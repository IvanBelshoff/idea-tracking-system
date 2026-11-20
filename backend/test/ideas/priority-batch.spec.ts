import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Notification } from '../../src/communication/entities.js';
import { priorityScore } from '../../src/ideas/triage-rules.js';
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
  impact: number | null;
  effort: number | null;
  category: { id: string } | null;
  assignedTo: { id: string } | null;
}
interface Batch {
  results: { ref: string; ok: boolean; code: string | null; error: string | null; message: string | null }[];
  succeeded: number;
  failed: number;
}

describe('Priorização, ações em lote e filtros salvos (M6, RN-56, RN-59)', () => {
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
  const submit = async (who: string, entityId: string, title: string) => {
    const res = await c[who]!.post<Detail>('/ideas', { title, description: 'x', entityId, categoryId: cat.q });
    expect(res.status).toBe(201);
    return res.body;
  };
  const prio = (who: Client, code: string, impact: unknown, effort: unknown) =>
    who.post<Detail>(`/ideas/${code}/priority`, { impact, effort });
  const batch = (who: Client, body: Record<string, unknown>) => who.post<Batch>('/ideas/batch', body);

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    ent.A = (await tree.save(tree.create({ name: 'Unidade A', parent: org }))).id;
    ent.B = (await tree.save(tree.create({ name: 'Unidade B', parent: org }))).id;
    const cats = ds.getRepository(Category);
    cat.q = (await cats.save(cats.create({ name: 'Qualidade', color: '#4f46e5' }))).id;
    cat.s = (await cats.save(cats.create({ name: 'Segurança', color: '#dc2626' }))).id;
    await user('ana', 'analyst', ent.A!);
    await user('beto', 'analyst', ent.A!);
    await user('bia', 'analyst', ent.B!);
    await user('colab', 'collaborator', ent.A!);
    await user('colab2', 'collaborator', ent.A!);
    await user('colabB', 'collaborator', ent.B!);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-56.2 (regra) nota = impacto ÷ esforço; sem um dos dois, sem nota', () => {
    expect(priorityScore(5, 1)).toBe(5);
    expect(priorityScore(2, 3)).toBe(0.667);
    expect(priorityScore(null, 3)).toBeNull();
    expect(priorityScore(4, null)).toBeNull();
  });

  it('CA-RN-56.1 impacto e esforço só de 1 a 5; fora disso → 422; só quem tria avalia', async () => {
    const idea = await submit('colab', ent.A!, 'Avaliar');
    for (const [i, e] of [
      [0, 3],
      [6, 3],
      [3, 0],
      [3, 6],
      [2.5, 3],
      ['3', 3],
    ]) {
      expect((await prio(c.ana!, idea.code, i, e)).status, `${i}/${e}`).toBe(422);
    }
    const ok = await prio(c.ana!, idea.code, 4, 2);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ impact: 4, effort: 2 });
    expect((await prio(c.colab!, idea.code, 4, 2)).status).toBe(403);
    expect((await prio(c.bia!, idea.code, 4, 2)).status).toBe(404);
    // Limpar a avaliação é permitido.
    expect((await prio(c.ana!, idea.code, null, null)).body).toMatchObject({ impact: null, effort: null });
  });

  it('CA-RN-56.3 a nota nunca muda a situação; fica no histórico interno; o autor não vê os números', async () => {
    const idea = await submit('colab', ent.A!, 'Sem mudar situação');
    const res = await prio(c.ana!, idea.code, 5, 1);
    expect(res.body.status).toBe('submitted');
    const team = await c.ana!.get<{ type: string }[]>(`/ideas/${idea.code}/timeline`);
    expect(team.body.some((e) => e.type === 'prioritized')).toBe(true);
    const author = await c.colab!.get<{ type: string }[]>(`/ideas/${idea.code}/timeline`);
    expect(author.body.some((e) => e.type === 'prioritized')).toBe(false);
    expect((await c.colab!.get<Detail>(`/ideas/${idea.code}`)).body).toMatchObject({ impact: null, effort: null });
    const mine = await c.colab!.get<{ items: Detail[] }>('/ideas/mine?pageSize=100');
    expect(mine.body.items.find((i) => i.id === idea.id)).toMatchObject({ impact: null, effort: null });
    // Encerrada não é avaliada.
    await c.ana!.post(`/ideas/${idea.code}/start-review`);
    await c.ana!.post(`/ideas/${idea.code}/reject`, { reason: 'Não' });
    expect((await prio(c.ana!, idea.code, 3, 3)).status).toBe(409);
  });

  it('CA-RN-56.2 a fila ordena por prioridade, desempata pela data de envio; sem avaliação vai para o fim', async () => {
    const a = await submit('colab', ent.A!, 'Ordem A (5/5 = 1)');
    const b = await submit('colab', ent.A!, 'Ordem B (4/1 = 4)');
    const none = await submit('colab', ent.A!, 'Ordem C (sem avaliação)');
    const d = await submit('colab', ent.A!, 'Ordem D (2/2 = 1, mais nova que A)');
    await prio(c.ana!, a.code, 5, 5);
    await prio(c.ana!, b.code, 4, 1);
    await prio(c.ana!, d.code, 2, 2);
    const res = await c.ana!.get<{ items: Detail[] }>(
      '/ideas?sort=priority&status=submitted&pageSize=100&search=Ordem',
    );
    expect(res.body.items.map((i) => i.code)).toEqual([b.code, a.code, d.code, none.code]);
    expect(res.body.items[0]).toMatchObject({ impact: 4, effort: 1 }); // a equipe vê os números
    // Paginação com a ordem de prioridade continua estável.
    const page2 = await c.ana!.get<{ items: Detail[] }>(
      '/ideas?sort=priority&status=submitted&pageSize=2&page=2&search=Ordem',
    );
    expect(page2.body.items.map((i) => i.code)).toEqual([d.code, none.code]);
  });

  it('CA-RN-59.1 lote em 20 ideias: escopo e permissão item a item; o que falha não desfaz o resto', async () => {
    const own: Detail[] = [];
    for (let i = 0; i < 17; i++) own.push(await submit(i % 2 ? 'colab' : 'colab2', ent.A!, `Lote ${i}`));
    const outside = await submit('colabB', ent.B!, 'Lote fora do escopo');
    const closed = own.pop()!;
    await c.ana!.post(`/ideas/${closed.code}/start-review`);
    await c.ana!.post(`/ideas/${closed.code}/reject`, { reason: 'Já encerrada' });
    const refs = [...own.map((i) => i.code), outside.code, closed.code, 'ITS-2099-9999', own[0]!.code];

    const res = await batch(c.ana!, { action: 'assign', refs, assigneeId: uid.beto });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(19); // repetida conta uma vez
    expect(res.body.succeeded).toBe(16);
    expect(res.body.failed).toBe(3);
    const byRef = new Map(res.body.results.map((r) => [r.ref, r]));
    expect(byRef.get(outside.code)).toMatchObject({ ok: false, error: 'not_found' });
    expect(byRef.get(closed.code)).toMatchObject({ ok: false, error: 'invalid_transition' });
    expect(byRef.get('ITS-2099-9999')).toMatchObject({ ok: false, error: 'not_found' });
    for (const i of own) expect((await c.ana!.get<Detail>(`/ideas/${i.code}`)).body.assignedTo?.id).toBe(uid.beto);
    // Nada mudou na ideia de fora do escopo.
    expect((await c.bia!.get<Detail>(`/ideas/${outside.code}`)).body.assignedTo).toBeNull();
    // Colaborador não faz lote em ideias alheias: cada item falha por permissão ou escopo.
    const forbidden = await batch(c.colab!, { action: 'assign', refs: [own[1]!.code], assigneeId: uid.beto });
    expect(forbidden.body).toMatchObject({ succeeded: 0, failed: 1 });
    expect(forbidden.body.results[0]!.error).toBe('forbidden');
    // Pedidos inválidos: limite de 100, ação desconhecida, atribuir sem a pessoa.
    expect(
      (
        await batch(c.ana!, {
          action: 'assign',
          refs: Array.from({ length: 101 }, (_, i) => `X-${i}`),
          assigneeId: null,
        })
      ).status,
    ).toBe(422);
    expect((await batch(c.ana!, { action: 'apagar', refs: [own[1]!.code] })).status).toBe(422);
    expect((await batch(c.ana!, { action: 'assign', refs: [own[1]!.code] })).status).toBe(422);
  });

  it('mudar a categoria em lote', async () => {
    const x = await submit('colab', ent.A!, 'Categoria 1');
    const y = await submit('colab', ent.A!, 'Categoria 2');
    const res = await batch(c.ana!, { action: 'category', refs: [x.code, y.code], categoryId: cat.s });
    expect(res.body).toMatchObject({ succeeded: 2, failed: 0 });
    expect((await c.ana!.get<Detail>(`/ideas/${x.code}`)).body.category?.id).toBe(cat.s);
  });

  it('CA-RN-59.2 recusar em lote exige a justificativa e a aplica a todas; cada autor é avisado', async () => {
    const x = await submit('colab', ent.A!, 'Recusa 1');
    const y = await submit('colab2', ent.A!, 'Recusa 2');
    expect((await batch(c.ana!, { action: 'reject', refs: [x.code, y.code] })).status).toBe(422);
    expect((await batch(c.ana!, { action: 'reject', refs: [x.code, y.code], reason: '   ' })).status).toBe(422);
    const res = await batch(c.ana!, { action: 'reject', refs: [x.code, y.code], reason: 'Fora do escopo do programa' });
    expect(res.body).toMatchObject({ succeeded: 2, failed: 0 });
    for (const [idea, author] of [
      [x, uid.colab!],
      [y, uid.colab2!],
    ] as const) {
      expect((await c.ana!.get<Detail>(`/ideas/${idea.code}`)).body.status).toBe('rejected');
      const note = await t.db.dataSource
        .getRepository(Notification)
        .findOneByOrFail({ userId: author, ideaId: idea.id, type: 'idea_rejected' });
      expect(note.payload.reason).toBe('Fora do escopo do programa');
    }
  });

  it('CA-RN-59.3 filtro salvo é privado e não amplia o escopo', async () => {
    const definition = {
      status: ['submitted'],
      entityId: ent.B,
      categoryId: null,
      search: '',
      assignedToMe: false,
      sort: 'priority',
    };
    const saved = await c.ana!.post<{ id: string; name: string; definition: typeof definition }>('/saved-filters', {
      name: 'Unidade B',
      definition,
    });
    expect(saved.status).toBe(201);
    expect(saved.body.definition).toMatchObject(definition);
    expect((await c.ana!.get<unknown[]>('/saved-filters')).body).toHaveLength(1);
    expect((await c.beto!.get<unknown[]>('/saved-filters')).body).toHaveLength(0);
    expect((await c.beto!.request('DELETE', `/saved-filters/${saved.body.id}`)).status).toBe(404);
    // Aplicar o filtro (entidade B) na lista da Ana, que só tria na A: nada de fora aparece.
    const applied = await c.ana!.get<{ items: Detail[]; meta: { total: number } }>(
      `/ideas?status=submitted&entityId=${ent.B}`,
    );
    expect(applied.body.meta.total).toBe(0);
    // Validação e limite.
    expect((await c.ana!.post('/saved-filters', { name: '', definition })).status).toBe(422);
    expect(
      (await c.ana!.post('/saved-filters', { name: 'x', definition: { ...definition, sort: 'qualquer' } })).status,
    ).toBe(422);
    for (let i = 0; i < 29; i++) await c.ana!.post('/saved-filters', { name: `F${i}`, definition });
    const over = await c.ana!.post<{ code: string }>('/saved-filters', { name: 'Demais', definition });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('too_many_filters');
    expect((await c.ana!.request('DELETE', `/saved-filters/${saved.body.id}`)).status).toBe(204);
  });
});
