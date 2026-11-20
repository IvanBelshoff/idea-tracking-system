/**
 * Regras puras da saúde (RN-93): recebem um retrato do sistema e devolvem os itens e o estado geral.
 * Sem banco, sem relógio próprio e sem framework, para os limites serem testados na borda (CA-RN-93.2).
 * Os textos ficam no frontend: aqui só vão o item, o estado, um código e um número.
 */
import { minutesSince, todayInZone } from '../common/dates.js';
import { secretVerdict, worstVerdict } from './secret-expiry.js';

export const HEALTH_STATES = ['ok', 'warning', 'failed'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export const HEALTH_KEYS = [
  'database',
  'migrations',
  'storage',
  'email',
  'email_queue',
  'email_secret',
  'sso_secret',
  'integration_token',
  'webhook_secret',
  'webhook_delivery',
  'worker',
  'api',
] as const;
export type HealthKey = (typeof HEALTH_KEYS)[number];

/** Limites que mudam o estado (RN-93). Mudar aqui muda a tela e o alerta. */
export const LIMITS = {
  databaseSlowMs: 200,
  storageFreeWarningPct: 10,
  storageFreeFailedPct: 3,
  emailWindowHours: 24,
  emailFailedMinAttempts: 5,
  emailFailedRatio: 0.5,
  queueWarningMinutes: 10,
  queueFailedMinutes: 30,
  heartbeatWarningMinutes: 3,
  heartbeatFailedMinutes: 10,
  eventLoopWarningMs: 200,
  /** Entrega de webhook pendente há mais que isto põe a saúde em atenção (RN-123). */
  webhookStaleMinutes: 15,
} as const;

export interface HealthItem {
  key: HealthKey;
  state: HealthState;
  /** O que aconteceu, em código estável; a tela traduz (`ok`, `slow`, `down`, `stale`...). */
  code: string;
  /** Número que acompanha o código (ms, %, minutos...), quando faz sentido. */
  value: number | null;
}

/** Resultado de uma coleta: deu certo, com o dado, ou deu erro (item vira falha, RN-93). */
export type Probe<T> = { ok: true; data: T } | { ok: false };

export interface HealthSnapshot {
  now: Date;
  database: Probe<{ ms: number }>;
  /** `true` = há migração pendente. */
  migrations: Probe<{ pending: boolean }>;
  /** Percentual livre do volume dos anexos, medido pela API; nulo = ainda sem medida. */
  storage: Probe<{ freePct: number | null }>;
  email: Probe<{ providerActive: boolean; attempts: number; failed: number }>;
  /** O e-mail pendente mais antigo; nulo = fila vazia. */
  emailQueue: Probe<{ oldestPendingAt: Date | null }>;
  /** Fuso da instalação, para contar os dias até a validade dos segredos (M14, RN-100). */
  timeZone: string;
  /** Só vale com o envio ligado e do tipo Microsoft; `expiresOn` é `AAAA-MM-DD` ou nulo. */
  emailSecret: Probe<{ applicable: boolean; expiresOn: string | null }>;
  /** Os provedores de login corporativo LIGADOS e a validade do segredo de cada um. */
  ssoSecret: Probe<{ providers: { expiresOn: string | null }[] }>;
  /**
   * Integrações ATIVAS (M16, RN-113): a validade do token de maior validade de cada uma. `enabled` é a
   * chave geral da API de integração; desligada, o item não se aplica.
   */
  integrationToken: Probe<{ enabled: boolean; integrations: { expiresAt: Date }[] }>;
  /** Webhooks (M17, RN-123): a validade do segredo de maior validade de cada assinatura ativa. */
  webhookSecret: Probe<{ enabled: boolean; subscriptions: { expiresAt: Date }[] }>;
  /** Webhooks (M17, RN-123): entregas. `active` conta as assinaturas ativas; `suspendedByFailures`, as paradas por falhas. */
  webhookDelivery: Probe<{
    enabled: boolean;
    active: number;
    suspendedByFailures: number;
    failedLast24h: number;
    oldestPendingAt: Date | null;
  }>;
  /** Último batimento do processo; nulo = nunca registrou. */
  worker: Probe<{ lastSeenAt: Date | null }>;
  api: Probe<{ lastSeenAt: Date | null; eventLoopP99Ms: number | null }>;
}

const unavailable = (key: HealthKey): HealthItem => ({ key, state: 'failed', code: 'unavailable', value: null });

const item = (key: HealthKey, state: HealthState, code: string, value: number | null = null): HealthItem => ({
  key,
  state,
  code,
  value,
});

export function databaseItem(probe: HealthSnapshot['database']): HealthItem {
  if (!probe.ok) return item('database', 'failed', 'down');
  return probe.data.ms > LIMITS.databaseSlowMs
    ? item('database', 'warning', 'slow', probe.data.ms)
    : item('database', 'ok', 'ok', probe.data.ms);
}

export function migrationsItem(probe: HealthSnapshot['migrations']): HealthItem {
  if (!probe.ok) return unavailable('migrations');
  return probe.data.pending ? item('migrations', 'warning', 'pending') : item('migrations', 'ok', 'ok');
}

export function storageItem(probe: HealthSnapshot['storage']): HealthItem {
  if (!probe.ok) return unavailable('storage');
  const free = probe.data.freePct;
  if (free === null) return item('storage', 'warning', 'unknown');
  if (free < LIMITS.storageFreeFailedPct) return item('storage', 'failed', 'low_space', free);
  if (free < LIMITS.storageFreeWarningPct) return item('storage', 'warning', 'low_space', free);
  return item('storage', 'ok', 'ok', free);
}

export function emailItem(probe: HealthSnapshot['email']): HealthItem {
  if (!probe.ok) return unavailable('email');
  const { providerActive, attempts, failed } = probe.data;
  if (!providerActive) return item('email', 'ok', 'disabled');
  if (attempts >= LIMITS.emailFailedMinAttempts && failed / attempts >= LIMITS.emailFailedRatio) {
    return item('email', 'failed', 'many_failures', failed);
  }
  if (failed > 0) return item('email', 'warning', 'failures', failed);
  return item('email', 'ok', 'ok');
}

export function emailQueueItem(probe: HealthSnapshot['emailQueue'], now: Date): HealthItem {
  if (!probe.ok) return unavailable('email_queue');
  const oldest = probe.data.oldestPendingAt;
  if (!oldest) return item('email_queue', 'ok', 'empty');
  const minutes = Math.floor(minutesSince(oldest, now));
  if (minutes > LIMITS.queueFailedMinutes) return item('email_queue', 'failed', 'stuck', minutes);
  if (minutes > LIMITS.queueWarningMinutes) return item('email_queue', 'warning', 'stuck', minutes);
  return item('email_queue', 'ok', 'pending', minutes);
}

/** Segredo do envio de e-mail: vale com o envio pela Microsoft, ou pelo Google com validade informada (RN-100). */
export function emailSecretItem(probe: HealthSnapshot['emailSecret'], now: Date, timeZone: string): HealthItem {
  if (!probe.ok) return unavailable('email_secret');
  if (!probe.data.applicable) return item('email_secret', 'ok', 'not_applicable');
  const verdict = secretVerdict(probe.data.expiresOn, now, timeZone);
  return item('email_secret', verdict.state, verdict.code, verdict.days);
}

/** Segredo do login corporativo: o pior entre os provedores ligados (RN-100). */
export function ssoSecretItem(probe: HealthSnapshot['ssoSecret'], now: Date, timeZone: string): HealthItem {
  if (!probe.ok) return unavailable('sso_secret');
  const worst = worstVerdict(probe.data.providers.map((p) => secretVerdict(p.expiresOn, now, timeZone)));
  if (!worst) return item('sso_secret', 'ok', 'not_applicable');
  return item('sso_secret', worst.state, worst.code, worst.days);
}

/**
 * Token de integração (M16, RN-113): o pior entre as integrações ativas, cada uma pelo token de maior
 * validade (o antigo de uma rotação não pesa). Mesma conta da RN-100: atenção a 30 dias ou menos, falha a
 * 7 ou menos ou vencido. Só vale com a chave geral ligada e ao menos uma integração ativa com token.
 */
export function integrationTokenItem(
  probe: HealthSnapshot['integrationToken'],
  now: Date,
  timeZone: string,
): HealthItem {
  if (!probe.ok) return unavailable('integration_token');
  if (!probe.data.enabled || probe.data.integrations.length === 0) {
    return item('integration_token', 'ok', 'not_applicable');
  }
  const worst = worstVerdict(
    probe.data.integrations.map((i) => secretVerdict(todayInZone(i.expiresAt, timeZone), now, timeZone)),
  );
  if (!worst) return item('integration_token', 'ok', 'not_applicable');
  return item('integration_token', worst.state, worst.code, worst.days);
}

/** Segredo dos webhooks (M17, RN-123): o pior entre as assinaturas ativas, pela mesma régua da RN-100. */
export function webhookSecretItem(probe: HealthSnapshot['webhookSecret'], now: Date, timeZone: string): HealthItem {
  if (!probe.ok) return unavailable('webhook_secret');
  if (!probe.data.enabled || probe.data.subscriptions.length === 0)
    return item('webhook_secret', 'ok', 'not_applicable');
  const worst = worstVerdict(
    probe.data.subscriptions.map((s) => secretVerdict(todayInZone(s.expiresAt, timeZone), now, timeZone)),
  );
  if (!worst) return item('webhook_secret', 'ok', 'not_applicable');
  return item('webhook_secret', worst.state, worst.code, worst.days);
}

/**
 * Entrega dos webhooks (M17, RN-123): falha se há assinatura suspensa por falhas; atenção se houve falha
 * definitiva nas últimas 24 horas ou há entrega pendente há mais de 15 minutos. Só vale com a chave ligada
 * e ao menos uma assinatura (ativa ou parada por falhas).
 */
export function webhookDeliveryItem(probe: HealthSnapshot['webhookDelivery'], now: Date): HealthItem {
  if (!probe.ok) return unavailable('webhook_delivery');
  const d = probe.data;
  if (!d.enabled || (d.active === 0 && d.suspendedByFailures === 0))
    return item('webhook_delivery', 'ok', 'not_applicable');
  if (d.suspendedByFailures > 0) return item('webhook_delivery', 'failed', 'suspended', d.suspendedByFailures);
  if (d.failedLast24h > 0) return item('webhook_delivery', 'warning', 'failures', d.failedLast24h);
  if (d.oldestPendingAt) {
    const minutes = Math.floor(minutesSince(d.oldestPendingAt, now));
    if (minutes > LIMITS.webhookStaleMinutes) return item('webhook_delivery', 'warning', 'stuck', minutes);
  }
  return item('webhook_delivery', 'ok', 'ok');
}

/** Idade do último batimento: nenhum registro e atraso (3 e 10 minutos) valem para a API e o worker. */
function heartbeatItem(key: 'worker' | 'api', lastSeenAt: Date | null, now: Date): HealthItem {
  if (!lastSeenAt) return item(key, 'warning', 'no_heartbeat');
  const minutes = Math.floor(minutesSince(lastSeenAt, now));
  if (minutes > LIMITS.heartbeatFailedMinutes) return item(key, 'failed', 'stale', minutes);
  if (minutes > LIMITS.heartbeatWarningMinutes) return item(key, 'warning', 'stale', minutes);
  return item(key, 'ok', 'ok', minutes);
}

export function workerItem(probe: HealthSnapshot['worker'], now: Date): HealthItem {
  if (!probe.ok) return unavailable('worker');
  return heartbeatItem('worker', probe.data.lastSeenAt, now);
}

export function apiItem(probe: HealthSnapshot['api'], now: Date): HealthItem {
  if (!probe.ok) return unavailable('api');
  const beat = heartbeatItem('api', probe.data.lastSeenAt, now);
  const loop = probe.data.eventLoopP99Ms;
  if (beat.state === 'ok' && loop !== null && loop > LIMITS.eventLoopWarningMs) {
    return item('api', 'warning', 'event_loop', loop);
  }
  return beat;
}

/** O pior estado entre os itens (`failed` > `warning` > `ok`); sem itens, `ok` (CA-RN-93.1). */
export function overallState(items: readonly Pick<HealthItem, 'state'>[]): HealthState {
  if (items.some((entry) => entry.state === 'failed')) return 'failed';
  if (items.some((entry) => entry.state === 'warning')) return 'warning';
  return 'ok';
}

/** Os doze itens, na ordem em que aparecem na tela, e o estado geral. */
export function evaluateHealth(snapshot: HealthSnapshot): { state: HealthState; items: HealthItem[] } {
  const items = [
    databaseItem(snapshot.database),
    migrationsItem(snapshot.migrations),
    storageItem(snapshot.storage),
    emailItem(snapshot.email),
    emailQueueItem(snapshot.emailQueue, snapshot.now),
    emailSecretItem(snapshot.emailSecret, snapshot.now, snapshot.timeZone),
    ssoSecretItem(snapshot.ssoSecret, snapshot.now, snapshot.timeZone),
    integrationTokenItem(snapshot.integrationToken, snapshot.now, snapshot.timeZone),
    webhookSecretItem(snapshot.webhookSecret, snapshot.now, snapshot.timeZone),
    webhookDeliveryItem(snapshot.webhookDelivery, snapshot.now),
    workerItem(snapshot.worker, snapshot.now),
    apiItem(snapshot.api, snapshot.now),
  ];
  return { state: overallState(items), items };
}
