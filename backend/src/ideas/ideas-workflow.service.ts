import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { assertNotHeld, closeOpenRequest } from '../approvals/approval-core.js';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import { addDaysToDay } from '../common/dates.js';
import type { RichDoc } from '../common/rich-text.js';
import type { Access } from '../identity-access/access.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { emitWebhookEvent } from '../integration/webhooks/webhook-emit.js';
import { SettingsService } from '../organization/settings.service.js';
import { AttachmentStorage } from './attachment-storage.js';
import { ConvergenceService } from './convergence.service.js';
import { Attachment } from './entities/attachment.entity.js';
import { type Idea, Idea as IdeaEntity, IdeaStatus } from './entities/idea.entity.js';
import { IdeaParticipant, Step, Visibility } from './entities/idea-related.entity.js';
import { SustainmentReview, SustainmentStatus } from './entities/result.entity.js';
import { type IdeaCapabilities, ideaCapabilities } from './idea-access.js';
import type { IdeaDetail } from './ideas.dto.js';
import { type ApproveInput, convergedError, IdeasService, recordEvent } from './ideas.service.js';
import { type IdeaAction, implementBlocker, isClosed, nextStatus } from './lifecycle.js';
import { priorityScore } from './triage-rules.js';

const forbidden = (message: string) => apiError(403, 'forbidden', message);
const invalidTransition = (from: IdeaStatus) =>
  apiError(
    409,
    'invalid_transition',
    'A ação não vale no estado atual da ideia (ela pode ter sido alterada por outra pessoa).',
    {
      status: from,
    },
  );

/**
 * Transições do ciclo de vida (§4), sempre pelo mesmo caminho: carrega com escopo, TRAVA a linha,
 * confere permissão e estado com o valor travado, aplica, grava o histórico. Duas ações
 * simultâneas na mesma ideia: a segunda vê o estado novo e recebe 409 (CA-T.2).
 */
/** Colunas que as transições mudam junto com a situação (só colunas, sem relações). */
type TransitionChanges = Partial<
  Pick<
    Idea,
    | 'assignedToId'
    | 'reviewStartedAt'
    | 'decidedAt'
    | 'implementedAt'
    | 'rejectionReason'
    | 'resultText'
    | 'resultTextRich'
    | 'standardAdopted'
    | 'standardAdoptedRich'
    | 'isReplicable'
  >
>;

