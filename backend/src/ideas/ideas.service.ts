import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, type DataSource, type EntityManager, In } from 'typeorm';
import { CampaignsService } from '../campaigns/campaigns.service.js';
import { Campaign } from '../campaigns/entities.js';
import { apiError } from '../common/api-error.js';
import { todayInZone, yearInZone } from '../common/dates.js';
import { type PageQuery, pageMeta } from '../common/pagination.js';
import type { RichDoc } from '../common/rich-text.js';
import { notifyIdeaEvent } from '../communication/notify.js';
import type { Access } from '../identity-access/access.js';
import { AccessService } from '../identity-access/access.service.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { Integration } from '../integration/entities.js';
import { emitForIdeaEvent } from '../integration/webhooks/webhook-emit.js';
import { withdrawForIdeaEvent } from '../mural/mural-core.js';
import { Category } from '../organization/entities/category.entity.js';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import { SettingsService } from '../organization/settings.service.js';
import { subtreeIds } from '../organization/tree.js';
import { newPublicCode } from '../public/public.service.js';
import { awardForIdeaEvent } from '../recognition/award.js';
import { snapshotAuthorFields } from '../user-fields/snapshot.js';
import { canSupport, requesterCount } from './convergence-rules.js';
import { Idea, IdeaCategory, IdeaStatus } from './entities/idea.entity.js';
import {
  IdeaEvent,
  IdeaParticipant,
  ParticipantOrigin,
  ParticipantRole,
  Step,
  Visibility,
} from './entities/idea-related.entity.js';
import {
  FinancialGain,
  GainStatus,
  Measurement,
  SustainmentReview,
  SustainmentStatus,
} from './entities/result.entity.js';
import { TriageRule } from './entities/triage-rule.entity.js';
import { type IdeaCapabilities, ideaCapabilities } from './idea-access.js';
import { nextIdeaCode } from './idea-code.js';
import type { IdeaDetail, IdeaPage, IdeaSummary, PersonOption, StepView } from './ideas.dto.js';
import { isClosed } from './lifecycle.js';
import { nextPdcaPhase } from './results-rules.js';
import { gainView, measurementView } from './results-view.js';
import { ideaDeadline, isDeletableStep, isEditableStep, isLate, openStep, progress } from './steps-rules.js';
import { chooseTriageRule, isTriageOverdue, triageDueDate } from './triage-rules.js';

export const notFound = () => apiError(404, 'not_found', 'Ideia não encontrada.');
const CODE = /^[A-Z][A-Z0-9]{1,7}-\d{4}-\d{4,}$/;

export interface ApproveInput {
  stepName: string;
  stepDescription: string | null;
  stepDescriptionRich?: RichDoc | null;
  assigneeId: string;
  dueDate: string;
  stepModel?: 'free' | 'pdca';
}

export interface SubmitInput {
  title: string;
  description: string;
  /** O documento do editor, quando veio dele (RN-136); a coluna de texto é a cópia em texto puro. */
  descriptionRich?: RichDoc | null;
  proposedSolutionRich?: RichDoc | null;
  entityId: string;
  categoryId?: string | null;
  tagIds: string[];
  proposedSolution: string | null;
  expectedGain: string | null;
  externalRef: string | null;
  onBehalfOfUserId?: string | null;
  approveNow?: ApproveInput | null;
  /** Réplica de outra ideia (RN-64). */
  originIdeaId?: string | null;
  /** Campanha ativa (RN-51); vazio = fluxo contínuo. */
  campaignId?: string | null;
  /** A integração que enviou pela API (M18, RN-133): vai na ideia e no histórico. */
  sourceIntegration?: { id: string; name: string } | null;
}

/** Registro no histórico da ideia (RN-38), na transação da ação. */
export async function recordEvent(
  m: EntityManager,
  e: {
    ideaId: string;
    type: string;
    actorId: string | null;
    visibility?: Visibility;
    reason?: string | null;
    data?: object;
  },
): Promise<void> {
  const repo = m.getRepository(IdeaEvent);
  await repo.save(
    repo.create({
      ideaId: e.ideaId,
      type: e.type,
      actorId: e.actorId,
      reason: e.reason ?? null,
      data: (e.data ?? {}) as Record<string, unknown>,
      visibility: e.visibility ?? Visibility.Public,
    }),
  );
  // Avisos ao autor e ao analista saem do próprio histórico, na mesma transação (M4).
  await notifyIdeaEvent(m, {
    ideaId: e.ideaId,
    type: e.type,
    actorId: e.actorId,
    reason: e.reason,
    data: e.data as Record<string, unknown>,
  });
  // Pontos do reconhecimento (M8), também do histórico; com o módulo desligado, nada acontece.
  await awardForIdeaEvent(m, { ideaId: e.ideaId, type: e.type, data: e.data as Record<string, unknown> });
  // Webhooks de saída (M17, RN-119): o evento nasce aqui, na mesma transação; com a chave desligada, nada acontece.
  // O que uma integração causou não volta para ela (RN-133): o `integrationId` do dado é a origem.
  const data = (e.data ?? {}) as Record<string, unknown>;
  await emitForIdeaEvent(m, {
    ideaId: e.ideaId,
    type: e.type,
    data,
    originIntegrationId: typeof data.integrationId === 'string' ? data.integrationId : null,
  });
  // Mural (M21, RN-149): interromper ou arquivar retira a ideia do mural, na mesma transação.
  await withdrawForIdeaEvent(m, { ideaId: e.ideaId, type: e.type, data }, recordEvent);
}

