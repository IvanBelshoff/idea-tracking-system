import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysToDay, todayInZone } from '../../src/common/dates.js';
import { Notification } from '../../src/communication/entities.js';
import { runSustainmentReminders } from '../../src/communication/jobs.js';
import { annualize, attainment, nextPdcaPhase, roi, variation } from '../../src/ideas/results-rules.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Gain {
  currency: string;
  periodicity: string;
  estimated: number | null;
  realized: number | null;
  implementationCost: number | null;
  annualizedRealized: number | null;
  roi: number | null;
  status: string;
  validatedBy: { name: string } | null;
  validatedAt: string | null;
}
interface Detail {
  id: string;
  code: string;
  status: string;
  entity: { id: string };
  stepModel: string;
  nextPdcaPhase: string | null;
  steps: { id: string; position: number; pdcaPhase: string | null }[];
  measurement: { attainment: number | null; variation: number | null; variationPercent: number | null } | null;
  gain: Gain | null;
  standardAdopted: string | null;
  isReplicable: boolean;
  origin: { code: string } | null;
  replicas: { code: string }[];
  proposedSolution: string | null;
  sustainment: {
    dueOn: string;
    status: string;
    due: boolean;
    note: string | null;
    reviewedBy: { name: string } | null;
  } | null;
  can: Record<string, boolean>;
}

