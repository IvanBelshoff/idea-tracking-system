import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysToDay, todayInZone } from '../../src/common/dates.js';
import { Step } from '../../src/ideas/entities/idea-related.entity.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User, UserStatus } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface StepView {
  id: string;
  position: number;
  dueDate: string;
  completedAt: string | null;
  editable: boolean;
  deletable: boolean;
  canComplete: boolean;
}
interface Detail {
  id: string;
  code: string;
  status: string;
  deadline: string | null;
  late: boolean;
  progress: number;
  allStepsCompleted: boolean;
  implementedAt: string | null;
  steps: StepView[];
}
interface Event {
  type: string;
  data: Record<string, unknown>;
}

/** Data AAAA-MM-DD daqui a `n` dias, no fuso da instalação (o mesmo que o atraso usa). */
const day = (n: number) => addDaysToDay(todayInZone(new Date(), INSTALL_INPUT.timezone), n);

describe('Etapas, prazos e implementação (M3, fatia 1)', () => {
  let t: TestApp;
  const ent: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  let categoryId: string;

  async function user(key: string, roleKey: string | null, entityId?: string) {
    const ds = t.db.dataSource;
    const u = await ds
      .getRepository(User)
      .save(
        ds
          .getRepository(User)
          .create({ email: `${key}@example.test`, name: key, passwordHash: await hashPassword(STRONG_PASSWORD) }),
      );
    if (roleKey && entityId) {
      const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: roleKey });
      await ds
        .getRepository(UserRoleScope)
        .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId }));
    }
    uid[key] = u.id;
    c[key] = new Client(t.baseUrl);
    expect((await c[key].post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  }

  /** Ideia já aprovada (Em andamento) com a 1ª etapa do analista vencendo em `due`. */
  async function approvedIdea(due = day(10)): Promise<Detail> {
    const res = await c.analista!.post<Detail>('/ideas', {
      title: 'Ideia',
      description: 'x',
      entityId: ent.A1,
      categoryId,
      approveNow: { stepName: 'Planejar', assigneeId: uid.analista, dueDate: due },
    });
    expect(res.status).toBe(201);
    return res.body;
  }
  const step = (who: string, code: string, body: Record<string, unknown>) =>
    c[who]!.post<Detail>(`/ideas/${code}/steps`, body);
  const complete = (who: string, d: Detail, stepId: string) =>
    c[who]!.post<Detail>(`/ideas/${d.code}/steps/${stepId}/complete`);

  beforeAll(async () => {
    t = await createTestApp();
    const admin = new Client(t.baseUrl);
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
    await user('colab1', 'collaborator', ent.A1);
    await user('gestor', 'manager', ent.A);
    await user('colab3', 'collaborator', ent.B);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-12.1 com a última etapa aberta, criar outra → 409', async () => {
    const idea = await approvedIdea();
    const res = await step('analista', idea.code, { name: 'Executar', assigneeId: uid.analista, dueDate: day(20) });
    expect(res.status).toBe(409);
  });

  it('CA-RN-12.2 com a última concluída, cria com posição +1; CA-RN-17.2 o prazo muda e fica no histórico', async () => {
    const idea = await approvedIdea(day(10));
    await complete('analista', idea, idea.steps[0]!.id);
    const res = await step('analista', idea.code, { name: 'Executar', assigneeId: uid.colab1, dueDate: day(20) });
    expect(res.status).toBe(201);
    expect(res.body.steps.map((s) => s.position)).toEqual([1, 2]);
    expect(res.body.deadline).toBe(day(20));
    const events = (await c.analista!.get<Event[]>(`/ideas/${idea.code}/timeline`)).body;
    expect(events.find((e) => e.type === 'deadline_changed')?.data).toEqual({ from: day(10), to: day(20) });
  });

  it('CA-RN-13.1 etapa concluída: editar ou excluir → 409; CA-RN-13.3 a última aberta: editar e excluir permitidos', async () => {
    const idea = await approvedIdea();
    const first = idea.steps[0]!;
    await complete('analista', idea, first.id);
    const second = (await step('analista', idea.code, { name: 'Executar', assigneeId: uid.analista, dueDate: day(15) }))
      .body.steps[1]!;
    expect(
      (await c.analista!.request('PATCH', `/ideas/${idea.code}/steps/${first.id}`, { name: 'Outro' })).status,
    ).toBe(409);
    expect((await c.analista!.request('DELETE', `/ideas/${idea.code}/steps/${first.id}`)).status).toBe(409);
    const edited = await c.analista!.request<Detail>('PATCH', `/ideas/${idea.code}/steps/${second.id}`, {
      name: 'Executar a mudança',
      dueDate: day(16),
    });
    expect(edited.status).toBe(200);
    expect(edited.body.deadline).toBe(day(16));
    const removed = await c.analista!.request<Detail>('DELETE', `/ideas/${idea.code}/steps/${second.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.steps.map((s) => s.position)).toEqual([1]);
  });

  it('CA-RN-13.2 aberta que não é a última (por reversão): editar → 409', async () => {
    const idea = await approvedIdea();
    const first = idea.steps[0]!;
    await complete('analista', idea, first.id);
    await step('analista', idea.code, { name: 'Executar', assigneeId: uid.analista, dueDate: day(15) });
    const steps = t.db.dataSource.getRepository(Step);
    await steps.update(first.id, { completedAt: null });
    const second = await steps.findOneByOrFail({ ideaId: idea.id, position: 2 });
    await steps.update(second.id, { completedAt: new Date() });
    expect((await c.analista!.request('PATCH', `/ideas/${idea.code}/steps/${first.id}`, { name: 'X' })).status).toBe(
      409,
    );
  });

  it('a única etapa não pode ser excluída (a ideia não fica sem etapas)', async () => {
    const idea = await approvedIdea();
    expect((await c.analista!.request('DELETE', `/ideas/${idea.code}/steps/${idea.steps[0]!.id}`)).status).toBe(409);
  });

  it('CA-RN-14.2 duas criações simultâneas: só uma é aceita, sem posição repetida', async () => {
    const idea = await approvedIdea();
    await complete('analista', idea, idea.steps[0]!.id);
    const results = await Promise.all([
      step('analista', idea.code, { name: 'A', assigneeId: uid.analista, dueDate: day(20) }),
      step('analista', idea.code, { name: 'B', assigneeId: uid.analista, dueDate: day(21) }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await t.db.dataSource.getRepository(Step).countBy({ ideaId: idea.id })).toBe(2);
  });

  it('CA-RN-15.1 sem nome, responsável ou previsão → 422; CA-RN-16 prevista antes do início → 422', async () => {
    const idea = await approvedIdea();
    await complete('analista', idea, idea.steps[0]!.id);
    for (const missing of ['name', 'assigneeId', 'dueDate']) {
      const body: Record<string, unknown> = { name: 'E', assigneeId: uid.analista, dueDate: day(5) };
      delete body[missing];
      expect((await step('analista', idea.code, body)).status).toBe(422);
    }
    expect(
      (await step('analista', idea.code, { name: 'E', assigneeId: uid.analista, startDate: day(5), dueDate: day(4) }))
        .status,
    ).toBe(422);
    expect(
      (await step('analista', idea.code, { name: 'E', assigneeId: uid.analista, startDate: day(5), dueDate: day(5) }))
        .status,
    ).toBe(201);
  });

  it('CA-RN-15.2 responsável precisa ser ativo e ter acesso à entidade da ideia (inclusive na aprovação)', async () => {
    const idea = await approvedIdea();
    await complete('analista', idea, idea.steps[0]!.id);
    expect((await step('analista', idea.code, { name: 'E', assigneeId: uid.colab3, dueDate: day(5) })).status).toBe(
      422,
    );
    await user('inativo', 'collaborator', ent.A1);
    await t.db.dataSource.getRepository(User).update(uid.inativo!, { status: UserStatus.Disabled });
    expect((await step('analista', idea.code, { name: 'E', assigneeId: uid.inativo, dueDate: day(5) })).status).toBe(
      422,
    );
    const viaApproval = await c.analista!.post('/ideas', {
      title: 'x',
      description: 'x',
      entityId: ent.A1,
      categoryId,
      approveNow: { stepName: 'P', assigneeId: uid.colab3, dueDate: day(5) },
    });
    expect(viaApproval.status).toBe(422);
  });

  it('gestão de etapas exige step.manage; o responsável conclui a própria etapa', async () => {
    const idea = await approvedIdea();
    await complete('analista', idea, idea.steps[0]!.id);
    expect((await step('gestor', idea.code, { name: 'E', assigneeId: uid.colab1, dueDate: day(5) })).status).toBe(403);
    const withColab = (await step('analista', idea.code, { name: 'E', assigneeId: uid.colab1, dueDate: day(5) })).body;
    const own = withColab.steps[1]!;
    // O gestor vê, mas não é o responsável: 403. colab1 não é autor nem equipe, mas, como
    // responsável da etapa, vê a ideia como o autor (só o público) e conclui a própria etapa (M4).
    expect((await complete('gestor', idea, own.id)).status).toBe(403);
    await c.analista!.post(`/ideas/${idea.code}/comments`, { body: 'Só para a equipe', visibility: 'internal' });
    const seen = await c.colab1!.get<Detail & { can: Record<string, boolean> }>(`/ideas/${idea.code}`);
    expect(seen.status).toBe(200);
    expect(seen.body.can).toMatchObject({ edit: false, triage: false, manageSteps: false, commentInternal: false });
    const comments = await c.colab1!.get<{ body: string }[]>(`/ideas/${idea.code}/comments`);
    expect(comments.body.some((x) => x.body === 'Só para a equipe')).toBe(false);
    expect((await complete('colab1', idea, own.id)).status).toBe(200);
    // Quem não é autor, equipe nem responsável continua sem ver: 404.
    expect((await c.colab3!.get(`/ideas/${idea.code}`)).status).toBe(404);
  });

  it('CA-RN-20.1 concluir a última etapa: continua Em andamento e o histórico registra; CA-RN-07.4 sem resultado → 422; CA-RN-07.3 com resultado → Implementada', async () => {
    const idea = await approvedIdea();
    const done = await complete('analista', idea, idea.steps[0]!.id);
    expect(done.body.status).toBe('in_progress');
    expect(done.body.allStepsCompleted).toBe(true);
    expect(done.body.progress).toBe(100);
    const types = (await c.analista!.get<Event[]>(`/ideas/${idea.code}/timeline`)).body.map((e) => e.type);
    expect(types.slice(-2)).toEqual(['step_completed', 'all_steps_completed']);

    expect((await c.analista!.post(`/ideas/${idea.code}/implement`, { resultText: '  ' })).status).toBe(422);
    const implemented = await c.analista!.post<Detail>(`/ideas/${idea.code}/implement`, {
      resultText: 'Retrabalho caiu 30%.',
    });
    expect(implemented.status).toBe(200);
    expect(implemented.body.status).toBe('implemented');
    expect(implemented.body.implementedAt).not.toBeNull();
  });

  it('CA-RN-08.1 Implementada: criar etapa → 409', async () => {
    const idea = await approvedIdea();
    await complete('analista', idea, idea.steps[0]!.id);
    await c.analista!.post(`/ideas/${idea.code}/implement`, { resultText: 'Ok.' });
    expect((await step('analista', idea.code, { name: 'E', assigneeId: uid.analista, dueDate: day(5) })).status).toBe(
      409,
    );
  });

  it('RN-18 e RN-19 na API: atraso só em andamento com etapa vencida; progresso por etapas ou por tempo', async () => {
    const idea = await approvedIdea(day(3));
    await t.db.dataSource.getRepository(Step).update(idea.steps[0]!.id, { startDate: day(-10), dueDate: day(-1) });
    const late = (await c.analista!.get<Detail>(`/ideas/${idea.code}`)).body;
    expect(late.late).toBe(true);
    const list = (await c.analista!.get<{ items: { code: string; late: boolean }[] }>('/ideas?pageSize=100')).body;
    expect(list.items.find((i) => i.code === idea.code)?.late).toBe(true);
    expect(late.progress).toBe(0); // modo etapas: nenhuma concluída

    const admin = new Client(t.baseUrl);
    await admin.post('/auth/login', { email: INSTALL_INPUT.adminEmail, password: STRONG_PASSWORD });
    await admin.request('PATCH', '/settings', { values: { 'steps.progress_mode': 'time' } });
    expect((await c.analista!.get<Detail>(`/ideas/${idea.code}`)).body.progress).toBe(100); // prazo já passou
    await admin.request('PATCH', '/settings', { values: { 'steps.progress_mode': 'steps' } });
  });
});
