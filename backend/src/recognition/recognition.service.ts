import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { z } from 'zod';
import { apiError } from '../common/api-error.js';
import { todayInZone } from '../common/dates.js';
import { dispatchNotifications } from '../communication/notify.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import type { Access } from '../identity-access/access.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { photoVersions } from '../identity-access/photo-versions.js';
import { SettingsService } from '../organization/settings.service.js';
import { currentSeason, grantAchievements, totalPoints } from './award.js';
import { Achievement, Level, RewardRecord, Season, UserAchievement } from './entities.js';
import type {
  AchievementSchema,
  AchievementView,
  LevelView,
  MyRecognition,
  Ranking,
  RewardSchema,
  RewardView,
  SeasonSchema,
  SeasonView,
} from './recognition.dto.js';
import { levelIndex, sortedLevels } from './recognition-rules.js';

const RANKING_SIZE = 20;

/**
 * Reconhecimento (RN-66 a RN-71). Desligado por padrão: com o módulo desligado, nada é registrado e
 * as telas de pontos e ranking respondem 404 (CA-RN-66.2). A configuração (níveis, conquistas,
 * temporadas) pode ser preparada antes de ligar.
 */
@Injectable()
export class RecognitionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
  ) {}

  private async assertEnabled(): Promise<void> {
    if (!(await this.settings.get('recognition.enabled'))) {
      throw apiError(404, 'recognition_disabled', 'O reconhecimento está desligado nesta instalação.');
    }
  }

  private async today(m: EntityManager = this.dataSource.manager): Promise<string> {
    return todayInZone(new Date(), await this.settings.get('organization.timezone', m));
  }

  private seasonView(s: Season, today: string): SeasonView {
    return {
      id: s.id,
      name: s.name,
      startsOn: s.startsOn,
      endsOn: s.endsOn,
      campaignId: s.campaignId,
      current: s.startsOn <= today && s.endsOn >= today,
    };
  }

  /** Painel da própria pessoa: pontos, nível, conquistas, últimos lançamentos e recompensas. */
  async me(userId: string): Promise<MyRecognition> {
    await this.assertEnabled();
    const m = this.dataSource.manager;
    const [season, levels, achievements, granted, user] = await Promise.all([
      currentSeason(m),
      m.getRepository(Level).find(),
      m.getRepository(Achievement).find({ where: { active: true }, order: { threshold: 'ASC' } }),
      m.getRepository(UserAchievement).find({ where: { userId } }),
      m.getRepository(User).findOneByOrFail({ id: userId }),
    ]);
    const total = await totalPoints(m, userId);
    let seasonPoints: number | null = null;
    if (season) {
      const [row]: { total: string | null }[] = await m.query(
        'SELECT sum(points) AS total FROM point_ledger WHERE user_id = $1 AND season_id = $2',
        [userId, season.id],
      );
      seasonPoints = Number(row?.total ?? 0);
    }
    const sorted = sortedLevels(levels);
    const idx = levelIndex(total, sorted);
    const recent: {
      event_type: string;
      points: number;
      code: string | null;
      title: string | null;
      created_at: Date;
    }[] = await m.query(
      `SELECT l.event_type, l.points, i.code, i.title, l.created_at FROM point_ledger l
           LEFT JOIN idea i ON i.id = l.idea_id WHERE l.user_id = $1 ORDER BY l.created_at DESC LIMIT 20`,
      [userId],
    );
    const ref = (l: Level | undefined) => (l ? { name: l.name, minPoints: l.minPoints } : null);
    const grantedAt = new Map(granted.map((g) => [g.achievementId, g.grantedAt]));
    const today = await this.today(m);
    return {
      totalPoints: total,
      seasonPoints,
      season: season ? this.seasonView(season, today) : null,
      level: ref(sorted[idx]),
      nextLevel: ref(sorted[idx + 1]),
      achievements: achievements.map((a) => ({
        code: a.code,
        name: a.name,
        description: a.description,
        grantedAt: grantedAt.get(a.id)?.toISOString() ?? null,
      })),
      recent: recent.map((r) => ({
        eventType: r.event_type,
        points: r.points,
        ideaCode: r.code,
        ideaTitle: r.title,
        at: new Date(r.created_at).toISOString(),
      })),
      rewards: await this.rewardsOf(m, userId),
      nameVisible: !user.hideName,
    };
  }

  /**
   * Ranking (RN-66, RN-70): individual ou por entidade, da temporada de hoje ou de sempre. Quem
   * oculta o nome aparece sem nome (CA-RN-70.1). Ranking individual desligado → 404 (CA-RN-70.2).
   */
  async ranking(userId: string, scope: 'individual' | 'entity', period: 'season' | 'all'): Promise<Ranking> {
    await this.assertEnabled();
    if (scope === 'individual' && !(await this.settings.get('recognition.individual_ranking'))) {
      throw apiError(404, 'not_found', 'Ranking individual desligado nesta instalação.');
    }
    const m = this.dataSource.manager;
    const season = period === 'season' ? await currentSeason(m) : null;
    const filter = season ? 'AND l.season_id = $1' : '';
    const params = season ? [season.id] : [];
    const today = await this.today(m);
    if (scope === 'entity') {
      const rows: { name: string; total: string }[] = await m.query(
        `SELECT e.name, sum(l.points) AS total FROM point_ledger l JOIN idea i ON i.id = l.idea_id
           JOIN entity e ON e.id = i.entity_id WHERE true ${filter}
          GROUP BY e.id, e.name ORDER BY total DESC, e.name LIMIT ${RANKING_SIZE}`,
        params,
      );
      return {
        scope,
        period: season ? 'season' : 'all',
        season: season ? this.seasonView(season, today) : null,
        rows: rows.map((r, i) => ({
          position: i + 1,
          name: r.name,
          userId: null,
          photoVersion: null,
          points: Number(r.total),
          isMe: false,
        })),
      };
    }
    const rows: { id: string; name: string; hide_name: boolean; status: string; total: string }[] = await m.query(
      `SELECT u.id, u.name, u.hide_name, u.status, sum(l.points) AS total FROM point_ledger l
         JOIN "user" u ON u.id = l.user_id WHERE true ${filter}
        GROUP BY u.id ORDER BY total DESC, u.id LIMIT ${RANKING_SIZE}`,
      params,
    );
    const photos = await photoVersions(
      m,
      rows.map((r) => r.id),
    );
    const shows = (r: (typeof rows)[number]) => !(r.hide_name || r.status === UserStatus.Anonymized);
    return {
      scope,
      period: season ? 'season' : 'all',
      season: season ? this.seasonView(season, today) : null,
      rows: rows.map((r, i) => ({
        position: i + 1,
        // Opt-out (RN-70) e conta anonimizada não mostram nome nem foto; a própria pessoa se reconhece pelo "isMe".
        name: shows(r) ? r.name : null,
        userId: shows(r) ? r.id : null,
        photoVersion: shows(r) ? (photos.get(r.id) ?? null) : null,
        points: Number(r.total),
        isMe: r.id === userId,
      })),
    };
  }

  // --- Configuração (setting.manage) ----------------------------------------------------------

  async levels(): Promise<LevelView[]> {
    const levels = await this.dataSource.getRepository(Level).find();
    return sortedLevels(levels).map((l) => ({ id: l.id, name: l.name, minPoints: l.minPoints }));
  }

  /** Troca a lista inteira de níveis (RN-67). Só muda o nome da faixa: os pontos não são recalculados. */
  async replaceLevels(levels: { name: string; minPoints: number }[]): Promise<LevelView[]> {
    await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(Level);
      await repo.clear();
      for (const l of levels) await repo.save(repo.create(l));
    });
    return this.levels();
  }

  async achievements(): Promise<AchievementView[]> {
    const list = await this.dataSource.getRepository(Achievement).find();
    const counts: { achievement_id: string; n: string }[] = await this.dataSource.query(
      'SELECT achievement_id, count(*) AS n FROM user_achievement GROUP BY achievement_id',
    );
    return list
      .sort((a, b) => a.ruleType.localeCompare(b.ruleType) || a.threshold - b.threshold)
      .map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        description: a.description,
        ruleType: a.ruleType,
        threshold: a.threshold,
        active: a.active,
        holders: Number(counts.find((c) => c.achievement_id === a.id)?.n ?? 0),
      }));
  }

  async saveAchievement(id: string | null, input: z.infer<typeof AchievementSchema>): Promise<AchievementView[]> {
    const repo = this.dataSource.getRepository(Achievement);
    const clash = await repo.findOneBy({ code: input.code });
    if (clash && clash.id !== id) {
      throw apiError(409, 'duplicate_code', 'Já existe uma conquista com este código.');
    }
    if (id) {
      if (!(await repo.existsBy({ id }))) throw apiError(404, 'not_found', 'Conquista não encontrada.');
      await repo.update(id, input);
    } else {
      await repo.save(repo.create(input));
    }
    return this.achievements();
  }

  async removeAchievement(id: string): Promise<AchievementView[]> {
    await this.dataSource.getRepository(Achievement).delete(id);
    return this.achievements();
  }

  /**
   * Conceder agora (CA-RN-68.1): a única forma de dar uma conquista a quem já cumpria a regra antes.
   * Avalia todas as pessoas ativas com alguma ideia; cada uma recebe no máximo uma vez.
   */
  async grantRetroactive(id: string): Promise<number> {
    if (!(await this.dataSource.getRepository(Achievement).existsBy({ id, active: true }))) {
      throw apiError(404, 'not_found', 'Conquista ativa não encontrada.');
    }
    return this.dataSource.transaction(async (m) => {
      const users: { id: string }[] = await m.query(
        `SELECT DISTINCT u.id FROM "user" u
          WHERE u.status = 'active' AND (EXISTS (SELECT 1 FROM idea i WHERE i.author_id = u.id)
             OR EXISTS (SELECT 1 FROM point_ledger l WHERE l.user_id = u.id))`,
      );
      let granted = 0;
      for (const u of users) {
        // Só a conquista pedida: as outras continuam esperando uma ação da pessoa.
        const drafts = await grantAchievements(m, u.id, null, id);
        granted += drafts.length;
        await dispatchNotifications(m, drafts);
      }
      return granted;
    });
  }

  async seasons(): Promise<SeasonView[]> {
    const today = await this.today();
    const list = await this.dataSource.getRepository(Season).find({ order: { startsOn: 'DESC' } });
    return list.map((s) => this.seasonView(s, today));
  }

  /** Temporadas não se sobrepõem: em cada dia vale no máximo uma (o ranking da temporada é claro). */
  async saveSeason(id: string | null, input: z.infer<typeof SeasonSchema>): Promise<SeasonView[]> {
    await this.dataSource.transaction(async (m) => {
      const overlap: { id: string }[] = await m.query(
        'SELECT id FROM season WHERE starts_on <= $2 AND ends_on >= $1 AND ($3::uuid IS NULL OR id <> $3)',
        [input.startsOn, input.endsOn, id],
      );
      if (overlap.length > 0) {
        throw apiError(409, 'season_overlap', 'Já existe uma temporada nesse período.');
      }
      const repo = m.getRepository(Season);
      if (id) {
        if (!(await repo.existsBy({ id }))) throw apiError(404, 'not_found', 'Temporada não encontrada.');
        await repo.update(id, input);
      } else {
        await repo.save(repo.create(input));
      }
    });
    return this.seasons();
  }

  async removeSeason(id: string): Promise<SeasonView[]> {
    await this.dataSource.getRepository(Season).delete(id);
    return this.seasons();
  }

  // --- Recompensas (RN-71) ------------------------------------------------------------------------

  private async rewardsOf(m: EntityManager, userId?: string): Promise<RewardView[]> {
    const rows = await m.getRepository(RewardRecord).find({
      where: userId ? { userId } : {},
      relations: { user: true, idea: true, registeredBy: true },
      order: { grantedOn: 'DESC', createdAt: 'DESC' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      userName: r.user.name,
      ideaCode: r.idea?.code ?? null,
      description: r.description,
      grantedOn: r.grantedOn,
      registeredBy: r.registeredBy?.name ?? null,
    }));
  }

  async rewards(): Promise<RewardView[]> {
    return this.rewardsOf(this.dataSource.manager);
  }

  /** Registro informativo (CA-RN-71.1): texto e data, sem valor nem pagamento. */
  async registerReward(access: Access, input: z.infer<typeof RewardSchema>): Promise<RewardView[]> {
    const m = this.dataSource.manager;
    const user = await m.getRepository(User).findOneBy({ id: input.userId });
    if (!user || user.status === UserStatus.Anonymized) {
      throw apiError(422, 'validation_failed', 'Pessoa inexistente.', [
        { path: 'userId', message: 'Escolha uma pessoa.' },
      ]);
    }
    let ideaId: string | null = null;
    if (input.ideaRef) {
      const idea = await m.getRepository(Idea).findOne({
        where: /^[0-9a-f-]{36}$/i.test(input.ideaRef) ? { id: input.ideaRef } : { code: input.ideaRef.toUpperCase() },
      });
      if (!idea) {
        throw apiError(422, 'validation_failed', 'Ideia não encontrada.', [
          { path: 'ideaRef', message: 'Código inexistente.' },
        ]);
      }
      if (!access.hasIn('reward.register', idea.entityId)) {
        throw apiError(403, 'forbidden', 'Você não registra recompensas nas ideias desta entidade.');
      }
      ideaId = idea.id;
    }
    const repo = m.getRepository(RewardRecord);
    await repo.save(
      repo.create({
        userId: user.id,
        ideaId,
        description: input.description,
        grantedOn: input.grantedOn,
        registeredById: access.userId,
      }),
    );
    return this.rewards();
  }
}
