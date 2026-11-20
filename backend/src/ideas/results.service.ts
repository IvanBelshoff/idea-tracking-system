import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, In, IsNull, Not } from 'typeorm';
import { apiError } from '../common/api-error.js';
import type { RichDoc } from '../common/rich-text.js';
import type { Access } from '../identity-access/access.js';
import { SettingsService } from '../organization/settings.service.js';
import { Idea, IdeaStatus } from './entities/idea.entity.js';
import { Visibility } from './entities/idea-related.entity.js';
import {
  FinancialGain,
  GainStatus,
  Measurement,
  SustainmentReview,
  SustainmentStatus,
} from './entities/result.entity.js';
import type { IdeaCapabilities } from './idea-access.js';
import type { IdeaDetail, PendingGainView } from './ideas.dto.js';
import { IdeasService, recordEvent } from './ideas.service.js';
import type { Direction, Periodicity } from './results-rules.js';
import { gainView } from './results-view.js';

export interface MeasurementInput {
  indicator: string;
  unit: string;
  direction: Direction;
  baseline: number;
  target: number | null;
  achieved: number | null;
}

export interface GainInput {
  currency?: string;
  periodicity: Periodicity;
  estimated?: number | null;
  realized?: number | null;
  implementationCost?: number | null;
}

const forbidden = (message: string) => apiError(403, 'forbidden', message);
const conflict = (code: string, message: string) => apiError(409, code, message);

/**
 * Resultado da ideia (RN-61 a RN-64): medição, ganho financeiro com validação, lição aprendida e
 * réplica em outra entidade. Quem edita é quem tria na entidade; quem valida o ganho tem
 * `gain.validate`. Cada mudança vai para o histórico (o dinheiro só no histórico interno).
 */
