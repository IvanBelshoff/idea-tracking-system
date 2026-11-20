import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hoursFromNow, startOfUtcHour } from '../../src/common/dates.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { bucketIndex, emptyBuckets } from '../../src/observability/latency.js';
import { flushWorkerMetrics } from '../../src/observability/worker-flush.js';
import { emptyWorkerStats, mergeWorkerStats, WorkerMetrics } from '../../src/observability/worker-stats.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Usage {
  activeUsers: number | null;
  activeSessions: number | null;
  loginsLast24h: number | null;
  loginsFailedLast24h: number | null;
  lockoutsLast24h: number | null;
  databaseBytes: number | null;
  tables: { name: string; rows: number }[];
}
interface History {
  workerHours: {
    hour: string;
    ticks: number;
    tickFailures: number;
    tickP95Ms: number;
    emailsSent: number;
    emailsFailed: number;
    emailsRetried: number;
  }[];
}

const NOW = new Date('2026-11-10T12:34:56Z');

describe('Métricas do worker (CA-RN-92.8)', () => {
  it('conta disparos, falhas, faixas de tempo e e-mails; "skipped" não é tentativa', () => {
    const metrics = new WorkerMetrics();
    metrics.recordTick(30, true, NOW);
    metrics.recordTick(900, false, NOW);
    metrics.recordEmail('sent', NOW);
    metrics.recordEmail('retry', NOW);
    metrics.recordEmail('failed', NOW);
    metrics.recordEmail('skipped', NOW);
    const [hour, ...rest] = metrics.drain();
    expect(rest).toHaveLength(0);
    expect(hour?.hour).toEqual(new Date('2026-11-10T12:00:00Z'));
    expect(hour?.stats).toMatchObject({ ticks: 2, tickFailures: 1, emailsSent: 1, emailsRetried: 1, emailsFailed: 1 });
    const expected = emptyBuckets();
    expected[bucketIndex(30)] = 1;
    expected[bucketIndex(900)] = 1;
    expect(hour?.stats.tickBuckets).toEqual(expected);
    expect(metrics.drain()).toHaveLength(0);
  });

  it('restore devolve o que não foi gravado e a soma é exata', () => {
    const metrics = new WorkerMetrics();
    metrics.recordTick(30, true, NOW);
    const first = metrics.drain();
    metrics.restore(first);
    metrics.recordTick(30, true, NOW);
    expect(metrics.drain()[0]?.stats.ticks).toBe(2);
    const sum = mergeWorkerStats(null, { ...emptyWorkerStats(), ticks: 2 });
    expect(mergeWorkerStats(sum, { ...emptyWorkerStats(), ticks: 3, emailsSent: 1 })).toMatchObject({
      ticks: 5,
      emailsSent: 1,
    });
  });
});

describe('Worker e uso na observabilidade (M12, RN-92)', () => {
  let t: TestApp;
  let admin: Client;

  const usage = async () => {
    const res = await admin.get<Usage>('/ops/usage');
    expect(res.status).toBe(200);
    return res.body;
  };

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-92.8 o worker grava por hora e duas gravações na mesma hora somam; o histórico traz a execução do worker', async () => {
    const at = hoursFromNow(-3);
    const hour = startOfUtcHour(at);
    const metrics = new WorkerMetrics();

    metrics.recordTick(30, true, at);
    metrics.recordEmail('sent', at);
    await flushWorkerMetrics(t.db.dataSource, metrics);
    metrics.recordTick(900, false, at);
    metrics.recordEmail('retry', at);
    metrics.recordEmail('failed', at);
    await flushWorkerMetrics(t.db.dataSource, metrics);
    await flushWorkerMetrics(t.db.dataSource, metrics); // nada novo: não muda nada

    const rows: { worker: { ticks: number; tickBuckets: number[] } }[] = await t.db.dataSource.query(
      `SELECT worker FROM ops_metric_hour WHERE process = 'worker' AND hour = $1`,
      [hour],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.worker.ticks).toBe(2);

    const res = await admin.get<History>('/ops/history');
    const found = res.body.workerHours.find((entry) => entry.hour === hour.toISOString());
    expect(found).toMatchObject({
      ticks: 2,
      tickFailures: 1,
      tickP95Ms: 1000,
      emailsSent: 1,
      emailsRetried: 1,
      emailsFailed: 1,
    });
  });

  it('CA-RN-92.8 gravação que falha devolve as medidas para a memória', async () => {
    const metrics = new WorkerMetrics();
    metrics.recordTick(30, true, hoursFromNow(-2));
    const broken = {
      transaction: () => Promise.reject(new Error('banco caiu')),
    } as unknown as Parameters<typeof flushWorkerMetrics>[0];
    await flushWorkerMetrics(broken, metrics);
    expect(metrics.drain()[0]?.stats.ticks).toBe(1);
  });

  it('CA-RN-92.9 conta contas, sessões, entradas, falhas e bloqueios; mede o banco e as tabelas que só crescem', async () => {
    const before = await usage();
    expect(before.activeUsers).toBeGreaterThanOrEqual(1);
    expect(before.activeSessions).toBeGreaterThanOrEqual(1);
    expect(before.databaseBytes).toBeGreaterThan(0);
    expect(before.tables.map((table) => table.name)).toEqual(['audit_log', 'idea_event', 'email_log', 'notification']);

    // bloqueio por tentativas: três erros seguidos com o limite em 3
    expect((await admin.request('PATCH', '/settings', { values: { 'auth.max_failed_attempts': 3 } })).status).toBe(200);
    const ds = t.db.dataSource;
    const users = ds.getRepository(User);
    await users.save(
      users.create({
        email: 'bloqueado@example.test',
        name: 'Bloq',
        passwordHash: await hashPassword(STRONG_PASSWORD),
      }),
    );
    const anon = new Client(t.baseUrl);
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await anon.post('/auth/login', { email: 'bloqueado@example.test', password: 'errada-errada-1' })).status,
      ).toBe(401);
    }
    expect(
      (await new Client(t.baseUrl).post('/auth/login', { email: INSTALL_INPUT.adminEmail, password: STRONG_PASSWORD }))
        .status,
    ).toBe(200);

    const after = await usage();
    expect(after.loginsFailedLast24h).toBe((before.loginsFailedLast24h ?? 0) + 3);
    expect(after.lockoutsLast24h).toBe((before.lockoutsLast24h ?? 0) + 1);
    expect(after.loginsLast24h).toBe((before.loginsLast24h ?? 0) + 1);
    expect(after.activeUsers).toBe((before.activeUsers ?? 0) + 1);
    expect(after.activeSessions).toBe((before.activeSessions ?? 0) + 1);
    // ninguém é identificado: só contagens
    expect(JSON.stringify(after)).not.toContain('bloqueado@example.test');
  });
});
