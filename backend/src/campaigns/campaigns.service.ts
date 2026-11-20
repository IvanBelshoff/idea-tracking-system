import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, In } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { todayInZone } from '../common/dates.js';
import type { Access } from '../identity-access/access.js';
import { AccessService } from '../identity-access/access.service.js';
import { emitWebhookEvent } from '../integration/webhooks/webhook-emit.js';
import { Category } from '../organization/entities/category.entity.js';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import { SettingsService } from '../organization/settings.service.js';
import { subtreeIds } from '../organization/tree.js';
import { canTransition, goalProgress, isEligible } from './campaign-rules.js';
import type { CampaignDashboard, CampaignInput, CampaignView, HallCandidate } from './campaigns.dto.js';
import { Campaign, CampaignCategory, CampaignEntity, CampaignStatus } from './entities.js';

const notFound = () => apiError(404, 'not_found', 'Campanha não encontrada.');

interface Loaded {
  campaign: Campaign;
  entityIds: string[];
  categoryIds: string[];
}

/**
 * Campanhas (RN-50 a RN-53). Quem gerencia precisa de `campaign.manage` em todas as entidades-alvo
 * (campanha para todas as entidades exige a permissão na raiz). O painel conta só as ideias do
 * escopo de quem vê (RN-49).
 */
