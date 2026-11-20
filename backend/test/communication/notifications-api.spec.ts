import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInZone } from '../../src/common/dates.js';
import { Notification, NotificationEmailState } from '../../src/communication/entities.js';
import { runDeadlineAlerts } from '../../src/communication/jobs.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Detail {
  id: string;
  code: string;
  status: string;
  steps: { id: string; completedAt: string | null }[];
}
interface NotificationItem {
  id: string;
  type: string;
  idea: { code: string; title: string } | null;
  payload: Record<string, unknown>;
  readAt: string | null;
}
interface Page {
  items: NotificationItem[];
  meta: { total: number };
  unreadCount: number;
}
interface Prefs {
  events: { type: string; group: string; mandatory: boolean; inApp: boolean; email: boolean }[];
  deadlineAlertDays: number | null;
  defaultDeadlineAlertDays: number;
  emailActive: boolean;
}

const TZ = 'America/Sao_Paulo';
/** Data AAAA-MM-DD daqui a `n` dias, no fuso da instalação (o mesmo que o job usa). */
const day = (n: number) => {
  const today = todayInZone(new Date(), TZ);
  const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
};

describe('Notificações internas, preferências e alertas de prazo (M4)', () => {
  let t: TestApp;
  let admin: Client;
  const ent: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  let categoryId: string;

  async function user(key: string, roleKey: string, entityId: string) {
    const ds = t.db.dataSource;
    const repo = ds.getRepository(User);
    const u = await repo.save(
      repo.create({ email: `${key}@example.test`, name: key, passwordHash: await hashPassword(STRONG_PASSWORD) }),
    );
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: roleKey });
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId }));
    uid[key] = u.id;
    c[key] = new Client(t.baseUrl);
    expect((await c[key].post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  }

  const submit = async (who: string, extra: Record<string, unknown> = {}) => {
    const res = await c[who]!.post<Detail>('/ideas', {
      title: `Ideia de ${who}`,
      description: 'Situação',
      entityId: ent.A1,
      categoryId,
      ...extra,
    });
    expect(res.status).toBe(201);
    return res.body;
  };
  const act = async (who: Client, code: string, action: string, body: Record<string, unknown> = {}) => {
    const res = await who.post<Detail>(`/ideas/${code}/${action}`, body);
    expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body;
  };
  const notificationsOf = (userId: string, ideaId?: string) =>
    t.db.dataSource.getRepository(Notification).find({
      where: { userId, ...(ideaId ? { ideaId } : {}) },
      order: { createdAt: 'ASC' },
    });
  const typesOf = async (userId: string, ideaId?: string) => (await notificationsOf(userId, ideaId)).map((n) => n.type);

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    const a = await tree.save(tree.create({ name: 'Unidade A', parent: org }));
    ent.A = a.id;
    ent.A1 = (await tree.save(tree.create({ name: 'Setor A1', parent: a }))).id;
    ent.B = (await tree.save(tree.create({ name: 'Unidade B', parent: org }))).id;
    categoryId = (
      await ds.getRepository(Category).save(ds.getRepository(Category).create({ name: 'Qualidade', color: '#4f46e5' }))
    ).id;
    await user('analista', 'analyst', ent.A);
    await user('gestor', 'manager', ent.A);
    await user('colab1', 'collaborator', ent.A1);
    await user('colab2', 'collaborator', ent.A1);
    await user('colab3', 'collaborator', ent.B);
    await user('colab4', 'collaborator', ent.A1);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-27.1 o ciclo completo gera exatamente 1 aviso ao autor por evento; CA-RN-09.3 reabrir avisa', async () => {
    const idea = await submit('colab1');
    await act(c.analista!, idea.code, 'start-review');
    const approved = await act(c.analista!, idea.code, 'approve', {
      stepName: 'Planejar',
      assigneeId: uid.analista,
      dueDate: day(10),
    });
    await act(c.analista!, idea.code, `steps/${approved.steps[0]!.id}/complete`);
    await act(c.analista!, idea.code, 'implement', { resultText: 'Faixa pintada' });
    await act(admin, idea.code, 'reopen', { reason: 'Faltou a placa' });

    expect(await typesOf(uid.colab1!, idea.id)).toEqual([
      'idea_received',
      'review_started',
      'idea_approved',
      'step_completed',
      'idea_implemented',
      'idea_reopened',
    ]);
    const reopened = (await notificationsOf(uid.colab1!, idea.id)).at(-1)!;
    expect(reopened.payload).toMatchObject({ code: idea.code, reason: 'Faltou a placa', status: 'in_progress' });
  });

  it('CA-RN-20.1 ao concluir a última etapa, o analista responsável é avisado e a ideia continua Em andamento', async () => {
    const idea = await submit('colab1');
    const approved = await act(c.analista!, idea.code, 'approve', {
      stepName: 'Planejar',
      assigneeId: uid.colab2,
      dueDate: day(10),
    });
    const after = await act(c.colab2!, idea.code, `steps/${approved.steps[0]!.id}/complete`);
    expect(after.status).toBe('in_progress');
    expect(await typesOf(uid.analista!, idea.id)).toEqual(['all_steps_completed']);
    expect(await typesOf(uid.colab2!, idea.id)).toEqual([]);
  });

  it('CA-RN-05.2 recusa avisa o autor com a justificativa; interromper também; CA-RN-27.2 ninguém mais recebe', async () => {
    const rejected = await submit('colab1');
    await act(c.analista!, rejected.code, 'start-review');
    await act(c.analista!, rejected.code, 'reject', { reason: 'Já existe um projeto igual' });
    const last = (await notificationsOf(uid.colab1!, rejected.id)).at(-1)!;
    expect(last.type).toBe('idea_rejected');
    expect(last.payload.reason).toBe('Já existe um projeto igual');

    const interrupted = await submit('colab1');
    await act(c.analista!, interrupted.code, 'approve', {
      stepName: 'Planejar',
      assigneeId: uid.analista,
      dueDate: day(5),
    });
    await act(c.analista!, interrupted.code, 'interrupt', { reason: 'Sem verba' });
    expect((await notificationsOf(uid.colab1!, interrupted.id)).at(-1)).toMatchObject({
      type: 'idea_interrupted',
      payload: expect.objectContaining({ reason: 'Sem verba' }),
    });

    for (const other of ['colab3', 'gestor', 'colab4']) expect(await typesOf(uid[other]!)).toEqual([]);
  });

  it('CA-RN-30.1 com o e-mail desligado, o aviso interno existe e nada fica esperando e-mail', async () => {
    const all = await notificationsOf(uid.colab1!);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((n) => n.inApp && n.emailState === NotificationEmailState.None)).toBe(true);
  });

  it('o sino: lista da própria pessoa, não lidas, marcar uma e todas; a de outra pessoa é 404', async () => {
    const page = await c.colab1!.get<Page>('/notifications?pageSize=5');
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(5);
    expect(page.body.unreadCount).toBe(page.body.meta.total);
    expect(page.body.items[0]!.idea?.code).toMatch(/^ITS-\d{4}-\d{4}$/);

    const first = page.body.items[0]!;
    expect((await c.colab1!.post(`/notifications/${first.id}/read`)).status).toBe(204);
    expect((await c.colab1!.get<{ count: number }>('/notifications/unread-count')).body.count).toBe(
      page.body.meta.total - 1,
    );
    const unread = await c.colab1!.get<Page>('/notifications?unread=true&pageSize=100');
    expect(unread.body.items.some((n) => n.id === first.id)).toBe(false);

    expect((await c.colab3!.post(`/notifications/${first.id}/read`)).status).toBe(404);
    expect((await c.colab3!.get<Page>('/notifications')).body.items).toEqual([]);

    expect((await c.colab1!.post('/notifications/read-all')).status).toBe(204);
    expect((await c.colab1!.get<{ count: number }>('/notifications/unread-count')).body.count).toBe(0);
    expect((await new Client(t.baseUrl).get('/notifications')).status).toBe(401);
  });

  it('CA-RN-30.3 quem desliga um evento deixa de recebê-lo, exceto as decisões sobre a própria ideia', async () => {
    const before = await c.colab4!.get<Prefs>('/notifications/preferences');
    expect(before.status).toBe(200);
    expect(before.body.events).toHaveLength(25);
    expect(before.body.emailActive).toBe(false);
    expect(before.body.defaultDeadlineAlertDays).toBe(3);
    expect(before.body.events.find((e) => e.type === 'idea_approved')).toMatchObject({
      mandatory: true,
      group: 'author',
    });

    const saved = await c.colab4!.request<Prefs>('PUT', '/notifications/preferences', {
      events: [
        { type: 'review_started', inApp: false, email: false },
        { type: 'idea_received', inApp: true, email: false },
        { type: 'idea_approved', inApp: false, email: false },
      ],
      deadlineAlertDays: 1,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.deadlineAlertDays).toBe(1);
    expect(saved.body.events.find((e) => e.type === 'review_started')).toMatchObject({ inApp: false, email: false });
    expect(saved.body.events.find((e) => e.type === 'idea_received')).toMatchObject({ inApp: true, email: false });
    expect(saved.body.events.find((e) => e.type === 'idea_approved')).toMatchObject({ inApp: true, email: true });

    const idea = await submit('colab4');
    await act(c.analista!, idea.code, 'start-review');
    await act(c.analista!, idea.code, 'approve', { stepName: 'Planejar', assigneeId: uid.analista, dueDate: day(10) });
    expect(await typesOf(uid.colab4!, idea.id)).toEqual(['idea_received', 'idea_approved']);

    const invalid = await c.colab4!.request('PUT', '/notifications/preferences', {
      events: [{ type: 'nao_existe', inApp: true, email: true }],
      deadlineAlertDays: 99,
    });
    expect(invalid.status).toBe(400);
  });

  it('CA-RN-29.2 alerta ao responsável e ao analista, um só mesmo rodando o job de novo (CA-T.1)', async () => {
    const idea = await submit('colab1');
    await act(c.analista!, idea.code, 'approve', { stepName: 'Pintar', assigneeId: uid.colab2, dueDate: day(3) });
    const today = await submit('colab1');
    await act(c.analista!, today.code, 'approve', { stepName: 'Medir', assigneeId: uid.colab2, dueDate: day(0) });
    const far = await submit('colab1');
    await act(c.analista!, far.code, 'approve', { stepName: 'Longe', assigneeId: uid.colab2, dueDate: day(4) });

    await runDeadlineAlerts(t.db.dataSource);
    await runDeadlineAlerts(t.db.dataSource);
    await Promise.all([runDeadlineAlerts(t.db.dataSource), runDeadlineAlerts(t.db.dataSource)]);

    expect(await typesOf(uid.colab2!, idea.id)).toEqual(['deadline_soon']);
    expect(await typesOf(uid.analista!, idea.id)).toEqual(['deadline_soon']);
    expect((await notificationsOf(uid.colab2!, idea.id))[0]!.payload).toMatchObject({
      code: idea.code,
      position: 1,
      name: 'Pintar',
      dueDate: day(3),
    });
    expect(await typesOf(uid.colab2!, today.id)).toEqual(['deadline_due']);
    expect(await typesOf(uid.analista!, today.id)).toEqual(['deadline_due']);
    expect(await typesOf(uid.colab2!, far.id)).toEqual([]);
  });

  it('CA-RN-29.3 etapa concluída ou ideia encerrada não gera alerta', async () => {
    const done = await submit('colab1');
    const approved = await act(c.analista!, done.code, 'approve', {
      stepName: 'Feita',
      assigneeId: uid.colab2,
      dueDate: day(2),
    });
    await act(c.colab2!, done.code, `steps/${approved.steps[0]!.id}/complete`);
    const closed = await submit('colab1');
    await act(c.analista!, closed.code, 'approve', { stepName: 'Parada', assigneeId: uid.colab2, dueDate: day(1) });
    await act(c.analista!, closed.code, 'interrupt', { reason: 'Cancelada' });

    await runDeadlineAlerts(t.db.dataSource);
    expect((await typesOf(uid.colab2!, done.id)).filter((x) => x.startsWith('deadline'))).toEqual([]);
    expect((await typesOf(uid.colab2!, closed.id)).filter((x) => x.startsWith('deadline'))).toEqual([]);
    expect((await typesOf(uid.analista!, closed.id)).filter((x) => x.startsWith('deadline'))).toEqual([]);
  });

  it('CA-RN-29.4 a preferência de menos dias é respeitada (o analista, no padrão, recebe)', async () => {
    // colab4 pediu 1 dia no teste de preferências.
    const idea = await submit('colab1');
    await act(c.analista!, idea.code, 'approve', { stepName: 'Revisar', assigneeId: uid.colab4, dueDate: day(3) });
    await runDeadlineAlerts(t.db.dataSource);
    expect(await typesOf(uid.colab4!, idea.id)).toEqual([]);
    expect(await typesOf(uid.analista!, idea.id)).toEqual(['deadline_soon']);

    // Faltando 1 dia (simula o relógio dois dias à frente), colab4 é avisado.
    await runDeadlineAlerts(t.db.dataSource, new Date(Date.now() + 2 * 86_400_000));
    expect(await typesOf(uid.colab4!, idea.id)).toEqual(['deadline_soon']);
    expect(await typesOf(uid.analista!, idea.id)).toEqual(['deadline_soon']);
  });

  it('o padrão de dias da instalação tem limite (1 a 30) e vale para quem não escolheu', async () => {
    const bad = await admin.request('PATCH', '/settings', { values: { 'notifications.deadline_alert_days': 0 } });
    expect(bad.status).toBe(400);
    const ok = await admin.request('PATCH', '/settings', { values: { 'notifications.deadline_alert_days': 5 } });
    expect(ok.status).toBe(200);
    expect((await c.colab1!.get<Prefs>('/notifications/preferences')).body.defaultDeadlineAlertDays).toBe(5);
  });
});
