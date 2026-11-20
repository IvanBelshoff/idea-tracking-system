import type { DataSource, EntityManager } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { addDaysToDay, todayInZone } from '../common/dates.js';
import type { NotificationDraft } from '../communication/notification-rules.js';
import { dispatchNotifications } from '../communication/notify.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { IdeaParticipant, ParticipantOrigin, ParticipantRole } from '../ideas/entities/idea-related.entity.js';
import { recordEvent } from '../ideas/ideas.service.js';
import { getSetting } from '../organization/settings.service.js';
import { Highlight, HighlightConsent, type HighlightScope, HighlightStatus } from './entities.js';
import { candidateReason, eligibility } from './hall-rules.js';

export interface HighlightInput {
  ideaId: string;
  scope: HighlightScope;
  justification: string;
  startsOn: string;
  endsOn: string;
}

/**
 * Cria o destaque (RN-72 a RN-74, RN-80). Quem chama já conferiu a permissão. Convergida destaca a
 * principal; Não autorizada nunca (422). Autor e co-autores recebem o aviso e o pedido de
 * consentimento; o histórico da ideia registra o destaque (e, com o reconhecimento ligado, os pontos).
 */
export async function createHighlight(
  m: EntityManager,
  input: HighlightInput,
  actorId: string | null,
): Promise<string> {
  let idea = await m.getRepository(Idea).findOneBy({ id: input.ideaId });
  if (idea?.convergedIntoId) idea = await m.getRepository(Idea).findOneBy({ id: idea.convergedIntoId });
  if (!idea || idea.archivedAt) throw apiError(404, 'not_found', 'Ideia não encontrada.');
  const ok = eligibility(idea.status, await getSetting(m, 'hall.allow_in_progress'));
  if (ok !== 'ok') {
    throw apiError(
      422,
      ok === 'rejected' ? 'idea_rejected' : 'not_implemented',
      ok === 'rejected' ? 'Ideia não autorizada nunca vai para o Hall.' : 'Só ideias implementadas podem ser destaque.',
    );
  }
  const duplicate = await m.getRepository(Highlight).existsBy({
    ideaId: idea.id,
    scope: input.scope,
    status: HighlightStatus.Active,
  });
  if (duplicate) throw apiError(409, 'already_highlighted', 'Esta ideia já está em destaque neste escopo.');

  const repo = m.getRepository(Highlight);
  const highlight = await repo.save(
    repo.create({
      ideaId: idea.id,
      scope: input.scope,
      justification: input.justification,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      curatedById: actorId,
    }),
  );
  // Autor e co-autores (o co-autor por convergência só com a opção ligada; CA-RN-89.2).
  const withConverged = await getSetting(m, 'recognition.converged_coauthorship');
  const participants = await m
    .getRepository(IdeaParticipant)
    .find({ where: { ideaId: idea.id }, order: { createdAt: 'ASC' } });
  const people = participants.filter(
    (p) =>
      p.role === ParticipantRole.Author ||
      (p.role === ParticipantRole.CoAuthor && (withConverged || p.origin !== ParticipantOrigin.Converged)),
  );
  if (people.length > 0) {
    await m.getRepository(HighlightConsent).insert(
      people.map((p) => ({
        highlightId: highlight.id,
        userId: p.userId,
        role: p.role === ParticipantRole.Author ? ('author' as const) : ('co_author' as const),
      })),
    );
  }
  await recordEvent(m, {
    ideaId: idea.id,
    type: 'highlighted',
    actorId,
    data: { scope: input.scope, startsOn: input.startsOn, endsOn: input.endsOn, highlightId: highlight.id },
    reason: input.justification,
  });
  const drafts: NotificationDraft[] = people.map((p) => ({
    userId: p.userId,
    type: 'idea_highlighted',
    ideaId: idea.id,
    payload: { code: idea.code, title: idea.title, scope: input.scope, highlightId: highlight.id },
  }));
  await dispatchNotifications(m, drafts);
  return highlight.id;
}

