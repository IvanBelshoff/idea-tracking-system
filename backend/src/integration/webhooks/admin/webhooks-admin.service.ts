import { isIP } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../../audit/audit.service.js';
import { apiError } from '../../../common/api-error.js';
import { seal, secretKeyReady } from '../../../communication/secret-box.js';
import type { RequestMeta } from '../../../identity-access/auth-context.js';
import { SettingsService } from '../../../organization/settings.service.js';
import { Integration } from '../../entities.js';
import { INTEGRATION_MODULES } from '../../modules.js';
import { checkExpiry, countActiveTokens, retireAtFor, tokenState } from '../../token-rules.js';
import {
  checkResolved,
  type DestinationError,
  MAX_DESTINATIONS,
  normalizeDestinations,
  parseWebhookUrl,
} from '../destination-rules.js';
import { WebhookDelivery, WebhookSecret, WebhookSubscription } from '../entities.js';
import { eventModule, isWebhookEvent, WEBHOOK_EVENT_TYPES, type WebhookEventType } from '../events.js';
import { newWebhookSecret, WEBHOOK_LIMITS } from '../rules.js';
import { type SenderDeps, sendPing } from '../webhook-sender.js';
import type {
  SubscriptionCreateInput,
  SubscriptionUpdateInput,
  WebhookDeliveryView,
  WebhookPingResult,
  WebhookSecretView,
  WebhookSubscriptionView,
  WebhooksView,
  WebhookWithSecret,
} from './webhooks-admin.dto.js';

/** Onde os testes trocam o DNS e o relógio por versões falsas (nunca a internet). */
export const SENDER_DEPS = Symbol('WEBHOOK_SENDER_DEPS');

interface Actor {
  userId: string;
  meta: RequestMeta;
}

const UNIQUE_VIOLATION = '23505';
const DAY_MS = 86_400_000;

const DESTINATION_MESSAGES: Record<DestinationError, [string, string]> = {
  invalid_url: ['invalid_url', 'O endereço não é uma URL válida (use https://servidor/caminho).'],
  credentials_not_allowed: ['credentials_not_allowed', 'O endereço não pode trazer usuário e senha.'],
  destination_blocked: [
    'destination_blocked',
    'Este endereço é de uma classe sempre bloqueada (local, metadados de nuvem).',
  ],
  destination_not_allowed: [
    'destination_not_allowed',
    'O servidor não está na lista de destinos permitidos. Cadastre-o primeiro.',
  ],
  https_required: ['https_required', 'Use https. O http só vale para destino da rede interna que esteja na lista.'],
  unresolved: ['destination_unresolved', 'Não foi possível resolver o nome do servidor.'],
};

/** Só o servidor do endereço vai à auditoria e aos logs: o caminho e a consulta podem trazer segredo (RN-124). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Webhooks, lado do administrador (permissão `integration.manage`): chave, destinos permitidos,
 * assinaturas, segredos, registro de entregas, reenvio e teste (RN-117 a RN-124). Toda alteração
 * valida aqui e é auditada na mesma transação; o segredo só existe em claro na resposta de quem o cria.
 */
