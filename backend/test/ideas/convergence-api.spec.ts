import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Notification } from '../../src/communication/entities.js';
import { canBeConverged, principalOf, requesterCount, splitPoints } from '../../src/ideas/convergence-rules.js';
import { IdeaStatus } from '../../src/ideas/entities/idea.entity.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Participant {
  id: string;
  user: { id: string; name: string };
  role: string;
  origin: string;
  note: string | null;
  sourceCode: string | null;
}
interface Detail {
  id: string;
  code: string;
  status: string;
  submittedAt: string;
  convergedInto: { code: string } | null;
  convergedReason: string | null;
  requesters: number;
  participants: Participant[];
  convergedIdeas: { code: string; description: string }[];
  can: Record<string, boolean>;
}
interface Similar {
  code: string;
  title: string;
  canView: boolean;
  canSupport: boolean;
  own: boolean;
}

describe('Semelhantes, convergência e co-autoria (M6, RN-57, RN-69, RN-84 a RN-88)', () => {
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
  const send = async (who: string, title: string, description = 'Descrição.', entityId = ent.A!) => {
    const res = await c[who]!.post<Detail>('/ideas', { title, description, entityId, categoryId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const converge = (who: Client, ref: string, targetRef: string, reason = 'Pedem a mesma coisa') =>
    who.post<Detail & { code?: string }>(`/ideas/${ref}/converge`, { targetRef, reason });
  const get = async (who: Client, ref: string) => (await who.get<Detail>(`/ideas/${ref}`)).body;
  const notes = (userId: string, ideaId: string, type: string) =>
    t.db.dataSource.getRepository(Notification).findBy({ userId, ideaId, type });
  const backdate = (id: string, minutes: number) =>
    t.db.dataSource.query(`UPDATE idea SET submitted_at = now() - ($2 || ' minutes')::interval WHERE id = $1`, [
      id,
      minutes,
    ]);

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
    await user('gestor', 'manager', ent.A!);
    await user('colab1', 'collaborator', ent.A!);
    await user('colab2', 'collaborator', ent.A!);
    await user('colab3', 'collaborator', ent.A!);
    await user('colabB', 'collaborator', ent.B!);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('regras: principal é a mais antiga (empate, menor id); só ideia sem execução converge; contagem e divisão de pontos', () => {
    const a = { id: 'b', submittedAt: new Date('2026-01-01') };
    const b = { id: 'a', submittedAt: new Date('2026-02-01') };
    expect(principalOf(a, b)).toEqual([a, b]);
    expect(principalOf(b, a)).toEqual([a, b]);
    const same = new Date('2026-01-01');
    expect(principalOf({ id: 'z', submittedAt: same }, { id: 'y', submittedAt: same })[0].id).toBe('y'); // CA-RN-84.1
    expect([IdeaStatus.Submitted, IdeaStatus.InReview].every(canBeConverged)).toBe(true);
    expect([IdeaStatus.InProgress, IdeaStatus.Implemented, IdeaStatus.Rejected].some(canBeConverged)).toBe(false);
    expect(requesterCount(2)).toBe(3); // CA-RN-87.2
    expect(splitPoints(100, 50, 2)).toEqual({ author: 50, coAuthors: [25, 25] }); // CA-RN-89.1
    const odd = splitPoints(100, 50, 3);
    expect(odd.author + odd.coAuthors.reduce((s, x) => s + x, 0)).toBe(100); // CA-RN-69.2: soma exata
    expect(odd.coAuthors).toEqual([17, 17, 16]);
    expect(splitPoints(100, 50, 0)).toEqual({ author: 100, coAuthors: [] });
  });

  it('CA-RN-57.1 sugere a parecida (sem acento) e não a sem relação; CA-RN-57.2 respeita o escopo', async () => {
    const lamp = await send(
      'colab1',
      'Substituição de lâmpada no corredor B',
      'A lâmpada do corredor queima e deixa o local escuro.',
    );
    await send('colab1', 'Comprar cadeiras ergonômicas', 'Cadeiras novas para a montagem.');
    await send('colabB', 'Trocar lâmpada do corredor da expedição', 'Lâmpada queimada.', ent.B!);
    const res = await c.colab2!.get<Similar[]>(
      `/ideas/similar?q=${encodeURIComponent('Trocar lampada do corredor')}&entityId=${ent.A}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.code)).toEqual([lamp.code]);
    // O colaborador não vê a ideia alheia: só o título, mas pode apoiar.
    expect(res.body[0]).toMatchObject({
      title: 'Substituição de lâmpada no corredor B',
      canView: false,
      canSupport: true,
      own: false,
    });
    // A analista da A vê completa; ninguém da A vê a da Unidade B.
    const team = (await c.ana!.get<Similar[]>(`/ideas/similar?q=${encodeURIComponent('trocar lampada do corredor')}`))
      .body;
    expect(team.map((s) => s.code)).toEqual([lamp.code]);
    expect(team[0]!.canView).toBe(true);
    // A autora vê a própria marcada como sua (não pode apoiar).
    const own = (
      await c.colab1!.get<Similar[]>(`/ideas/similar?q=${encodeURIComponent('lampada corredor')}&entityId=${ent.A}`)
    ).body;
    expect(own[0]).toMatchObject({ own: true, canSupport: false });
    // Desligando os títulos, o colaborador não recebe ideias que não pode ver.
    await admin.request('PATCH', '/settings', { values: { 'ideas.similar_show_titles': false } });
    expect((await c.colab2!.get<Similar[]>(`/ideas/similar?q=lampada%20corredor&entityId=${ent.A}`)).body).toEqual([]);
    await admin.request('PATCH', '/settings', { values: { 'ideas.similar_show_titles': true } });
    // Consulta curta demais: nada.
    expect((await c.colab2!.get<Similar[]>('/ideas/similar?q=lam')).body).toEqual([]);
  });

  it('CA-RN-85.1 "Apoiar": vira co-autor sem criar ideia; CA-RN-86.4 não apoia a própria nem duas vezes', async () => {
    const idea = await send('colab1', 'Bebedouro no galpão 2', 'Não há água no galpão 2.');
    const before = (await t.db.dataSource.query('SELECT count(*)::int AS n FROM idea'))[0].n;
    const res = await c.colab2!.post<Detail>(`/ideas/${idea.code}/support`, { note: 'Também sinto falta.' });
    expect(res.status).toBe(200);
    expect((await t.db.dataSource.query('SELECT count(*)::int AS n FROM idea'))[0].n).toBe(before);
    expect(res.body.participants.find((p) => p.user.id === uid.colab2)).toMatchObject({
      role: 'co_author',
      origin: 'support',
    });
    expect(res.body.requesters).toBe(2);
    expect((await c.colab1!.post<{ code: string }>(`/ideas/${idea.code}/support`)).body.code).toBe('own_idea');
    expect((await c.colab2!.post<{ code: string }>(`/ideas/${idea.code}/support`)).body.code).toBe(
      'already_supporting',
    );
    // A co-autora vê a ideia e a acompanha em "Minhas ideias".
    expect((await c.colab2!.get(`/ideas/${idea.code}`)).status).toBe(200);
    const mine = await c.colab2!.get<{ items: (Detail & { relation: string })[] }>('/ideas/mine?pageSize=100');
    expect(mine.body.items.find((i) => i.code === idea.code)?.relation).toBe('co_author');
    expect((await notes(uid.colab2!, idea.id, 'coauthor_added')).length).toBe(1); // CA-RN-87.1
    // O texto de apoio é da equipe: a autora vê só quantos pediram (CA-RN-86.2).
    expect((await get(c.colab1!, idea.code)).participants.find((p) => p.user.id === uid.colab2)?.note).toBeNull();
    expect((await get(c.ana!, idea.code)).participants.find((p) => p.user.id === uid.colab2)?.note).toBe(
      'Também sinto falta.',
    );
    // Fora da entidade onde envia ideias: não acha (404).
    expect((await c.colabB!.post(`/ideas/${idea.code}/support`)).status).toBe(404);
  });

  it('CA-RN-85.2 converger exige justificativa (422) e idea.converge (403); CA-RN-84.1 a mais antiga é a principal', async () => {
    const older = await send('colab1', 'Faixa de pedestres na portaria');
    const newer = await send('colab2', 'Pintar faixa na portaria', 'Pedestres sem faixa na entrada.');
    await backdate(older.id, 60);
    expect((await c.ana!.post(`/ideas/${older.code}/converge`, { targetRef: newer.code, reason: '  ' })).status).toBe(
      422,
    );
    expect((await converge(c.gestor!, older.code, newer.code)).status).toBe(403);
    expect((await converge(c.colab1!, older.code, newer.code)).status).toBe(404); // não vê a outra
    // Pedido "ao contrário" (a mais antiga como alvo): a principal continua sendo a mais antiga.
    const res = await converge(c.ana!, newer.code, older.code);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(older.code);
    expect(res.body.requesters).toBe(2);
    // CA-RN-86.1: a autora da principal continua autora; quem pediu depois vira co-autor.
    expect(res.body.participants.find((p) => p.role === 'author')?.user.id).toBe(uid.colab1);
    expect(res.body.participants.find((p) => p.user.id === uid.colab2)).toMatchObject({
      role: 'co_author',
      origin: 'converged',
      sourceCode: newer.code,
    });
    // CA-RN-86.2: a equipe vê o texto original da convergida; a autora da principal, não.
    expect(res.body.convergedIdeas).toEqual([
      expect.objectContaining({ code: newer.code, description: 'Pedestres sem faixa na entrada.' }),
    ]);
    expect((await get(c.colab1!, older.code)).convergedIdeas).toEqual([]);
    // CA-RN-87.1: a autora da convergida é avisada e vê "Convergida com X" na lista dela.
    expect((await notes(uid.colab2!, newer.id, 'idea_converged')).length).toBe(1);
    const mine = await c.colab2!.get<{ items: Detail[] }>('/ideas/mine?pageSize=100');
    expect(mine.body.items.find((i) => i.code === newer.code)?.convergedInto?.code).toBe(older.code);
    expect(mine.body.items.find((i) => i.code === older.code)).toBeDefined(); // acompanha a principal
  });

  it('CA-RN-84.2 a convergida sai das filas e dos indicadores e não tem fluxo próprio', async () => {
    const p = await send('colab1', 'Fluxo próprio principal');
    const x = await send('colab3', 'Fluxo próprio convergida');
    await backdate(p.id, 30);
    await converge(c.ana!, x.code, p.code);
    const queue = await c.ana!.get<{ items: Detail[] }>('/ideas?pageSize=100&status=submitted');
    expect(queue.body.items.some((i) => i.code === x.code)).toBe(false);
    expect(queue.body.items.some((i) => i.code === p.code)).toBe(true);
    const report = await c.gestor!.get<{ total: number }>('/reports/summary');
    const all = (
      await t.db.dataSource.query(
        'SELECT count(*)::int AS n FROM idea WHERE converged_into_id IS NULL AND entity_id = $1',
        [ent.A],
      )
    )[0].n;
    expect(report.body.total).toBe(all);
    const detail = await get(c.ana!, x.code);
    expect(detail.convergedInto?.code).toBe(p.code);
    expect(detail.can).toMatchObject({ triage: false, edit: false, unconverge: true, converge: false });
    for (const action of ['start-review', 'priority', 'assign']) {
      const body =
        action === 'priority' ? { impact: 3, effort: 3 } : action === 'assign' ? { assigneeId: uid.ana } : {};
      const res = await c.ana!.post<{ code: string }>(`/ideas/${x.code}/${action}`, body);
      expect([action, res.status, res.body.code]).toEqual([action, 409, 'idea_converged']);
    }
    expect((await c.colab3!.request<{ code: string }>('PATCH', `/ideas/${x.code}`, { title: 'novo' })).body.code).toBe(
      'idea_converged',
    );
  });

  it('CA-RN-84.3 cadeia A→B→C aponta tudo para C; A↔B → 422; CA-RN-84.4 a principal leva as suas convergidas', async () => {
    const cc = await send('colab1', 'Cadeia C (mais antiga)');
    const bb = await send('colab2', 'Cadeia B');
    const aa = await send('colab3', 'Cadeia A (mais nova)');
    await backdate(cc.id, 120);
    await backdate(bb.id, 60);
    expect((await converge(c.ana!, aa.code, bb.code)).body.code).toBe(bb.code);
    // A já converge em B: A↔B é a mesma ideia.
    expect((await converge(c.ana!, bb.code, aa.code)).status).toBe(422);
    // B (que tem A) converge em C: as duas apontam para C, e os co-autores vão junto.
    const res = await converge(c.ana!, bb.code, cc.code);
    expect(res.body.code).toBe(cc.code);
    const rows = await t.db.dataSource.query('SELECT code, converged_into_id FROM idea WHERE code = ANY($1)', [
      [aa.code, bb.code],
    ]);
    expect(rows.every((r: { converged_into_id: string }) => r.converged_into_id === cc.id)).toBe(true);
    expect(
      res.body.participants
        .filter((p) => p.role === 'co_author')
        .map((p) => p.user.id)
        .sort(),
    ).toEqual([uid.colab2, uid.colab3].sort());
    expect(res.body.requesters).toBe(3);
    expect((await converge(c.ana!, cc.code, cc.code)).status).toBe(422);
  });

  it('a mais recente já em andamento não perde o fluxo (409)', async () => {
    const older = await send('colab1', 'Em andamento antiga');
    const running = await send('colab2', 'Em andamento nova');
    await backdate(older.id, 30);
    await c.ana!.post(`/ideas/${running.code}/approve`, {
      stepName: 'Fazer',
      assigneeId: uid.ana,
      dueDate: '2099-12-31',
    });
    const res = await converge(c.ana!, older.code, running.code);
    expect(res.status).toBe(409);
    expect((res.body as unknown as { code: string }).code).toBe('cannot_converge');
  });

  it('CA-RN-88.2 principal recusada: convergidas ficam recusadas e cada pessoa recebe a mesma justificativa, sem duplicar; CA-RN-88.3 reaberta, acompanham', async () => {
    const p = await send('colab1', 'Recusa principal');
    const x = await send('colab2', 'Recusa convergida');
    await backdate(p.id, 30);
    await converge(c.ana!, x.code, p.code);
    await c.colab3!.post(`/ideas/${p.code}/support`);
    await c.ana!.post(`/ideas/${p.code}/start-review`);
    expect((await c.ana!.post(`/ideas/${p.code}/reject`, { reason: 'Sem orçamento este ano' })).status).toBe(200);
    expect((await get(c.colab2!, x.code)).status).toBe('rejected');
    for (const who of ['colab1', 'colab2', 'colab3']) {
      const list = await notes(uid[who]!, p.id, 'idea_rejected');
      expect([who, list.length]).toEqual([who, 1]);
      expect(list[0]!.payload.reason).toBe('Sem orçamento este ano');
    }
    expect((await admin.post(`/ideas/${p.code}/reopen`, { reason: 'Verba liberada' })).status).toBe(200);
    expect((await get(c.colab2!, x.code)).status).toBe('in_review');
    expect((await notes(uid.colab2!, p.id, 'idea_reopened')).length).toBe(1);
  });

  it('CA-RN-88.1 desfazer: volta com fluxo próprio e a data original; co-autoria removida; histórico nas duas; CA-RN-88.4 colaborador não desfaz', async () => {
    const p = await send('colab1', 'Desfazer principal');
    const x = await send('colab2', 'Desfazer convergida');
    await backdate(p.id, 30);
    await converge(c.ana!, x.code, p.code);
    expect((await c.colab2!.post(`/ideas/${x.code}/unconverge`, {})).status).toBe(403);
    const res = await c.ana!.post<Detail>(`/ideas/${x.code}/unconverge`, { reason: 'Era engano: pedidos diferentes' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ convergedInto: null, status: 'submitted', submittedAt: x.submittedAt });
    expect(res.body.can.triage).toBe(true);
    const principal = await get(c.ana!, p.code);
    expect(principal.participants.some((pp) => pp.user.id === uid.colab2)).toBe(false);
    expect(principal.requesters).toBe(1);
    const tl = async (code: string) =>
      (await c.ana!.get<{ type: string }[]>(`/ideas/${code}/timeline`)).body.map((e) => e.type);
    expect(await tl(x.code)).toEqual(expect.arrayContaining(['converged', 'convergence_undone']));
    expect(await tl(p.code)).toEqual(expect.arrayContaining(['convergence_received', 'convergence_undone']));
    expect((await notes(uid.colab2!, x.id, 'idea_unconverged')).length).toBe(1);
    // Volta para a fila.
    expect(
      (await c.ana!.get<{ items: Detail[] }>('/ideas?status=submitted&pageSize=100')).body.items.some(
        (i) => i.code === x.code,
      ),
    ).toBe(true);
  });

  it('CA-RN-86.3 principal encerrada: o colaborador não entra; a equipe adiciona. CA-RN-69 participantes', async () => {
    const p = await send('colab1', 'Participantes');
    await c.ana!.post(`/ideas/${p.code}/start-review`);
    await c.ana!.post(`/ideas/${p.code}/reject`, { reason: 'Encerrada' });
    expect((await c.colab2!.post<{ code: string }>(`/ideas/${p.code}/support`)).body.code).toBe('idea_closed');
    // A equipe ainda pode adicionar; colaborador e gestor não gerenciam.
    expect(
      (await c.colab1!.post(`/ideas/${p.code}/participants`, { userId: uid.colab2, role: 'co_author' })).status,
    ).toBe(403);
    expect(
      (await c.gestor!.post(`/ideas/${p.code}/participants`, { userId: uid.colab2, role: 'co_author' })).status,
    ).toBe(403);
    const added = await c.ana!.post<Detail>(`/ideas/${p.code}/participants`, { userId: uid.colab2, role: 'co_author' });
    expect(added.status).toBe(200);
    const exec = await c.ana!.post<Detail>(`/ideas/${p.code}/participants`, { userId: uid.colab3, role: 'executor' });
    expect(exec.body.participants.map((x) => x.role).sort()).toEqual(['author', 'co_author', 'executor']);
    expect((await c.ana!.post(`/ideas/${p.code}/participants`, { userId: uid.colab3, role: 'executor' })).status).toBe(
      409,
    );
    expect((await c.ana!.post(`/ideas/${p.code}/participants`, { userId: uid.colab3, role: 'author' })).status).toBe(
      422,
    );
    // CA-RN-69.1: o autor não sai.
    const author = exec.body.participants.find((x) => x.role === 'author')!;
    const removeAuthor = await c.ana!.request<{ code: string }>('DELETE', `/ideas/${p.code}/participants/${author.id}`);
    expect(removeAuthor.body.code).toBe('author_required');
    const executor = exec.body.participants.find((x) => x.role === 'executor')!;
    expect(
      (await c.ana!.request<Detail>('DELETE', `/ideas/${p.code}/participants/${executor.id}`)).body.participants,
    ).toHaveLength(2);
    const events = (await c.colab1!.get<{ type: string }[]>(`/ideas/${p.code}/timeline`)).body.map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(['participant_added', 'participant_removed'])); // CA-RN-69.3
  });

  it('CA-T.2 duas convergências simultâneas do mesmo par, em sentidos opostos: uma vale, a outra não, sem ciclo', async () => {
    const a = await send('colab1', 'Concorrência A');
    const b = await send('colab2', 'Concorrência B');
    await backdate(a.id, 30);
    const [r1, r2] = await Promise.all([converge(c.ana!, a.code, b.code), converge(c.ana!, b.code, a.code)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect([409, 422]).toContain(statuses[1]);
    const rows = await t.db.dataSource.query('SELECT id, converged_into_id FROM idea WHERE id = ANY($1)', [
      [a.id, b.id],
    ]);
    const pointers = rows.map((r: { converged_into_id: string | null }) => r.converged_into_id);
    expect(pointers.filter((x: string | null) => x !== null)).toEqual([a.id]); // só B aponta para A
  });

  it('principal com convergidas não é excluída sem desfazer antes', async () => {
    const p = await send('colab1', 'Excluir principal');
    const x = await send('colab2', 'Excluir convergida');
    await backdate(p.id, 30);
    await converge(c.ana!, x.code, p.code);
    expect((await admin.request<{ code: string }>('DELETE', `/ideas/${p.code}`)).body.code).toBe('has_converged');
    // Excluir a convergida tira a co-autoria que veio dela.
    expect((await admin.request('DELETE', `/ideas/${x.code}`)).status).toBe(204);
    expect((await get(c.ana!, p.code)).requesters).toBe(1);
  });
});