@Injectable()
export class ResultsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ideas: IdeasService,
    private readonly settings: SettingsService,
  ) {}

  /** Trava a ideia, roda a mudança e devolve o detalhe atualizado. */
  private async withIdea(
    access: Access,
    refValue: string,
    fn: (m: EntityManager, idea: Idea, can: IdeaCapabilities) => Promise<void>,
  ): Promise<IdeaDetail> {
    const id = await this.dataSource.transaction(async (m) => {
      const { idea: seen, can } = await this.ideas.findVisible(access, refValue, m);
      const idea = await this.ideas.lock(m, seen.id);
      await fn(m, idea, can);
      return idea.id;
    });
    return this.ideas.detail(access, id);
  }

  /** Editar resultado: quem tria, em ideia não convergida, não arquivada e não recusada. */
  private assertEditable(idea: Idea, can: IdeaCapabilities): void {
    if (!can.triage) throw forbidden('Você não registra resultados nas ideias desta entidade.');
    if (idea.convergedIntoId) throw conflict('idea_converged', 'Esta ideia segue a principal; registre lá.');
    if (idea.archivedAt || idea.status === IdeaStatus.Rejected) {
      throw conflict('idea_closed', 'Ideia não autorizada ou arquivada não recebe resultado.');
    }
  }

  setMeasurement(access: Access, refValue: string, input: MeasurementInput): Promise<IdeaDetail> {
    return this.withIdea(access, refValue, async (m, idea, can) => {
      this.assertEditable(idea, can);
      await m.getRepository(Measurement).save({ ideaId: idea.id, ...input });
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'measurement_updated',
        actorId: access.userId,
        data: { indicator: input.indicator, unit: input.unit, target: input.target, achieved: input.achieved },
      });
    });
  }

  removeMeasurement(access: Access, refValue: string): Promise<IdeaDetail> {
    return this.withIdea(access, refValue, async (m, idea, can) => {
      this.assertEditable(idea, can);
      const res = await m.getRepository(Measurement).delete({ ideaId: idea.id });
      if (res.affected) await recordEvent(m, { ideaId: idea.id, type: 'measurement_removed', actorId: access.userId });
    });
  }

  /**
   * Ganho (RN-62): o estimado só na triagem (Enviada ou Em análise); o realizado só depois de
   * implementar (CA-RN-62.1). Mudar realizado, custo, moeda ou periodicidade de um ganho validado
   * volta ele para "declarado" e fica no histórico (CA-RN-63.2).
   */
  setGain(access: Access, refValue: string, input: GainInput): Promise<IdeaDetail> {
    return this.withIdea(access, refValue, async (m, idea, can) => {
      this.assertEditable(idea, can);
      await this.saveGain(m, idea, input, { actorId: access.userId });
    });
  }

  /**
   * O miolo do ganho (RN-62, RN-63), usado pela tela e pela escrita da API de integração (RN-130):
   * quem chama já conferiu a permissão e travou a ideia. Com `declaredOnly` (a integração), um ganho
   * já validado não é tocado (`gain_validated`): quem valida é sempre uma pessoa.
   */
  async saveGain(
    m: EntityManager,
    idea: Idea,
    input: GainInput,
    who: { actorId: string | null; declaredOnly?: boolean; eventData?: Record<string, unknown> },
  ): Promise<void> {
    const repo = m.getRepository(FinancialGain);
    const current = await repo.findOneBy({ ideaId: idea.id });
    if (who.declaredOnly && current?.status === GainStatus.Validated) {
      throw conflict(
        'gain_validated',
        'O ganho já foi validado por uma pessoa e não pode ser alterado por integração.',
      );
    }
    const pick = (k: 'estimated' | 'realized' | 'implementationCost') =>
      input[k] !== undefined ? (input[k] ?? null) : (current?.[k] ?? null);
    const next = {
      currency: input.currency ?? current?.currency ?? (await this.settings.get('results.currency', m)),
      periodicity: input.periodicity,
      estimated: pick('estimated'),
      realized: pick('realized'),
      implementationCost: pick('implementationCost'),
    };
    const triaging = idea.status === IdeaStatus.Submitted || idea.status === IdeaStatus.InReview;
    if (next.estimated !== (current?.estimated ?? null) && !triaging) {
      throw conflict('estimate_closed', 'O ganho estimado é informado na triagem (Enviada ou Em análise).');
    }
    if (next.realized !== (current?.realized ?? null) && idea.status !== IdeaStatus.Implemented) {
      throw conflict('realized_not_yet', 'O ganho realizado é informado depois de implementar a ideia.');
    }
    const unvalidate =
      current?.status === GainStatus.Validated &&
      (next.realized !== current.realized ||
        next.implementationCost !== current.implementationCost ||
        next.currency !== current.currency ||
        next.periodicity !== current.periodicity);
    await repo.save({
      ideaId: idea.id,
      ...next,
      status: unvalidate || !current ? GainStatus.Declared : current.status,
      validatedById: unvalidate ? null : (current?.validatedById ?? null),
      validatedAt: unvalidate ? null : (current?.validatedAt ?? null),
    });
    await recordEvent(m, {
      ideaId: idea.id,
      type: 'gain_updated',
      actorId: who.actorId,
      visibility: Visibility.Internal,
      data: { ...next, ...(who.eventData ?? {}) },
    });
    if (unvalidate) {
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'gain_unvalidated',
        actorId: who.actorId,
        visibility: Visibility.Internal,
        data: who.eventData ?? {},
      });
    }
  }

  /** Validar o ganho realizado (RN-63): só com `gain.validate` na entidade da ideia (CA-RN-63.1). */
  validateGain(access: Access, refValue: string): Promise<IdeaDetail> {
    return this.withIdea(access, refValue, async (m, idea) => {
      if (!access.hasIn('gain.validate', idea.entityId)) throw forbidden('Você não valida ganhos nesta entidade.');
      const repo = m.getRepository(FinancialGain);
      const gain = await repo.findOneBy({ ideaId: idea.id });
      if (idea.status !== IdeaStatus.Implemented || gain?.realized == null) {
        throw conflict('gain_not_realized', 'Só se valida o ganho realizado de uma ideia implementada.');
      }
      if (gain.status === GainStatus.Validated) throw conflict('already_validated', 'Este ganho já foi validado.');
      await repo.update(idea.id, {
        status: GainStatus.Validated,
        validatedById: access.userId,
        validatedAt: new Date(),
      });
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'gain_validated',
        actorId: access.userId,
        visibility: Visibility.Internal,
        data: { realized: gain.realized, currency: gain.currency, periodicity: gain.periodicity },
      });
    });
  }

  /** Lição aprendida (RN-64): padrão adotado e se é replicável; só em ideia implementada. */
  setStandard(
    access: Access,
    refValue: string,
    input: { standardAdopted: string | null; standardAdoptedRich?: RichDoc | null; isReplicable: boolean },
  ): Promise<IdeaDetail> {
    return this.withIdea(access, refValue, async (m, idea, can) => {
      this.assertEditable(idea, can);
      if (idea.status !== IdeaStatus.Implemented) {
        throw conflict('not_implemented', 'A lição aprendida é registrada depois de implementar.');
      }
      await m.getRepository(Idea).update(idea.id, {
        standardAdopted: input.standardAdopted,
        standardAdoptedRich: input.standardAdoptedRich ?? null,
        isReplicable: input.isReplicable,
      });
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'standard_updated',
        actorId: access.userId,
        data: { standardAdopted: input.standardAdopted, isReplicable: input.isReplicable },
      });
    });
  }

  /**
   * Replicar (RN-64, CA-RN-64.2): cria uma ideia Enviada em outra entidade, ligada à origem, com o
   * texto e o padrão adotado; sem ganho, medição nem anexos. Ela segue o fluxo completo, com quem
   * replicou como autor. Exige poder enviar ideias na entidade de destino.
   */
  async replicate(access: Access, refValue: string, entityId: string): Promise<IdeaDetail> {
    const { idea: origin } = await this.ideas.findVisible(access, refValue);
    if (origin.status !== IdeaStatus.Implemented || !origin.isReplicable || origin.convergedIntoId) {
      throw conflict('not_replicable', 'Só ideias implementadas e marcadas como replicáveis podem ser replicadas.');
    }
    if (entityId === origin.entityId) {
      throw apiError(422, 'validation_failed', 'Escolha outra entidade.', [
        { path: 'entityId', message: 'A réplica vai para outra entidade.' },
      ]);
    }
    const standard = origin.standardAdopted
      ? `Padrão adotado na ideia ${origin.code}:\n${origin.standardAdopted}`
      : null;
    return this.ideas.submit(
      access,
      {
        title: origin.title,
        description: origin.description,
        descriptionRich: origin.descriptionRich,
        entityId,
        categoryId: origin.categoryId,
        tagIds: [],
        proposedSolution: [standard, origin.proposedSolution].filter(Boolean).join('\n\n') || null,
        expectedGain: null,
        externalRef: null,
        originIdeaId: origin.id,
      },
      {
        eventData: { origin: origin.code },
        run: async (m, created) => {
          await recordEvent(m, {
            ideaId: origin.id,
            type: 'replicated',
            actorId: access.userId,
            data: { code: created.code },
          });
        },
      },
    );
  }

  /**
   * Revisão de sustentação (RN-65): no dia previsto ou depois, quem tria ou o analista responsável
   * confirma que o ganho se mantém, ou contesta contando o que mudou. Contestar não reabre a ideia.
   */
  reviewSustainment(
    access: Access,
    refValue: string,
    input: { decision: 'confirmed' | 'contested'; note: string | null },
  ): Promise<IdeaDetail> {
    return this.withIdea(access, refValue, async (m, idea, can) => {
      if (!can.triage && idea.assignedToId !== access.userId) {
        throw forbidden('A revisão é do responsável pela ideia ou de quem tria nesta entidade.');
      }
      const repo = m.getRepository(SustainmentReview);
      const review = await repo.findOne({
        where: { ideaId: idea.id, status: SustainmentStatus.Pending },
        order: { createdAt: 'DESC' },
      });
      if (!review) throw conflict('no_review', 'Não há revisão de sustentação pendente nesta ideia.');
      if (review.dueOn > (await this.ideas.today(m))) {
        throw conflict('not_due', 'A revisão de sustentação ainda não chegou.');
      }
      await repo.update(review.id, {
        status: input.decision === 'confirmed' ? SustainmentStatus.Confirmed : SustainmentStatus.Contested,
        reviewedById: access.userId,
        reviewedAt: new Date(),
        note: input.note,
      });
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'sustainment_reviewed',
        actorId: access.userId,
        reason: input.note,
        data: { decision: input.decision, dueOn: review.dueOn },
      });
    });
  }

  /** Ganhos realizados à espera de validação nas entidades onde a pessoa valida (RN-63). */
  async pendingGains(access: Access): Promise<PendingGainView[]> {
    const entities = access.entities('gain.validate');
    if (entities.length === 0) return [];
    const gains = await this.dataSource.getRepository(FinancialGain).find({
      where: {
        status: GainStatus.Declared,
        realized: Not(IsNull()),
        idea: {
          entityId: In(entities),
          status: IdeaStatus.Implemented,
          archivedAt: IsNull(),
          convergedIntoId: IsNull(),
        },
      },
      relations: { idea: { entity: true }, validatedBy: true },
      order: { idea: { implementedAt: 'ASC' } },
      take: 200,
    });
    return gains.map((g) => ({
      code: g.idea.code,
      title: g.idea.title,
      entity: { id: g.idea.entity.id, name: g.idea.entity.name },
      implementedAt: g.idea.implementedAt?.toISOString() ?? null,
      gain: gainView(g) as NonNullable<ReturnType<typeof gainView>>,
    }));
  }
}