@Injectable()
export class WebhooksAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(SENDER_DEPS) private readonly deps: SenderDeps,
  ) {}

  // --- Leitura -------------------------------------------------------------------------------

  async view(m: EntityManager = this.dataSource.manager): Promise<WebhooksView> {
    const [general, enabled, destinations] = await Promise.all([
      this.settings.get('integration.enabled', m),
      this.settings.get('integration.webhooks_enabled', m),
      this.settings.get('integration.webhook_destinations', m),
    ]);
    const integrations = await m.getRepository(Integration).find({ order: { name: 'ASC' } });
    const subs = await m.getRepository(WebhookSubscription).find({ order: { name: 'ASC' } });
    return {
      enabled,
      integrationEnabled: general,
      destinations,
      events: WEBHOOK_EVENT_TYPES.map((type) => ({ type, module: eventModule(type) })),
      integrations: integrations
        .filter((i) => i.status !== 'revoked')
        .map((i) => ({ id: i.id, name: i.name, status: i.status, modules: i.modules })),
      subscriptions: await this.loadViews(m, subs, new Map(integrations.map((i) => [i.id, i.name]))),
      limits: {
        maxSubscriptions: WEBHOOK_LIMITS.maxSubscriptions,
        maxDestinations: MAX_DESTINATIONS,
        maxSecretDays: WEBHOOK_LIMITS.maxSecretDays,
        maxActiveSecrets: WEBHOOK_LIMITS.maxActiveSecrets,
        defaultOverlapHours: WEBHOOK_LIMITS.defaultOverlapHours,
        maxOverlapHours: WEBHOOK_LIMITS.maxOverlapHours,
        suggestedSecretDays: 90,
      },
    };
  }

  async deliveries(subscriptionId: string, state: string | undefined, limit = 50): Promise<WebhookDeliveryView[]> {
    await this.requireSubscription(this.dataSource.manager, subscriptionId);
    const rows: DeliveryRow[] = await this.dataSource.query(
      `SELECT d.id, d.event_id, e.type AS event_type, d.state, d.attempts, d.next_attempt_at, d.last_status,
              d.last_error, d.delivered_at, d.created_at
         FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id
        WHERE d.subscription_id = $1 AND ($2::text IS NULL OR d.state = $2)
        ORDER BY d.created_at DESC, d.id LIMIT $3`,
      [subscriptionId, state ?? null, limit],
    );
    return rows.map(deliveryView);
  }

  // --- Chave e destinos (RN-117) -------------------------------------------------------------

  async setEnabled({ userId, meta }: Actor, enabled: boolean): Promise<WebhooksView> {
    await this.dataSource.transaction(async (m) => {
      if (enabled && !(await this.settings.get('integration.enabled', m))) {
        throw apiError(
          422,
          'webhooks_require_integration',
          'Ligue antes a chave geral da API de integração: os webhooks dependem dela.',
        );
      }
      const before = await this.settings.get('integration.webhooks_enabled', m);
      await this.settings.set('integration.webhooks_enabled', enabled, userId, m);
      await this.audit.record(
        {
          action: 'integration.webhooks_enabled_changed',
          actorId: userId,
          targetType: 'setting',
          data: { enabled, before: { enabled: before } },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.view();
  }

  async setDestinations({ userId, meta }: Actor, input: readonly string[]): Promise<WebhooksView> {
    const destinations = normalizeDestinations(input);
    if (!destinations) {
      throw apiError(
        422,
        'invalid_destinations',
        `Informe até ${MAX_DESTINATIONS} destinos válidos: nomes, domínios com curinga (*.empresa.com.br), IPs ou faixas (10.0.0.0/8).`,
      );
    }
    await this.dataSource.transaction(async (m) => {
      const before = await this.settings.get('integration.webhook_destinations', m);
      await this.settings.set('integration.webhook_destinations', destinations, userId, m);
      await this.audit.record(
        {
          action: 'integration.webhook_destinations_changed',
          actorId: userId,
          targetType: 'setting',
          data: { destinations, before: { destinations: before } },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.view();
  }

  // --- Assinaturas (RN-118) ------------------------------------------------------------------

  async create({ userId, meta }: Actor, input: SubscriptionCreateInput): Promise<WebhookWithSecret> {
    if (!secretKeyReady()) {
      throw apiError(503, 'secret_key_missing', 'Defina APP_SECRET_KEY no servidor antes de criar webhooks.');
    }
    const now = new Date();
    const expiresAt = this.expiry(input.expiresAt, now);
    const issued = newWebhookSecret();
    const id = await this.dataSource.transaction(async (m) => {
      const integration = await this.lockIntegration(m, input.integrationId);
      if (integration.status === 'revoked') throw this.revokedError();
      const count = await m.getRepository(WebhookSubscription).countBy({ integrationId: integration.id });
      if (count >= WEBHOOK_LIMITS.maxSubscriptions) {
        throw apiError(
          422,
          'too_many_subscriptions',
          `A integração já tem ${WEBHOOK_LIMITS.maxSubscriptions} assinaturas. Remova uma antes de criar outra.`,
        );
      }
      const events = this.checkEvents(input.events, integration.modules);
      await this.checkUrl(m, input.url);
      let sub: WebhookSubscription;
      try {
        sub = await m.getRepository(WebhookSubscription).save(
          m.getRepository(WebhookSubscription).create({
            integrationId: integration.id,
            name: input.name,
            url: input.url,
            events,
            status: 'active',
            suspendedReason: null,
            consecutiveFailures: 0,
            createdById: userId,
          }),
        );
      } catch (error) {
        throw this.translate(error);
      }
      const secret = await m.getRepository(WebhookSecret).save(
        m.getRepository(WebhookSecret).create({
          subscriptionId: sub.id,
          secretEncrypted: seal(issued.secret),
          prefix: issued.prefix,
          expiresAt,
        }),
      );
      await this.audit.record(
        {
          action: 'integration.webhook_created',
          actorId: userId,
          targetType: 'webhook_subscription',
          targetId: sub.id,
          data: { integrationId: integration.id, subscription: sub.name, host: hostOf(sub.url), events },
          ip: meta.ip,
        },
        m,
      );
      await this.audit.record(
        {
          action: 'integration.webhook_secret_created',
          actorId: userId,
          targetType: 'webhook_subscription',
          targetId: sub.id,
          data: { integrationId: integration.id, subscription: sub.name, prefix: secret.prefix },
          ip: meta.ip,
        },
        m,
      );
      return sub.id;
    });
    return { subscription: await this.viewOf(id), secret: issued.secret };
  }

  async update({ userId, meta }: Actor, id: string, input: SubscriptionUpdateInput): Promise<WebhookSubscriptionView> {
    await this.dataSource.transaction(async (m) => {
      const sub = await this.lockSubscription(m, id);
      const integration = await this.requireIntegration(m, sub.integrationId);
      if (integration.status === 'revoked') throw this.revokedError();
      const events = this.checkEvents(input.events, integration.modules);
      await this.checkUrl(m, input.url);
      const before = { subscription: sub.name, host: hostOf(sub.url), events: sub.events };
      try {
        await m.getRepository(WebhookSubscription).update({ id }, { name: input.name, url: input.url, events });
      } catch (error) {
        throw this.translate(error);
      }
      await this.audit.record(
        {
          action: 'integration.webhook_updated',
          actorId: userId,
          targetType: 'webhook_subscription',
          targetId: id,
          data: {
            integrationId: sub.integrationId,
            subscription: input.name,
            host: hostOf(input.url),
            events,
            before,
          },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.viewOf(id);
  }

  /** Suspende pelo administrador: não envia nada novo; o que está pendente espera (RN-121). */
  async suspend(actor: Actor, id: string): Promise<WebhookSubscriptionView> {
    return this.transition(actor, id, 'integration.webhook_suspended', (sub) => {
      if (sub.status !== 'active') {
        throw apiError(409, 'invalid_state', 'A assinatura já está suspensa.');
      }
      return { status: 'suspended', suspendedReason: 'admin' };
    });
  }

  /** Reativa, inclusive a suspensa por falhas: a contagem de falhas volta a zero (RN-121). */
  async reactivate(actor: Actor, id: string): Promise<WebhookSubscriptionView> {
    return this.transition(actor, id, 'integration.webhook_reactivated', (sub, integration) => {
      if (integration.status === 'revoked') throw this.revokedError();
      if (sub.status !== 'suspended') {
        throw apiError(409, 'invalid_state', 'A assinatura não está suspensa.');
      }
      return { status: 'active', suspendedReason: null, consecutiveFailures: 0 };
    });
  }

  async remove({ userId, meta }: Actor, id: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const sub = await this.lockSubscription(m, id);
      await m.getRepository(WebhookSubscription).delete({ id });
      await this.audit.record(
        {
          action: 'integration.webhook_removed',
          actorId: userId,
          targetType: 'webhook_subscription',
          targetId: id,
          data: { integrationId: sub.integrationId, subscription: sub.name, host: hostOf(sub.url) },
          ip: meta.ip,
        },
        m,
      );
    });
  }

  // --- Segredos (RN-120) ---------------------------------------------------------------------

  /**
   * Gera um segredo novo. Os que valem hoje e ainda não tinham fim ganham a janela de sobreposição
   * (padrão 24 h, nunca além da validade deles); no máximo 2 segredos ativos por assinatura.
   */
  async rotateSecret(
    { userId, meta }: Actor,
    id: string,
    input: { expiresAt: string; overlapHours: number },
  ): Promise<WebhookWithSecret> {
    if (!secretKeyReady()) {
      throw apiError(503, 'secret_key_missing', 'Defina APP_SECRET_KEY no servidor antes de gerar o segredo.');
    }
    const now = new Date();
    const expiresAt = this.expiry(input.expiresAt, now);
    const issued = newWebhookSecret();
    await this.dataSource.transaction(async (m) => {
      const sub = await this.lockSubscription(m, id);
      const integration = await this.requireIntegration(m, sub.integrationId);
      if (integration.status === 'revoked') throw this.revokedError();
      const secrets = await m.getRepository(WebhookSecret).findBy({ subscriptionId: id });
      if (countActiveTokens(secrets, now) >= WEBHOOK_LIMITS.maxActiveSecrets) {
        throw apiError(
          409,
          'too_many_secrets',
          'A assinatura já tem 2 segredos ativos. Revogue um deles antes de gerar outro.',
        );
      }
      const current = secrets.filter((s) => ['active', 'retiring'].includes(tokenState(s, now)));
      for (const s of current) {
        if (s.retireAt === null) {
          await m
            .getRepository(WebhookSecret)
            .update({ id: s.id }, { retireAt: retireAtFor(s.expiresAt, now, input.overlapHours) });
        }
      }
      const secret = await m.getRepository(WebhookSecret).save(
        m.getRepository(WebhookSecret).create({
          subscriptionId: id,
          secretEncrypted: seal(issued.secret),
          prefix: issued.prefix,
          expiresAt,
        }),
      );
      await this.audit.record(
        {
          action: current.length > 0 ? 'integration.webhook_secret_rotated' : 'integration.webhook_secret_created',
          actorId: userId,
          targetType: 'webhook_subscription',
          targetId: id,
          data: {
            integrationId: sub.integrationId,
            subscription: sub.name,
            prefix: secret.prefix,
            overlapHours: current.length > 0 ? input.overlapHours : null,
          },
          ip: meta.ip,
        },
        m,
      );
    });
    return { subscription: await this.viewOf(id), secret: issued.secret };
  }

  async revokeSecret({ userId, meta }: Actor, id: string, secretId: string): Promise<WebhookSubscriptionView> {
    await this.dataSource.transaction(async (m) => {
      const sub = await this.lockSubscription(m, id);
      const secret = await m.getRepository(WebhookSecret).findOneBy({ id: secretId, subscriptionId: id });
      if (!secret) throw apiError(404, 'not_found', 'Segredo não encontrado.');
      if (secret.revokedAt) return;
      await m.getRepository(WebhookSecret).update({ id: secretId }, { revokedAt: new Date() });
      await this.audit.record(
        {
          action: 'integration.webhook_secret_revoked',
          actorId: userId,
          targetType: 'webhook_subscription',
          targetId: id,
          data: { integrationId: sub.integrationId, subscription: sub.name, prefix: secret.prefix },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.viewOf(id);
  }

  // --- Entregas: reenvio e teste (RN-122) ----------------------------------------------------

  /** Volta uma entrega com falha para pendente; ela sai igual (o aviso fica guardado). */
  async resend({ userId, meta }: Actor, id: string, deliveryId: string): Promise<WebhookDeliveryView> {
    await this.dataSource.transaction(async (m) => {
      const sub = await this.lockSubscription(m, id);
      const delivery = await m
        .getRepository(WebhookDelivery)
        .findOne({ where: { id: deliveryId, subscriptionId: id }, lock: { mode: 'pessimistic_write' } });
      if (!delivery) throw apiError(404, 'not_found', 'Entrega não encontrada.');
      if (delivery.state !== 'failed') {
        throw apiError(409, 'delivery_not_failed', 'Só uma entrega com falha pode ser reenviada.');
      }
      // O marco das 48 horas recomeça: sem isto, uma entrega expirada expiraria de novo na hora.
      await m.query(
        `UPDATE webhook_delivery SET state = 'pending', attempts = 0, next_attempt_at = now(), created_at = now(),
                last_status = NULL, last_error = NULL, delivered_at = NULL WHERE id = $1`,
        [deliveryId],
      );
      await this.audit.record(
        {
          action: 'integration.webhook_resent',
          actorId: userId,
          targetType: 'webhook_subscription',
          targetId: id,
          data: { integrationId: sub.integrationId, subscription: sub.name, deliveryId },
          ip: meta.ip,
        },
        m,
      );
    });
    const [row] = await this.deliveryRows(id, deliveryId);
    return deliveryView(row as DeliveryRow);
  }

  /** O evento de teste: passa pela checagem do destino e pela assinatura; o resultado vai direto à tela. */
  async ping({ userId, meta }: Actor, id: string): Promise<WebhookPingResult> {
    const sub = await this.requireSubscription(this.dataSource.manager, id);
    const result = await sendPing(this.dataSource, sub, this.deps);
    await this.audit.record({
      action: 'integration.webhook_ping',
      actorId: userId,
      targetType: 'webhook_subscription',
      targetId: id,
      data: {
        integrationId: sub.integrationId,
        subscription: sub.name,
        host: hostOf(sub.url),
        ok: result.kind === 'ok',
        status: result.status,
        error: result.error,
      },
      ip: meta.ip,
    });
    return { ok: result.kind === 'ok', status: result.status, error: result.error };
  }

  // --- Auxiliares ----------------------------------------------------------------------------

  private async transition(
    { userId, meta }: Actor,
    id: string,
    action: string,
    change: (sub: WebhookSubscription, integration: Integration) => Partial<WebhookSubscription>,
  ): Promise<WebhookSubscriptionView> {
    await this.dataSource.transaction(async (m) => {
      const sub = await this.lockSubscription(m, id);
      const integration = await this.requireIntegration(m, sub.integrationId);
      await m.getRepository(WebhookSubscription).update({ id }, change(sub, integration));
      await this.audit.record(
        {
          action,
          actorId: userId,
          targetType: 'webhook_subscription',
          targetId: id,
          data: { integrationId: sub.integrationId, subscription: sub.name, host: hostOf(sub.url) },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.viewOf(id);
  }

  private revokedError() {
    return apiError(409, 'integration_revoked', 'A integração foi revogada e não pode mais ser alterada.');
  }

  private expiry(raw: string, now: Date): Date {
    const date = new Date(raw);
    const verdict = checkExpiry(date, now);
    if (verdict === 'in_the_past') {
      throw apiError(422, 'invalid_expiry', 'A validade do segredo precisa estar no futuro.', { reason: verdict });
    }
    if (verdict === 'too_far' || date.getTime() > now.getTime() + WEBHOOK_LIMITS.maxSecretDays * DAY_MS) {
      throw apiError(
        422,
        'invalid_expiry',
        `A validade do segredo pode ser de no máximo ${WEBHOOK_LIMITS.maxSecretDays} dias.`,
        { reason: 'too_far' },
      );
    }
    return date;
  }

  /** Eventos válidos e de módulos que a integração tem (RN-118). */
  private checkEvents(input: readonly string[], modules: readonly string[]): WebhookEventType[] {
    const events = [...new Set(input)];
    if (events.length === 0) throw apiError(422, 'invalid_events', 'Escolha ao menos um evento.');
    const unknown = events.filter((e) => !isWebhookEvent(e));
    if (unknown.length > 0) throw apiError(422, 'invalid_events', 'Evento desconhecido na lista.', { events: unknown });
    const known = events as WebhookEventType[];
    const notAllowed = known.filter((e) => !modules.includes(eventModule(e)));
    if (notAllowed.length > 0) {
      throw apiError(
        422,
        'event_not_allowed',
        'A integração não tem o módulo de um dos eventos. Adicione o módulo à integração primeiro.',
        { events: notAllowed, modules: INTEGRATION_MODULES.filter((id) => known.some((e) => eventModule(e) === id)) },
      );
    }
    return known;
  }

  /** A checagem do endereço ao salvar: forma, resolução do nome, lista de destinos e classes bloqueadas (RN-118). */
  private async checkUrl(m: EntityManager, raw: string): Promise<void> {
    const parsed = parseWebhookUrl(raw);
    if (!parsed.ok) throw this.destinationError(parsed.code);
    const { hostname, scheme, literalIp } = parsed.parts;
    let addresses: string[];
    try {
      addresses = literalIp || isIP(hostname) ? [hostname] : await this.deps.resolve(hostname);
    } catch {
      throw this.destinationError('unresolved');
    }
    const checked = checkResolved({
      scheme,
      hostname,
      addresses,
      entries: await this.settings.get('integration.webhook_destinations', m),
      allowLoopback: this.deps.allowLoopback,
    });
    if (!checked.ok) throw this.destinationError(checked.code);
  }

  private destinationError(code: DestinationError) {
    const [apiCode, message] = DESTINATION_MESSAGES[code];
    return apiError(422, apiCode, message);
  }

  private translate(error: unknown): unknown {
    const code =
      (error as { code?: string })?.code ?? (error as { driverError?: { code?: string } })?.driverError?.code;
    if (code === UNIQUE_VIOLATION) {
      return apiError(409, 'webhook_name_taken', 'Esta integração já tem uma assinatura com este nome.');
    }
    return error;
  }

  private async requireIntegration(m: EntityManager, id: string): Promise<Integration> {
    const row = await m.getRepository(Integration).findOneBy({ id });
    if (!row) throw apiError(404, 'not_found', 'Integração não encontrada.');
    return row;
  }

  /** Trava a integração: serializa o limite de 5 assinaturas (CA-T.2). */
  private async lockIntegration(m: EntityManager, id: string): Promise<Integration> {
    const row = await m.getRepository(Integration).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!row) throw apiError(404, 'not_found', 'Integração não encontrada.');
    return row;
  }

  private async requireSubscription(m: EntityManager, id: string): Promise<WebhookSubscription> {
    const row = await m.getRepository(WebhookSubscription).findOneBy({ id });
    if (!row) throw apiError(404, 'not_found', 'Assinatura não encontrada.');
    return row;
  }

  private async lockSubscription(m: EntityManager, id: string): Promise<WebhookSubscription> {
    const row = await m
      .getRepository(WebhookSubscription)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!row) throw apiError(404, 'not_found', 'Assinatura não encontrada.');
    return row;
  }

  private async deliveryRows(subscriptionId: string, deliveryId: string): Promise<DeliveryRow[]> {
    return this.dataSource.query(
      `SELECT d.id, d.event_id, e.type AS event_type, d.state, d.attempts, d.next_attempt_at, d.last_status,
              d.last_error, d.delivered_at, d.created_at
         FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id
        WHERE d.subscription_id = $1 AND d.id = $2`,
      [subscriptionId, deliveryId],
    );
  }

  private async viewOf(id: string): Promise<WebhookSubscriptionView> {
    const m = this.dataSource.manager;
    const sub = await this.requireSubscription(m, id);
    const integration = await this.requireIntegration(m, sub.integrationId);
    const [view] = await this.loadViews(m, [sub], new Map([[integration.id, integration.name]]));
    return view as WebhookSubscriptionView;
  }

  private async loadViews(
    m: EntityManager,
    subs: WebhookSubscription[],
    integrationNames: Map<string, string>,
  ): Promise<WebhookSubscriptionView[]> {
    if (subs.length === 0) return [];
    const ids = subs.map((s) => s.id);
    const [secrets, counts]: [WebhookSecret[], { subscription_id: string; state: string; total: string }[]] =
      await Promise.all([
        m
          .getRepository(WebhookSecret)
          .createQueryBuilder('s')
          .where('s.subscription_id IN (:...ids)', { ids })
          .orderBy('s.created_at', 'DESC')
          .getMany(),
        m.query(
          `SELECT subscription_id, state, count(*) AS total FROM webhook_delivery
            WHERE subscription_id = ANY($1) AND state IN ('pending', 'failed') GROUP BY subscription_id, state`,
          [ids],
        ),
      ]);
    const now = new Date();
    const count = (subId: string, state: string) =>
      Number(counts.find((c) => c.subscription_id === subId && c.state === state)?.total ?? 0);
    return subs.map((s) => ({
      id: s.id,
      integrationId: s.integrationId,
      integrationName: integrationNames.get(s.integrationId) ?? '',
      name: s.name,
      url: s.url,
      events: s.events,
      status: s.status,
      suspendedReason: s.suspendedReason,
      consecutiveFailures: s.consecutiveFailures,
      secrets: secrets
        .filter((x) => x.subscriptionId === s.id)
        .map(
          (x): WebhookSecretView => ({
            id: x.id,
            prefix: x.prefix,
            state: tokenState(x, now),
            expiresAt: x.expiresAt.toISOString(),
            retireAt: x.retireAt?.toISOString() ?? null,
            revokedAt: x.revokedAt?.toISOString() ?? null,
            createdAt: x.createdAt.toISOString(),
          }),
        ),
      pending: count(s.id, 'pending'),
      failed: count(s.id, 'failed'),
      createdAt: s.createdAt.toISOString(),
    }));
  }
}

interface DeliveryRow {
  id: string;
  event_id: string;
  event_type: string;
  state: string;
  attempts: number;
  next_attempt_at: Date;
  last_status: number | null;
  last_error: string | null;
  delivered_at: Date | null;
  created_at: Date;
}

function deliveryView(r: DeliveryRow): WebhookDeliveryView {
  return {
    id: r.id,
    eventId: r.event_id,
    eventType: r.event_type,
    state: r.state,
    attempts: r.attempts,
    nextAttemptAt: new Date(r.next_attempt_at).toISOString(),
    lastStatus: r.last_status,
    lastError: r.last_error,
    deliveredAt: r.delivered_at ? new Date(r.delivered_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}
