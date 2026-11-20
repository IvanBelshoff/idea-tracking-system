import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmailLog, Notification } from '../../src/communication/entities.js';
import { deliverEmail } from '../../src/communication/mail.js';
import { Role, RolePermission } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { AlertService } from '../../src/observability/alert.service.js';
import { HealthService } from '../../src/observability/health.service.js';
import { writeHeartbeat } from '../../src/observability/heartbeat.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { FakeSmtp } from '../support/fake-smtp.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

const SMTP_USER = 'its-smtp';
const SMTP_PASS = 'S3nha-do-SMTP!-xyz';

describe('Alerta de saúde: aviso interno e e-mail imediato (M12, RN-94)', () => {
  let t: TestApp;
  let smtp: FakeSmtp;
  let admin: Client;
  let alert: AlertService;
  let entityId: string;
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};

  async function user(key: string, roleId: string, locale = 'pt-BR') {
    const ds = t.db.dataSource;
    const users = ds.getRepository(User);
    const u = await users.save(
      users.create({
        email: `${key}@example.test`,
        name: key,
        locale,
        passwordHash: await hashPassword(STRONG_PASSWORD),
      }),
    );
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId, entityId }));
    uid[key] = u.id;
    c[key] = new Client(t.baseUrl);
    expect((await c[key].post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  }
  const notices = (type: string) =>
    t.db.dataSource.getRepository(Notification).find({ where: { type }, order: { createdAt: 'ASC' } });
  const ops = () => t.db.dataSource.getRepository(EmailLog).find({ where: { kind: 'ops_alert' } });
  /** Batimento do worker de `minutes` minutos atrás. */
  const workerBeat = (minutes: number) =>
    t.db.dataSource.query(
      `INSERT INTO ops_heartbeat (process, instance, started_at, last_seen_at, memory_mb, version)
       VALUES ('worker', 'teste', now() - interval '1 day', now() - make_interval(mins => $1), 100, 'teste')
       ON CONFLICT (process, instance) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [minutes],
    );
  const resetAlertState = () => t.db.dataSource.query('DELETE FROM ops_alert_state');
  const cleanUp = async () => {
    await resetAlertState();
    await t.db.dataSource.query('DELETE FROM notification');
    await t.db.dataSource.query('DELETE FROM email_log');
  };

  beforeAll(async () => {
    smtp = new FakeSmtp({ user: SMTP_USER, pass: SMTP_PASS });
    await smtp.start();
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    entityId = (await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;

    // Um perfil só com ops.view (concedido pelo admin) e um colaborador sem a permissão.
    const roles = ds.getRepository(Role);
    const opsRole = await roles.save(roles.create({ name: 'Operação', description: 'Lê a saúde', isSystem: false }));
    await ds.getRepository(RolePermission).insert({ roleId: opsRole.id, permission: 'ops.view' });
    await user('operador', opsRole.id, 'en');
    await user('colab', (await roles.findOneByOrFail({ systemKey: 'collaborator' })).id);

    // A API dá sinal (para o item "api" ficar em ordem); o worker, não.
    await writeHeartbeat(ds, { process: 'api', startedAt: new Date(), storageFreePct: 80 });
    alert = new AlertService(ds, new HealthService(ds));
  });
  afterAll(async () => {
    await t?.close();
    await smtp?.stop();
  });

  it('CA-RN-94.5 a falha gera aviso interno para quem tem ops.view e para mais ninguém', async () => {
    await cleanUp();
    await workerBeat(11); // sem sinal há 11 minutos: o item "worker" entra em falha
    const result = await alert.check();
    expect(result).toMatchObject({ failed: ['worker'], recovered: [], recipients: 2 });

    const failed = await notices('ops_failed');
    expect(failed.map((n) => n.userId).sort()).toEqual([uid.operador, ...(await adminId())].sort());
    expect(failed.every((n) => n.ideaId === null && n.inApp)).toBe(true);
    expect(failed[0]?.payload).toEqual({ items: ['worker'] });
    expect((await notices('ops_failed')).some((n) => n.userId === uid.colab)).toBe(false);
    expect((await c.colab!.get<{ items: unknown[] }>('/notifications')).body.items).toEqual([]);
  });

  it('CA-RN-94.5 o tipo não aparece nas preferências e não se desliga', async () => {
    const prefs = await c.operador!.get<{ events: { type: string }[] }>('/notifications/preferences');
    expect(prefs.status).toBe(200);
    expect(prefs.body.events.map((e) => e.type)).not.toContain('ops_failed');
    expect(prefs.body.events.map((e) => e.type)).not.toContain('ops_recovered');
    const off = await c.operador!.request('PUT', '/notifications/preferences', {
      events: [{ type: 'ops_failed', inApp: false, email: false }],
      deadlineAlertDays: null,
    });
    expect(off.status).toBe(200);
    await cleanUp();
    await alert.check();
    expect((await notices('ops_failed')).some((n) => n.userId === uid.operador)).toBe(true);
  });

  it('CA-RN-94.6 com o provedor de e-mail desligado, só o aviso interno; ligado, o e-mail sai na hora e fora do resumo', async () => {
    await cleanUp();
    await workerBeat(11);
    await alert.check();
    expect(await ops()).toEqual([]);
    expect(smtp.connections).toBe(0);

    // liga o provedor com o SMTP falso
    const input = {
      host: '127.0.0.1',
      port: smtp.port,
      security: 'none',
      username: SMTP_USER,
      password: SMTP_PASS,
      fromAddress: 'ideias@example.test',
      fromName: 'Ideias Org',
    };
    expect((await admin.request('PUT', '/admin/email/provider', input)).status).toBe(200);
    expect((await admin.post('/admin/email/provider/test', { to: 'admin@example.test' })).status).toBe(200);
    expect(
      (await admin.request('PATCH', '/settings', { values: { 'email.app_url': 'http://127.0.0.1:8080/' } })).status,
    ).toBe(200);
    expect((await admin.post('/admin/email/provider/activate')).status).toBe(200);
    smtp.reset();

    await cleanUp();
    expect(await alert.check()).toMatchObject({ failed: ['worker'], recipients: 2 });
    const queued = await ops();
    expect(queued).toHaveLength(2);
    expect(queued.every((mail) => mail.status === 'pending')).toBe(true);
    // não vai de novo no resumo diário
    const rows = await notices('ops_failed');
    expect(rows.every((n) => n.emailState === 'none')).toBe(true);

    for (const mail of queued) expect(await deliverEmail(t.db.dataSource, mail.id)).toBe('sent');
    expect(smtp.messages).toHaveLength(2);
    const toOperator = smtp.messages.find((m) => m.to.includes('operador@example.test'));
    expect(toOperator?.subject).toBe('Health alert: failure in Worker | Org');
    expect(toOperator?.text).toContain('http://127.0.0.1:8080/admin/observabilidade');
    const toAdmin = smtp.messages.find((m) => m.to.includes(INSTALL_INPUT.adminEmail));
    expect(toAdmin?.subject).toBe('Alerta de saúde: falha em Worker | Org');
  });

  it('CA-RN-94.7 repetir a conferência, mesmo em duas ao mesmo tempo, não duplica avisos', async () => {
    await cleanUp();
    await workerBeat(11);
    const [a, b] = await Promise.all([alert.check(), alert.check()]);
    expect([a?.failed.length, b?.failed.length].sort()).toEqual([0, 1]);
    expect(await notices('ops_failed')).toHaveLength(2);
    expect(await ops()).toHaveLength(2);

    await alert.check();
    await alert.check();
    expect(await notices('ops_failed')).toHaveLength(2);
    expect(await ops()).toHaveLength(2);
  });

  it('CA-RN-94.8 o estado persiste: um serviço novo (reinício do worker) não repete a falha em curso', async () => {
    await cleanUp();
    await workerBeat(11);
    await alert.check();
    const restarted = new AlertService(t.db.dataSource, new HealthService(t.db.dataSource));
    expect(await restarted.check()).toMatchObject({ failed: [], recovered: [], recipients: 0 });
    expect(await notices('ops_failed')).toHaveLength(2);
  });

  it('a volta só avisa depois de 2 conferências sem falha; avisa quem tem ops.view', async () => {
    await cleanUp();
    await workerBeat(11);
    await alert.check();
    await workerBeat(0); // o worker voltou
    expect(await alert.check()).toMatchObject({ recovered: [] });
    expect(await notices('ops_recovered')).toHaveLength(0);
    expect(await alert.check()).toMatchObject({ recovered: ['worker'], recipients: 2 });
    const back = await notices('ops_recovered');
    expect(back).toHaveLength(2);
    expect(back[0]?.payload).toEqual({ items: ['worker'] });
    expect(await alert.check()).toMatchObject({ recovered: [], recipients: 0 });
  });

  it('o aviso aparece na lista de notificações de quem tem ops.view, com o tipo certo', async () => {
    await cleanUp();
    await workerBeat(11);
    await alert.check();
    const list = await c.operador!.get<{ items: { type: string; payload: { items: string[] }; idea: unknown }[] }>(
      '/notifications',
    );
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ type: 'ops_failed', payload: { items: ['worker'] }, idea: null });
  });

  async function adminId() {
    const rows = await t.db.dataSource
      .getRepository(User)
      .find({ select: { id: true }, where: { email: INSTALL_INPUT.adminEmail } });
    return rows.map((row) => row.id);
  }
});
