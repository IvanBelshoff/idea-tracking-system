import { daysBetween } from '../common/dates.js';

/**
 * Regras puras das notificações (RN-27, RN-29, RN-30): que evento gera aviso para quem, por qual
 * canal, e quando um prazo merece alerta. Sem banco, para testar sem infraestrutura.
 */

/** Avisos ao autor sobre a própria ideia (RN-27). */
export const AUTHOR_TYPES = [
  'idea_received',
  'review_started',
  'idea_approved',
  'idea_rejected',
  'idea_interrupted',
  'step_completed',
  'idea_implemented',
  'idea_reopened',
  'coauthor_added',
  'idea_converged',
  'idea_unconverged',
  'level_up',
  'achievement_granted',
  'idea_highlighted',
] as const;

/** Avisos para quem conduz: analista e responsáveis de etapa (RN-20, RN-29). */
export const TEAM_TYPES = [
  'all_steps_completed',
  'deadline_soon',
  'deadline_due',
  'idea_assigned',
  'triage_overdue',
  'sustainment_due',
  // Alerta de saúde da instalação (M12, RN-94): quem tem ops.view. Obrigatórios e fora das preferências.
  'ops_failed',
  'ops_recovered',
] as const;

/**
 * Avisos do mural (M21, RN-156): nenhum obrigatório, todos nas preferências. O resumo do dia, as
 * respostas e as denúncias são AGRUPADOS por dia (um aviso atualizado em vez de vários).
 */
export const MURAL_TYPES = [
  'mural_published',
  'mural_withdrawn',
  'mural_digest',
  'mural_reply',
  'mural_comment_hidden',
  'mural_reports',
  'mural_shared',
] as const;

/**
 * Avisos da loja (M22, RN-171). As decisões sobre o próprio pedido (aprovado, recusado e cancelado pela
 * equipe) são obrigatórias, como as decisões sobre a própria ideia (RN-30). Pedidos novos, para quem
 * gerencia, saem agrupados por dia.
 */
export const STORE_TYPES = [
  'store_order_approved',
  'store_order_rejected',
  'store_order_delivered',
  'store_order_cancelled',
  'store_bonus_paid',
  'store_balance_adjusted',
  'store_points_expiring',
  'store_points_expired',
  'store_orders_new',
] as const;

/**
 * Avisos da aprovação de outras áreas (M24, RN-191), no grupo da equipe. O pedido ao aprovador que tem
 * usuário é obrigatório (como as decisões da RN-30); os outros vão a quem pediu e ao responsável pela ideia.
 */
export const APPROVAL_TYPES = [
  'approval_requested',
  'approval_reminder',
  'approval_answered',
  'approval_completed',
  'approval_expired',
] as const;

