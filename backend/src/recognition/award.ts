import type { EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { todayInZone } from '../common/dates.js';
import type { NotificationDraft } from '../communication/notification-rules.js';
import { dispatchNotifications } from '../communication/notify.js';
import { splitPoints } from '../ideas/convergence-rules.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { IdeaParticipant, ParticipantOrigin, ParticipantRole } from '../ideas/entities/idea-related.entity.js';
import { getSetting } from '../organization/settings.service.js';
import { creditForPoint } from '../store/store-core.js';
import { Achievement, Level, type PointEvent, PointLedger, Season, UserAchievement } from './entities.js';
import { achievementMet, levelIndex, pointEventFor, sortedLevels, type UserStats } from './recognition-rules.js';

const WEIGHT = {
  idea_submitted: 'recognition.points_submitted',
  idea_approved: 'recognition.points_approved',
  idea_implemented: 'recognition.points_implemented',
  idea_highlighted: 'recognition.points_highlighted',
} as const;

/** Temporada vigente hoje (no fuso da instalação), se houver. */
export async function currentSeason(m: EntityManager): Promise<Season | null> {
  const today = todayInZone(new Date(), await getSetting(m, 'organization.timezone'));
  return m
    .getRepository(Season)
    .createQueryBuilder('s')
    .where('s.starts_on <= :today AND s.ends_on >= :today', { today })
    .orderBy('s.starts_on', 'DESC')
    .getOne();
}

/** Total de pontos da pessoa (todas as temporadas). */
export async function totalPoints(m: EntityManager, userId: string): Promise<number> {
  const [row]: { total: string | null }[] = await m.query(
    'SELECT sum(points) AS total FROM point_ledger WHERE user_id = $1',
    [userId],
  );
  return Number(row?.total ?? 0);
}

/** Contagens para as conquistas: ideias enviadas como autor; implementadas como autor ou co-autor. */
export async function userStats(m: EntityManager, userId: string): Promise<UserStats> {
  const [row]: { submitted: string; implemented: string }[] = await m.query(
    `SELECT
       (SELECT count(*) FROM idea WHERE author_id = $1 AND archived_at IS NULL) AS submitted,
       (SELECT count(DISTINCT i.id) FROM idea i JOIN idea_participant p ON p.idea_id = i.id
         WHERE p.user_id = $1 AND p.role IN ('author', 'co_author') AND i.status = 'implemented'
           AND i.archived_at IS NULL) AS implemented`,
    [userId],
  );
  return {
    ideasSubmitted: Number(row?.submitted ?? 0),
    ideasImplemented: Number(row?.implemented ?? 0),
    points: await totalPoints(m, userId),
  };
}

/**
 * Concede as conquistas que a pessoa acabou de alcançar (RN-68) e devolve os avisos. Só roda quando
 * a pessoa age (ou pelo botão "conceder agora" do admin): nada é dado de forma retroativa sozinho.
 */
export async function grantAchievements(
  m: EntityManager,
  userId: string,
  ideaId: string | null,
  onlyAchievementId?: string,
): Promise<NotificationDraft[]> {
  const achievements = await m
    .getRepository(Achievement)
    .findBy(onlyAchievementId ? { active: true, id: onlyAchievementId } : { active: true });
  if (achievements.length === 0) return [];
  const stats = await userStats(m, userId);
  const drafts: NotificationDraft[] = [];
  for (const a of achievements) {
    if (!achievementMet(a, stats)) continue;
    const inserted = await m
      .createQueryBuilder()
      .insert()
      .into(UserAchievement)
      .values({ userId, achievementId: a.id })
      .orIgnore()
      .returning(['user_id'])
      .execute();
    if (inserted.raw.length > 0) {
      drafts.push({ userId, type: 'achievement_granted', ideaId, payload: { name: a.name } });
    }
  }
  return drafts;
}

/**
 * Pontos do evento da ideia (RN-66, RN-89), na mesma transação do histórico. Módulo desligado →
 * nada (CA-RN-66.2). O peso vale do momento em diante (o lançamento guarda os pontos). A divisão
 * entre autor e co-autores fecha exatamente no total; co-autor por convergência só entra com a
 * opção ligada (CA-RN-89.2). Subida de nível e conquista nova geram aviso (CA-RN-67.2).
 */
export async function awardForIdeaEvent(
  m: EntityManager,
  event: { ideaId: string; type: string; data?: Record<string, unknown> },
): Promise<void> {
  const pointEvent = pointEventFor(event.type, event.data);
  if (!pointEvent || !(await getSetting(m, 'recognition.enabled'))) return;
  await awardPoints(m, event.ideaId, pointEvent);
}

export async function awardPoints(m: EntityManager, ideaId: string, pointEvent: PointEvent): Promise<void> {
  const total = await getSetting(m, WEIGHT[pointEvent]);
  if (total <= 0) return;
  const idea = await m.getRepository(Idea).findOne({ select: { id: true, authorId: true }, where: { id: ideaId } });
  if (!idea) return;
  const withConverged = await getSetting(m, 'recognition.converged_coauthorship');
  const coAuthors = (
    await m.getRepository(IdeaParticipant).find({
      where: { ideaId, role: ParticipantRole.CoAuthor },
      order: { createdAt: 'ASC' },
    })
  )
    .filter((p) => withConverged || p.origin !== ParticipantOrigin.Converged)
    .map((p) => p.userId)
    .filter((u) => u !== idea.authorId);
  const share = await getSetting(m, 'recognition.author_share');
  const split = idea.authorId
    ? splitPoints(total, share, coAuthors.length)
    : { author: 0, coAuthors: splitPoints(total, 0, coAuthors.length).coAuthors };
  const awards = [
    ...(idea.authorId ? [{ userId: idea.authorId, points: split.author }] : []),
    ...coAuthors.map((userId, i) => ({ userId, points: split.coAuthors[i] ?? 0 })),
  ].filter((a) => a.points > 0);
  if (awards.length === 0) return;

  const season = await currentSeason(m);
  const levels = sortedLevels(await m.getRepository(Level).find());
  const drafts: NotificationDraft[] = [];
  for (const a of awards) {
    const pointId = uuidv7();
    const inserted = await m
      .createQueryBuilder()
      .insert()
      .into(PointLedger)
      .values({
        id: pointId,
        userId: a.userId,
        ideaId,
        eventType: pointEvent,
        points: a.points,
        seasonId: season?.id ?? null,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    if (inserted.raw.length === 0) continue; // já pontuado (CA-RN-66.1)
    // Loja (M22, RN-161): o ponto ganho credita o saldo, na mesma transação, com o mesmo valor.
    await creditForPoint(m, { id: pointId, userId: a.userId, ideaId, points: a.points });
    const after = await totalPoints(m, a.userId);
    const before = after - a.points;
    const reached = levelIndex(after, levels);
    if (reached > levelIndex(before, levels) && reached >= 0) {
      drafts.push({ userId: a.userId, type: 'level_up', ideaId, payload: { level: levels[reached]?.name ?? '' } });
    }
    drafts.push(...(await grantAchievements(m, a.userId, ideaId)));
  }
  await dispatchNotifications(m, drafts);
}
