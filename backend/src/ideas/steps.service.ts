import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, QueryFailedError } from 'typeorm';
import { apiError } from '../common/api-error.js';
import type { RichDoc } from '../common/rich-text.js';
import type { Access } from '../identity-access/access.js';
import { AttachmentStorage } from './attachment-storage.js';
import { Attachment } from './entities/attachment.entity.js';
import { type Idea, IdeaStatus } from './entities/idea.entity.js';
import { Step } from './entities/idea-related.entity.js';
import { type IdeaCapabilities, ideaCapabilities } from './idea-access.js';
import type { IdeaDetail } from './ideas.dto.js';
import { IdeasService, recordEvent } from './ideas.service.js';
import { isClosed } from './lifecycle.js';
import { nextPdcaPhase } from './results-rules.js';
import {
  canAddStep,
  ideaDeadline,
  isDeletableStep,
  isEditableStep,
  nextPosition,
  openStep,
  validStepDates,
} from './steps-rules.js';

export interface StepInput {
  name: string;
  description: string | null;
  descriptionRich?: RichDoc | null;
  assigneeId: string;
  startDate?: string | null;
  dueDate: string;
}

const conflict = (code: string, message: string) => apiError(409, code, message);
const invalidDates = () =>
  apiError(422, 'validation_failed', 'A data prevista não pode ser anterior ao início.', [
    { path: 'dueDate', message: 'A data prevista não pode ser anterior ao início.' },
  ]);

/**
 * Etapas da ideia (RN-12 a RN-20). Mesmo caminho das transições: carrega com escopo, trava a
 * linha da ideia, confere com o estado travado, aplica e grava no histórico. A trava serializa
 * duas criações simultâneas; a restrição única de posição é a segunda trava (CA-RN-14.2).
 */
