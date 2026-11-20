import { describe, expect, it } from 'vitest';
import {
  apiItem,
  databaseItem,
  emailItem,
  emailQueueItem,
  evaluateHealth,
  type HealthSnapshot,
  LIMITS,
  overallState,
  storageItem,
  workerItem,
} from '../../src/observability/health-rules.js';

const NOW = new Date('2026-11-10T12:00:00Z');
/** Instante `minutes` minutos antes de NOW. */
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const healthy = (): HealthSnapshot => ({
  now: NOW,
  database: { ok: true, data: { ms: 5 } },
  migrations: { ok: true, data: { pending: false } },
  storage: { ok: true, data: { freePct: 50 } },
  email: { ok: true, data: { providerActive: true, attempts: 10, failed: 0 } },
  emailQueue: { ok: true, data: { oldestPendingAt: null } },
  timeZone: 'America/Sao_Paulo',
  emailSecret: { ok: true, data: { applicable: false, expiresOn: null } },
  ssoSecret: { ok: true, data: { providers: [] } },
  integrationToken: { ok: true, data: { enabled: false, integrations: [] } },
  webhookSecret: { ok: true, data: { enabled: false, subscriptions: [] } },
  webhookDelivery: {
    ok: true,
    data: { enabled: false, active: 0, suspendedByFailures: 0, failedLast24h: 0, oldestPendingAt: null },
  },
  worker: { ok: true, data: { lastSeenAt: minutesBefore(1) } },
  api: { ok: true, data: { lastSeenAt: minutesBefore(1), eventLoopP99Ms: 10 } },
});

describe('Regras de saúde (RN-93)', () => {
  it('CA-RN-93.1 o estado geral é o pior dos itens; sem itens, ok', () => {
    expect(overallState([])).toBe('ok');
    expect(overallState([{ state: 'ok' }, { state: 'ok' }])).toBe('ok');
    expect(overallState([{ state: 'ok' }, { state: 'warning' }])).toBe('warning');
    expect(overallState([{ state: 'warning' }, { state: 'failed' }, { state: 'ok' }])).toBe('failed');
  });

  it('CA-RN-93.1 um retrato saudável dá doze itens em ordem e estado ok', () => {
    const result = evaluateHealth(healthy());
    expect(result.state).toBe('ok');
    expect(result.items.map((item) => item.key)).toEqual([
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
    ]);
  });

  it('CA-RN-93.2 banco: 200 ms ainda é ok, 201 ms é atenção, sem resposta é falha', () => {
    expect(databaseItem({ ok: true, data: { ms: LIMITS.databaseSlowMs } }).state).toBe('ok');
    expect(databaseItem({ ok: true, data: { ms: LIMITS.databaseSlowMs + 1 } }).state).toBe('warning');
    expect(databaseItem({ ok: false })).toMatchObject({ state: 'failed', code: 'down' });
  });

  it('CA-RN-93.2 armazenamento: 10% é ok, 9% é atenção, 3% é atenção, 2% é falha', () => {
    const at = (freePct: number | null) => storageItem({ ok: true, data: { freePct } }).state;
    expect(at(10)).toBe('ok');
    expect(at(9)).toBe('warning');
    expect(at(3)).toBe('warning');
    expect(at(2)).toBe('failed');
    expect(at(null)).toBe('warning');
  });

  it('CA-RN-93.2 fila de e-mail: 10 min é ok, 11 é atenção, 30 é atenção, 31 é falha', () => {
    const at = (minutes: number | null) =>
      emailQueueItem({ ok: true, data: { oldestPendingAt: minutes === null ? null : minutesBefore(minutes) } }, NOW)
        .state;
    expect(at(null)).toBe('ok');
    expect(at(10)).toBe('ok');
    expect(at(11)).toBe('warning');
    expect(at(30)).toBe('warning');
    expect(at(31)).toBe('failed');
  });

  it('CA-RN-93.2 worker e API: 3 min é ok, 4 é atenção, 10 é atenção, 11 é falha; sem registro é atenção', () => {
    const worker = (minutes: number | null) =>
      workerItem({ ok: true, data: { lastSeenAt: minutes === null ? null : minutesBefore(minutes) } }, NOW).state;
    const api = (minutes: number | null) =>
      apiItem(
        { ok: true, data: { lastSeenAt: minutes === null ? null : minutesBefore(minutes), eventLoopP99Ms: 0 } },
        NOW,
      ).state;
    for (const at of [worker, api]) {
      expect(at(3)).toBe('ok');
      expect(at(4)).toBe('warning');
      expect(at(10)).toBe('warning');
      expect(at(11)).toBe('failed');
      expect(at(null)).toBe('warning');
    }
  });

  it('CA-RN-93.2 API: atraso do ciclo de eventos de 200 ms é ok, 201 ms é atenção', () => {
    const at = (eventLoopP99Ms: number) =>
      apiItem({ ok: true, data: { lastSeenAt: minutesBefore(0), eventLoopP99Ms } }, NOW);
    expect(at(LIMITS.eventLoopWarningMs).state).toBe('ok');
    expect(at(LIMITS.eventLoopWarningMs + 1)).toMatchObject({ state: 'warning', code: 'event_loop' });
  });

  it('CA-RN-93.2 e-mail: falha só com 5+ tentativas e metade ou mais falhando; qualquer falha é atenção', () => {
    const at = (attempts: number, failed: number, providerActive = true) =>
      emailItem({ ok: true, data: { providerActive, attempts, failed } });
    expect(at(10, 0).state).toBe('ok');
    expect(at(10, 1).state).toBe('warning');
    expect(at(10, 4).state).toBe('warning');
    expect(at(10, 5).state).toBe('failed');
    expect(at(4, 4).state).toBe('warning'); // poucas tentativas: ainda não é falha
    expect(at(5, 3).state).toBe('failed');
    expect(at(0, 0).state).toBe('ok');
  });

  it('CA-RN-93.7 provedor de e-mail desligado é ok, só informativo', () => {
    expect(emailItem({ ok: true, data: { providerActive: false, attempts: 9, failed: 9 } })).toMatchObject({
      state: 'ok',
      code: 'disabled',
    });
  });

  it('CA-RN-93.5 coleta com erro vira falha "unavailable" sem derrubar os outros itens', () => {
    const snapshot = { ...healthy(), storage: { ok: false } as const };
    const result = evaluateHealth(snapshot);
    expect(result.state).toBe('failed');
    expect(result.items.find((item) => item.key === 'storage')).toMatchObject({
      state: 'failed',
      code: 'unavailable',
    });
    expect(result.items.filter((item) => item.state === 'failed')).toHaveLength(1);
  });
});
