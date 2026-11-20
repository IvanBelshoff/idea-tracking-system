import { z } from 'zod';
import { IdeaStatus } from '../ideas/entities/idea.entity.js';

/**
 * Aprovação de outras áreas (M24, RN-183 a RN-192): regras puras. A equipe de melhoria pede o aval, e
 * quem aprova é escolhido caso a caso, com ou sem usuário no ITS. O ITS não guarda organograma.
 */
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'cancelled'] as const;
export const APPROVAL_HOLDS = ['approve', 'implement'] as const;
export const RECIPIENT_DECISIONS = ['pending', 'approved', 'rejected', 'void'] as const;
export const DECISION_SOURCES = ['link', 'its', 'manual'] as const;
export const ON_REJECT_MODES = ['return', 'block'] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type ApprovalHold = (typeof APPROVAL_HOLDS)[number];
export type RecipientDecision = (typeof RECIPIENT_DECISIONS)[number];
export type DecisionSource = (typeof DECISION_SOURCES)[number];
export type OnRejectMode = (typeof ON_REJECT_MODES)[number];

/** Limites (RN-183). */
export const MAX_RECIPIENTS = 10;
export const SUMMARY_MAX = 2000;
export const NAME_MAX = 120;
export const AREA_MAX = 80;
export const COMMENT_MAX = 1000;
export const REASON_MAX = 1000;
export const MAX_ATTACHMENTS = 5;
export const DAYS_MIN = 1;
export const DAYS_MAX = 60;

const recipient = z.union([
  z.object({ userId: z.uuid(), area: z.string().trim().max(AREA_MAX).optional().default('') }),
  z.object({
    name: z.string().trim().min(1).max(NAME_MAX),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    area: z.string().trim().min(1).max(AREA_MAX),
  }),
]);

export const ApprovalRequestSchema = z.object({
  holds: z.enum(APPROVAL_HOLDS),
  summary: z.string().trim().min(1).max(SUMMARY_MAX),
  /** Prazo em dias; sem ele, vale `approval.default_days`. */
  days: z.number().int().min(DAYS_MIN).max(DAYS_MAX).optional(),
  showGain: z.boolean().optional().default(false),
  attachmentIds: z.array(z.uuid()).max(MAX_ATTACHMENTS).optional().default([]),
  recipients: z.array(recipient).min(1).max(MAX_RECIPIENTS),
});
export type ApprovalRequestInput = z.infer<typeof ApprovalRequestSchema>;

export const ReasonSchema = z.object({ reason: z.string().trim().min(1).max(REASON_MAX) });

/** Código de confirmação (RN-185): 6 dígitos, 10 minutos, 5 tentativas. */
export const CODE_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;

const comment = z.string().trim().max(COMMENT_MAX).optional().default('');
const requireCommentToReject = (v: { decision: string; comment: string }) =>
  v.decision === 'approved' || v.comment.length > 0;
const rejectMessage = { message: 'Para não aprovar, escreva o motivo.', path: ['comment'] };

/** Decisão dentro do ITS (RN-186). */
export const DecisionSchema = z
  .object({ decision: z.enum(['approved', 'rejected']), comment })
  .refine(requireCommentToReject, rejectMessage);

/** Decisão pelo link (RN-184): o nome confirmado e, com o código ligado, o código (RN-185). */
export const LinkDecisionSchema = z
  .object({
    token: z.string().min(20).max(100),
    decision: z.enum(['approved', 'rejected']),
    comment,
    name: z.string().trim().min(1).max(NAME_MAX),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .refine(requireCommentToReject, rejectMessage);

export const TokenSchema = z.object({ token: z.string().min(20).max(100) });
export const LinkAttachmentSchema = z.object({ token: z.string().min(20).max(100), attachmentId: z.uuid() });

/** Registro manual com evidência (RN-187): a data é a da decisão informada (nunca no futuro). */
export const ManualDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    decidedName: z.string().trim().min(1).max(NAME_MAX),
    decidedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    comment,
  })
  .refine(requireCommentToReject, rejectMessage);

/** Como o link se apresenta (RN-184). */
export type LinkState = 'open' | 'decided' | 'expired' | 'cancelled' | 'closed';

export function linkState(
  recipient: { decision: RecipientDecision },
  request: { status: ApprovalStatus; expiresAt: Date },
  now = new Date(),
): LinkState {
  if (recipient.decision === 'approved' || recipient.decision === 'rejected') return 'decided';
  if (request.status === 'cancelled') return 'cancelled';
  if (request.status === 'approved' || request.status === 'rejected') return 'closed';
  if (request.status === 'expired' || request.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'open';
}

/** Em que situação da ideia cada pedido pode ser feito (RN-183). */
export function holdAllowed(status: IdeaStatus, holds: ApprovalHold): boolean {
  if (holds === 'approve') return status === IdeaStatus.InReview;
  return status === IdeaStatus.InReview || status === IdeaStatus.InProgress;
}

export type HoldState = 'free' | 'pending' | 'not_obtained';

/**
 * Se o último pedido que segura uma transição a deixa passar (RN-188): aprovado, cancelado ou com
 * "seguir sem a aprovação" → livre; pendente → segura; não aprovado ou vencido → segura até um novo
 * pedido aprovado (ou, no modo devolver, até o analista seguir sem a aprovação).
 */
export function holdState(latest: { status: ApprovalStatus; overriddenAt: Date | null } | null): HoldState {
  if (!latest) return 'free';
  if (latest.status === 'pending') return 'pending';
  if ((latest.status === 'rejected' || latest.status === 'expired') && !latest.overriddenAt) return 'not_obtained';
  return 'free';
}

/** O pedido fecha quando alguém não aprova (rejected) ou quando todos aprovaram (approved). */
export function outcomeOf(decisions: readonly RecipientDecision[]): 'pending' | 'approved' | 'rejected' {
  if (decisions.includes('rejected')) return 'rejected';
  return decisions.length > 0 && decisions.every((d) => d === 'approved') ? 'approved' : 'pending';
}

/** E-mail fora dos domínios da empresa (RN-190); sem domínios cadastrados, nenhum é de fora. */
export function outsideDomains(email: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return false;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return !domains.some((d) => domain === d.toLowerCase());
}
