import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Notification } from '../../src/communication/entities.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword, tokenHash } from '../../src/identity-access/password.js';
import { AlertService } from '../../src/observability/alert.service.js';
import { HealthService } from '../../src/observability/health.service.js';
import { writeHeartbeat } from '../../src/observability/heartbeat.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { SettingsService } from '../../src/organization/settings.service.js';
import { ALL_MODULES, createIntegration, IntegrationClient } from '../support/integration-support.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface View {
  id: string;
  name: string;
  status: string;
  modules: string[];
  tokens: { id: string; prefix: string; state: string }[];
  scope: { entityId: string }[];
  expiry: { state: string; code: string; days: number | null } | null;
}
interface Overview {
  enabled: boolean;
  blockers: string[];
  modules: { id: string; enabled: boolean; sensitive: boolean; writes: boolean }[];
  integrations: View[];
  limits: { maxTokenDays: number };
}
interface Health {
  items: { key: string; state: string; code: string; value: number | null }[];
}

describe('Administração das integrações (M16, RN-102 a RN-104, RN-113 e RN-114)', () => {
  let t: TestApp;
  let admin: Client;
  let colab: Client;
  let orgId: string;
  let childId: string;
  const ds = () => t.db.dataSource;
  const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const overview = async () => (await admin.get<Overview>('/admin/integrations')).body;
  const input = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    owner: 'Equipe',
    modules: ['ideas'],
    scope: [{ entityId: orgId, includeChildren: true }],
    ratePerMinute: 60,
    ipAllowlist: [],
    includeEmail: false,
    expiresAt: future(90),
    ...over,
  });
  const audits = async (action?: string) =>
    ds().query(
      `SELECT action, actor_id, target_id, data FROM audit_log WHERE action LIKE 'integration.%' ${action ? `AND action = '${action}'` : ''} ORDER BY id`,
    );

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    orgId = (await ds().getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;
    const repo = ds().getTreeRepository(OrgEntity);
    childId = (await repo.save(repo.create({ name: 'Filha', parent: await repo.findOneByOrFail({ id: orgId }) }))).id;
    const user = await ds()
      .getRepository(User)
      .save(
        ds()
          .getRepository(User)
          .create({ email: 'colab@example.test', name: 'Colab', passwordHash: await hashPassword(STRONG_PASSWORD) }),
      );
    const role = await ds().getRepository(Role).findOneByOrFail({ systemKey: 'collaborator' });
    await ds()
      .getRepository(UserRoleScope)
      .save(ds().getRepository(UserRoleScope).create({ userId: user.id, roleId: role.id, entityId: orgId }));
    colab = new Client(t.baseUrl);
    expect((await colab.post('/auth/login', { email: 'colab@example.test', password: STRONG_PASSWORD })).status).toBe(
      200,
    );
    await writeHeartbeat(ds(), { process: 'api', startedAt: new Date(), storageFreePct: 80 });
    await writeHeartbeat(ds(), { process: 'worker', startedAt: new Date() });
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-102.6 só quem tem integration.manage mexe; de fábrica só o Administrador a tem', async () => {
    const routes: [string, string][] = [
      ['GET', '/admin/integrations'],
      ['PUT', '/admin/integrations/enabled'],
      ['PUT', '/admin/integrations/modules'],
      ['POST', '/admin/integrations'],
      ['GET', '/admin/integrations/openapi'],
    ];
    for (const [method, path] of routes) {
      expect((await colab.request(method, path, method === 'GET' ? undefined : {})).status, `${method} ${path}`).toBe(
        403,
      );
      expect((await new Client(t.baseUrl).request(method, path, method === 'GET' ? undefined : {})).status).toBe(401);
    }
    const holders: { system_key: string }[] = await ds().query(
      `SELECT r.system_key FROM role r JOIN role_permission p ON p.role_id = r.id WHERE p.permission = 'integration.manage' ORDER BY 1`,
    );
    expect(holders.map((h) => h.system_key)).toEqual(['admin']);
    expect((await admin.get<{ permissions: string[] }>('/auth/me')).body.permissions).toContain('integration.manage');
  });

  it('CA-RN-102.1 a chave nasce desligada e os módulos também', async () => {
    const o = await overview();
    expect(o.enabled).toBe(false);
    expect(o.modules.map((m) => [m.id, m.enabled])).toEqual(
      [...ALL_MODULES, 'store', 'ideas_write', 'gains_write'].map((id) => [id, false]),
    );
    // Os de escrita vêm marcados como "grava" (RN-126).
    expect(o.modules.filter((m) => m.writes).map((m) => m.id)).toEqual(['ideas_write', 'gains_write']);
    expect(o.modules.find((m) => m.id === 'users')?.sensitive).toBe(true);
    expect(o.modules.filter((m) => m.sensitive).map((m) => m.id)).toEqual(['users', 'store']);
    expect(o.limits.maxTokenDays).toBe(365);
  });

  it('CA-RN-102.2 ligar exige o endereço do sistema em HTTPS (ou localhost)', async () => {
    const settings = t.app.get(SettingsService, { strict: false });
    const attempt = (url: string) =>
      settings.set('email.app_url', url, null).then(() =>
        admin.put<{ code: string; details: { blockers: string[] } }>('/admin/integrations/enabled', {
          enabled: true,
        }),
      );
    const none = await attempt('');
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('integration_requires_app_url');
    const http = await attempt('http://its.empresa.com.br');
    expect(http.status).toBe(422);
    expect(http.body.code).toBe('integration_requires_https');
    expect(http.body.details.blockers).toEqual(['https_required']);
    expect((await overview()).enabled).toBe(false);
    expect((await attempt('http://localhost:8080')).status).toBe(200);
    expect((await admin.put('/admin/integrations/enabled', { enabled: false })).status).toBe(200);
    expect((await attempt('https://its.empresa.com.br')).status).toBe(200);
    expect((await overview()).blockers).toEqual([]);
  });

  it('CA-RN-102.7 módulo desconhecido → 422; a lista é gravada sem repetição', async () => {
    expect((await admin.put('/admin/integrations/modules', { modules: ['ideas', 'inventado'] })).status).toBe(422);
    expect((await admin.put('/admin/integrations/modules', { modules: 'ideas' })).status).toBe(422);
    const saved = await admin.put<Overview>('/admin/integrations/modules', { modules: ['users', 'ideas', 'ideas'] });
    expect(saved.status).toBe(200);
    expect(saved.body.modules.filter((m) => m.enabled).map((m) => m.id)).toEqual(['ideas', 'users']);
    await admin.put('/admin/integrations/modules', { modules: ALL_MODULES });
  });

  it('CA-RN-103.1 nome repetido (sem diferenciar maiúsculas) → 409; módulo desligado, IP, escopo e limite inválidos → 422', async () => {
    const first = await admin.post<{ integration: View }>('/admin/integrations', input('Power BI'));
    expect(first.status).toBe(201);
    const dup = await admin.post<{ code: string }>('/admin/integrations', input('power bi'));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('integration_name_taken');
    await admin.put('/admin/integrations/modules', { modules: ['ideas'] });
    const off = await admin.post<{ code: string; details: { modules: string[] } }>(
      '/admin/integrations',
      input('Com usuários', { modules: ['ideas', 'users'] }),
    );
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('module_not_enabled');
    expect(off.body.details.modules).toEqual(['users']);
    await admin.put('/admin/integrations/modules', { modules: ALL_MODULES });
    expect((await admin.post('/admin/integrations', input('IP ruim', { ipAllowlist: ['lixo'] }))).status).toBe(422);
    expect(
      (
        await admin.post(
          '/admin/integrations',
          input('IPs demais', { ipAllowlist: Array.from({ length: 21 }, (_, i) => `10.0.0.${i + 1}`) }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await admin.post(
          '/admin/integrations',
          input('Escopo ruim', {
            scope: [{ entityId: '019a2c10-0000-7000-8000-000000000999', includeChildren: true }],
          }),
        )
      ).status,
    ).toBe(422);
    expect((await admin.post('/admin/integrations', input('Sem nome', { name: '   ' }))).status).toBe(422);
  });

  it('CA-RN-105.2 limite fora de 1 a 600 → 422', async () => {
    for (const rate of [0, -5, 601, 1.5]) {
      expect(
        (await admin.post('/admin/integrations', input(`limite ${rate}`, { ratePerMinute: rate }))).status,
        String(rate),
      ).toBe(422);
    }
    expect((await admin.post('/admin/integrations', input('limite 600', { ratePerMinute: 600 }))).status).toBe(201);
  });

  it('CA-RN-104.3 a validade é obrigatória, no futuro e de até 365 dias', async () => {
    const { expiresAt: _drop, ...semData } = input('Sem validade');
    expect((await admin.post('/admin/integrations', semData)).status).toBe(422);
    expect((await admin.post('/admin/integrations', input('No passado', { expiresAt: future(-1) }))).status).toBe(422);
    const far = await admin.post<{ code: string; details: { reason: string } }>(
      '/admin/integrations',
      input('Longe demais', { expiresAt: future(366) }),
    );
    expect(far.status).toBe(422);
    expect(far.body.details.reason).toBe('too_far');
    expect((await admin.post('/admin/integrations', input('Quase um ano', { expiresAt: future(364) }))).status).toBe(
      201,
    );
  });

  it('CA-RN-104.2 o valor aparece uma vez; o banco guarda só o hash e o prefixo; nada depois devolve o token', async () => {
    const res = await admin.post<{ token: string; integration: View }>('/admin/integrations', input('Token único'));
    expect(res.status).toBe(201);
    const token = res.body.token;
    expect(token).toMatch(/^its_[A-Za-z0-9_-]{43}$/);
    const rows: { token_hash: string; prefix: string }[] = await ds().query(
      'SELECT token_hash, prefix FROM integration_token WHERE integration_id = $1',
      [res.body.integration.id],
    );
    expect(rows).toEqual([{ token_hash: tokenHash(token), prefix: token.slice(0, 8) }]);
    expect(JSON.stringify(await overview())).not.toContain(token);
    expect(res.body.integration.tokens[0]?.prefix).toBe(token.slice(0, 8));
    expect(JSON.stringify(res.body.integration)).not.toContain(token);
  });

  it('CA-RN-103.6 a integração não é usuário: não está na lista de usuários e não entra pelo login', async () => {
    const users = JSON.stringify((await admin.get('/users')).body);
    expect(users).not.toContain('Power BI');
    expect(
      (await new Client(t.baseUrl).post('/auth/login', { email: 'Power BI', password: 'qualquer' })).status,
    ).toBeGreaterThanOrEqual(400);
    const names: { n: number }[] = await ds().query(
      `SELECT count(*)::int AS n FROM "user" WHERE name ILIKE '%Power BI%'`,
    );
    expect(names[0]?.n).toBe(0);
  });

  it('CA-RN-104.5 e 104.6 rotação e revogação de token pela administração', async () => {
    const made = await createIntegration(admin, {
      name: 'Rotação admin',
      modules: ['ideas'],
      scope: [{ entityId: orgId, includeChildren: true }],
    });
    const rotated = await admin.post<{ token: string; integration: View }>(`/admin/integrations/${made.id}/tokens`, {
      expiresAt: future(30),
      overlapHours: 12,
    });
    expect(rotated.status).toBe(200);
    const states = rotated.body.integration.tokens.map((x) => x.state).sort();
    expect(states).toEqual(['active', 'retiring']);
    expect(
      (await admin.post(`/admin/integrations/${made.id}/tokens`, { expiresAt: future(30), overlapHours: 73 })).status,
    ).toBe(422);
    const retiring = rotated.body.integration.tokens.find((x) => x.state === 'retiring');
    const revoked = await admin.post<View>(`/admin/integrations/${made.id}/tokens/${retiring?.id}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.tokens.map((x) => x.state).sort()).toEqual(['active', 'revoked']);
    const c = new IntegrationClient(t.baseUrl, rotated.body.token);
    expect((await c.get('/ideas')).status).toBe(200);
    expect(
      (await admin.post(`/admin/integrations/${made.id}/tokens/019a2c10-0000-7000-8000-000000000999/revoke`)).status,
    ).toBe(404);
  });

  it('CA-RN-103 alterar a integração mantém o token; revogada não se altera (409)', async () => {
    const made = await createIntegration(admin, {
      name: 'Alterável',
      modules: ['ideas'],
      scope: [{ entityId: orgId, includeChildren: false }],
    });
    const update = await admin.put<View>(`/admin/integrations/${made.id}`, {
      name: 'Alterável 2',
      owner: 'Outro time',
      modules: ['ideas', 'hall'],
      scope: [{ entityId: childId, includeChildren: true }],
      ratePerMinute: 120,
      ipAllowlist: ['10.0.0.0/8'],
      includeEmail: true,
    });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ name: 'Alterável 2', modules: ['ideas', 'hall'] });
    expect(update.body.scope.map((s) => s.entityId)).toEqual([childId]);
    expect(update.body.tokens).toHaveLength(1);
    expect((await admin.post(`/admin/integrations/${made.id}/revoke`)).status).toBe(200);
    expect((await admin.put(`/admin/integrations/${made.id}`, { name: 'x', modules: [], scope: [] })).status).toBe(409);
    expect((await admin.post(`/admin/integrations/${made.id}/tokens`, { expiresAt: future(10) })).status).toBe(409);
    const view = (await overview()).integrations.find((i) => i.id === made.id);
    expect(view?.status).toBe('revoked');
    expect(view?.tokens.every((x) => x.state === 'revoked')).toBe(true);
  });

  it('CA-RN-114.1 e 114.2 cada ação do administrador gera um registro, sem o token nem o hash', async () => {
    const actions = new Set<string>((await audits()).map((r: { action: string }) => r.action));
    for (const expected of [
      'integration.enabled_changed',
      'integration.modules_changed',
      'integration.created',
      'integration.token_created',
      'integration.token_rotated',
      'integration.token_revoked',
      'integration.updated',
      'integration.revoked',
    ]) {
      expect(actions.has(expected), expected).toBe(true);
    }
    const adminId: { id: string }[] = await ds().query(`SELECT id FROM "user" WHERE email = 'admin@example.test'`);
    const created = await audits('integration.created');
    expect(created[0].actor_id).toBe(adminId[0]?.id);
    expect(created[0].data).toMatchObject({ name: expect.any(String), integrationId: expect.any(String) });
    const everything = JSON.stringify(await audits());
    const tokens: { token_hash: string }[] = await ds().query('SELECT token_hash FROM integration_token');
    for (const row of tokens) expect(everything).not.toContain(row.token_hash);
    expect(everything).not.toMatch(/its_[A-Za-z0-9_-]{43}/);
  });

  it('CA-RN-114.3 e 114.4 as leituras não vão à auditoria; "incluir e-mail" vai com o valor novo e o antigo', async () => {
    const made = await createIntegration(admin, {
      name: 'Auditada',
      modules: ['ideas'],
      scope: [{ entityId: orgId, includeChildren: true }],
    });
    const before = (await ds().query('SELECT count(*)::int AS n FROM audit_log'))[0].n;
    const c = new IntegrationClient(t.baseUrl, made.token);
    for (let i = 0; i < 100; i++) expect((await c.get('/ideas')).status).toBeLessThan(500);
    expect((await ds().query('SELECT count(*)::int AS n FROM audit_log'))[0].n).toBe(before);
    expect(
      (
        await admin.put(`/admin/integrations/${made.id}`, {
          name: 'Auditada',
          owner: '',
          modules: ['ideas'],
          scope: [{ entityId: orgId, includeChildren: true }],
          ratePerMinute: 60,
          ipAllowlist: [],
          includeEmail: true,
        })
      ).status,
    ).toBe(200);
    const updated = (await audits('integration.updated')).at(-1);
    expect(updated.data).toMatchObject({ includeEmail: true, before: { includeEmail: false } });
  });

  it('CA-RN-113.1 a 113.4 o item de saúde segue a validade do token: pior integração, token de maior validade, suspensas não contam', async () => {
    const health = () => new HealthService(ds());
    const item = async () => (await health().evaluate()).items.find((i) => i.key === 'integration_token');
    // Só integrações antigas já existem; limpa para medir isolado.
    await ds().query(`UPDATE integration SET status = 'revoked'`);
    expect(await item()).toMatchObject({ state: 'ok', code: 'not_applicable' });

    const soon = await createIntegration(admin, { name: 'vence em 20', modules: ['ideas'], scope: [], days: 20 });
    expect(await item()).toMatchObject({ state: 'warning', code: 'expiring' });
    expect((await item())?.value).toBeGreaterThanOrEqual(19);
    // Um token novo de longa validade (a rotação) faz o de 20 dias não pesar mais.
    const rotated = await admin.post(`/admin/integrations/${soon.id}/tokens`, {
      expiresAt: future(200),
      overlapHours: 24,
    });
    expect(rotated.status).toBe(200);
    expect(await item()).toMatchObject({ state: 'ok', code: 'ok' });

    const critical = await createIntegration(admin, { name: 'vence em 5', modules: ['ideas'], scope: [], days: 5 });
    expect(await item()).toMatchObject({ state: 'failed', code: 'expiring' });
    expect((await admin.post(`/admin/integrations/${critical.id}/suspend`)).status).toBe(200);
    expect(await item()).toMatchObject({ state: 'ok', code: 'ok' });
    expect((await admin.post(`/admin/integrations/${critical.id}/reactivate`)).status).toBe(200);
    await ds().query(`UPDATE integration_token SET expires_at = now() - interval '2 days' WHERE integration_id = $1`, [
      critical.id,
    ]);
    expect(await item()).toMatchObject({ state: 'failed', code: 'expired' });
    // Desligada a chave geral, o item não se aplica.
    expect((await admin.put('/admin/integrations/enabled', { enabled: false })).status).toBe(200);
    expect(await item()).toMatchObject({ state: 'ok', code: 'not_applicable' });
    expect((await admin.put('/admin/integrations/enabled', { enabled: true })).status).toBe(200);
    // Aparece também na tela de saúde da observabilidade.
    const report = await admin.get<Health>('/ops/health');
    expect(report.body.items.map((i) => i.key)).toContain('integration_token');
  });

  it('CA-RN-113.5 o token a 7 dias ou vencido dispara o alerta; a volta só depois de duas conferências', async () => {
    await ds().query(`UPDATE integration SET status = 'revoked'`);
    await ds().query('DELETE FROM ops_alert_state');
    await ds().query('DELETE FROM notification');
    const alert = new AlertService(ds(), new HealthService(ds()));
    const notices = (type: string) => ds().getRepository(Notification).find({ where: { type } });
    const made = await createIntegration(admin, { name: 'alerta', modules: ['ideas'], scope: [], days: 3 });
    expect(await alert.check()).toMatchObject({ failed: ['integration_token'], recovered: [] });
    expect((await notices('ops_failed'))[0]?.payload).toEqual({ items: ['integration_token'] });
    const before = (await notices('ops_failed')).length;
    await alert.check();
    expect((await notices('ops_failed')).length).toBe(before);
    expect(
      (await admin.post(`/admin/integrations/${made.id}/tokens`, { expiresAt: future(120), overlapHours: 0 })).status,
    ).toBe(200);
    await alert.check();
    expect(await notices('ops_recovered')).toEqual([]);
    expect(await alert.check()).toMatchObject({ recovered: ['integration_token'] });
  });

  it('CA-RN-113.6 e 113.7 o consumo soma por integração e módulo e a última chamada aparece; a limpeza respeita a retenção', async () => {
    const made = await createIntegration(admin, {
      name: 'consumo',
      modules: ['ideas', 'entities'],
      scope: [{ entityId: orgId, includeChildren: true }],
      days: 30,
    });
    const c = new IntegrationClient(t.baseUrl, made.token);
    for (let i = 0; i < 3; i++) expect((await c.get('/ideas')).status).toBe(200);
    expect((await c.get('/entities')).status).toBe(200);
    expect((await c.get('/ideas/ITS-0000-0000')).status).toBe(404);
    const usage = await admin.get<{
      byModule: { module: string; requests: number; errors4xx: number; errors5xx: number }[];
      hours: { requests: number }[];
    }>(`/admin/integrations/${made.id}/usage`);
    expect(usage.status).toBe(200);
    expect(usage.body.byModule.find((m) => m.module === 'ideas')).toMatchObject({
      requests: 4,
      errors4xx: 1,
      errors5xx: 0,
    });
    expect(usage.body.byModule.find((m) => m.module === 'entities')).toMatchObject({ requests: 1 });
    expect(usage.body.hours.reduce((sum, h) => sum + h.requests, 0)).toBe(5);
    const view = (await overview()).integrations.find((i) => i.id === made.id) as View & { lastUsedAt: string | null };
    expect(view.lastUsedAt).not.toBeNull();

    // Falha de autenticação não se liga a nenhuma integração (CA-RN-113.8).
    const rowsBefore = (await ds().query('SELECT coalesce(sum(requests), 0)::int AS n FROM integration_hour'))[0].n;
    expect((await new IntegrationClient(t.baseUrl, `its_${'q'.repeat(43)}`).get('/ideas')).status).toBe(401);
    await t.app
      .get((await import('../../src/integration/integration-usage.service.js')).IntegrationUsageService)
      .flush();
    expect((await ds().query('SELECT coalesce(sum(requests), 0)::int AS n FROM integration_hour'))[0].n).toBe(
      rowsBefore,
    );

    // Retenção: a hora velha sai, a recente fica; repetir não muda nada (CA-T.1).
    await ds().query(
      `INSERT INTO integration_hour (hour, integration_id, module, requests) VALUES (now() - interval '40 days', $1, 'ideas', 9)`,
      [made.id],
    );
    const { purgeOpsData } = await import('../../src/observability/retention.js');
    expect((await purgeOpsData(ds())).integrations).toBe(1);
    expect((await purgeOpsData(ds())).integrations).toBe(0);
    const kept: { n: number }[] = await ds().query(
      'SELECT count(*)::int AS n FROM integration_hour WHERE integration_id = $1',
      [made.id],
    );
    expect(kept[0]?.n).toBeGreaterThan(0);
  });

  it('CA-RN-113.9 as tabelas de consumo não guardam URL, parâmetro, IP nem identificador de pessoa ou de ideia', async () => {
    const columns: { column_name: string }[] = await ds().query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'integration_hour' ORDER BY 1`,
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      'errors_4xx',
      'errors_5xx',
      'hour',
      'integration_id',
      'module',
      'rate_limited',
      'requests',
      'updated_at',
    ]);
  });

  it('CA-RN-115.7 o contrato da tela vem só com os módulos ligados, ou só com os da integração', async () => {
    await admin.put('/admin/integrations/modules', { modules: ['ideas', 'hall'] });
    const doc = await admin.get<{ paths: Record<string, unknown> }>('/admin/integrations/openapi');
    expect(doc.status).toBe(200);
    expect(Object.keys(doc.body.paths).sort()).toEqual([
      '/integration/v1/hall',
      '/integration/v1/ideas',
      '/integration/v1/ideas/{code}',
      '/integration/v1/openapi.json',
    ]);
    const only = await createIntegration(admin, { name: 'só hall', modules: ['hall'], scope: [] });
    const scoped = await admin.get<{ paths: Record<string, unknown> }>(
      `/admin/integrations/openapi?integration=${only.id}`,
    );
    expect(Object.keys(scoped.body.paths).sort()).toEqual(['/integration/v1/hall', '/integration/v1/openapi.json']);
    expect(
      (await admin.get('/admin/integrations/openapi?integration=019a2c10-0000-7000-8000-000000000999')).status,
    ).toBe(404);
    expect((await admin.get('/admin/integrations/openapi?integration=lixo')).status).toBe(404);
    await admin.put('/admin/integrations/modules', { modules: ALL_MODULES });
    const full = await admin.get<{ paths: Record<string, unknown>; servers?: { url: string }[] }>(
      '/admin/integrations/openapi',
    );
    expect(Object.keys(full.body.paths)).toContain('/integration/v1/users');
    expect(full.body.servers?.[0]?.url).toBe('https://its.empresa.com.br');
  });
});
