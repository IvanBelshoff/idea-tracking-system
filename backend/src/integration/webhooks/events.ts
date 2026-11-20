import type { IntegrationModuleId } from '../modules.js';

/**
 * Catálogo de eventos dos webhooks (M17, RN-119) e a conversão dos eventos do histórico da ideia.
 * O aviso é MÍNIMO: só identificadores e o estado necessário. Nunca título, texto, nome, e-mail ou valor.
 */
export const WEBHOOK_EVENTS = {
  'idea.submitted': 'ideas',
  'idea.status_changed': 'ideas',
  'idea.archived': 'ideas',
  'idea.deleted': 'ideas',
  'idea.converged': 'ideas',
  'gain.validated': 'indicators',
  'highlight.created': 'hall',
  'highlight.revoked': 'hall',
  'campaign.status_changed': 'campaigns',
  // Mural (M21, RN-157): só o código e a entidade; nunca o motivo da retirada.
  'mural.published': 'ideas',
  'mural.withdrawn': 'ideas',
  // Loja (M22, RN-172): só o pedido, o item e a situação; nunca a pessoa nem o valor.
  'store.order_approved': 'store',
  'store.order_delivered': 'store',
  'store.bonus_paid': 'store',
  // Aprovação de outras áreas (M24, RN-191): só o pedido e a situação; nunca nomes, e-mails ou comentários.
  'approval.requested': 'ideas',
  'approval.decided': 'ideas',
} as const satisfies Record<string, IntegrationModuleId>;

export type WebhookEventType = keyof typeof WEBHOOK_EVENTS;
export const WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as WebhookEventType[];

export function isWebhookEvent(value: string): value is WebhookEventType {
  return Object.hasOwn(WEBHOOK_EVENTS, value);
}

/** O módulo que a integração precisa ter para receber o evento. */
export function eventModule(type: WebhookEventType): IntegrationModuleId {
  return WEBHOOK_EVENTS[type];
}

/** O evento de teste: não precisa de ideia nem de escopo. */
export const PING_EVENT = 'webhook.ping';

/** O que vai em `data`: só estas chaves, de tipo simples (CA-RN-119.1). */
export type WebhookData = Record<string, string | null>;

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Evento do histórico da ideia → evento de webhook. `ideaCode` e `entityId` vêm da ideia; o resto,
 * do dado do histórico. Tipo que não vira webhook devolve nulo.
 */
export function mapIdeaEvent(
  type: string,
  data: Record<string, unknown>,
  idea: { code: string; entityId: string },
): { type: WebhookEventType; data: WebhookData } | null {
  const base: WebhookData = { idea_code: idea.code, entity_id: idea.entityId };
  switch (type) {
    case 'created':
      return { type: 'idea.submitted', data: base };
    // Reabrir também muda a situação (Implementada → Em andamento, Não autorizada → Em análise): sem
    // isso, quem acompanha as situações pelos avisos ficaria com a ideia encerrada (RN-119).
    case 'status_changed':
    case 'reopened':
      return { type: 'idea.status_changed', data: { ...base, from: text(data.from), to: text(data.to) } };
    case 'archived':
      return { type: 'idea.archived', data: base };
    case 'converged':
      return { type: 'idea.converged', data: { ...base, converged_into: text(data.into) } };
    case 'gain_validated':
      return { type: 'gain.validated', data: base };
    case 'highlighted':
      return { type: 'highlight.created', data: { ...base, highlight_id: text(data.highlightId) } };
    case 'highlight_revoked':
      return { type: 'highlight.revoked', data: { ...base, highlight_id: text(data.highlightId) } };
    case 'mural_published':
      return { type: 'mural.published', data: base };
    case 'mural_withdrawn':
      return { type: 'mural.withdrawn', data: base };
    case 'approval_requested':
      return { type: 'approval.requested', data: { ...base, request_id: text(data.requestId), status: 'pending' } };
    case 'approval_completed':
      return {
        type: 'approval.decided',
        data: { ...base, request_id: text(data.requestId), status: text(data.outcome) },
      };
    case 'approval_expired':
      return { type: 'approval.decided', data: { ...base, request_id: text(data.requestId), status: 'expired' } };
    case 'approval_cancelled':
      return { type: 'approval.decided', data: { ...base, request_id: text(data.requestId), status: 'cancelled' } };
    default:
      return null;
  }
}

/** O corpo enviado (JSON): `{ id, type, created_at, data }` (RN-119). */
export function buildBody(event: { id: string; type: string; createdAt: Date; data: WebhookData }): string {
  return JSON.stringify({
    id: event.id,
    type: event.type,
    created_at: event.createdAt.toISOString(),
    data: event.data,
  });
}