@Injectable()
export class IdeasWorkflowService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ideas: IdeasService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly storage: AttachmentStorage,
  ) {}

  private async run(
    access: Access,
    refValue: string,
    expected: IdeaStatus | undefined,
    fn: (ctx: { m: EntityManager; idea: Idea; can: IdeaCapabilities }) => Promise<void>,
  ): Promise<IdeaDetail> {
    const id = await this.dataSource.transaction(async (m) => {
      const visible = await this.ideas.findVisible(access, refValue, m);
      const idea = await this.ideas.lock(m, visible.idea.id);
      if (idea.convergedIntoId) throw convergedError();
      // A decisão foi tomada olhando um estado que já mudou (outra pessoa agiu antes): 409 (CA-T.2).
      if (expected && idea.status !== expected) {
        throw apiError(409, 'stale_state', 'A ideia mudou enquanto você a via. Confira de novo antes de agir.', {
          status: idea.status,
        });
      }
      await fn({ m, idea, can: ideaCapabilities(access, idea) });
      return idea.id;
    });
    return this.ideas.detail(access, id);
  }

  private async move(
    m: EntityManager,
    idea: Idea,
    action: IdeaAction,
    actorId: string,
    changes: TransitionChanges,
    reason?: string,
  ) {
    const to = nextStatus(idea.status, action);
    if (!to) throw invalidTransition(idea.status);
    await m.getRepository(IdeaEntity).update(idea.id, { ...changes, status: to });
    await recordEvent(m, {
      ideaId: idea.id,
      type: action === 'reopen' ? 'reopened' : 'status_changed',
      actorId,
      reason: reason ?? null,
      data: { from: idea.status, to },
    });
    idea.status = to;
    // Encerrada, a ideia não espera mais aprovação: o pedido aberto fecha e os links morrem (M24).
    if (isClosed(to)) await closeOpenRequest(m, idea.id, { actorId: null, reason: null });
  }

  /** Assumir a triagem (Enviada → Em análise): quem assume vira o responsável pela triagem. */
  startReview(access: Access, refValue: string, expected?: IdeaStatus): Promise<IdeaDetail> {
    return this.run(access, refValue, expected, async ({ m, idea, can }) => {
      if (!can.triage) throw forbidden('Você não tria ideias desta entidade.');
      await this.move(m, idea, 'start_review', access.userId, {
        assignedToId: access.userId,
        reviewStartedAt: new Date(),
      });
    });
  }

  /**
   * Aprovar (Em análise → Em andamento, RN-06): cria a primeira etapa com responsável e prazo.
   * Direto de Enviada só com o atalho da D3 ligado, e aí são duas transições no histórico (CA-RN-06.3).
   */
  approve(access: Access, refValue: string, input: ApproveInput, expected?: IdeaStatus): Promise<IdeaDetail> {
    return this.run(access, refValue, expected, async ({ m, idea, can }) => {
      if (!can.triage) throw forbidden('Você não tria ideias desta entidade.');
      if (idea.status === IdeaStatus.Submitted) {
        if (!(await this.settings.get('ideas.triage_shortcut', m))) throw invalidTransition(idea.status);
        await this.move(m, idea, 'start_review', access.userId, {
          assignedToId: access.userId,
          reviewStartedAt: new Date(),
        });
      }
      if (!nextStatus(idea.status, 'approve')) throw invalidTransition(idea.status);
      // Aprovação de outra área pendente ou não obtida segura a aprovação (M24, RN-188).
      await assertNotHeld(m, idea.id, 'approve');
      await this.ideas.createFirstStep(m, idea.id, input, access.userId);
      await this.move(m, idea, 'approve', access.userId, { decidedAt: new Date() });
    });
  }

  /** Recusar na triagem (→ Não autorizada, RN-05): justificativa obrigatória, visível ao autor. */
  reject(access: Access, refValue: string, reason: string, expected?: IdeaStatus): Promise<IdeaDetail> {
    return this.run(access, refValue, expected, async ({ m, idea, can }) => {
      if (!can.triage) throw forbidden('Você não tria ideias desta entidade.');
      await this.move(m, idea, 'reject', access.userId, { rejectionReason: reason, decidedAt: new Date() }, reason);
    });
  }

  /** Interromper uma ideia em andamento (Em andamento → Não autorizada), com justificativa. */
  interrupt(access: Access, refValue: string, reason: string, expected?: IdeaStatus): Promise<IdeaDetail> {
    return this.run(access, refValue, expected, async ({ m, idea, can }) => {
      if (!can.triage) throw forbidden('Você não tria ideias desta entidade.');
      await this.move(m, idea, 'interrupt', access.userId, { rejectionReason: reason, decidedAt: new Date() }, reason);
    });
  }

  /** Implementar (RN-07): etapas todas concluídas e resultado informado. */
  implement(
    access: Access,
    refValue: string,
    input: {
      resultText: string;
      resultTextRich?: RichDoc | null;
      standardAdopted?: string | null;
      standardAdoptedRich?: RichDoc | null;
      isReplicable?: boolean;
    },
    expected?: IdeaStatus,
  ): Promise<IdeaDetail> {
    const { resultText } = input;
    return this.run(access, refValue, expected, async ({ m, idea, can }) => {
      if (!can.triage) throw forbidden('Você não tria ideias desta entidade.');
      if (!nextStatus(idea.status, 'implement')) throw invalidTransition(idea.status);
      await assertNotHeld(m, idea.id, 'implement');
      const steps = await m.getRepository(Step).findBy({ ideaId: idea.id });
      const blocker = implementBlocker(steps, resultText);
      if (blocker) {
        const messages = {
          no_steps: 'A ideia não tem etapas.',
          open_steps: 'Conclua todas as etapas antes de implementar.',
          missing_result: 'Informe o resultado obtido.',
        };
        throw apiError(422, blocker, messages[blocker]);
      }
      await this.move(m, idea, 'implement', access.userId, {
        implementedAt: new Date(),
        resultText,
        resultTextRich: input.resultTextRich ?? null,
        // Lição aprendida (RN-64, CA-RN-64.1): registrada junto com a implementação.
        standardAdopted: input.standardAdopted ?? null,
        standardAdoptedRich: input.standardAdoptedRich ?? null,
        isReplicable: input.isReplicable ?? false,
      });
      const days = await this.settings.get('results.sustainment_days', m);
      if (days > 0) {
        const reviews = m.getRepository(SustainmentReview);
        await reviews.save(reviews.create({ ideaId: idea.id, dueOn: addDaysToDay(await this.ideas.today(m), days) }));
      }
    });
  }

  /**
   * Reabrir (RN-09): só com `idea.reopen` (por padrão, o Administrador), só encerradas, motivo
   * obrigatório. Implementada → Em andamento; Não autorizada → Em análise.
   */
  reopen(access: Access, refValue: string, reason: string, expected?: IdeaStatus): Promise<IdeaDetail> {
    return this.run(access, refValue, expected, async ({ m, idea, can }) => {
      if (!can.reopen) throw forbidden('Só o administrador reabre ideias encerradas.');
      if (!nextStatus(idea.status, 'reopen')) throw invalidTransition(idea.status);
      if (!reason) {
        throw apiError(422, 'validation_failed', 'Informe o motivo da reabertura.', [
          { path: 'reason', message: 'Informe o motivo.' },
        ]);
      }
      const changes: TransitionChanges =
        idea.status === IdeaStatus.Implemented ? { implementedAt: null } : { rejectionReason: null, decidedAt: null };
      // Reaberta, a revisão de sustentação pendente perde o sentido; a próxima implementação cria outra.
      await m.getRepository(SustainmentReview).delete({ ideaId: idea.id, status: SustainmentStatus.Pending });
      await this.move(m, idea, 'reopen', access.userId, changes, reason);
    });
  }

  /**
   * Atribuir ou reatribuir a triagem à mão (CA-RN-55.3): quem tria na entidade, enquanto a ideia
   * está aberta. O novo responsável precisa poder triar ali; `null` devolve à fila geral.
   */
  assign(access: Access, refValue: string, assigneeId: string | null, expected?: IdeaStatus): Promise<IdeaDetail> {
    return this.run(access, refValue, expected, async ({ m, idea, can }) => {
      if (!can.triage) throw forbidden('Você não tria ideias desta entidade.');
      if (isClosed(idea.status)) throw invalidTransition(idea.status);
      if (assigneeId === idea.assignedToId) return;
      if (assigneeId && !(await this.ideas.canTriage(m, assigneeId, idea.entityId))) {
        throw apiError(422, 'validation_failed', 'Escolha alguém ativo que tria ideias desta entidade.', [
          { path: 'assigneeId', message: 'Esta pessoa não tria ideias desta entidade.' },
        ]);
      }
      await m.getRepository(IdeaEntity).update(idea.id, { assignedToId: assigneeId });
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'assigned',
        actorId: access.userId,
        data: { from: idea.assignedToId, to: assigneeId },
      });
    });
  }

  /**
   * Priorização (RN-56): quem tria informa impacto e esforço (1 a 5) enquanto a ideia está aberta.
   * A nota nunca muda a situação (CA-RN-56.3). Fica no histórico interno da equipe.
   */
  prioritize(
    access: Access,
    refValue: string,
    impact: number | null,
    effort: number | null,
    expected?: IdeaStatus,
  ): Promise<IdeaDetail> {
    return this.run(access, refValue, expected, async ({ m, idea, can }) => {
      if (!can.triage) throw forbidden('Você não tria ideias desta entidade.');
      if (isClosed(idea.status)) throw invalidTransition(idea.status);
      await m
        .getRepository(IdeaEntity)
        .update(idea.id, { impact, effort, priorityScore: priorityScore(impact, effort) });
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'prioritized',
        actorId: access.userId,
        visibility: Visibility.Internal,
        data: { impact, effort },
      });
    });
  }

  /** Arquivar (RN-11): some das listas, mas o registro e o histórico ficam. */
  archive(access: Access, refValue: string, reason: string | null, expected?: IdeaStatus): Promise<IdeaDetail> {
    return this.run(access, refValue, expected, async ({ m, idea, can }) => {
      if (!can.archive) throw forbidden('Você não arquiva ideias desta entidade.');
      if (idea.archivedAt) throw apiError(409, 'already_archived', 'A ideia já está arquivada.');
      await m.getRepository(IdeaEntity).update(idea.id, { archivedAt: new Date() });
      await closeOpenRequest(m, idea.id, { actorId: null, reason: null });
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'archived',
        actorId: access.userId,
        reason,
        visibility: Visibility.Internal,
      });
    });
  }

  /**
   * Exclusão física (RN-11): só com `idea.delete` (Administrador). Libera o histórico daquela ideia
   * só nesta transação (trigger da migração IdeasGuards) e registra na auditoria.
   */
  async purge(access: Access, refValue: string, meta: RequestMeta): Promise<void> {
    const files = await this.dataSource.transaction(async (m) => {
      const visible = await this.ideas.findVisible(access, refValue, m);
      const idea = await this.ideas.lock(m, visible.idea.id);
      if (!ideaCapabilities(access, idea).delete) throw forbidden('Só o administrador exclui ideias definitivamente.');
      await ConvergenceService.assertNoConverged(m, idea.id);
      // Co-autorias que vieram desta ideia (se ela era convergida) saem da principal junto.
      await m.getRepository(IdeaParticipant).delete({ sourceIdeaId: idea.id });
      const stored = (await m.getRepository(Attachment).findBy({ ideaId: idea.id })).map((a) => a.storedName);
      // As evidências dos registros manuais de aprovação (M24) saem com a ideia (o banco apaga em cascata).
      const evidence: { stored_name: string }[] = await m.query(
        `SELECT e.stored_name FROM approval_evidence e
           JOIN approval_recipient r ON r.id = e.recipient_id
           JOIN approval_request q ON q.id = r.request_id
          WHERE q.idea_id = $1`,
        [idea.id],
      );
      stored.push(...evidence.map((e) => e.stored_name));
      // Webhook de exclusão (M17, RN-119): só o código e a entidade, porque o resto deixa de existir.
      await emitWebhookEvent(m, {
        type: 'idea.deleted',
        data: { idea_code: idea.code, entity_id: idea.entityId },
        entityIds: [idea.entityId],
      });
      await m.query("SELECT set_config('its.purge_idea', $1, true)", [idea.id]);
      await m.getRepository(IdeaEntity).delete({ id: idea.id });
      await this.audit.record(
        {
          action: 'idea.deleted',
          actorId: access.userId,
          targetType: 'idea',
          targetId: idea.id,
          data: { code: idea.code, title: idea.title, status: idea.status },
          ip: meta.ip,
        },
        m,
      );
      return stored;
    });
    await this.storage.remove(files);
  }
}
