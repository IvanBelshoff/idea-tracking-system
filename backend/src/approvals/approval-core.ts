import { createHash, randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { Visibility } from '../ideas/entities/idea-related.entity.js';
import { recordEvent } from '../ideas/ideas.service.js';
import { notifyTeam } from './approval-notify.js';
import { type ApprovalHold, holdState, outcomeOf } from './approval-rules.js';
import { ApprovalRecipient, ApprovalRequest } from './entities.js';

/**
 * Aprovação de outras áreas (M24): funções usadas também pelo ciclo da ideia, fora do módulo (sem
 * injeção do Nest), sempre na transação de quem chama.
 */

/** Link de uso único (RN-184): 32 bytes aleatórios; o banco guarda só o SHA-256 (CA-T.28). */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** O último pedido que segura uma transição (o mais novo daquele tipo). */
export function latestRequest(m: EntityManager, ideaId: string, holds: ApprovalHold): Promise<ApprovalRequest | null> {
  return m.getRepository(ApprovalRequest).findOne({ where: { ideaId, holds }, order: { createdAt: 'DESC' } });
}

/**
 * Segura a transição enquanto a aprovação não foi obtida (RN-188): pendente → 409 `approval_pending`;
 * não aprovada ou vencida (sem "seguir sem a aprovação") → 409 `approval_not_obtained`.
 */
export async function assertNotHeld(m: EntityManager, ideaId: string, holds: ApprovalHold): Promise<void> {
  const state = holdState(await latestRequest(m, ideaId, holds));
  if (state === 'pending') {
    throw apiError(409, 'approval_pending', 'A ideia aguarda a aprovação de outra área para seguir.');
  }
  if (state === 'not_obtained') {
    throw apiError(
      409,
      'approval_not_obtained',
      'A aprovação de outra área não foi obtida. Peça de novo ou, se a organização permitir, siga sem ela.',
    );
  }
}

/**
 * Fecha o pedido aberto (cancelado). Sem `actorId`, é o próprio ITS (a ideia foi encerrada ou
 * arquivada); os aprovadores que faltavam ficam sem efeito e os links deixam de valer.
 */
export async function closeOpenRequest(
  m: EntityManager,
  ideaId: string,
  by: { actorId: string | null; reason: string | null },
): Promise<ApprovalRequest | null> {
  const repo = m.getRepository(ApprovalRequest);
  const open = await repo.findOne({ where: { ideaId, status: 'pending' }, lock: { mode: 'pessimistic_write' } });
  if (!open) return null;
  await repo.update(open.id, {
    status: 'cancelled',
    closedAt: new Date(),
    cancelledById: by.actorId,
    cancelReason: by.reason,
  });
  await m.getRepository(ApprovalRecipient).update({ requestId: open.id, decision: 'pending' }, { decision: 'void' });
  await recordEvent(m, {
    ideaId,
    type: 'approval_cancelled',
    actorId: by.actorId,
    data: { requestId: open.id, automatic: by.actorId === null },
  });
  return open;
}

/** O que qualquer pessoa que vê a ideia pode saber da aprovação (RN-190): só a situação. */
export type ApprovalState = 'none' | 'pending' | 'approved' | 'not_approved';

export async function approvalState(m: EntityManager, ideaId: string): Promise<ApprovalState> {
  const last = await m.getRepository(ApprovalRequest).findOne({ where: { ideaId }, order: { createdAt: 'DESC' } });
  if (!last || last.status === 'cancelled') return 'none';
  if (last.status === 'pending') return 'pending';
  return last.status === 'approved' ? 'approved' : 'not_approved';
}

/** O anexo está num pedido de aprovação aberto (CA-RN-184.5): não pode ser removido até fechar. */
export async function attachmentInOpenApproval(m: EntityManager, attachmentId: string): Promise<boolean> {
  const rows: unknown[] = await m.query(
    `SELECT 1 FROM approval_request_attachment a JOIN approval_request r ON r.id = a.request_id
      WHERE a.attachment_id = $1 AND r.status = 'pending' LIMIT 1`,
    [attachmentId],
  );
  return rows.length > 0;
}

export interface DecisionInput {
  decision: 'approved' | 'rejected';
  source: 'link' | 'its' | 'manual';
  comment: string | null;
  decidedName: string;
  ip: string | null;
  /** Quem agiu no ITS (o próprio aprovador ou quem registrou); nulo = pelo link. */
  actorId: string | null;
  /** Registro manual (RN-187): quem registrou e a data informada. */
  recordedById?: string | null;
  decidedOn?: string | null;
}

/**
 * Aplica a decisão de um aprovador (RN-184, RN-186, RN-187) e fecha o pedido quando é a hora (RN-188):
 * uma recusa fecha como não aprovado (os que faltavam ficam sem efeito); o "sim" de todos fecha como
 * aprovado. Trava o pedido: duas decisões ao mesmo tempo não se atropelam.
 */
export async function applyDecision(
  m: EntityManager,
  recipientId: string,
  input: DecisionInput,
): Promise<{ request: ApprovalRequest; outcome: 'pending' | 'approved' | 'rejected' }> {
  const recipients = m.getRepository(ApprovalRecipient);
  const found = await recipients.findOneBy({ id: recipientId });
  if (!found) throw apiError(404, 'not_found', 'Aprovador não encontrado.');
  const requests = m.getRepository(ApprovalRequest);
  const request = await requests.findOne({ where: { id: found.requestId }, lock: { mode: 'pessimistic_write' } });
  if (!request) throw apiError(404, 'not_found', 'Pedido de aprovação não encontrado.');
  if (request.status !== 'pending') throw apiError(409, 'approval_not_open', 'Este pedido já foi encerrado.');
  if (request.expiresAt.getTime() <= Date.now()) {
    throw apiError(409, 'approval_expired', 'O prazo para responder este pedido acabou.');
  }
  const recipient = await recipients.findOneByOrFail({ id: recipientId });
  if (recipient.decision !== 'pending') {
    throw apiError(409, 'approval_already_decided', 'Esta resposta já foi registrada.');
  }
  await recipients.update(recipient.id, {
    decision: input.decision,
    source: input.source,
    comment: input.comment,
    decidedName: input.decidedName,
    decidedAt: new Date(),
    decidedIp: input.ip,
    recordedById: input.recordedById ?? null,
    decidedOn: input.decidedOn ?? null,
    codeHash: null,
    codeExpiresAt: null,
  });
  await recordEvent(m, {
    ideaId: request.ideaId,
    type: 'approval_decided',
    actorId: input.actorId,
    visibility: Visibility.Internal,
    reason: input.comment,
    data: {
      requestId: request.id,
      recipientId: recipient.id,
      name: input.decidedName,
      area: recipient.area,
      decision: input.decision,
      source: input.source,
    },
  });
  await notifyTeam(
    m,
    request,
    'approval_answered',
    { name: input.decidedName, decision: input.decision },
    input.actorId,
  );
  const all = await recipients.find({ where: { requestId: request.id }, select: { decision: true } });
  const outcome = outcomeOf(all.map((r) => r.decision));
  if (outcome !== 'pending') {
    await requests.update(request.id, { status: outcome, closedAt: new Date() });
    await recipients.update({ requestId: request.id, decision: 'pending' }, { decision: 'void' });
    await recordEvent(m, {
      ideaId: request.ideaId,
      type: 'approval_completed',
      actorId: null,
      data: { requestId: request.id, outcome },
    });
    await notifyTeam(m, request, 'approval_completed', { outcome }, null);
    request.status = outcome;
  }
  return { request, outcome };
}