export const NOTIFICATION_TYPES = [
  ...AUTHOR_TYPES,
  ...TEAM_TYPES,
  ...MURAL_TYPES,
  ...STORE_TYPES,
  ...APPROVAL_TYPES,
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/** Decisões sobre a própria ideia: sempre enviadas, a pessoa não pode desligar (RN-30, CA-RN-30.3). */
export const MANDATORY_TYPES: ReadonlySet<NotificationType> = new Set([
  'idea_approved',
  'idea_rejected',
  'idea_interrupted',
  'idea_implemented',
  'idea_reopened',
  'idea_converged',
  'idea_unconverged',
  'ops_failed',
  'ops_recovered',
  'store_order_approved',
  'store_order_rejected',
  'store_order_cancelled',
  'approval_requested',
]);

/** Avisos da operação: não aparecem nas preferências (não se desligam e só chegam a quem tem ops.view). */
export const OPS_TYPES: ReadonlySet<NotificationType> = new Set(['ops_failed', 'ops_recovered']);

export interface IdeaRef {
  id: string;
  code: string;
  title: string;
  authorId: string | null;
  assignedToId: string | null;
  /** Co-autores (RN-86): acompanham cada mudança de situação da ideia (RN-87). */
  coAuthorIds?: readonly string[];
}

export interface IdeaEventRef {
  type: string;
  actorId?: string | null;
  reason?: string | null;
  data?: Record<string, unknown>;
}

export interface NotificationDraft {
  userId: string;
  type: NotificationType;
  ideaId: string | null;
  payload: Record<string, unknown>;
}

/** Eventos do histórico que podem gerar aviso (evita consultar a ideia nos outros). */
export const NOTIFYING_EVENTS: ReadonlySet<string> = new Set([
  'created',
  'status_changed',
  'reopened',
  'step_completed',
  'all_steps_completed',
  'assigned',
]);

/**
 * Evento do histórico da ideia → avisos. Exatamente um por evento ao autor (CA-RN-27.1); nunca
 * para quem não é o autor da ideia (CA-RN-27.2). Ao concluir a última etapa, o analista
 * responsável é avisado (CA-RN-20.1).
 */
export function notificationsForEvent(event: IdeaEventRef, idea: IdeaRef): NotificationDraft[] {
  const base = { code: idea.code, title: idea.title };
  const data = event.data ?? {};
  const toAuthor = (type: NotificationType, extra: Record<string, unknown> = {}): NotificationDraft[] =>
    idea.authorId ? [{ userId: idea.authorId, type, ideaId: idea.id, payload: { ...base, ...extra } }] : [];
  /**
   * Mudança de situação: o autor e cada co-autor, um aviso por pessoa (sem duplicar quem é as duas
   * coisas; CA-RN-87.1, CA-RN-88.2), com a mesma justificativa.
   */
  const toRequesters = (type: NotificationType, extra: Record<string, unknown> = {}): NotificationDraft[] => {
    const users = new Set<string>([...(idea.authorId ? [idea.authorId] : []), ...(idea.coAuthorIds ?? [])]);
    return [...users].map((userId) => ({ userId, type, ideaId: idea.id, payload: { ...base, ...extra } }));
  };

  switch (event.type) {
    case 'created':
      return toAuthor('idea_received');
    case 'status_changed':
      switch (data.to) {
        case 'in_review':
          return toRequesters('review_started');
        case 'in_progress':
          return toRequesters('idea_approved');
        case 'rejected':
          return toRequesters(data.from === 'in_progress' ? 'idea_interrupted' : 'idea_rejected', {
            reason: event.reason ?? null,
          });
        case 'implemented':
          return toRequesters('idea_implemented');
        default:
          return [];
      }
    case 'reopened':
      return toRequesters('idea_reopened', { status: data.to, reason: event.reason ?? null });
    case 'step_completed':
      return toAuthor('step_completed', { position: data.position, name: data.name });
    case 'assigned': {
      // Quem recebe a triagem é avisado (RN-55); quem atribuiu a si mesmo, não.
      const to = typeof data.to === 'string' ? data.to : null;
      return to && to !== event.actorId
        ? [{ userId: to, type: 'idea_assigned', ideaId: idea.id, payload: { ...base, automatic: data.rule === true } }]
        : [];
    }
    case 'all_steps_completed':
      return idea.assignedToId
        ? [{ userId: idea.assignedToId, type: 'all_steps_completed', ideaId: idea.id, payload: base }]
        : [];
    default:
      return [];
  }
}

/** Preferências gravadas, por `tipo:canal`. Sem valor = ligado. */
export type PreferenceMap = ReadonlyMap<string, boolean>;

export const prefKey = (type: string, channel: 'in_app' | 'email') => `${type}:${channel}`;

/**
 * Canais de um aviso para uma pessoa (RN-30). A notificação interna existe sempre que a pessoa não
 * a desligou; o e-mail só com o envio ligado na instalação. Decisões sobre a própria ideia vão
 * pelos dois canais, sem opção de desligar.
 */
export function channelsFor(
  type: NotificationType,
  prefs: PreferenceMap,
  emailActive: boolean,
): { inApp: boolean; email: boolean } {
  if (MANDATORY_TYPES.has(type)) return { inApp: true, email: emailActive };
  return {
    inApp: prefs.get(prefKey(type, 'in_app')) ?? true,
    email: emailActive && (prefs.get(prefKey(type, 'email')) ?? true),
  };
}

/**
 * Alerta de prazo (RN-29): `due` no dia do vencimento; `soon` quando faltam de 1 até `days` dias
 * (com o padrão 3: vence em 3 dias gera alerta, em 4 não, CA-RN-29.1). Etapa vencida não gera.
 */
export function deadlineAlertKind(today: string, dueDate: string, days: number): 'soon' | 'due' | null {
  const left = daysBetween(today, dueDate);
  if (left === 0) return 'due';
  if (left > 0 && left <= days) return 'soon';
  return null;
}
