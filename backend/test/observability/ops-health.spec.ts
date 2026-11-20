import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { HealthService } from '../../src/observability/health.service.js';
import { HeartbeatService } from '../../src/observability/heartbeat.service.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Item {
  key: string;
  state: 'ok' | 'warning' | 'failed';
  code: string;
  value: number | null;
}
interface Report {
  state: 'ok' | 'warning' | 'failed';
  version: string;
  metricsEnabled: boolean;
  items: Item[];
}

describe('Observabilidade: saúde por itens e permissão (M12, RN-92 e RN-93)', () => {
  let t: TestApp;
  let admin: Client;
  let collaborator: Client;

  const itemOf = (report: Report, key: string) => {
    const found = report.items.find((item) => item.key === key);
    if (!found) throw new Error(`Item ${key} ausente`);
    return found;
  };
  const health = async () => {
    const res = await admin.get<Report>('/ops/health');
    expect(res.status).toBe(200);
    return res.body;
  };

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);

    const ds = t.db.dataSource;
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    const users = ds.getRepository(User);
    const user = await users.save(
      users.create({ email: 'colab@example.test', name: 'Colab', passwordHash: await hashPassword(STRONG_PASSWORD) }),
    );
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: 'collaborator' });
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: user.id, roleId: role.id, entityId: org.id }));
    collaborator = new Client(t.baseUrl);
    expect(
      (await collaborator.post('/auth/login', { email: 'colab@example.test', password: STRONG_PASSWORD })).status,
    ).toBe(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-92.4 sem login → 401; sem ops.view → 403; Administrador → 200', async () => {
    expect((await new Client(t.baseUrl).get('/ops/health')).status).toBe(401);
    expect((await collaborator.get('/ops/health')).status).toBe(403);
    expect((await admin.get('/ops/health')).status).toBe(200);
  });

  it('CA-RN-92.4 só o perfil de fábrica Administrador recebe ops.view', async () => {
    const rows: { system_key: string }[] = await t.db.dataSource.query(
      `SELECT r.system_key FROM role r JOIN role_permission p ON p.role_id = r.id
        WHERE p.permission = 'ops.view' ORDER BY r.system_key`,
    );
    expect(rows.map((row) => row.system_key)).toEqual(['admin']);
    const me = await admin.get<{ permissions: string[] }>('/auth/me');
    expect(me.body.permissions).toContain('ops.view');
  });

  it('a saúde traz os doze itens, a versão e o estado da medição; a API dá sinal de vida na subida', async () => {
    const report = await health();
    expect(report.items.map((item) => item.key)).toEqual([
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
    expect(report.version).toBeTruthy();
    expect(report.metricsEnabled).toBe(true);
    expect(itemOf(report, 'database').state).toBe('ok');
    expect(itemOf(report, 'migrations')).toMatchObject({ state: 'ok', code: 'ok' });
    await t.app.get(HeartbeatService).beat();
    expect(itemOf(await health(), 'api')).toMatchObject({ state: 'ok', code: 'ok' });
  });

  it('CA-RN-93.7 provedor de e-mail desligado → item de e-mail ok ("disabled")', async () => {
    expect(itemOf(await health(), 'email')).toMatchObject({ state: 'ok', code: 'disabled' });
  });

  it('CA-RN-93.6 worker sem sinal: nunca registrou → atenção; batimento de 11 min → falha; recente → ok', async () => {
    const ds = t.db.dataSource;
    expect(itemOf(await health(), 'worker')).toMatchObject({ state: 'warning', code: 'no_heartbeat' });

    const beat = (minutes: number) =>
      ds.query(
        `INSERT INTO ops_heartbeat (process, instance, started_at, last_seen_at, memory_mb, version)
         VALUES ('worker', 'teste', now() - interval '1 hour', now() - make_interval(mins => $1), 100, 'teste')
         ON CONFLICT (process, instance) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
        [minutes],
      );
    await beat(11);
    expect(itemOf(await health(), 'worker')).toMatchObject({ state: 'failed', code: 'stale' });
    await beat(0);
    expect(itemOf(await health(), 'worker')).toMatchObject({ state: 'ok', code: 'ok' });
  });

  it('CA-RN-93.6 e-mail pendente há 40 minutos → fila em falha; sem pendentes → ok', async () => {
    const ds = t.db.dataSource;
    expect(itemOf(await health(), 'email_queue')).toMatchObject({ state: 'ok', code: 'empty' });
    await ds.query(
      `INSERT INTO email_log (id, kind, to_address, subject, body_encrypted, status, attempts, created_at)
       VALUES (gen_random_uuid(), 'teste', 'alguem@example.test', 'Teste', '\\x00', 'pending', 0,
               now() - interval '40 minutes')`,
    );
    expect(itemOf(await health(), 'email_queue')).toMatchObject({ state: 'failed', code: 'stuck' });
    await ds.query(`DELETE FROM email_log WHERE kind = 'teste'`);
    expect(itemOf(await health(), 'email_queue').state).toBe('ok');
  });

  it('CA-RN-93.5 coleta que dá erro vira falha e não derruba a resposta', async () => {
    const service = t.app.get(HealthService) as unknown as { probeStorage: () => Promise<unknown> };
    const spy = vi.spyOn(service, 'probeStorage').mockRejectedValueOnce(new Error('disco quebrou'));
    const report = await health();
    spy.mockRestore();
    expect(itemOf(report, 'storage')).toMatchObject({ state: 'failed', code: 'unavailable' });
    expect(report.state).toBe('failed');
    expect(itemOf(report, 'database').state).toBe('ok');
  });
});
