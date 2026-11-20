import type { EntityManager } from 'typeorm';
import { computeAccess, type Grant } from '../../identity-access/access.js';
import { getSetting } from '../../organization/settings.service.js';
import { IntegrationScope } from '../entities.js';
import { WebhookDelivery, WebhookEvent } from './entities.js';
import { eventModule, mapIdeaEvent, type WebhookData, type WebhookEventType } from './events.js';

/**
 * Emissão dos eventos dos webhooks (M17, RN-119). É chamada DENTRO da transação de quem muda o dado
 * (o mesmo padrão dos avisos e dos pontos, a partir do `recordEvent`): se a transação desfaz, o evento
 * some junto; se dá certo, sai exatamente uma entrega por assinatura interessada. Só identificadores
 * e estado vão no evento. Sem chave dos webhooks ligada, nada é guardado (RN-117).
 */
export async function webhooksEnabled(m: EntityManager): Promise<boolean> {
  const [general, webhooks] = await Promise.all([
    getSetting(m, 'integration.enabled'),
    getSetting(m, 'integration.webhooks_enabled'),
  ]);
  return general && webhooks;
}

export interface EmitInput {
  type: WebhookEventType;
  data: WebhookData;
  /**
   * As entidades a que o evento se refere: a integração só recebe se alguma está no escopo dela AGORA.
   * Nulo = vale para qualquer escopo (campanha sem entidade-alvo).
   */
  entityIds: readonly string[] | null;
  /** Quem causou o evento, quando foi uma integração (M18): ela não recebe o próprio eco (RN-133). */
  originIntegrationId?: string | null;
}

interface Candidate {
  sub_id: string;
  integration_id: string;
  modules: string[];
}

/** O escopo de cada integração candidata, já expandido pelas subentidades (o mesmo cálculo dos perfis). */
async function scopesOf(m: EntityManager, integrationIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const rows = await m
    .getRepository(IntegrationScope)
    .createQueryBuilder('s')
    .where('s.integration_id IN (:...ids)', { ids: integrationIds })
    .getMany();
  const tree: { id: string; mpath: string }[] = await m.query('SELECT id, mpath FROM entity');
  const out = new Map<string, Set<string>>();
  for (const id of integrationIds) {
    const grants: Grant[] = rows
      .filter((r) => r.integrationId === id)
      .map((r) => ({ entityId: r.entityId, includeChildren: r.includeChildren, permissions: ['idea.view_scope'] }));
    out.set(id, new Set(computeAccess(id, grants, tree).entities('idea.view_scope')));
  }
  return out;
}

export async function emitWebhookEvent(m: EntityManager, input: EmitInput): Promise<void> {
  if (!(await webhooksEnabled(m))) return;
  const candidates: Candidate[] = await m.query(
    `SELECT s.id AS sub_id, i.id AS integration_id, i.modules
       FROM webhook_subscription s JOIN integration i ON i.id = s.integration_id
      WHERE s.status = 'active' AND i.status = 'active' AND $1 = ANY(s.events)`,
    [input.type],
  );
  if (candidates.length === 0) return;
  const enabledModules = await getSetting(m, 'integration.modules');
  const module = eventModule(input.type);
  if (!enabledModules.includes(module)) return;

  let matching = candidates.filter(
    (c) => c.modules.includes(module) && c.integration_id !== (input.originIntegrationId ?? null),
  );
  if (input.entityIds !== null && matching.length > 0) {
    const scopes = await scopesOf(m, [...new Set(matching.map((c) => c.integration_id))]);
    const wanted = input.entityIds;
    matching = matching.filter((c) => {
      const scope = scopes.get(c.integration_id);
      return !!scope && wanted.some((id) => scope.has(id));
    });
  }
  if (matching.length === 0) return;

  const event = await m.getRepository(WebhookEvent).save(
    m.getRepository(WebhookEvent).create({
      type: input.type,
      data: input.data,
      entityId: input.entityIds?.[0] ?? null,
      originIntegrationId: input.originIntegrationId ?? null,
    }),
  );
  const deliveries = m.getRepository(WebhookDelivery);
  await deliveries.save(
    matching.map((c) =>
      deliveries.create({ eventId: event.id, subscriptionId: c.sub_id, state: 'pending', attempts: 0 }),
    ),
  );
}

/** Evento do histórico da ideia (`recordEvent`) → evento de webhook, se for um dos da RN-119. */
export async function emitForIdeaEvent(
  m: EntityManager,
  e: { ideaId: string; type: string; data?: Record<string, unknown>; originIntegrationId?: string | null },
): Promise<void> {
  // Barato primeiro: tipo que não vira webhook e chave desligada não consultam a ideia.
  if (!mapIdeaEvent(e.type, {}, { code: '', entityId: '' })) return;
  if (!(await webhooksEnabled(m))) return;
  const [idea]: { code: string; entity_id: string }[] = await m.query(
    'SELECT code, entity_id FROM idea WHERE id = $1',
    [e.ideaId],
  );
  if (!idea) return;
  const mapped = mapIdeaEvent(e.type, e.data ?? {}, { code: idea.code, entityId: idea.entity_id });
  if (!mapped) return;
  await emitWebhookEvent(m, {
    type: mapped.type,
    data: mapped.data,
    entityIds: [idea.entity_id],
    originIntegrationId: e.originIntegrationId ?? null,
  });
}