/** Sugestão de ideia parecida (RN-57). */
export interface SimilarIdea {
  code: string;
  title: string;
  status: IdeaStatus;
  canView: boolean;
  canSupport: boolean;
  own: boolean;
}

/** Filtros da lista da equipe (também usados pela exportação). */
export interface IdeaFilters {
  status: IdeaStatus[];
  entityId?: string;
  categoryId?: string;
  search?: string;
  assignedToMe: boolean;
  sort: 'oldest' | 'newest' | 'priority';
}

/** Teto de linhas por exportação (evita pedir o banco inteiro de uma vez). */
export const EXPORT_LIMIT = 10_000;

/** Ideia convergida não tem fluxo próprio: só se desfaz a convergência (RN-84, RN-88). */
export const convergedError = () =>
  apiError(
    409,
    'idea_converged',
    'Esta ideia foi convergida com outra e não tem fluxo próprio. Acompanhe pela principal.',
  );

const ref = (u: { id: string; name: string } | null | undefined) => (u ? { id: u.id, name: u.name } : null);
const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * Ideias: envio, consultas com escopo, detalhe e edição. As transições ficam em
 * `IdeasWorkflowService`; comentários e linha do tempo em `IdeaActivityService`.
 */
@Injectable()
export class IdeasService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly accessService: AccessService,
    private readonly campaigns: CampaignsService,
  ) {}

  // --- leitura -----------------------------------------------------------------------------------

  private baseQuery(m: EntityManager = this.dataSource.manager) {
    return m
      .getRepository(Idea)
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.entity', 'entity')
      .leftJoinAndSelect('i.category', 'category')
      .leftJoinAndSelect('i.author', 'author')
      .leftJoinAndSelect('i.assignedTo', 'assignedTo')
      .leftJoinAndSelect('i.convergedInto', 'convergedInto');
  }

  /** Hoje no fuso da instalação (prazos e atraso; CA-T.3). */
  async today(m: EntityManager = this.dataSource.manager): Promise<string> {
    return todayInZone(new Date(), await this.settings.get('organization.timezone', m));
  }

  /**
   * Previsão de retorno da triagem (RN-54): envio (no fuso da instalação) + prazo, em dias corridos
   * ou úteis conforme a configuração; e se a ideia ainda Enviada já passou dela.
   */
  async triageCalc(m: EntityManager = this.dataSource.manager) {
    const [zone, sla, business] = await Promise.all([
      this.settings.get('organization.timezone', m),
      this.settings.get('triage.sla_days', m),
      this.settings.get('triage.business_days', m),
    ]);
    const today = todayInZone(new Date(), zone);
    return (i: Pick<Idea, 'submittedAt' | 'status'>) => {
      const triageDue = triageDueDate(todayInZone(i.submittedAt, zone), sla, business);
      return { triageDue, triageOverdue: isTriageOverdue(i.status, triageDue, today) };
    };
  }

  /** Acrescenta prazo, atraso e previsão de retorno às linhas da lista, com uma consulta só às etapas. */
  private async withDeadlines(rows: Idea[], teamEntities: readonly string[] = []): Promise<IdeaSummary[]> {
    if (rows.length === 0) return [];
    const steps = await this.dataSource.getRepository(Step).findBy({ ideaId: In(rows.map((r) => r.id)) });
    const today = await this.today();
    const triage = await this.triageCalc();
    return rows.map((r) => {
      const own = steps.filter((s) => s.ideaId === r.id);
      return {
        ...IdeasService.summary(r),
        deadline: ideaDeadline(own),
        late: isLate(r.status, own, today),
        ...triage(r),
        ...IdeasService.priority(r, teamEntities.includes(r.entityId)),
      };
    });
  }

  /** Impacto e esforço são apoio da equipe à decisão: quem não é da equipe (o autor) não vê. */
  static priority(i: Pick<Idea, 'impact' | 'effort'>, team: boolean) {
    return team ? { impact: i.impact, effort: i.effort } : { impact: null, effort: null };
  }

  static summary(
    i: Idea,
  ): Omit<IdeaSummary, 'deadline' | 'late' | 'triageDue' | 'triageOverdue' | 'impact' | 'effort'> {
    return {
      id: i.id,
      code: i.code,
      title: i.title,
      // Convergida não tem fluxo próprio: mostra a situação da principal (CA-RN-84.2, 88.2).
      status: i.convergedInto?.status ?? i.status,
      convergedInto: i.convergedInto ? { code: i.convergedInto.code, title: i.convergedInto.title } : null,
      relation: null,
      entity: { id: i.entity.id, name: i.entity.name },
      category: i.category ? { id: i.category.id, name: i.category.name, color: i.category.color } : null,
      author: ref(i.author),
      assignedTo: ref(i.assignedTo),
      submittedAt: i.submittedAt.toISOString(),
      archivedAt: iso(i.archivedAt),
    };
  }

  /**
   * Carrega a ideia por id ou pelo código (`ITS-2026-0042`) e confere se quem chama a vê.
   * Fora do escopo → 404, sem revelar que existe (CA-RN-01.2, CA-T.5).
   */
  async findVisible(
    access: Access,
    refValue: string,
    m?: EntityManager,
  ): Promise<{ idea: Idea; can: IdeaCapabilities }> {
    const qb = this.baseQuery(m);
    if (CODE.test(refValue)) qb.where('i.code = :code', { code: refValue });
    else if (/^[0-9a-f-]{36}$/i.test(refValue)) qb.where('i.id = :id', { id: refValue });
    else throw notFound();
    const idea = await qb.getOne();
    if (!idea) throw notFound();
    let can = ideaCapabilities(access, idea);
    if (!can.view) {
      const manager = m ?? this.dataSource.manager;
      const involved =
        (await manager.getRepository(IdeaParticipant).existsBy({ ideaId: idea.id, userId: access.userId })) ||
        (await manager.getRepository(Step).existsBy({ ideaId: idea.id, assigneeId: access.userId }));
      if (involved) can = ideaCapabilities(access, idea, true);
    }
    if (!can.view) throw notFound();
    return { idea, can };
  }

  async detail(access: Access, refValue: string, m: EntityManager = this.dataSource.manager): Promise<IdeaDetail> {
    const { idea, can } = await this.findVisible(access, refValue, m);
    const [tags, steps, registeredBy, via] = await Promise.all([
      m.getRepository(IdeaCategory).find({ where: { ideaId: idea.id }, relations: { category: true } }),
      m
        .getRepository(Step)
        .find({ where: { ideaId: idea.id }, relations: { assignee: true }, order: { position: 'ASC' } }),
      idea.registeredById ? m.getRepository(User).findOneBy({ id: idea.registeredById }) : null,
      idea.sourceIntegrationId ? m.getRepository(Integration).findOneBy({ id: idea.sourceIntegrationId }) : null,
    ]);
    const [measurement, gain, origin, replicas, review, campaign, highlightRow] = await Promise.all([
      m.getRepository(Measurement).findOneBy({ ideaId: idea.id }),
      m.getRepository(FinancialGain).findOne({ where: { ideaId: idea.id }, relations: { validatedBy: true } }),
      idea.originIdeaId ? m.getRepository(Idea).findOneBy({ id: idea.originIdeaId }) : null,
      m.getRepository(Idea).find({ where: { originIdeaId: idea.id }, order: { submittedAt: 'ASC' } }),
      m.getRepository(SustainmentReview).findOne({
        where: { ideaId: idea.id },
        relations: { reviewedBy: true },
        order: { createdAt: 'DESC' },
      }),
      idea.campaignId ? m.getRepository(Campaign).findOneBy({ id: idea.campaignId }) : null,
      m.query("SELECT id FROM highlight WHERE idea_id = $1 AND status = 'active' ORDER BY starts_on DESC LIMIT 1", [
        idea.id,
      ]) as Promise<{ id: string }[]>,
    ]);
    const [participants, convergedIdeas] = await Promise.all([
      m.getRepository(IdeaParticipant).find({
        where: { ideaId: idea.id },
        relations: { user: true, sourceIdea: true },
        order: { createdAt: 'ASC' },
      }),
      m.getRepository(Idea).find({
        where: { convergedIntoId: idea.id },
        relations: { author: true },
        order: { submittedAt: 'ASC' },
      }),
    ]);
    const converged = idea.convergedIntoId !== null;
    const team = can.commentInternal;
    const canConverge = access.hasIn('idea.converge', idea.entityId);
    const validator = access.hasIn('gain.validate', idea.entityId);
    const editResults = !converged && can.triage && idea.archivedAt === null && idea.status !== IdeaStatus.Rejected;
    const counts: { step_id: string; n: string }[] = steps.length
      ? await m.query('SELECT step_id, count(*) AS n FROM attachment WHERE step_id = ANY($1) GROUP BY step_id', [
          steps.map((s) => s.id),
        ])
      : [];
    const closedOrNotRunning = idea.status !== IdeaStatus.InProgress;
    const stepViews: StepView[] = steps.map((s) => ({
      id: s.id,
      position: s.position,
      name: s.name,
      description: s.description,
      descriptionRich: s.descriptionRich,
      assignee: { id: s.assignee.id, name: s.assignee.name },
      startDate: s.startDate,
      dueDate: s.dueDate,
      completedAt: iso(s.completedAt),
      editable: can.manageSteps && !closedOrNotRunning && isEditableStep(s, steps),
      deletable: can.manageSteps && !closedOrNotRunning && isDeletableStep(s, steps),
      canComplete: !closedOrNotRunning && s.completedAt === null && (can.manageSteps || s.assigneeId === access.userId),
      attachmentsCount: Number(counts.find((c) => c.step_id === s.id)?.n ?? 0),
      pdcaPhase: s.pdcaPhase,
    }));
    const today = await this.today(m);
    const mode = await this.settings.get('steps.progress_mode', m);
    const triage = await this.triageCalc(m);
    return {
      ...IdeasService.summary(idea),
      deadline: ideaDeadline(steps),
      late: isLate(idea.status, steps, today),
      ...triage(idea),
      ...IdeasService.priority(idea, can.commentInternal),
      publicLookup: can.isAuthor ? { enabled: idea.publicEnabled, code: idea.publicCode } : null,
      description: idea.description,
      descriptionRich: idea.descriptionRich,
      proposedSolution: idea.proposedSolution,
      proposedSolutionRich: idea.proposedSolutionRich,
      expectedGain: idea.expectedGain,
      externalRef: idea.externalRef,
      tags: tags.map((t) => ({ id: t.category.id, name: t.category.name, color: t.category.color })),
      registeredBy: ref(registeredBy),
      viaIntegration: via?.name ?? null,
      reviewStartedAt: iso(idea.reviewStartedAt),
      decidedAt: iso(idea.decidedAt),
      implementedAt: iso(idea.implementedAt),
      rejectionReason: idea.rejectionReason,
      resultText: idea.resultText,
      resultTextRich: idea.resultTextRich,
      steps: stepViews,
      progress: progress(mode, idea.status, steps, today),
      progressMode: mode,
      allStepsCompleted: idea.status === IdeaStatus.InProgress && steps.length > 0 && openStep(steps) === null,
      requesters: requesterCount(participants.filter((p) => p.role === ParticipantRole.CoAuthor).length),
      participants: participants.map((p) => ({
        id: p.id,
        user: { id: p.user.id, name: p.user.name },
        role: p.role,
        origin: p.origin,
        // O texto de quem apoiou e a ideia de origem são da equipe; o autor vê só quantos pediram (RN-86).
        note: team ? p.note : null,
        sourceCode: team ? (p.sourceIdea?.code ?? null) : null,
      })),
      convergedIdeas: team
        ? convergedIdeas.map((c) => ({
            code: c.code,
            title: c.title,
            description: c.description,
            author: ref(c.author),
            convergedAt: iso(c.convergedAt),
            reason: c.convergedReason,
          }))
        : [],
      convergedReason: converged ? idea.convergedReason : null,
      stepModel: idea.stepModel,
      nextPdcaPhase: idea.stepModel === 'pdca' ? nextPdcaPhase(steps.at(-1)?.pdcaPhase ?? null) : null,
      measurement: measurementView(measurement),
      // Valor em dinheiro: para a equipe, para quem pediu a ideia e para quem valida ganhos (RN-63).
      gain: team || can.isAuthor || validator ? gainView(gain) : null,
      standardAdopted: idea.standardAdopted,
      standardAdoptedRich: idea.standardAdoptedRich,
      isReplicable: idea.isReplicable,
      origin: origin ? { code: origin.code, title: origin.title } : null,
      replicas: replicas.map((r) => ({ code: r.code, title: r.title })),
      campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
      highlightId: highlightRow[0]?.id ?? null,
      sustainment: review
        ? {
            dueOn: review.dueOn,
            status: review.status,
            due: review.dueOn <= today,
            reviewedBy: ref(review.reviewedBy),
            reviewedAt: iso(review.reviewedAt),
            note: review.note,
          }
        : null,
      // Convergida não tem fluxo próprio: nenhuma ação, só desfazer (RN-84, RN-88).
      can: {
        edit: !converged && can.edit,
        triage: !converged && can.triage,
        reopen: !converged && can.reopen,
        archive: can.archive,
        delete: can.delete,
        manageSteps: !converged && can.manageSteps,
        comment: !converged && can.comment,
        commentInternal: !converged && can.commentInternal,
        converge: !converged && canConverge && !isClosed(idea.status),
        unconverge: converged && canConverge,
        support:
          !converged &&
          !can.isAuthor &&
          canSupport(idea.status) &&
          !participants.some((p) => p.userId === access.userId),
        manageParticipants: !converged && can.triage,
        editResults,
        validateGain:
          validator &&
          idea.status === IdeaStatus.Implemented &&
          gain?.realized != null &&
          gain.status === GainStatus.Declared,
        highlight:
          !converged &&
          idea.archivedAt === null &&
          (access.hasIn('hall.highlight_entity', idea.entityId) || access.hasIn('hall.highlight_org', idea.entityId)) &&
          (idea.status === IdeaStatus.Implemented ||
            (idea.status === IdeaStatus.InProgress && (await this.settings.get('hall.allow_in_progress', m)))),
        reviewSustainment:
          !converged &&
          review?.status === SustainmentStatus.Pending &&
          review.dueOn <= today &&
          (can.triage || idea.assignedToId === access.userId),
        replicate:
          !converged &&
          idea.status === IdeaStatus.Implemented &&
          idea.isReplicable &&
          access.entities('idea.submit').some((e) => e !== idea.entityId),
      },
    };
  }

  /**
   * Liga ou desliga a consulta pública da ideia (RN-37). Só o autor: nem a equipe nem o administrador
   * mexem (CA-RN-37.1). Quem não vê a ideia recebe 404; quem vê e não é o autor, 403.
   */
  async setPublicLookup(access: Access, refValue: string, enabled: boolean): Promise<IdeaDetail> {
    const { idea, can } = await this.findVisible(access, refValue);
    if (!can.isAuthor) throw apiError(403, 'forbidden', 'Só o autor da ideia altera a consulta pública dela.');
    await this.dataSource.getRepository(Idea).update(idea.id, { publicEnabled: enabled });
    return this.detail(access, idea.id);
  }

  /**
   * Ideia que a pessoa pode apoiar: uma que ela vê, ou (com `ideas.similar_show_titles`) uma da
   * entidade onde ela envia ideias, que a sugestão mostrou só pelo título (RN-57). Fora disso, 404.
   */
  async findForSupport(access: Access, refValue: string, m: EntityManager): Promise<Idea> {
    try {
      return (await this.findVisible(access, refValue, m)).idea;
    } catch (error) {
      const qb = this.baseQuery(m);
      if (CODE.test(refValue)) qb.where('i.code = :code', { code: refValue });
      else if (/^[0-9a-f-]{36}$/i.test(refValue)) qb.where('i.id = :id', { id: refValue });
      else throw error;
      const idea = await qb.getOne();
      const allowed =
        idea && (await this.settings.get('ideas.similar_show_titles', m)) && access.hasIn('idea.submit', idea.entityId);
      if (!idea || !allowed) throw error;
      return idea;
    }
  }

  /**
   * Ideias parecidas com o que a pessoa está digitando (RN-57), por trigramas sobre título +
   * descrição sem acento (índice `ix_idea_search_trgm`). Nunca revela o que ela não pode ver
   * (CA-RN-57.2): as que ela vê vêm completas; com `ideas.similar_show_titles`, as abertas da
   * entidade onde ela envia vêm só com título e situação. Sem convergidas, arquivadas e encerradas.
   */
  async similar(access: Access, text: string, entityId?: string): Promise<SimilarIdea[]> {
    const q = text.trim();
    if (q.length < 4) return [];
    const visible = access.entities('idea.view_scope');
    const titlesOnly =
      entityId && access.hasIn('idea.submit', entityId) && (await this.settings.get('ideas.similar_show_titles'))
        ? subtreeIds(entityId, await this.accessService.tree())
        : [];
    return this.dataSource.transaction(async (m) => {
      await m.query("SELECT set_config('pg_trgm.word_similarity_threshold', '0.45', true)");
      const rows: {
        id: string;
        code: string;
        title: string;
        status: IdeaStatus;
        entity_id: string;
        author_id: string | null;
        score: number;
      }[] = await m.query(
        `SELECT i.id, i.code, i.title, i.status, i.entity_id, i.author_id,
                  word_similarity(immutable_unaccent(lower($1)), immutable_unaccent(lower(i.title || ' ' || i.description))) AS score
             FROM idea i
            WHERE immutable_unaccent(lower($1)) <% immutable_unaccent(lower(i.title || ' ' || i.description))
              AND i.archived_at IS NULL AND i.converged_into_id IS NULL
              AND i.status IN ('submitted', 'in_review', 'in_progress')
              AND (i.entity_id = ANY($2::uuid[]) OR i.entity_id = ANY($3::uuid[]) OR i.author_id = $4
                   OR EXISTS (SELECT 1 FROM idea_participant p WHERE p.idea_id = i.id AND p.user_id = $4))
            ORDER BY score DESC, i.submitted_at ASC
            LIMIT 5`,
        [q, visible, titlesOnly, access.userId],
      );
      const mine = new Set(
        (
          await m.query('SELECT idea_id FROM idea_participant WHERE user_id = $1 AND idea_id = ANY($2::uuid[])', [
            access.userId,
            rows.map((r) => r.id),
          ])
        ).map((r: { idea_id: string }) => r.idea_id),
      );
      return rows.map((r) => {
        const own = r.author_id === access.userId;
        return {
          code: r.code,
          title: r.title,
          status: r.status,
          // Sem acesso completo, a pessoa só vê o título (CA-RN-57.2).
          canView: own || visible.includes(r.entity_id) || mine.has(r.id),
          canSupport: !own && !mine.has(r.id),
          own,
        };
      });
    });
  }

  /** As minhas ideias (o autor sempre vê as suas, qualquer que seja o escopo; CA-RN-01.4). */
  async mine(access: Access, query: PageQuery & { status: IdeaStatus[] }): Promise<IdeaPage> {
    // As que a pessoa enviou (inclusive as convergidas, com "Convergida com X") e as que ela acompanha
    // como co-autora (RN-87).
    const qb = this.baseQuery()
      .where('i.archived_at IS NULL')
      .andWhere(
        new Brackets((w) => {
          w.where('i.author_id = :me', { me: access.userId }).orWhere(
            `EXISTS (SELECT 1 FROM idea_participant p WHERE p.idea_id = i.id AND p.user_id = :me AND p.role = 'co_author')`,
          );
        }),
      );
    if (query.status.length > 0) {
      qb.andWhere('COALESCE("convergedInto"."status", i.status) IN (:...status)', { status: query.status });
    }
    const [rows, total] = await qb
      .orderBy('i.submitted_at', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    const items = await this.withDeadlines(rows);
    return {
      items: items.map((item, n) => ({
        ...item,
        relation: rows[n]?.authorId === access.userId ? 'author' : 'co_author',
      })),
      meta: pageMeta(query, total),
    };
  }

  /**
   * Lista da equipe (fila e consulta): só as entidades onde a pessoa tem `idea.view_scope`
   * (CA-RN-01.3), mais as próprias. Filtro por entidade inclui as descendentes (CA-RN-25.2).
   */
  async list(access: Access, q: PageQuery & IdeaFilters): Promise<IdeaPage> {
    const qb = await this.filteredQuery(access, q);
    const [rows, total] = await qb
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return { items: await this.withDeadlines(rows, access.entities('idea.view_scope')), meta: pageMeta(q, total) };
  }

  /** Exportação (RN-48): as MESMAS linhas que a lista mostraria com estes filtros, sem paginar (teto de 10 mil). */
  async exportRows(access: Access, q: IdeaFilters): Promise<IdeaSummary[]> {
    const qb = await this.filteredQuery(access, q);
    return this.withDeadlines(await qb.take(EXPORT_LIMIT).getMany(), access.entities('idea.view_scope'));
  }

  private async filteredQuery(access: Access, q: IdeaFilters) {
    const scope = access.entities('idea.view_scope');
    const qb = this.baseQuery()
      .where('i.archived_at IS NULL')
      // Convergida sai das filas (CA-RN-84.2); quem acompanha é a principal.
      .andWhere('i.converged_into_id IS NULL')
      .andWhere(
        new Brackets((w) => {
          w.where('i.author_id = :me', { me: access.userId });
          if (scope.length > 0) w.orWhere('i.entity_id IN (:...scope)', { scope });
        }),
      );
    if (q.status.length > 0) qb.andWhere('i.status IN (:...status)', { status: q.status });
    if (q.entityId) {
      const ids = subtreeIds(q.entityId, await this.accessService.tree());
      qb.andWhere(ids.length > 0 ? 'i.entity_id IN (:...ids)' : '1 = 0', { ids });
    }
    if (q.categoryId) qb.andWhere('i.category_id = :cat', { cat: q.categoryId });
    if (q.assignedToMe) qb.andWhere('i.assigned_to_id = :me2', { me2: access.userId });
    if (q.search) {
      const like = `%${q.search.replace(/[%_\\]/g, '\\$&')}%`;
      qb.andWhere('(i.code ILIKE :like OR i.title ILIKE :like OR i.external_ref ILIKE :like)', { like });
    }
    // Prioridade (CA-RN-56.2): maior impacto ÷ esforço primeiro, desempate pela data de envio;
    // sem avaliação, depois das avaliadas.
    if (q.sort === 'priority') {
      return qb.orderBy('i.priorityScore', 'DESC', 'NULLS LAST').addOrderBy('i.submitted_at', 'ASC');
    }
    return qb.orderBy('i.submitted_at', q.sort === 'oldest' ? 'ASC' : 'DESC');
  }

  /** Pessoas ativas para escolher autor (RN-04) ou responsável de etapa (RN-06). */
  /**
   * Pessoas ativas para os seletores da equipe. A busca também procura nos campos pesquisáveis que não são
   * sensíveis (RN-200), e cada resultado traz esses valores (ex.: a matrícula). O sensível nunca entra.
   */
  async people(search: string): Promise<PersonOption[]> {
    const qb = this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .where('u.status = :active', { active: UserStatus.Active })
      .orderBy('u.name', 'ASC')
      .take(20);
    if (search) {
      const like = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
      const bare = search.replace(/[^\p{L}\p{N}]/gu, '').replace(/[%_\\]/g, '\\$&');
      qb.andWhere(
        `(u.name ILIKE :like OR u.email ILIKE :like OR EXISTS (
           SELECT 1 FROM user_field_value v JOIN user_field f ON f.id = v.field_id
             LEFT JOIN user_field_option o ON o.id = v.option_id
            WHERE v.user_id = u.id AND f.active AND f.searchable AND NOT f.sensitive
              AND (COALESCE(v.value, o.label) ILIKE :like
                   OR (CAST(:bare AS text) <> '' AND regexp_replace(v.value, '[^[:alnum:]]', '', 'g') ILIKE :qb))))`,
        { like, bare, qb: `%${bare}%` },
      );
    }
    const users = await qb.getMany();
    const rows: { user_id: string; label_pt: string; label_en: string | null; value: string }[] = users.length
      ? await this.dataSource.query(
          `SELECT v.user_id, f.label_pt, f.label_en, COALESCE(v.value, o.label) AS value
             FROM user_field_value v JOIN user_field f ON f.id = v.field_id
             LEFT JOIN user_field_option o ON o.id = v.option_id
            WHERE v.user_id = ANY($1) AND f.active AND f.searchable AND NOT f.sensitive
            ORDER BY f.sort_order`,
          [users.map((u) => u.id)],
        )
      : [];
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      fields: rows
        .filter((r) => r.user_id === u.id)
        .map((r) => ({ labelPt: r.label_pt, labelEn: r.label_en, value: r.value })),
    }));
  }

  // --- validações compartilhadas -------------------------------------------------------------------

  /** Entidade e categorias existentes e ativas (RN-26) e categoria obrigatória (RN-03). */
  private async validateClassification(
    m: EntityManager,
    input: { entityId?: string; categoryId?: string | null; tagIds?: string[] },
    requireCategory: boolean,
  ): Promise<void> {
    const problems: { path: string; message: string }[] = [];
    if (input.entityId !== undefined) {
      const entity = await m.getRepository(OrgEntity).findOneBy({ id: input.entityId });
      if (!entity) problems.push({ path: 'entityId', message: 'Entidade inexistente.' });
      else if (!entity.active) problems.push({ path: 'entityId', message: 'Entidade inativa não recebe ideias.' });
    }
    if (input.categoryId) {
      const category = await m.getRepository(Category).findOneBy({ id: input.categoryId });
      if (!category) problems.push({ path: 'categoryId', message: 'Categoria inexistente.' });
      else if (!category.active) problems.push({ path: 'categoryId', message: 'Categoria inativa não recebe ideias.' });
    } else if (requireCategory) {
      problems.push({ path: 'categoryId', message: 'Escolha uma categoria.' });
    }
    if (input.tagIds && input.tagIds.length > 0) {
      const tags = await m.getRepository(Category).findBy({ id: In(input.tagIds), active: true });
      if (tags.length !== new Set(input.tagIds).size) {
        problems.push({ path: 'tagIds', message: 'Categoria secundária inexistente ou inativa.' });
      }
    }
    if (problems.length > 0) throw apiError(422, 'validation_failed', 'Confira os campos indicados.', problems);
  }

  /** Cria a primeira etapa ao aprovar (RN-06): responsável ativo e prevista ≥ hoje (no fuso da instalação). */
  async createFirstStep(m: EntityManager, ideaId: string, input: ApproveInput, actorId: string): Promise<void> {
    const idea = await m.getRepository(Idea).findOneByOrFail({ id: ideaId });
    const assignee = await this.assertAssignee(m, input.assigneeId, idea.entityId);
    const today = todayInZone(new Date(), await this.settings.get('organization.timezone', m));
    if (input.dueDate < today) {
      throw apiError(422, 'validation_failed', 'A data prevista não pode ser anterior a hoje.', [
        { path: 'dueDate', message: 'A data prevista não pode ser anterior a hoje.' },
      ]);
    }
    const steps = m.getRepository(Step);
    const pdca = input.stepModel === 'pdca';
    await steps.save(
      steps.create({
        ideaId,
        position: 1,
        name: input.stepName,
        description: input.stepDescription,
        descriptionRich: input.stepDescriptionRich ?? null,
        assigneeId: assignee.id,
        startDate: today,
        dueDate: input.dueDate,
        pdcaPhase: pdca ? 'plan' : null,
      }),
    );
    await m.getRepository(Idea).update(ideaId, { stepModel: pdca ? 'pdca' : 'free' });
    await recordEvent(m, {
      ideaId,
      type: 'step_added',
      actorId,
      data: {
        position: 1,
        name: input.stepName,
        assignee: { id: assignee.id, name: assignee.name },
        dueDate: input.dueDate,
      },
    });
  }

  /** Responsável de etapa: ativo e com acesso à entidade da ideia (RN-15, CA-RN-15.2). */
  async assertAssignee(m: EntityManager, assigneeId: string, entityId: string): Promise<User> {
    const assignee = await m.getRepository(User).findOneBy({ id: assigneeId });
    const ok =
      assignee?.status === UserStatus.Active && (await this.accessService.load(assignee.id)).hasAnyIn(entityId);
    if (!assignee || !ok) {
      throw apiError(422, 'validation_failed', 'O responsável precisa estar ativo e ter acesso à entidade da ideia.', [
        { path: 'assigneeId', message: 'Escolha alguém ativo com acesso à entidade da ideia.' },
      ]);
    }
    return assignee;
  }

  // --- envio -------------------------------------------------------------------------------------

  /**
   * Envio (RN-02 a RN-04): o autor é quem envia, nunca um campo do corpo; em nome de outro, exige
   * `idea.register_for_other` na entidade; "já aprovar" (D3) exige triagem e o atalho ligado.
   */
  async submit(
    access: Access,
    input: SubmitInput,
    after?: { eventData: Record<string, unknown>; run: (m: EntityManager, idea: Idea) => Promise<void> },
  ): Promise<IdeaDetail> {
    const onBehalf = input.onBehalfOfUserId && input.onBehalfOfUserId !== access.userId ? input.onBehalfOfUserId : null;
    if (onBehalf) {
      if (!access.hasIn('idea.register_for_other', input.entityId)) {
        throw apiError(403, 'forbidden', 'Você não pode cadastrar ideias em nome de outras pessoas nesta entidade.');
      }
    } else if (!access.hasIn('idea.submit', input.entityId)) {
      throw apiError(403, 'forbidden', 'Você não pode enviar ideias para esta entidade.');
    }
    if (input.approveNow && !access.hasIn('idea.triage', input.entityId)) {
      throw apiError(403, 'forbidden', 'Você não pode aprovar ideias nesta entidade.');
    }

    const created = await this.dataSource.transaction(async (m) => {
      const requireCategory = await this.settings.get('ideas.category_required', m);
      await this.validateClassification(m, input, requireCategory);
      if (input.campaignId) {
        await this.campaigns.assertEligible(m, input.campaignId, {
          entityId: input.entityId,
          categoryId: input.categoryId ?? null,
        });
      }
      if (input.approveNow && !(await this.settings.get('ideas.triage_shortcut', m))) {
        throw apiError(409, 'shortcut_disabled', 'O atalho de aprovação no cadastro está desligado.');
      }
      let authorId = access.userId;
      if (onBehalf) {
        const author = await m.getRepository(User).findOneBy({ id: onBehalf });
        if (!author || author.status !== UserStatus.Active) {
          throw apiError(422, 'validation_failed', 'Autor inexistente ou inativo.', [
            { path: 'onBehalfOfUserId', message: 'Escolha uma pessoa ativa.' },
          ]);
        }
        authorId = author.id;
      }

      const now = new Date();
      const tz = await this.settings.get('organization.timezone', m);
      const code = await nextIdeaCode(m, await this.settings.get('ideas.code_prefix', m), yearInZone(now, tz));
      const ideas = m.getRepository(Idea);
      const idea = await ideas.save(
        ideas.create({
          code,
          publicCode: newPublicCode(),
          title: input.title,
          description: input.description,
          descriptionRich: input.descriptionRich ?? null,
          proposedSolution: input.proposedSolution,
          proposedSolutionRich: input.proposedSolutionRich ?? null,
          expectedGain: input.expectedGain,
          externalRef: input.externalRef,
          entityId: input.entityId,
          categoryId: input.categoryId ?? null,
          authorId,
          registeredById: onBehalf ? access.userId : null,
          status: IdeaStatus.Submitted,
          submittedAt: now,
          originIdeaId: input.originIdeaId ?? null,
          campaignId: input.campaignId ?? null,
          sourceIntegrationId: input.sourceIntegration?.id ?? null,
        }),
      );
      const participants = m.getRepository(IdeaParticipant);
      await participants.save(
        participants.create({
          ideaId: idea.id,
          userId: authorId,
          role: ParticipantRole.Author,
          origin: ParticipantOrigin.Original,
          addedById: access.userId,
        }),
      );
      // Os campos fechados do autor, como estão agora (M25, RN-201).
      await snapshotAuthorFields(m, idea.id, authorId);
      const tagIds = [...new Set(input.tagIds)].filter((t) => t !== input.categoryId);
      if (tagIds.length > 0)
        await m.getRepository(IdeaCategory).insert(tagIds.map((categoryId) => ({ ideaId: idea.id, categoryId })));
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'created',
        actorId: access.userId,
        data: {
          code,
          ...(onBehalf ? { onBehalfOf: authorId } : {}),
          ...(input.sourceIntegration
            ? { integrationId: input.sourceIntegration.id, integrationName: input.sourceIntegration.name }
            : {}),
          ...(after ? after.eventData : {}),
        },
      });

      if (input.approveNow) {
        await ideas.update(idea.id, { status: IdeaStatus.InReview, assignedToId: access.userId, reviewStartedAt: now });
        await recordEvent(m, {
          ideaId: idea.id,
          type: 'status_changed',
          actorId: access.userId,
          data: { from: 'submitted', to: 'in_review' },
        });
        await this.createFirstStep(m, idea.id, input.approveNow, access.userId);
        await ideas.update(idea.id, { status: IdeaStatus.InProgress, decidedAt: now });
        await recordEvent(m, {
          ideaId: idea.id,
          type: 'status_changed',
          actorId: access.userId,
          data: { from: 'in_review', to: 'in_progress' },
        });
      } else {
        await this.autoAssign(m, idea);
      }
      if (after) await after.run(m, idea);
      return idea;
    });
    return this.detail(await this.accessService.load(access.userId), created.id);
  }

  /** Quem pode receber a triagem da ideia: ativo e com `idea.triage` na entidade dela. */
  async canTriage(m: EntityManager, userId: string, entityId: string): Promise<boolean> {
    const user = await m.getRepository(User).findOneBy({ id: userId });
    return user?.status === UserStatus.Active && (await this.accessService.load(userId)).hasIn('idea.triage', entityId);
  }

  /**
   * Atribuição automática (RN-55): a regra mais específica escolhe o analista; a ideia continua
   * Enviada (ele ainda precisa assumir). Se o analista da regra não puder triar ali (inativo ou fora
   * do escopo), a ideia fica na fila geral, sem erro para quem enviou.
   */
  private async autoAssign(m: EntityManager, idea: Idea): Promise<void> {
    const rules = await m.getRepository(TriageRule).findBy({ active: true });
    if (rules.length === 0) return;
    const rule = chooseTriageRule(
      rules,
      { entityId: idea.entityId, categoryId: idea.categoryId },
      await this.accessService.tree(),
    );
    if (!rule || !(await this.canTriage(m, rule.assigneeId, idea.entityId))) return;
    await m.getRepository(Idea).update(idea.id, { assignedToId: rule.assigneeId });
    await recordEvent(m, {
      ideaId: idea.id,
      type: 'assigned',
      actorId: null,
      data: { from: null, to: rule.assigneeId, rule: true },
    });
  }

  // --- edição ------------------------------------------------------------------------------------

  /** Edita o conteúdo enquanto aberta (RN-08); o status nunca muda por aqui (RN-10). */
  async update(
    access: Access,
    refValue: string,
    input: Partial<{
      title: string;
      description: string;
      descriptionRich: RichDoc | null;
      entityId: string;
      categoryId: string | null;
      tagIds: string[];
      proposedSolution: string | null;
      proposedSolutionRich: RichDoc | null;
      expectedGain: string | null;
      externalRef: string | null;
    }>,
  ): Promise<IdeaDetail> {
    const fields = Object.keys(input).filter((k) => !k.endsWith('Rich'));
    if (fields.length === 0) throw apiError(400, 'validation_failed', 'Informe ao menos um campo.');
    await this.dataSource.transaction(async (m) => {
      const visible = await this.findVisible(access, refValue, m);
      // Trava a linha e relê: a decisão usa o estado de agora, não o da leitura anterior.
      const idea = await this.lock(m, visible.idea.id);
      const can = ideaCapabilities(access, idea);
      if (isClosed(idea.status)) {
        throw apiError(409, 'idea_closed', 'Ideia encerrada: somente leitura.');
      }
      if (idea.convergedIntoId) throw convergedError();
      if (!can.edit) throw apiError(403, 'forbidden', 'Você não pode editar esta ideia.');
      if (input.entityId && input.entityId !== idea.entityId && !access.hasIn('idea.triage', input.entityId)) {
        throw apiError(403, 'forbidden', 'Você não pode mover a ideia para esta entidade.');
      }
      const requireCategory = await this.settings.get('ideas.category_required', m);
      const categoryTouched = 'categoryId' in input;
      await this.validateClassification(
        m,
        {
          entityId: input.entityId,
          categoryId: categoryTouched ? input.categoryId : idea.categoryId,
          tagIds: input.tagIds,
        },
        requireCategory && categoryTouched,
      );
      const { tagIds, ...columns } = input;
      // Texto puro que muda sem o documento do editor: o documento antigo deixa de valer (RN-136).
      if ('description' in input) columns.descriptionRich = input.descriptionRich ?? null;
      if ('proposedSolution' in input) columns.proposedSolutionRich = input.proposedSolutionRich ?? null;
      if (Object.keys(columns).length > 0) await m.getRepository(Idea).update(idea.id, columns);
      if (tagIds) {
        await m.getRepository(IdeaCategory).delete({ ideaId: idea.id });
        const unique = [...new Set(tagIds)].filter((t) => t !== (categoryTouched ? input.categoryId : idea.categoryId));
        if (unique.length > 0)
          await m.getRepository(IdeaCategory).insert(unique.map((categoryId) => ({ ideaId: idea.id, categoryId })));
      }
      await recordEvent(m, { ideaId: idea.id, type: 'updated', actorId: access.userId, data: { fields } });
    });
    return this.detail(access, refValue);
  }

  /**
   * Trava a linha da ideia até o fim da transação (SELECT ... FOR UPDATE) e devolve o estado atual.
   * Duas ações simultâneas na mesma ideia ficam em fila; a segunda vê o resultado da primeira (CA-T.2).
   */
  async lock(m: EntityManager, id: string): Promise<Idea> {
    const idea = await m
      .getRepository(Idea)
      .createQueryBuilder('i')
      .setLock('pessimistic_write')
      .where('i.id = :id', { id })
      .getOne();
    if (!idea) throw notFound();
    return idea;
  }
}