describe('Resultado da ideia (M7, RN-60 a RN-64, RN-82)', () => {
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
  const send = async (title: string, entityId = ent.A!) => {
    const res = await c.colab!.post<Detail>('/ideas', { title, description: 'Descrição.', entityId, categoryId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const ok = async (p: Promise<{ status: number; body: Detail }>, status = 200) => {
    const res = await p;
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body;
  };
  const approve = (code: string, stepModel?: 'free' | 'pdca') =>
    ok(
      c.ana!.post<Detail>(`/ideas/${code}/approve`, {
        stepName: 'Primeira',
        assigneeId: uid.ana,
        dueDate: '2099-12-31',
        ...(stepModel ? { stepModel } : {}),
      }),
    );
  const complete = (code: string, stepId: string) =>
    ok(c.ana!.post<Detail>(`/ideas/${code}/steps/${stepId}/complete`, {}));
  const implemented = async (title: string, extra: Record<string, unknown> = {}) => {
    const idea = await send(title);
    const approved = await approve(idea.code);
    await complete(idea.code, approved.steps[0]!.id);
    return ok(c.ana!.post<Detail>(`/ideas/${idea.code}/implement`, { resultText: 'Feito', ...extra }));
  };

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    ent.A = (await tree.save(tree.create({ name: 'Unidade A', parent: org }))).id;
    ent.B = (await tree.save(tree.create({ name: 'Unidade B', parent: org }))).id;
    categoryId = (
      await ds.getRepository(Category).save(ds.getRepository(Category).create({ name: 'Qualidade', color: '#4f46e5' }))
    ).id;
    await user('ana', 'analyst', ent.A!);
    await user('colab', 'collaborator', ent.A!);
    await user('vera', 'validator', ent.A!);
    await user('validB', 'validator', ent.B!);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('regras: atingimento (CA-RN-61.1), variação, anualização (CA-RN-62.2), ROI (CA-RN-82.1) e fases PDCA', () => {
    const reduce = { direction: 'decrease' as const, baseline: 100, target: 80 };
    expect(attainment({ ...reduce, achieved: 82 })).toBeCloseTo(0.9, 10);
    expect(attainment({ ...reduce, achieved: 80 })).toBe(1);
    expect(attainment({ ...reduce, achieved: 70 })).toBe(1);
    expect(attainment({ ...reduce, achieved: 110 })).toBe(0);
    expect(attainment({ direction: 'increase', baseline: 50, target: 100, achieved: 75 })).toBe(0.5);
    expect(attainment({ ...reduce, target: null, achieved: 82 })).toBeNull(); // CA-RN-61.2
    expect(attainment({ ...reduce, achieved: null })).toBeNull();
    expect(variation(100, 82)).toEqual({ absolute: -18, percent: -0.18 });
    expect(variation(0, 5)).toEqual({ absolute: 5, percent: null });
    expect(annualize(1000, 'monthly')).toBe(12_000);
    expect(annualize(1000, 'yearly')).toBe(1000);
    expect(annualize(1000, 'once')).toBe(1000);
    expect(roi(12_000, 4000)).toBe(3);
    expect(roi(null, 4000)).toBeNull(); // só declarado não entra
    expect(roi(12_000, 0)).toBeNull();
    expect(roi(12_000, null)).toBeNull();
    expect([null, 'plan', 'do', 'check', 'act'].map((p) => nextPdcaPhase(p as never))).toEqual([
      'plan',
      'do',
      'check',
      'act',
      'plan',
    ]);
  });

  it('CA-RN-60.1 aprovar com PDCA: Planejar primeiro, e cada nova etapa (uma por vez, RN-12) recebe a fase seguinte', async () => {
    const idea = await send('Troca rápida de ferramenta');
    let d = await approve(idea.code, 'pdca');
    expect(d.stepModel).toBe('pdca');
    expect(d.steps.map((s) => s.pdcaPhase)).toEqual(['plan']);
    expect(d.nextPdcaPhase).toBe('do');
    // Etapa aberta: não cria outra (a sequência continua valendo).
    const blocked = await c.ana!.post(`/ideas/${idea.code}/steps`, {
      name: 'Fazer',
      assigneeId: uid.ana,
      dueDate: '2099-12-31',
    });
    expect(blocked.status).toBe(409);
    for (const name of ['Fazer', 'Verificar', 'Agir', 'Planejar de novo']) {
      d = await complete(idea.code, d.steps.at(-1)!.id);
      d = await ok(
        c.ana!.post<Detail>(`/ideas/${idea.code}/steps`, { name, assigneeId: uid.ana, dueDate: '2099-12-31' }),
        201,
      );
    }
    expect(d.steps.map((s) => s.pdcaPhase)).toEqual(['plan', 'do', 'check', 'act', 'plan']);
  });

  it('CA-RN-60.2 etapas livres: nenhuma fase PDCA', async () => {
    const idea = await send('Etiquetas no almoxarifado');
    let d = await approve(idea.code);
    expect(d.stepModel).toBe('free');
    expect(d.nextPdcaPhase).toBeNull();
    d = await complete(idea.code, d.steps[0]!.id);
    d = await ok(
      c.ana!.post<Detail>(`/ideas/${idea.code}/steps`, { name: 'Outra', assigneeId: uid.ana, dueDate: '2099-12-31' }),
      201,
    );
    expect(d.steps.map((s) => s.pdcaPhase)).toEqual([null, null]);
  });

  it('CA-RN-61.1 / 61.2 medição: atingimento só com meta; a variação aparece sempre; só a equipe registra', async () => {
    const idea = await send('Menos refugo na prensa');
    const body = { indicator: 'Refugo', unit: '%', direction: 'decrease', baseline: 100, achieved: 82 };
    expect((await c.colab!.put(`/ideas/${idea.code}/measurement`, body)).status).toBe(403);
    let d = await ok(c.ana!.put<Detail>(`/ideas/${idea.code}/measurement`, body));
    expect(d.measurement).toMatchObject({ attainment: null, variation: -18, variationPercent: -0.18 });
    d = await ok(c.ana!.put<Detail>(`/ideas/${idea.code}/measurement`, { ...body, target: 80 }));
    expect(d.measurement?.attainment).toBeCloseTo(0.9, 10);
    // O autor vê a medição.
    expect((await c.colab!.get<Detail>(`/ideas/${idea.code}`)).body.measurement?.attainment).toBeCloseTo(0.9, 10);
    expect((await c.ana!.put(`/ideas/${idea.code}/measurement`, { ...body, direction: 'sideways' })).status).toBe(422);
    d = await ok(c.ana!.delete<Detail>(`/ideas/${idea.code}/measurement`));
    expect(d.measurement).toBeNull();
  });

  it('CA-RN-62.1 / 62.3 ganho: estimado só na triagem, realizado só depois de implementar; negativo recusado; moeda padrão', async () => {
    const idea = await send('Reaproveitar a água da lavagem');
    let d = await ok(c.ana!.put<Detail>(`/ideas/${idea.code}/gain`, { periodicity: 'monthly', estimated: 1500 }));
    expect(d.gain).toMatchObject({
      currency: 'BRL',
      periodicity: 'monthly',
      estimated: 1500,
      realized: null,
      status: 'declared',
    });
    expect((await c.ana!.put(`/ideas/${idea.code}/gain`, { periodicity: 'monthly', estimated: -1 })).status).toBe(422);
    expect((await c.ana!.put(`/ideas/${idea.code}/gain`, { periodicity: 'weekly', estimated: 1 })).status).toBe(422);
    const early = await c.ana!.put<{ code: string }>(`/ideas/${idea.code}/gain`, {
      periodicity: 'monthly',
      realized: 10,
    });
    expect([early.status, early.body.code]).toEqual([409, 'realized_not_yet']);
    const approved = await approve(idea.code);
    const late = await c.ana!.put<{ code: string }>(`/ideas/${idea.code}/gain`, {
      periodicity: 'monthly',
      estimated: 2000,
    });
    expect([late.status, late.body.code]).toEqual([409, 'estimate_closed']);
    // Custo pode ser informado durante a execução; o estimado fica como estava.
    d = await ok(c.ana!.put<Detail>(`/ideas/${idea.code}/gain`, { periodicity: 'monthly', implementationCost: 6000 }));
    expect(d.gain).toMatchObject({ estimated: 1500, implementationCost: 6000 });
    await complete(idea.code, approved.steps[0]!.id);
    await ok(c.ana!.post<Detail>(`/ideas/${idea.code}/implement`, { resultText: 'Feito' }));
    d = await ok(c.ana!.put<Detail>(`/ideas/${idea.code}/gain`, { periodicity: 'monthly', realized: 1000 }));
    expect(d.gain).toMatchObject({ realized: 1000, annualizedRealized: 12_000, roi: null, status: 'declared' });
    // O autor vê o ganho da própria ideia.
    expect((await c.colab!.get<Detail>(`/ideas/${idea.code}`)).body.gain?.realized).toBe(1000);
  });

  it('CA-RN-63.1 / 63.2 validação: só quem tem gain.validate; validado tem quem e quando; mudar o realizado volta a declarado', async () => {
    const idea = await implemented('Iluminação LED no galpão');
    await ok(
      c.ana!.put<Detail>(`/ideas/${idea.code}/gain`, {
        periodicity: 'yearly',
        realized: 9000,
        implementationCost: 3000,
      }),
    );
    // O validador acha a ideia na fila e consegue abri-la (só leitura).
    const pending = await c.vera!.get<{ code: string; gain: Gain }[]>('/gains/pending');
    expect(pending.body.map((p) => p.code)).toContain(idea.code);
    const seen = await c.vera!.get<Detail>(`/ideas/${idea.code}`);
    expect(seen.status).toBe(200);
    expect(seen.body.can).toMatchObject({ validateGain: true, comment: false, editResults: false, triage: false });
    expect((await c.validB!.get(`/ideas/${idea.code}`)).status).toBe(404); // validador de outra unidade
    expect((await c.ana!.post(`/ideas/${idea.code}/gain/validate`, {})).status).toBe(403);
    let d = await ok(c.vera!.post<Detail>(`/ideas/${idea.code}/gain/validate`, {}));
    expect(d.gain).toMatchObject({ status: 'validated', validatedBy: { name: 'Pessoa vera' }, roi: 3 });
    expect(d.gain?.validatedAt).toBeTruthy();
    expect((await c.vera!.post(`/ideas/${idea.code}/gain/validate`, {})).status).toBe(409);
    expect((await c.vera!.get<{ code: string }[]>('/gains/pending')).body.map((p) => p.code)).not.toContain(idea.code);
    d = await ok(c.ana!.put<Detail>(`/ideas/${idea.code}/gain`, { periodicity: 'yearly', realized: 9500 }));
    expect(d.gain).toMatchObject({ status: 'declared', validatedBy: null, validatedAt: null, roi: null });
    const events = await t.db.dataSource.query(`SELECT type FROM idea_event WHERE idea_id = $1`, [d.id]);
    expect(events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['gain_validated', 'gain_unvalidated']),
    );
  });

  it('CA-RN-64.1 / 64.2 lição aprendida e réplica em outra entidade, sem ganho nem medição', async () => {
    const plain = await implemented('Kanban de peças');
    expect(plain).toMatchObject({ standardAdopted: null, isReplicable: false });
    expect((await admin.post(`/ideas/${plain.code}/replicate`, { entityId: ent.B })).status).toBe(409);
    const idea = await implemented('Poka-yoke na montagem', {
      standardAdopted: 'Gabarito de encaixe em todas as bancadas.',
      isReplicable: true,
    });
    expect(idea).toMatchObject({ standardAdopted: 'Gabarito de encaixe em todas as bancadas.', isReplicable: true });
    await ok(c.ana!.put<Detail>(`/ideas/${idea.code}/gain`, { periodicity: 'once', realized: 500 }));
    expect((await admin.post(`/ideas/${idea.code}/replicate`, { entityId: ent.A })).status).toBe(422);
    expect((await c.colab!.post(`/ideas/${idea.code}/replicate`, { entityId: ent.B })).status).toBe(403);
    const copy = await ok(admin.post<Detail>(`/ideas/${idea.code}/replicate`, { entityId: ent.B }), 201);
    expect(copy).toMatchObject({
      status: 'submitted',
      entity: { id: ent.B },
      origin: { code: idea.code },
      gain: null,
      measurement: null,
    });
    expect(copy.proposedSolution).toContain('Gabarito de encaixe');
    expect(copy.code).not.toBe(idea.code);
    expect((await c.ana!.get<Detail>(`/ideas/${idea.code}`)).body.replicas.map((r) => r.code)).toEqual([copy.code]);
    // Padronização editável depois de implementar; antes, 409.
    const open = await send('Ainda aberta');
    expect(
      (await c.ana!.put(`/ideas/${open.code}/standard`, { standardAdopted: 'x', isReplicable: true })).status,
    ).toBe(409);
    const d = await ok(
      c.ana!.put<Detail>(`/ideas/${plain.code}/standard`, {
        standardAdopted: 'Quadro em cada linha',
        isReplicable: true,
      }),
    );
    expect(d).toMatchObject({ standardAdopted: 'Quadro em cada linha', isReplicable: true });
  });

  it('CA-RN-65.1 sustentação: revisão N dias depois de implementar, lembrete no dia (uma vez), contestar não reabre', async () => {
    expect((await admin.request('PATCH', '/settings', { values: { 'results.sustainment_days': 90 } })).status).toBe(
      200,
    );
    const idea = await implemented('Organização 5S na ferramentaria');
    const today = todayInZone(new Date(), 'America/Sao_Paulo');
    expect(idea.sustainment).toMatchObject({ dueOn: addDaysToDay(today, 90), status: 'pending', due: false });
    expect(idea.can.reviewSustainment).toBe(false);
    const early = await c.ana!.post<{ code: string }>(`/ideas/${idea.code}/sustainment`, { decision: 'confirmed' });
    expect([early.status, early.body.code]).toEqual([409, 'not_due']);
    // Antes do dia, o job não lembra ninguém.
    expect(await runSustainmentReminders(t.db.dataSource)).toBe(0);
    await t.db.dataSource.query(`UPDATE sustainment_review SET due_on = $2 WHERE idea_id = $1`, [idea.id, today]);
    expect(await runSustainmentReminders(t.db.dataSource)).toBe(1);
    expect(await runSustainmentReminders(t.db.dataSource)).toBe(0); // idempotente
    const notes = await t.db.dataSource
      .getRepository(Notification)
      .findBy({ ideaId: idea.id, type: 'sustainment_due' });
    expect(notes.map((n) => n.userId)).toEqual([uid.ana]);
    expect((await c.colab!.post(`/ideas/${idea.code}/sustainment`, { decision: 'confirmed' })).status).toBe(403);
    expect((await c.ana!.post(`/ideas/${idea.code}/sustainment`, { decision: 'contested' })).status).toBe(422);
    const d = await ok(
      c.ana!.post<Detail>(`/ideas/${idea.code}/sustainment`, {
        decision: 'contested',
        note: 'O quadro sumiu na troca de turno.',
      }),
    );
    expect(d.status).toBe('implemented');
    expect(d.sustainment).toMatchObject({
      status: 'contested',
      note: 'O quadro sumiu na troca de turno.',
      reviewedBy: { name: 'Pessoa ana' },
    });
    expect(d.can.reviewSustainment).toBe(false);
    // Reabrir cancela a revisão pendente de outra ideia.
    const other = await implemented('Sinalização do corredor');
    expect(other.sustainment?.status).toBe('pending');
    const reopened = await ok(admin.post<Detail>(`/ideas/${other.code}/reopen`, { reason: 'Faltou uma etapa' }));
    expect(reopened.sustainment).toBeNull();
    expect((await admin.request('PATCH', '/settings', { values: { 'results.sustainment_days': 0 } })).status).toBe(200);
    expect((await implemented('Sem revisão')).sustainment).toBeNull();
  });

  it('RN-46 / RN-82 / CA-RN-63.3 indicadores: só o validado soma; média sem zeros; ROI das que têm custo', async () => {
    const adminId = (await admin.get<{ id: string }>('/auth/me')).body.id;
    const done = async (title: string, gain: Record<string, unknown>, validate: boolean) => {
      const idea = await ok(
        admin.post<Detail>('/ideas', { title, description: 'x', entityId: ent.B, categoryId }),
        201,
      );
      const approved = await ok(
        admin.post<Detail>(`/ideas/${idea.code}/approve`, {
          stepName: 'Fazer',
          assigneeId: adminId,
          dueDate: '2099-12-31',
        }),
      );
      await ok(admin.post<Detail>(`/ideas/${idea.code}/steps/${approved.steps[0]!.id}/complete`, {}));
      await ok(admin.post<Detail>(`/ideas/${idea.code}/implement`, { resultText: 'Feito' }));
      await ok(admin.put<Detail>(`/ideas/${idea.code}/gain`, gain));
      if (validate) await ok(admin.post<Detail>(`/ideas/${idea.code}/gain/validate`, {}));
    };
    await done('Ganho mensal com custo', { periodicity: 'monthly', realized: 1000, implementationCost: 6000 }, true);
    await done('Ganho anual sem custo', { periodicity: 'yearly', realized: 5000 }, true);
    await done('Ganho só declarado', { periodicity: 'once', realized: 800 }, false);
    await ok(admin.post<Detail>('/ideas', { title: 'Sem ganho', description: 'x', entityId: ent.B, categoryId }), 201);
    const res = await admin.get<{
      currencies: Record<string, unknown>[];
      byCategory: Record<string, unknown>[];
      byEntity: Record<string, unknown>[];
    }>(`/reports/results?entityId=${ent.B}`);
    expect(res.status).toBe(200);
    expect(res.body.currencies).toEqual([
      {
        currency: 'BRL',
        validatedAnnual: 17_000,
        validatedIdeas: 2,
        avgPerIdea: 8500,
        roi: 2,
        declaredAnnual: 800,
        declaredIdeas: 1,
      },
    ]);
    expect(res.body.byEntity).toEqual([
      { id: ent.B, name: 'Unidade B', color: null, currency: 'BRL', validatedAnnual: 17_000, ideas: 2, roi: 2 },
    ]);
    expect(res.body.byCategory).toMatchObject([
      { id: categoryId, name: 'Qualidade', validatedAnnual: 17_000, ideas: 2 },
    ]);
    // Escopo: a analista da Unidade A não vê indicadores (sem report.view).
    expect((await c.ana!.get('/reports/results')).status).toBe(403);
  });
});
