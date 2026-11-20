import type { EntityManager } from 'typeorm';
import type { NotificationType } from '../communication/notification-rules.js';
import { dispatchNotifications } from '../communication/notify.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import type { ApprovalRequest } from './entities.js';

type ApprovalType = Extract<
  NotificationType,
  'approval_requested' | 'approval_reminder' | 'approval_answered' | 'approval_completed' | 'approval_expired'
>;

/**
 * Avisos da aprovação de outras áreas (M24, RN-191), na transação da ação. Ao aprovador que tem usuário,
 * sem ligar o aviso à ideia (ele pode não ter acesso a ela); à equipe (quem pediu e o responsável pela
 * ideia), ligado à ideia.
 */
export async function notifyApprover(
  m: EntityManager,
  userId: string,
  type: Extract<ApprovalType, 'approval_requested' | 'approval_reminder'>,
  request: ApprovalRequest,
  area: string,
): Promise<void> {
  await dispatchNotifications(m, [
    {
      userId,
      type,
      ideaId: null,
      payload: { code: request.ideaCode, title: request.ideaTitle, area, dueOn: request.dueOn, requestId: request.id },
    },
  ]);
}

/** Quem pediu e o responsável pela ideia, sem repetir e sem avisar quem agiu. */
export async function notifyTeam(
  m: EntityManager,
  request: ApprovalRequest,
  type: Extract<ApprovalType, 'approval_answered' | 'approval_completed' | 'approval_expired'>,
  payload: Record<string, unknown>,
  actorId: string | null,
): Promise<void> {
  const idea = await m.getRepository(Idea).findOneBy({ id: request.ideaId });
  const users = new Set([request.requestedById, ...(idea?.assignedToId ? [idea.assignedToId] : [])]);
  if (actorId) users.delete(actorId);
  await dispatchNotifications(
    m,
    [...users].map((userId) => ({
      userId,
      type,
      ideaId: request.ideaId,
      payload: { code: request.ideaCode, title: request.ideaTitle, requestId: request.id, ...payload },
    })),
  );
}
