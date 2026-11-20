import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { daysAgo, hoursFromNow, startOfUtcHour } from '../../src/common/dates.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { HttpMetricsStore } from '../../src/observability/http-metrics.store.js';
import { bucketIndex, emptyBuckets } from '../../src/observability/latency.js';
import { MetricsFlushService } from '../../src/observability/metrics-flush.service.js';
import { purgeOpsData, runOpsMaintenance } from '../../src/observability/retention.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Traffic {
  metricsEnabled: boolean;
  requests: number;
  errors4xx: number;
  loginsOk: number;
  loginsFailed: number;
  routes: { route: string; requests: number; errors: number; p95Ms: number }[];
}
interface History {
  metricsEnabled: boolean;
  hours: { hour: string; requests: number; errors5xx: number; p95Ms: number; routes: { route: string }[] }[];
}

/** O `finish` da resposta corre logo depois de o cliente receber o corpo; uma folga curta evita corrida. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('Observabilidade: tráfego, histórico e retenção (M12, RN-92)', () => {
  let t: TestApp;
  let admin: Client;
  let store: HttpMetricsStore;
  let flush: MetricsFlushService;

  const traffic = async () => {
    await settle();
    const res = await admin.get<Traffic>('/ops/traffic');
    expect(res.status).toBe(200);
    return res.body;
  };
  const routeOf = (report: Traffic, route: string) => report.routes.find((entry) => entry.route === route);
  const hourRow = async (hour: Date) => {
    const rows: {
      requests: number;
      errors_5xx: number;
      latency_buckets: number[];
      routes: { route: string; requests: number; errors: number }[];
    }[] = await t.db.dataSource.query('SELECT * FROM ops_metric_hour WHERE hour = $1 AND process = $2', [hour, 'api']);
    return rows[0];
  };

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    store = t.app.get(HttpMetricsStore);
    flush = t.app.get(MetricsFlushService);
  });
  afterEach(() => {
    // (atribuir undefined a process.env gravaria o texto "undefined"; por isso o delete)
    delete process.env.METRICS_ENABLED;
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-92.1 conta pela rota molde: a URL de verdade e a query string nunca aparecem', async () => {
    const id = '0190a3b2-7c11-7000-8000-00000000abcd';
    const res = await admin.get(`/ideas/${id}?x=1&token=segredo`);
    expect([404, 422]).toContain(res.status);
    const report = await traffic();
    const molded = report.routes.find((entry) => entry.route.startsWith('GET /api/ideas/:'));
    expect(molded, JSON.stringify(report.routes)).toBeTruthy();
    const everything = JSON.stringify(report);
    expect(everything).not.toContain(id);
    expect(everything).not.toContain('x=1');
    expect(everything).not.toContain('segredo');
  });

  it('CA-RN-92.2 rota inexistente conta como "(sem rota)"; /api/health e /api/ops/* não entram na conta', async () => {
    const before = await traffic();
    await new Client(t.baseUrl).get('/health');
    await new Client(t.baseUrl).get('/health');
    await admin.get('/ops/health');
    expect((await admin.get('/nao-existe-mesmo')).status).toBe(404);
    const after = await traffic();
    expect(routeOf(after, 'GET (sem rota)')?.requests ?? 0).toBe(
      (routeOf(before, 'GET (sem rota)')?.requests ?? 0) + 1,
    );
    expect(after.routes.some((entry) => entry.route.includes('/api/health'))).toBe(false);
    expect(after.routes.some((entry) => entry.route.includes('/api/ops/'))).toBe(false);
  });

  it('CA-RN-92.7 login com sucesso e login recusado são contados à parte', async () => {
    const before = await traffic();
    const anon = new Client(t.baseUrl);
    expect(
      (await anon.post('/auth/login', { email: INSTALL_INPUT.adminEmail, password: 'errada-errada-1' })).status,
    ).toBe(401);
    expect(
      (await new Client(t.baseUrl).post('/auth/login', { email: INSTALL_INPUT.adminEmail, password: STRONG_PASSWORD }))
        .status,
    ).toBe(200);
    const after = await traffic();
    expect(after.loginsFailed).toBe(before.loginsFailed + 1);
    expect(after.loginsOk).toBe(before.loginsOk + 1);
    expect(after.errors4xx).toBeGreaterThanOrEqual(before.errors4xx + 1);
  });

  it('CA-RN-92.3 duas gravações na mesma hora somam contadores, faixas e rotas', async () => {
    await flush.flush();
    const hour = startOfUtcHour(hoursFromNow(-5));
    const at = hoursFromNow(-5);
    const base = await hourRow(hour);
    expect(base).toBeUndefined();

    store.record('GET /api/teste', 200, 3, at);
    store.record('GET /api/teste', 500, 30, at);
    await flush.flush();
    store.record('GET /api/teste', 200, 3, at);
    await flush.flush();

    const row = await hourRow(hour);
    expect(row?.requests).toBe(3);
    expect(row?.errors_5xx).toBe(1);
    const expected = emptyBuckets();
    expected[bucketIndex(3)] = 2;
    expected[bucketIndex(30)] = 1;
    expect(row?.latency_buckets).toEqual(expected);
    expect(row?.routes.find((entry) => entry.route === 'GET /api/teste')).toMatchObject({ requests: 3, errors: 1 });

    // a leitura devolve a hora com os percentis calculados das faixas somadas
    const res = await admin.get<History>('/ops/history');
    expect(res.status).toBe(200);
    expect(res.body.metricsEnabled).toBe(true);
    const found = res.body.hours.find((entry) => entry.hour === hour.toISOString());
    expect(found).toMatchObject({ requests: 3, errors5xx: 1, p95Ms: 50 });
  });

  it('CA-RN-92.5 período inválido, invertido ou maior que 31 dias → 422', async () => {
    const to = new Date();
    expect((await admin.get('/ops/history?from=nao-e-data')).status).toBe(422);
    expect((await admin.get(`/ops/history?from=${to.toISOString()}&to=${daysAgo(1, to).toISOString()}`)).status).toBe(
      422,
    );
    expect((await admin.get(`/ops/history?from=${daysAgo(40, to).toISOString()}&to=${to.toISOString()}`)).status).toBe(
      422,
    );
    expect((await admin.get(`/ops/history?from=${daysAgo(30, to).toISOString()}&to=${to.toISOString()}`)).status).toBe(
      200,
    );
  });

  it('CA-RN-92.5 a limpeza apaga o que passou de ops.retention_days e repetir não muda mais nada', async () => {
    const ds = t.db.dataSource;
    const now = new Date();
    const insert = (hour: Date) =>
      ds.query(`INSERT INTO ops_metric_hour (hour, process, requests) VALUES ($1, 'api', 1) ON CONFLICT DO NOTHING`, [
        hour,
      ]);
    const old = startOfUtcHour(daysAgo(40, now));
    const recent = startOfUtcHour(daysAgo(10, now));
    await insert(old);
    await insert(recent);
    await ds.query(
      `INSERT INTO ops_heartbeat (process, instance, started_at, last_seen_at, memory_mb, version)
       VALUES ('worker', 'maquina-que-sumiu', now() - interval '3 days', now() - interval '2 days', 10, 'x')`,
    );

    expect(await purgeOpsData(ds, now)).toEqual({
      metrics: expect.any(Number),
      heartbeats: 1,
      integrations: 0,
      webhooks: 0,
      idempotency: 0,
    });
    expect(await hourRow(old)).toBeUndefined();
    expect(await hourRow(recent)).toBeTruthy();
    expect(await purgeOpsData(ds, now)).toEqual({
      metrics: 0,
      heartbeats: 0,
      integrations: 0,
      webhooks: 0,
      idempotency: 0,
    });

    // com retenção de 5 dias, a hora de 10 dias atrás também sai
    await ds.query(
      `INSERT INTO setting (key, value) VALUES ('ops.retention_days', '5'::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    expect((await purgeOpsData(ds, now)).metrics).toBeGreaterThanOrEqual(1);
    expect(await hourRow(recent)).toBeUndefined();
  });

  it('a manutenção do worker só limpa no minuto 10 de cada hora', async () => {
    const ds = t.db.dataSource;
    expect(await runOpsMaintenance(ds, new Date('2026-11-10T15:05:00-03:00'))).toBeNull();
    expect(await runOpsMaintenance(ds, new Date('2026-11-10T15:10:00-03:00'))).toEqual({
      metrics: expect.any(Number),
      heartbeats: expect.any(Number),
      integrations: expect.any(Number),
      webhooks: expect.any(Number),
      idempotency: expect.any(Number),
    });
  });

  it('CA-RN-92.6 com METRICS_ENABLED=false nada é contado nem gravado, e a saúde segue respondendo', async () => {
    await traffic();
    await flush.flush();
    const before = await traffic();
    process.env.METRICS_ENABLED = 'false';
    await admin.get('/ideas/mine');
    await settle();
    store.record('GET /api/nao-deveria', 200, 3, new Date());
    await flush.flush();
    const after = (await admin.get<Traffic>('/ops/traffic')).body;
    expect(after.metricsEnabled).toBe(false);
    expect(after.requests).toBe(before.requests + 1); // só o registro direto no armazém; a requisição não foi medida
    const health = await admin.get<{ metricsEnabled: boolean; items: unknown[] }>('/ops/health');
    expect(health.status).toBe(200);
    expect(health.body.metricsEnabled).toBe(false);
    expect(health.body.items.length).toBeGreaterThan(0);
    // e o armazém não gravou nada: a gravação foi pulada, então o que sobrou segue na memória
    const rows: { n: string }[] = await t.db.dataSource.query(
      `SELECT count(*) AS n FROM ops_metric_hour WHERE routes::text LIKE '%nao-deveria%'`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('CA-T.11 nenhuma tabela ops_*, resposta ou log guarda URL crua, query string, e-mail ou id', async () => {
    const id = '0190a3b2-7c11-7000-8000-00000000dcba';
    await new Client(t.baseUrl).post('/auth/login', {
      email: 'pessoa.secreta@example.test',
      password: 'x-x-x-x-x-x-1',
    });
    await admin.get(`/ideas/${id}?busca=confidencial`);
    await settle();
    await flush.flush();
    const ds = t.db.dataSource;
    const dump = JSON.stringify({
      metrics: await ds.query('SELECT * FROM ops_metric_hour'),
      heartbeats: await ds.query('SELECT * FROM ops_heartbeat'),
      traffic: (await admin.get('/ops/traffic')).body,
      history: (await admin.get('/ops/history')).body,
      health: (await admin.get('/ops/health')).body,
    });
    for (const secret of [id, 'busca=confidencial', 'pessoa.secreta', INSTALL_INPUT.adminEmail]) {
      expect(dump, `vazou: ${secret}`).not.toContain(secret);
    }
  });

  it('CA-RN-92.4 o Administrador de fábrica enxerga o histórico; quem não tem ops.view recebe 403 em todas as rotas', async () => {
    const ds = t.db.dataSource;
    const users = ds.getRepository(User);
    await users.save(
      users.create({
        email: 'sem-ops@example.test',
        name: 'Sem Ops',
        passwordHash: await hashPassword(STRONG_PASSWORD),
      }),
    );
    const plain = new Client(t.baseUrl);
    expect((await plain.post('/auth/login', { email: 'sem-ops@example.test', password: STRONG_PASSWORD })).status).toBe(
      200,
    );
    for (const path of ['/ops/health', '/ops/traffic', '/ops/history']) {
      expect((await plain.get(path)).status, path).toBe(403);
      expect((await admin.get(path)).status, path).toBe(200);
    }
  });
});