export interface Candidate {
  ideaId: string;
  code: string;
  title: string;
  entity: string;
  reason: 'gain' | 'likes';
  validatedAnnual: number | null;
  currency: string | null;
  likes: number;
}

/**
 * Candidatas automáticas (RN-72b, CA-RN-72.2): implementadas, sem destaque (fora os revogados), não
 * recusadas pelo curador (CA-RN-72.3) e com ganho validado ou curtidas acima do configurado.
 */
export async function listCandidates(m: EntityManager, entityIds: string[] | null): Promise<Candidate[]> {
  const criteria = {
    minGain: await getSetting(m, 'hall.suggest_min_gain'),
    minLikes: (await getSetting(m, 'hall.likes_enabled')) ? await getSetting(m, 'hall.suggest_min_likes') : 0,
  };
  if (criteria.minGain <= 0 && criteria.minLikes <= 0) return [];
  const rows: {
    id: string;
    code: string;
    title: string;
    entity: string;
    gain: string | null;
    currency: string | null;
    likes: string;
  }[] = await m.query(
    `SELECT i.id, i.code, i.title, e.name AS entity,
              CASE WHEN g.status = 'validated' THEN CASE g.periodicity WHEN 'monthly' THEN g.realized * 12 ELSE g.realized END END AS gain,
              g.currency,
              (SELECT count(*) FROM idea_like l WHERE l.idea_id = i.id) AS likes
         FROM idea i
         JOIN entity e ON e.id = i.entity_id
         LEFT JOIN financial_gain g ON g.idea_id = i.id
        WHERE i.status = 'implemented' AND i.archived_at IS NULL AND i.converged_into_id IS NULL
          AND ($1::uuid[] IS NULL OR i.entity_id = ANY($1::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM highlight h WHERE h.idea_id = i.id AND h.status <> 'revoked')
          AND NOT EXISTS (SELECT 1 FROM hall_dismissal d WHERE d.idea_id = i.id)`,
    [entityIds],
  );
  return rows
    .map((r) => {
      const stats = { validatedAnnual: r.gain === null ? null : Number(r.gain), likes: Number(r.likes) };
      const reason = candidateReason(stats, criteria);
      return reason
        ? {
            ideaId: r.id,
            code: r.code,
            title: r.title,
            entity: r.entity,
            reason,
            validatedAnnual: stats.validatedAnnual,
            currency: stats.validatedAnnual === null ? null : r.currency,
            likes: stats.likes,
          }
        : null;
    })
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => (b.validatedAnnual ?? 0) - (a.validatedAnnual ?? 0) || b.likes - a.likes)
    .slice(0, 50);
}

/** Destaques vencidos vão para o Hall da fama (CA-RN-78.1). Idempotente: só muda quem ainda está ativo. */
export async function expireHighlights(m: EntityManager, today: string): Promise<number> {
  const res: [unknown[], number] = await m.query(
    `UPDATE highlight SET status = 'expired' WHERE status = 'active' AND ends_on < $1::date RETURNING id`,
    [today],
  );
  return Array.isArray(res[0]) ? res[0].length : 0;
}

/**
 * Job do Hall (worker): expira os vencidos e, só com a entrada automática ligada pelo admin
 * (RN-72), destaca as candidatas por 30 dias no escopo da entidade.
 */
export async function runHallJobs(ds: DataSource, now = new Date()): Promise<{ expired: number; created: number }> {
  const today = todayInZone(now, await getSetting(ds.manager, 'organization.timezone'));
  const expired = await ds.transaction((m) => expireHighlights(m, today));
  let created = 0;
  if (await getSetting(ds.manager, 'hall.auto_entry')) {
    for (const c of await listCandidates(ds.manager, null)) {
      await ds.transaction(async (m) => {
        await createHighlight(
          m,
          {
            ideaId: c.ideaId,
            scope: 'entity',
            justification: c.reason === 'gain' ? 'Entrada automática: ganho validado' : 'Entrada automática: curtidas',
            startsOn: today,
            endsOn: addDaysToDay(today, 30),
          },
          null,
        );
        created += 1;
      });
    }
  }
  return { expired, created };
}