@Injectable()
export class StepsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ideas: IdeasService,
    private readonly storage: AttachmentStorage,
  ) {}

  private async run(
    access: Access,
    refValue: string,
    fn: (ctx: { m: EntityManager; idea: Idea; can: IdeaCapabilities; steps: Step[] }) => Promise<void>,
  ): Promise<IdeaDetail> {
    const id = await this.dataSource
      .transaction(async (m) => {
        const visible = await this.ideas.findVisible(access, refValue, m);
        const idea = await this.ideas.lock(m, visible.idea.id);
        if (isClosed(idea.status)) throw conflict('idea_closed', 'Ideia encerrada: somente leitura.');
        if (idea.status !== IdeaStatus.InProgress) {
          throw conflict('idea_not_in_progress', 'Etapas só existem em ideias aprovadas (Em andamento).');
        }
        const steps = await m.getRepository(Step).find({ where: { ideaId: idea.id }, order: { position: 'ASC' } });
        await fn({ m, idea, can: ideaCapabilities(access, idea), steps });
        return idea.id;
      })
      .catch((e: unknown) => {
        // Segunda trava: posição repetida (corrida que escapasse da trava da linha) vira 409.
        if (e instanceof QueryFailedError && String(e.message).includes('uq_step_position')) {
          throw conflict('step_open', 'Outra etapa acabou de ser criada. Atualize a tela.');
        }
        throw e;
      });
    return this.ideas.detail(access, id);
  }

  private async deadlineEvent(m: EntityManager, ideaId: string, before: string | null, actorId: string) {
    const after = ideaDeadline(await m.getRepository(Step).findBy({ ideaId }));
    if (after !== before) {
      await recordEvent(m, { ideaId, type: 'deadline_changed', actorId, data: { from: before, to: after } });
    }
  }

  private findStep(steps: Step[], stepId: string): Step {
    const step = steps.find((s) => s.id === stepId);
    if (!step) throw apiError(404, 'not_found', 'Etapa não encontrada.');
    return step;
  }

  /** Nova etapa (RN-12): só sem etapa aberta; posição +1; o prazo pode mudar (RN-17). */
  create(access: Access, refValue: string, input: StepInput): Promise<IdeaDetail> {
    return this.run(access, refValue, async ({ m, idea, can, steps }) => {
      if (!can.manageSteps) throw apiError(403, 'forbidden', 'Você não gerencia etapas desta entidade.');
      if (!canAddStep(steps)) throw conflict('step_open', 'Conclua a etapa aberta antes de criar outra.');
      const startDate = input.startDate ?? (await this.ideas.today(m));
      if (!validStepDates(startDate, input.dueDate)) throw invalidDates();
      const assignee = await this.ideas.assertAssignee(m, input.assigneeId, idea.entityId);
      const before = ideaDeadline(steps);
      const repo = m.getRepository(Step);
      const position = nextPosition(steps);
      const last = [...steps].sort((a, b) => a.position - b.position).at(-1);
      const pdcaPhase = idea.stepModel === 'pdca' ? nextPdcaPhase(last?.pdcaPhase ?? null) : null;
      await repo.save(
        repo.create({
          ideaId: idea.id,
          position,
          name: input.name,
          description: input.description,
          descriptionRich: input.descriptionRich ?? null,
          assigneeId: assignee.id,
          startDate,
          dueDate: input.dueDate,
          pdcaPhase,
        }),
      );
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'step_added',
        actorId: access.userId,
        data: {
          position,
          name: input.name,
          assignee: { id: assignee.id, name: assignee.name },
          dueDate: input.dueDate,
          ...(pdcaPhase ? { pdcaPhase } : {}),
        },
      });
      await this.deadlineEvent(m, idea.id, before, access.userId);
    });
  }

  /** Editar: só a última etapa aberta (RN-13). */
  update(access: Access, refValue: string, stepId: string, input: Partial<StepInput>): Promise<IdeaDetail> {
    return this.run(access, refValue, async ({ m, idea, can, steps }) => {
      if (!can.manageSteps) throw apiError(403, 'forbidden', 'Você não gerencia etapas desta entidade.');
      const step = this.findStep(steps, stepId);
      if (!isEditableStep(step, steps)) {
        throw conflict('step_locked', 'Só a última etapa, enquanto aberta, pode ser alterada.');
      }
      const startDate = input.startDate ?? step.startDate;
      const dueDate = input.dueDate ?? step.dueDate;
      if (!validStepDates(startDate, dueDate)) throw invalidDates();
      if (input.assigneeId && input.assigneeId !== step.assigneeId) {
        await this.ideas.assertAssignee(m, input.assigneeId, idea.entityId);
      }
      const before = ideaDeadline(steps);
      const changes: Partial<Step> = { startDate, dueDate };
      if (input.name !== undefined) changes.name = input.name;
      if (input.description !== undefined) {
        changes.description = input.description;
        changes.descriptionRich = input.descriptionRich ?? null;
      }
      if (input.assigneeId !== undefined) changes.assigneeId = input.assigneeId;
      await m.getRepository(Step).update(step.id, changes);
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'step_updated',
        actorId: access.userId,
        data: { position: step.position, fields: Object.keys(input).filter((k) => !k.endsWith('Rich')) },
      });
      await this.deadlineEvent(m, idea.id, before, access.userId);
    });
  }

  /** Excluir: só a última aberta, sobrando outra; sem lacuna (RN-13, RN-14). */
  async remove(access: Access, refValue: string, stepId: string): Promise<IdeaDetail> {
    const files: string[] = [];
    const detail = await this.run(access, refValue, async ({ m, idea, can, steps }) => {
      if (!can.manageSteps) throw apiError(403, 'forbidden', 'Você não gerencia etapas desta entidade.');
      const step = this.findStep(steps, stepId);
      if (!isDeletableStep(step, steps)) {
        throw conflict(
          'step_locked',
          'Só a última etapa aberta pode ser excluída, e a ideia não pode ficar sem etapas.',
        );
      }
      const before = ideaDeadline(steps);
      files.push(...(await m.getRepository(Attachment).findBy({ stepId: step.id })).map((a) => a.storedName));
      await m.getRepository(Step).delete(step.id);
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'step_removed',
        actorId: access.userId,
        data: { position: step.position, name: step.name },
      });
      await this.deadlineEvent(m, idea.id, before, access.userId);
    });
    await this.storage.remove(files);
    return detail;
  }

  /**
   * Concluir a etapa aberta: o responsável dela ou quem gerencia etapas. Ao concluir a última, a
   * ideia continua Em andamento e o histórico registra que todas foram concluídas (RN-20); o aviso
   * ao analista por notificação chega com o M4.
   */
  complete(access: Access, refValue: string, stepId: string): Promise<IdeaDetail> {
    return this.run(access, refValue, async ({ m, idea, can, steps }) => {
      const step = this.findStep(steps, stepId);
      if (!can.manageSteps && step.assigneeId !== access.userId) {
        throw apiError(403, 'forbidden', 'Só o responsável pela etapa ou quem gerencia etapas a conclui.');
      }
      if (openStep(steps)?.id !== step.id) throw conflict('step_not_open', 'Esta etapa não está aberta.');
      await m.getRepository(Step).update(step.id, { completedAt: new Date() });
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'step_completed',
        actorId: access.userId,
        data: { position: step.position, name: step.name },
      });
      if (steps.every((s) => s.id === step.id || s.completedAt !== null)) {
        await recordEvent(m, {
          ideaId: idea.id,
          type: 'all_steps_completed',
          actorId: access.userId,
          data: { assignedTo: idea.assignedToId },
        });
      }
    });
  }
}
