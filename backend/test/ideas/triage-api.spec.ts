import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysToDay, todayInZone } from '../../src/common/dates.js';
import { Notification } from '../../src/communication/entities.js';
import { runTriageSlaAlerts } from '../../src/communication/jobs.js';
import { triageDueDate } from '../../src/ideas/triage-rules.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User, UserStatus } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Detail {
  id: string;
  code: string;
  status: string;
  assignedTo: { id: string; name: string } | null;
  triageDue: string;
  triageOverdue: boolean;
}
interface TimelineEvent {
  type: string;
  actor: { name: string } | null;
  data: Record<string, unknown>;
}

const TZ = 'America/Sao_Paulo';
const today = () => todayInZone(new Date(), TZ);

describe('Triagem em volume: prazo de retorno e atribuição (M6, RN-54, RN-55)', () => {
  let t: TestApp;
  let admin: Client;
  const ent: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  const cat: Record<string, string> = {};

  async function user(key: string, roleKey: string, entityId: string) {
    const ds = t.db.dataSource;
    const repo = ds.getRepository(User);
    const u = await repo.save(
      repo.create({
        email: `${key}@example.test`,
        name: `Pessoa ${key}`,
        passwordHash: await hashPassword(STRONG_PASSWORD),
      }),
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
  const submit = async (who: string, entityId: string, categoryId: string, title = 'Ideia') => {
    const res = await c[who]!.post<Detail>('/ideas', { title, description: 'x', entityId, categoryId });
    expect(res.status).toBe(201);
    return res.body;
  };
  const rule = (body: Record<string, unknown>, who: Client = admin) => who.post<{ id: string }>('/triage-rules', body);
  const notes = (userId: string, ideaId: string, type: string) =>
    t.db.dataSource.getRepository(Notification).countBy({ userId, ideaId, type });
  const backdate = (id: string, days: number) =>
    t.db.dataSource.query(`UPDATE idea SET submitted_at = now() - ($2 || ' days')::interval WHERE id = $1`, [id, days]);

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
    const cats = ds.getRepository(Category);
    cat.seg = (await cats.save(cats.create({ name: 'Segurança', color: '#dc2626' }))).id;
    cat.qual = (await cats.save(cats.create({ name: 'Qualidade', color: '#4f46e5' }))).id;
    await user('ana', 'analyst', ent.A!);
    await user('beto', 'analyst', ent.A!);
    await user('bia', 'analyst', ent.B!);
    await user('gestor', 'manager', ent.A!);
    await user('colab', 'collaborator', ent.A1!);
    await user('colabB', 'collaborator', ent.B!);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('as regras de atribuição: só quem configura (setting.manage); validação de analista e de campos', async () => {
    expect((await rule({ entityId: null, categoryId: cat.seg!, assigneeId: uid.ana }, c.ana)).status).toBe(403);
    // Precisa de entidade ou categoria; o analista precisa poder triar ali.
    expect((await rule({ entityId: null, categoryId: null, assigneeId: uid.ana })).status).toBe(422);
    expect((await rule({ entityId: ent.A!, categoryId: null, assigneeId: uid.colab })).status).toBe(422);
    expect((await rule({ entityId: ent.B!, categoryId: null, assigneeId: uid.ana })).status).toBe(422);
    expect((await rule({ entityId: ent.A!, categoryId: null, assigneeId: uid.ana, priority: 500 })).status).toBe(422);
  });

  it('CA-RN-55.1 regra "categoria Segurança → Ana": a ideia nasce atribuída a ela, ainda Enviada', async () => {
    const created = await rule({ entityId: null, categoryId: cat.seg!, assigneeId: uid.ana });
    expect(created.status).toBe(201);
    const idea = await submit('colab', ent.A1!, cat.seg!, 'Proteção na prensa');
    expect(idea.status).toBe('submitted');
    expect(idea.assignedTo?.id).toBe(uid.ana);
    expect(await notes(uid.ana!, idea.id, 'idea_assigned')).toBe(1);
    const timeline = (await c.colab!.get<TimelineEvent[]>(`/ideas/${idea.code}/timeline`)).body;
    expect(timeline.find((e) => e.type === 'assigned')).toMatchObject({
      actor: null,
      data: { to: uid.ana, rule: true },
    });
    // Sem regra que case: fila geral.
    const other = await submit('colab', ent.A1!, cat.qual!);
    expect(other.assignedTo).toBeNull();
  });

  it('CA-RN-55.2 vale a regra mais específica (entidade + categoria vence só categoria); depois, a prioridade', async () => {
    expect((await rule({ entityId: ent.A!, categoryId: cat.seg!, assigneeId: uid.beto })).status).toBe(201);
    expect((await submit('colab', ent.A1!, cat.seg!)).assignedTo?.id).toBe(uid.beto);
    // Na Unidade B só a regra de categoria casa, mas a Ana não tria em B: fila geral, sem erro.
    expect((await submit('colabB', ent.B!, cat.seg!)).assignedTo).toBeNull();
    // Empate de especificidade: maior prioridade vence.
    expect((await rule({ entityId: ent.A!, categoryId: cat.qual!, assigneeId: uid.ana, priority: 1 })).status).toBe(
      201,
    );
    expect((await rule({ entityId: ent.A!, categoryId: cat.qual!, assigneeId: uid.beto, priority: 5 })).status).toBe(
      201,
    );
    expect((await submit('colab', ent.A1!, cat.qual!)).assignedTo?.id).toBe(uid.beto);
  });

  it('analista da regra desativado: a ideia vai para a fila geral', async () => {
    await t.db.dataSource.getRepository(User).update(uid.beto!, { status: UserStatus.Disabled });
    expect((await submit('colab', ent.A1!, cat.seg!)).assignedTo).toBeNull();
    await t.db.dataSource.getRepository(User).update(uid.beto!, { status: UserStatus.Active });
  });

  it('CA-RN-55.3 o analista reatribui à mão; o histórico registra e o novo responsável é avisado', async () => {
    const idea = await submit('colab', ent.A1!, cat.seg!);
    const res = await c.ana!.post<Detail>(`/ideas/${idea.code}/assign`, { assigneeId: uid.ana });
    expect(res.status).toBe(200);
    expect(res.body.assignedTo?.id).toBe(uid.ana);
    expect(await notes(uid.ana!, idea.id, 'idea_assigned')).toBe(0); // atribuiu a si mesma: sem aviso
    const back = await c.ana!.post<Detail>(`/ideas/${idea.code}/assign`, { assigneeId: uid.beto });
    expect(back.body.assignedTo?.id).toBe(uid.beto);
    expect(await notes(uid.beto!, idea.id, 'idea_assigned')).toBe(2); // pela regra e pela Ana
    const events = (await c.colab!.get<TimelineEvent[]>(`/ideas/${idea.code}/timeline`)).body.filter(
      (e) => e.type === 'assigned',
    );
    expect(events.at(-1)).toMatchObject({ actor: { name: 'Pessoa ana' }, data: { from: uid.ana, to: uid.beto } });
    // Devolver à fila geral; quem não tria ali não pode; colaborador não reatribui; estado velho → 409.
    expect((await c.ana!.post<Detail>(`/ideas/${idea.code}/assign`, { assigneeId: null })).body.assignedTo).toBeNull();
    expect((await c.ana!.post(`/ideas/${idea.code}/assign`, { assigneeId: uid.bia })).status).toBe(422);
    expect((await c.ana!.post(`/ideas/${idea.code}/assign`, { assigneeId: uid.colab })).status).toBe(422);
    expect((await c.colab!.post(`/ideas/${idea.code}/assign`, { assigneeId: uid.ana })).status).toBe(403);
    expect((await c.bia!.post(`/ideas/${idea.code}/assign`, { assigneeId: uid.bia })).status).toBe(404);
    expect(
      (await c.ana!.post(`/ideas/${idea.code}/assign`, { assigneeId: uid.ana, expectedStatus: 'in_review' })).status,
    ).toBe(409);
    // Encerrada não se reatribui.
    await c.ana!.post(`/ideas/${idea.code}/start-review`);
    await c.ana!.post(`/ideas/${idea.code}/reject`, { reason: 'Duplicada' });
    expect((await c.ana!.post(`/ideas/${idea.code}/assign`, { assigneeId: uid.beto })).status).toBe(409);
  });

  it('CA-RN-54.1 o autor vê a previsão de retorno desde o envio; 10 dias no prazo, 11 atrasada', async () => {
    const idea = await submit('colab', ent.A1!, cat.qual!);
    const fresh = (await c.colab!.get<Detail>(`/ideas/${idea.code}`)).body;
    expect(fresh.triageDue).toBe(addDaysToDay(today(), 10));
    expect(fresh.triageOverdue).toBe(false);
    await backdate(idea.id, 10);
    expect((await c.colab!.get<Detail>(`/ideas/${idea.code}`)).body.triageOverdue).toBe(false);
    await backdate(idea.id, 11);
    const late = (await c.colab!.get<Detail>(`/ideas/${idea.code}`)).body;
    expect(late).toMatchObject({ triageOverdue: true, triageDue: addDaysToDay(today(), -1) });
    // A fila mostra o mesmo.
    const queue = await c.ana!.get<{ items: Detail[] }>('/ideas?pageSize=100&status=submitted');
    expect(queue.body.items.find((i) => i.id === idea.id)?.triageOverdue).toBe(true);
    // Assumir dá o retorno: deixa de estar atrasada.
    await c.ana!.post(`/ideas/${idea.code}/start-review`);
    expect((await c.colab!.get<Detail>(`/ideas/${idea.code}`)).body.triageOverdue).toBe(false);
  });

  it('o prazo e os dias úteis vêm da configuração (CA-RN-54.3)', async () => {
    expect((await admin.request('PATCH', '/settings', { values: { 'triage.sla_days': 3 } })).status).toBe(200);
    const idea = await submit('colab', ent.A1!, cat.qual!);
    expect(idea.triageDue).toBe(addDaysToDay(today(), 3));
    expect((await admin.request('PATCH', '/settings', { values: { 'triage.business_days': true } })).status).toBe(200);
    const due = (await c.colab!.get<Detail>(`/ideas/${idea.code}`)).body.triageDue;
    expect(due).toBe(triageDueDate(today(), 3, true)); // sábado e domingo não contam
    expect(due >= addDaysToDay(today(), 3)).toBe(true);
    expect((await admin.request('PATCH', '/settings', { values: { 'triage.sla_days': 0 } })).status).toBe(400);
    await admin.request('PATCH', '/settings', { values: { 'triage.sla_days': 10, 'triage.business_days': false } });
  });

  it('CA-RN-54.2 analista e gestor recebem UM alerta por ideia atrasada, mesmo rodando o job de novo', async () => {
    const assigned = await submit('colab', ent.A1!, cat.seg!, 'Atrasada e atribuída'); // regra → Beto
    const unassigned = await submit('colab', ent.A1!, cat.qual!, 'Atrasada sem dono');
    await c.ana!.post(`/ideas/${unassigned.code}/assign`, { assigneeId: null });
    const onTime = await submit('colab', ent.A1!, cat.qual!, 'No prazo');
    await backdate(assigned.id, 15);
    await backdate(unassigned.id, 15);
    await backdate(onTime.id, 5);

    await runTriageSlaAlerts(t.db.dataSource);
    await runTriageSlaAlerts(t.db.dataSource);
    await Promise.all([runTriageSlaAlerts(t.db.dataSource), runTriageSlaAlerts(t.db.dataSource)]);

    // Atribuída: o analista dela e o gestor; os outros analistas não.
    expect(await notes(uid.beto!, assigned.id, 'triage_overdue')).toBe(1);
    expect(await notes(uid.gestor!, assigned.id, 'triage_overdue')).toBe(1);
    expect(await notes(uid.ana!, assigned.id, 'triage_overdue')).toBe(0);
    // Sem dono: todos que triam na entidade, e o gestor.
    expect(await notes(uid.ana!, unassigned.id, 'triage_overdue')).toBe(1);
    expect(await notes(uid.beto!, unassigned.id, 'triage_overdue')).toBe(1);
    expect(await notes(uid.gestor!, unassigned.id, 'triage_overdue')).toBe(1);
    // Fora do escopo, autor e ideia no prazo: nada.
    expect(await notes(uid.bia!, unassigned.id, 'triage_overdue')).toBe(0);
    expect(await notes(uid.colab!, assigned.id, 'triage_overdue')).toBe(0);
    expect(await notes(uid.gestor!, onTime.id, 'triage_overdue')).toBe(0);
    const payload = (
      await t.db.dataSource
        .getRepository(Notification)
        .findOneByOrFail({ userId: uid.beto!, ideaId: assigned.id, type: 'triage_overdue' })
    ).payload;
    expect(payload).toMatchObject({ code: assigned.code, dueDate: addDaysToDay(today(), -5) });
  });

  it('as regras aparecem na lista, podem ser desligadas, editadas e apagadas', async () => {
    const list = await admin.get<{ id: string; active: boolean; category: { name: string } | null }[]>('/triage-rules');
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(4);
    const segRule = list.body.find((r) => r.category?.name === 'Segurança' && r)!;
    const off = await admin.request<{ active: boolean }>('PUT', `/triage-rules/${segRule.id}`, {
      entityId: null,
      categoryId: cat.seg!,
      assigneeId: uid.ana,
      active: false,
    });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    expect((await admin.request('DELETE', `/triage-rules/${segRule.id}`)).status).toBe(204);
    expect((await admin.request('DELETE', `/triage-rules/${segRule.id}`)).status).toBe(404);
  });
});