@Injectable()
export class CampaignsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accessService: AccessService,
    private readonly settings: SettingsService,
  ) {}

  private async today(m: EntityManager = this.dataSource.manager): Promise<string> {
    return todayInZone(new Date(), await this.settings.get('organization.timezone', m));
  }

  private async rootId(): Promise<string | undefined> {
    const tree = await this.accessService.tree();
    return tree.find((n) => n.mpath.split('.').filter(Boolean).length === 1)?.id;
  }

  private async canManage(access: Access, entityIds: readonly string[]): Promise<boolean> {
    if (entityIds.length === 0) {
      const root = await this.rootId();
      return !!root && access.hasIn('campaign.manage', root);
    }
    return entityIds.every((id) => access.hasIn('campaign.manage', id));
  }

  private async assertManage(access: Access, entityIds: readonly string[]): Promise<void> {
    if (!(await this.canManage(access, entityIds))) {
      throw apiError(
        403,
        'forbidden',
        entityIds.length === 0
          ? 'Campanha para todas as entidades exige gerenciar campanhas na organização inteira.'
          : 'Você não gerencia campanhas em todas as entidades escolhidas.',
      );
    }
  }

  private async load(m: EntityManager, id: string): Promise<Loaded> {
    const campaign = await m.getRepository(Campaign).findOneBy({ id });
    if (!campaign) throw notFound();
    const [entities, categories] = await Promise.all([
      m.getRepository(CampaignEntity).findBy({ campaignId: id }),
      m.getRepository(CampaignCategory).findBy({ campaignId: id }),
    ]);
    return { campaign, entityIds: entities.map((e) => e.entityId), categoryIds: categories.map((c) => c.categoryId) };
  }

  private async views(access: Access, loaded: Loaded[]): Promise<CampaignView[]> {
    const entityIds = [...new Set(loaded.flatMap((l) => l.entityIds))];
    const categoryIds = [...new Set(loaded.flatMap((l) => l.categoryIds))];
    const [entities, categories] = await Promise.all([
      entityIds.length ? this.dataSource.getRepository(OrgEntity).findBy({ id: In(entityIds) }) : [],
      categoryIds.length ? this.dataSource.getRepository(Category).findBy({ id: In(categoryIds) }) : [],
    ]);
    const name = new Map([...entities, ...categories].map((x) => [x.id, x.name]));
    const out: CampaignView[] = [];
    for (const { campaign: c, entityIds: eIds, categoryIds: cIds } of loaded) {
      out.push({
        id: c.id,
        name: c.name,
        objective: c.objective,
        objectiveRich: c.objectiveRich,
        startsOn: c.startsOn,
        endsOn: c.endsOn,
        goalType: c.goalType,
        goalValue: c.goalValue,
        goalText: c.goalText,
        rewardNote: c.rewardNote,
        status: c.status,
        entities: eIds.map((id) => ({ id, name: name.get(id) ?? '' })),
        categories: cIds.map((id) => ({ id, name: name.get(id) ?? '' })),
        closedAt: c.closedAt?.toISOString() ?? null,
        canManage: c.status !== CampaignStatus.Closed && (await this.canManage(access, eIds)),
      });
    }
    return out;
  }

  private async loadMany(m: EntityManager, campaigns: Campaign[]): Promise<Loaded[]> {
    if (campaigns.length === 0) return [];
    const ids = campaigns.map((c) => c.id);
    const [entities, categories] = await Promise.all([
      m.getRepository(CampaignEntity).findBy({ campaignId: In(ids) }),
      m.getRepository(CampaignCategory).findBy({ campaignId: In(ids) }),
    ]);
    return campaigns.map((campaign) => ({
      campaign,
      entityIds: entities.filter((e) => e.campaignId === campaign.id).map((e) => e.entityId),
      categoryIds: categories.filter((c) => c.campaignId === campaign.id).map((c) => c.categoryId),
    }));
  }

  /** Lista para quem gerencia campanhas ou acompanha indicadores. */
  async list(access: Access): Promise<CampaignView[]> {
    const campaigns = await this.dataSource.getRepository(Campaign).find({ order: { startsOn: 'DESC', name: 'ASC' } });
    return this.views(access, await this.loadMany(this.dataSource.manager, campaigns));
  }

  async get(access: Access, id: string): Promise<CampaignView> {
    const [view] = await this.views(access, [await this.load(this.dataSource.manager, id)]);
    return view as CampaignView;
  }

  private async replaceTargets(m: EntityManager, id: string, input: CampaignInput): Promise<void> {
    const tree = await this.accessService.tree();
    if (input.entityIds.some((e) => !tree.some((n) => n.id === e))) {
      throw apiError(422, 'validation_failed', 'Entidade inexistente.', [
        { path: 'entityIds', message: 'Entidade inexistente.' },
      ]);
    }
    const cats = input.categoryIds.length ? await m.getRepository(Category).countBy({ id: In(input.categoryIds) }) : 0;
    if (cats !== new Set(input.categoryIds).size) {
      throw apiError(422, 'validation_failed', 'Categoria inexistente.', [
        { path: 'categoryIds', message: 'Categoria inexistente.' },
      ]);
    }
    await m.getRepository(CampaignEntity).delete({ campaignId: id });
    await m.getRepository(CampaignCategory).delete({ campaignId: id });
    const entityIds = [...new Set(input.entityIds)];
    const categoryIds = [...new Set(input.categoryIds)];
    if (entityIds.length)
      await m.getRepository(CampaignEntity).insert(entityIds.map((entityId) => ({ campaignId: id, entityId })));
    if (categoryIds.length) {
      await m.getRepository(CampaignCategory).insert(categoryIds.map((categoryId) => ({ campaignId: id, categoryId })));
    }
  }

  private fields(input: CampaignInput) {
    return {
      name: input.name,
      objective: input.objective,
      objectiveRich: input.objectiveRich ?? null,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      goalType: input.goalType,
      goalValue: input.goalType === 'qualitative' ? null : input.goalValue,
      goalText: input.goalText,
      rewardNote: input.rewardNote,
    };
  }

  async create(access: Access, input: CampaignInput): Promise<CampaignView> {
    await this.assertManage(access, input.entityIds);
    const id = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(Campaign);
      const c = await repo.save(repo.create({ ...this.fields(input), createdById: access.userId }));
      await this.replaceTargets(m, c.id, input);
      return c.id;
    });
    return this.get(access, id);
  }

  async update(access: Access, id: string, input: CampaignInput): Promise<CampaignView> {
    await this.dataSource.transaction(async (m) => {
      const loaded = await this.load(m, id);
      await this.assertManage(access, loaded.entityIds);
      await this.assertManage(access, input.entityIds);
      if (loaded.campaign.status === CampaignStatus.Closed) {
        throw apiError(409, 'campaign_closed', 'Campanha encerrada não muda.');
      }
      await m.getRepository(Campaign).update(id, this.fields(input));
      await this.replaceTargets(m, id, input);
    });
    return this.get(access, id);
  }

  async activate(access: Access, id: string): Promise<CampaignView> {
    return this.transition(access, id, CampaignStatus.Active);
  }

  /** Encerrar (RN-53): grava o resumo e a lista de candidatas ao Hall; nada entra no Hall sozinho. */
  async close(access: Access, id: string): Promise<CampaignDashboard> {
    await this.transition(access, id, CampaignStatus.Closed);
    const dashboard = await this.dashboard(access, id, { allEntities: true });
    const { campaign: _c, summary: _s, ...snapshot } = dashboard;
    await this.dataSource.query('UPDATE campaign SET summary = $2::jsonb WHERE id = $1', [
      id,
      JSON.stringify({ ...snapshot, closedAt: new Date().toISOString() }),
    ]);
    return this.dashboard(access, id);
  }

  private async transition(access: Access, id: string, to: CampaignStatus): Promise<CampaignView> {
    await this.dataSource.transaction(async (m) => {
      const campaign = await m.getRepository(Campaign).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!campaign) throw notFound();
      const { entityIds } = await this.load(m, id);
      await this.assertManage(access, entityIds);
      if (!canTransition(campaign.status, to)) {
        throw apiError(409, 'invalid_transition', 'Mudança de estado não permitida (rascunho → ativa → encerrada).');
      }
      await m
        .getRepository(Campaign)
        .update(id, { status: to, ...(to === CampaignStatus.Closed ? { closedAt: new Date() } : {}) });
      // Webhook (M17, RN-119): a campanha vale para as entidades-alvo e suas subentidades; sem alvo, para todas.
      if (to === CampaignStatus.Active || to === CampaignStatus.Closed) {
        const tree = await this.accessService.tree();
        await emitWebhookEvent(m, {
          type: 'campaign.status_changed',
          data: { campaign_id: id, status: to },
          entityIds: entityIds.length === 0 ? null : [...new Set(entityIds.flatMap((e) => subtreeIds(e, tree)))],
        });
      }
    });
    return this.get(access, id);
  }

  async remove(access: Access, id: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const loaded = await this.load(m, id);
      await this.assertManage(access, loaded.entityIds);
      if (loaded.campaign.status !== CampaignStatus.Draft) {
        throw apiError(409, 'not_draft', 'Só campanha em rascunho pode ser excluída; as outras se encerram.');
      }
      await m.getRepository(Campaign).delete(id);
    });
  }

  /**
   * Campanhas que podem receber uma ideia (CA-RN-51.1). Sem entidade, as que servem para alguma
   * entidade onde a pessoa pode enviar ideias (destaque no formulário e no início).
   */
  async available(access: Access, entityId?: string, categoryId?: string): Promise<CampaignView[]> {
    const today = await this.today();
    const tree = await this.accessService.tree();
    const active = await this.loadMany(
      this.dataSource.manager,
      await this.dataSource
        .getRepository(Campaign)
        .find({ where: { status: CampaignStatus.Active }, order: { endsOn: 'ASC' } }),
    );
    const targets = entityId ? [entityId] : access.entities('idea.submit');
    // Sem categoria escolhida ainda, as categorias-alvo não filtram (o envio confere de novo).
    const fits = active.filter((l) =>
      targets.some((e) =>
        isEligible(
          { ...l.campaign, ...l, categoryIds: categoryId ? l.categoryIds : [] },
          { entityId: e, categoryId: categoryId ?? null },
          tree,
          today,
        ),
      ),
    );
    return this.views(access, fits);
  }

  /** Confere o vínculo no envio (RN-51): campanha indisponível para a ideia → 422. */
  async assertEligible(
    m: EntityManager,
    campaignId: string,
    idea: { entityId: string; categoryId: string | null },
  ): Promise<void> {
    const campaign = await m.getRepository(Campaign).findOneBy({ id: campaignId });
    const loaded = campaign ? (await this.loadMany(m, [campaign]))[0] : undefined;
    const ok =
      loaded &&
      isEligible({ ...loaded.campaign, ...loaded }, idea, await this.accessService.tree(), await this.today(m));
    if (!ok) {
      throw apiError(422, 'validation_failed', 'Esta campanha não está aberta para esta ideia.', [
        { path: 'campaignId', message: 'Campanha encerrada, fora do período ou de outra entidade ou categoria.' },
      ]);
    }
  }

  /**
   * Painel (RN-52, CA-RN-52.1): ideias recebidas, aprovadas e implementadas, participantes, ganho
   * validado e atingimento da meta. Conta só as ideias do escopo de quem vê (indicadores ou campanhas).
   */
  async dashboard(access: Access, id: string, opts: { allEntities?: boolean } = {}): Promise<CampaignDashboard> {
    const m = this.dataSource.manager;
    const loaded = await this.load(m, id);
    const [view] = await this.views(access, [loaded]);
    const tree = await this.accessService.tree();
    const scope = opts.allEntities
      ? tree.map((n) => n.id)
      : [...new Set([...access.entities('report.view'), ...access.entities('campaign.manage')])].flatMap((e) =>
          subtreeIds(e, tree),
        );
    const where =
      'i.campaign_id = $1 AND i.archived_at IS NULL AND i.converged_into_id IS NULL AND i.entity_id = ANY($2::uuid[])';
    const params = [id, [...new Set(scope)]];
    const [counts]: Record<string, string>[] = await m.query(
      `SELECT count(*) AS received,
              count(*) FILTER (WHERE i.decided_at IS NOT NULL AND i.status IN ('in_progress', 'implemented')) AS approved,
              count(*) FILTER (WHERE i.status = 'implemented') AS implemented,
              count(DISTINCT i.author_id) AS participants
         FROM idea i WHERE ${where}`,
      params,
    );
    const annual = `CASE g.periodicity WHEN 'monthly' THEN g.realized * 12 ELSE g.realized END`;
    const gains: { currency: string; total: string }[] = await m.query(
      `SELECT g.currency, sum(${annual}) AS total FROM idea i JOIN financial_gain g ON g.idea_id = i.id
        WHERE ${where} AND i.status = 'implemented' AND g.status = 'validated' AND g.realized IS NOT NULL
        GROUP BY g.currency ORDER BY total DESC`,
      params,
    );
    const candidates: {
      code: string;
      title: string;
      author: string | null;
      annual: string | null;
      currency: string | null;
    }[] = await m.query(
      `SELECT i.code, i.title, u.name AS author,
                CASE WHEN g.status = 'validated' THEN ${annual} END AS annual, g.currency
           FROM idea i LEFT JOIN "user" u ON u.id = i.author_id LEFT JOIN financial_gain g ON g.idea_id = i.id
          WHERE ${where} AND i.status = 'implemented'
          ORDER BY annual DESC NULLS LAST, i.implemented_at ASC LIMIT 10`,
      params,
    );
    const currency = await this.settings.get('results.currency', m);
    const received = Number(counts?.received ?? 0);
    const validatedMain = Number(gains.find((g) => g.currency === currency)?.total ?? gains[0]?.total ?? 0);
    const hallCandidates: HallCandidate[] = candidates.map((c) => ({
      code: c.code,
      title: c.title,
      author: c.author,
      validatedAnnual: c.annual === null ? null : Number(c.annual),
      currency: c.annual === null ? null : c.currency,
    }));
    return {
      campaign: view as CampaignView,
      received,
      approved: Number(counts?.approved ?? 0),
      implemented: Number(counts?.implemented ?? 0),
      participants: Number(counts?.participants ?? 0),
      gains: gains.map((g) => ({ currency: g.currency, validatedAnnual: Number(g.total) })),
      goalProgress: goalProgress(loaded.campaign.goalType, loaded.campaign.goalValue, received, validatedMain),
      hallCandidates,
      summary: (loaded.campaign.summary ?? null) as Record<string, unknown> | null,
    };
  }
}
