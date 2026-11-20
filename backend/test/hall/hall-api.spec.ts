import 'reflect-metadata';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysToDay, todayInZone } from '../../src/common/dates.js';
import { Notification } from '../../src/communication/entities.js';
import { expireHighlights, runHallJobs } from '../../src/hall/hall-core.js';
import { candidateReason, eligibility, showsName } from '../../src/hall/hall-rules.js';
import { IdeaStatus } from '../../src/ideas/entities/idea.entity.js';
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
  steps: { id: string }[];
  highlightId: string | null;
  can: Record<string, boolean>;
}
interface Card {
  id: string;
  scope: string;
  state: string;
  idea: { code: string; title: string };
  people: { name: string | null; role: string; photoVersion: string | null }[];
  gain: { validatedAnnual: number } | null;
  likes: number | null;
  likedByMe: boolean;
  canLike: boolean;
}
interface HighlightDetail {
  card: Card;
  praiseList: { id: string; body: string; hidden: boolean; hiddenReason: string | null }[];
  myConsent: string | null;
}
interface Hall {
  current: Card[];
  fame: { year: number; cards: Card[] }[];
  mine: { highlightId: string; status: string }[];
}

/** Texto de um PDF sem compressão (pdfkit grava os textos em hexadecimal). */
function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  return [...raw.matchAll(/((?:\[[^\]]*\]|<[0-9a-f]+>)\s*T[jJ])/gi)]
    .map((op) =>
      [...(op[1] ?? '').matchAll(/<([0-9a-f]+)>/gi)]
        .map((h) =>
          Buffer.from(h[1]?.match(/[0-9a-f]{2}/gi)?.map((x) => Number.parseInt(x, 16)) ?? []).toString('latin1'),
        )
        .join(''),
    )
    .join(' ');
}

describe('Hall de destaques (M9, RN-72 a RN-80, CA-RN-89.3)', () => {
  let t: TestApp;
  let admin: Client;
  const ent: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  let categoryId: string;
  const today = todayInZone(new Date(), 'America/Sao_Paulo');

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
  const settings = (values: Record<string, unknown>) => admin.request('PATCH', '/settings', { values });
  const send = async (who: string, title: string) => {
    const res = await c[who]!.post<Detail>('/ideas', {
      title,
      description: `Antes: ${title}`,
      entityId: ent.A,
      categoryId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const approve = async (code: string) =>
    (
      await c.ana!.post<Detail>(`/ideas/${code}/approve`, {
        stepName: 'Fazer',
        assigneeId: uid.ana,
        dueDate: '2099-12-31',
      })
    ).body;
  const implemented = async (who: string, title: string) => {
    const idea = await send(who, title);
    const d = await approve(idea.code);
    await c.ana!.post(`/ideas/${idea.code}/steps/${d.steps[0]!.id}/complete`);
    expect((await c.ana!.post(`/ideas/${idea.code}/implement`, { resultText: `Depois: ${title}` })).status).toBe(200);
    return idea;
  };
  const highlight = (who: Client, ideaRef: string, over: Record<string, unknown> = {}) =>
    who.post<HighlightDetail>('/hall/highlights', {
      ideaRef,
      scope: 'entity',
      justification: 'Reduziu o refugo pela metade',
      startsOn: today,
      endsOn: addDaysToDay(today, 30),
      ...over,
    });

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
    await user('colabB', 'collaborator', ent.B!);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('regras: elegibilidade (CA-RN-73.1), nome só com consentimento (RN-74, RN-70) e candidatas (RN-72b)', () => {
    expect(eligibility(IdeaStatus.Implemented, false)).toBe('ok');
    expect(eligibility(IdeaStatus.Rejected, true)).toBe('rejected');
    expect(eligibility(IdeaStatus.InProgress, false)).toBe('not_ready');
    expect(eligibility(IdeaStatus.InProgress, true)).toBe('ok');
    expect(showsName('accepted', false, false)).toBe(true);
    expect(showsName('pending', false, false)).toBe(false); // sem resposta: sem nome
    expect(showsName('accepted', true, false)).toBe(false); // opt-out vence
    expect(candidateReason({ validatedAnnual: 5000, likes: 0 }, { minGain: 1000, minLikes: 0 })).toBe('gain');
    expect(candidateReason({ validatedAnnual: null, likes: 3 }, { minGain: 1000, minLikes: 3 })).toBe('likes');
    expect(candidateReason({ validatedAnnual: 10, likes: 1 }, { minGain: 0, minLikes: 0 })).toBeNull();
  });

  it('CA-RN-72.1 / 73.1 quem destaca, com justificativa e período; só implementadas; Não autorizada nunca', async () => {
    const idea = await implemented('colab1', 'Gabarito na prensa');
    expect((await highlight(c.colab2!, idea.code)).status).toBe(403);
    expect((await highlight(c.gestor!, idea.code, { scope: 'organization' })).status).toBe(403); // só entidade
    expect((await highlight(c.gestor!, idea.code, { justification: '' })).status).toBe(422);
    expect((await highlight(c.gestor!, idea.code, { endsOn: addDaysToDay(today, -1) })).status).toBe(422);
    const open = await send('colab1', 'Ainda aberta');
    expect((await highlight(c.gestor!, open.code)).body).toMatchObject({ code: 'not_implemented' });
    await approve(open.code);
    expect((await highlight(c.gestor!, open.code)).status).toBe(422); // Em andamento, opção desligada
    expect((await settings({ 'hall.allow_in_progress': true })).status).toBe(200);
    expect((await highlight(c.gestor!, open.code)).status).toBe(201);
    expect((await settings({ 'hall.allow_in_progress': false })).status).toBe(200);
    const rejected = await send('colab1', 'Recusada');
    await c.ana!.post(`/ideas/${rejected.code}/start-review`);
    await c.ana!.post(`/ideas/${rejected.code}/reject`, { reason: 'Fora do escopo' });
    const res = await highlight(admin, rejected.code);
    expect([res.status, (res.body as unknown as { code: string }).code]).toEqual([422, 'idea_rejected']);
    // Convergida: destaca-se a principal.
    const principal = await implemented('colab1', 'Principal');
    const child = await send('colab2', 'Convergida');
    expect(
      (await c.ana!.post(`/ideas/${child.code}/converge`, { targetRef: principal.code, reason: 'Igual' })).status,
    ).toBe(200);
    const viaChild = await highlight(c.gestor!, child.code);
    expect([viaChild.status, viaChild.body.card.idea.code]).toEqual([201, principal.code]);
    expect((await highlight(c.gestor!, principal.code)).status).toBe(409); // já em destaque neste escopo
  });

  it('CA-RN-74.1 / 89.3 / 80.1 autor e co-autores avisados; nome só com aceite; opt-out vale; todos aparecem', async () => {
    const idea = await send('colab1', 'Kanban de peças');
    expect((await c.colab2!.post(`/ideas/${idea.code}/support`, {})).status).toBe(200);
    const d = await approve(idea.code);
    await c.ana!.post(`/ideas/${idea.code}/steps/${d.steps[0]!.id}/complete`);
    await c.ana!.post(`/ideas/${idea.code}/implement`, { resultText: 'Depois: kanban' });
    const created = await highlight(c.gestor!, idea.code);
    expect(created.status).toBe(201);
    const hid = created.body.card.id;
    expect(created.body.card.people).toEqual([
      { name: null, userId: null, photoVersion: null, role: 'author' },
      { name: null, userId: null, photoVersion: null, role: 'co_author' },
    ]);
    for (const who of ['colab1', 'colab2']) {
      const notes = await t.db.dataSource
        .getRepository(Notification)
        .findBy({ userId: uid[who], type: 'idea_highlighted' });
      expect(notes.length).toBeGreaterThan(0);
    }
    expect((await c.colab1!.get<Hall>('/hall')).body.mine).toContainEqual({
      highlightId: hid,
      ideaTitle: 'Kanban de peças',
      status: 'pending',
    });
    const accepted = await c.colab1!.post<HighlightDetail>(`/hall/highlights/${hid}/consent`, { accept: true });
    expect([accepted.body.myConsent, accepted.body.card.people[0]?.name]).toEqual(['accepted', 'Pessoa colab1']);
    // RN-142: com foto, o Hall traz a versão dela para quem aparece com nome.
    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0f766e' } })
      .jpeg()
      .toBuffer();
    const up = await c.colab1!.upload<{ version: string }>(
      `/users/${uid.colab1}/photo`,
      'eu.jpg',
      jpeg,
      'image/jpeg',
      'PUT',
    );
    expect(up.status).toBe(200);
    expect((await c.gestor!.get<HighlightDetail>(`/hall/highlights/${hid}`)).body.card.people[0]?.photoVersion).toBe(
      up.body.version,
    );
    await c.colab2!.post(`/hall/highlights/${hid}/consent`, { accept: false });
    expect((await c.gestor!.post(`/hall/highlights/${hid}/consent`, { accept: true })).status).toBe(403);
    // Opt-out de nome (RN-70) vence o aceite.
    await c.colab1!.request('PATCH', '/auth/me/preferences', { hideName: true });
    expect(
      (await c.gestor!.get<HighlightDetail>(`/hall/highlights/${hid}`)).body.card.people.map((p) => p.name),
    ).toEqual([null, null]);
    // CA-RN-142.4: com o opt-out, nem a foto.
    expect(
      (await c.gestor!.get<HighlightDetail>(`/hall/highlights/${hid}`)).body.card.people.map((p) => p.photoVersion),
    ).toEqual([null, null]);
    await c.colab1!.request('PATCH', '/auth/me/preferences', { hideName: false });
    // Cartão em PDF com as mesmas regras (CA-RN-80.1).
    const pdf = await c.gestor!.raw(`/hall/highlights/${hid}/card`);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const text = pdfText(Buffer.from(await pdf.arrayBuffer()));
    expect(text).toContain('Kanban de pe');
    expect(text).toContain('Pessoa colab1');
    expect(text).toContain('Colaborador an'); // o co-autor recusou
    expect(text).not.toContain('Pessoa colab2');
    // O detalhe da ideia aponta o destaque e oferece "Destacar" só a quem faz curadoria.
    expect((await c.gestor!.get<Detail>(`/ideas/${idea.code}`)).body.highlightId).toBe(hid);
    expect((await c.colab1!.get<Detail>(`/ideas/${idea.code}`)).body.can.highlight).toBe(false);
  });

  it('CA-RN-79.1 / 80.2 destaque da entidade só para quem enxerga a entidade; o da organização para todos', async () => {
    const idea = await implemented('colab1', 'Iluminação LED');
    const entityH = (await highlight(c.gestor!, idea.code)).body.card.id;
    expect((await c.colabB!.get<Hall>('/hall')).body.current.map((x) => x.id)).not.toContain(entityH);
    expect((await c.colabB!.get(`/hall/highlights/${entityH}`)).status).toBe(404);
    expect((await c.colab2!.get<Hall>('/hall')).body.current.map((x) => x.id)).toContain(entityH);
    const orgH = (await highlight(admin, idea.code, { scope: 'organization' })).body.card.id;
    const hall = (await c.colabB!.get<Hall>('/hall')).body;
    expect(hall.current.map((x) => x.id)).toContain(orgH);
    expect(hall.current[0]?.scope).toBe('organization'); // organização primeiro
  });

  it('CA-RN-75.1 o ganho só aparece com "mostrar ganho no Hall" ligado e ganho validado', async () => {
    const idea = await implemented('colab1', 'Reuso de água');
    await c.ana!.request('PUT', `/ideas/${idea.code}/gain`, { periodicity: 'monthly', realized: 100 });
    const hid = (await highlight(c.gestor!, idea.code)).body.card.id;
    const gain = async () => (await c.colab2!.get<HighlightDetail>(`/hall/highlights/${hid}`)).body.card.gain;
    expect(await gain()).toBeNull(); // desligado
    expect((await settings({ 'hall.show_gain': true })).status).toBe(200);
    expect(await gain()).toBeNull(); // só declarado
    await admin.post(`/ideas/${idea.code}/gain/validate`);
    expect(await gain()).toMatchObject({ validatedAnnual: 1200 });
    await settings({ 'hall.show_gain': false });
  });

  it('CA-RN-76.1 a 76.4 curtidas: uma por pessoa, nunca na própria ou de co-autoria, só no que se vê, desligáveis', async () => {
    // Co-autoria antes de implementar (apoio só vale em ideia aberta).
    const idea = await send('colab1', 'Etiquetas');
    expect((await c.colab2!.post(`/ideas/${idea.code}/support`, {})).status).toBe(200);
    const d = await approve(idea.code);
    await c.ana!.post(`/ideas/${idea.code}/steps/${d.steps[0]!.id}/complete`);
    await c.ana!.post(`/ideas/${idea.code}/implement`, { resultText: 'Depois: etiquetas' });
    expect((await c.colabB!.request('PUT', `/ideas/${idea.code}/like`)).status).toBe(404); // não vê (CA-RN-76.4)
    await highlight(admin, idea.code, { scope: 'organization' });
    const first = await c.colabB!.request<{ likes: number; likedByMe: boolean }>('PUT', `/ideas/${idea.code}/like`);
    expect(first.body).toEqual({ likes: 1, likedByMe: true });
    expect((await c.colabB!.request<{ likes: number }>('PUT', `/ideas/${idea.code}/like`)).body.likes).toBe(1); // idempotente
    expect((await c.colab1!.request('PUT', `/ideas/${idea.code}/like`)).status).toBe(422);
    expect((await c.colab2!.request('PUT', `/ideas/${idea.code}/like`)).status).toBe(422); // co-autor
    expect((await c.gestor!.request<{ likes: number }>('PUT', `/ideas/${idea.code}/like`)).body.likes).toBe(2);
    expect((await admin.get<{ status: string }>(`/ideas/${idea.code}`)).body.status).toBe('implemented'); // CA-RN-76.2
    expect((await c.colabB!.request<{ likes: number }>('DELETE', `/ideas/${idea.code}/like`)).body.likes).toBe(1);
    expect((await settings({ 'hall.likes_enabled': false })).status).toBe(200);
    expect((await c.colabB!.request('PUT', `/ideas/${idea.code}/like`)).status).toBe(404); // CA-RN-76.3
    expect((await c.colabB!.get<Hall>('/hall')).body.current.every((x) => x.likes === null)).toBe(true);
    await settings({ 'hall.likes_enabled': true });
  });

  it('CA-RN-77.1 elogio oculto pela moderação some para todos, menos moderadores, com o motivo', async () => {
    const idea = await implemented('colab1', 'Organização 5S');
    const hid = (await highlight(admin, idea.code, { scope: 'organization' })).body.card.id;
    const praised = await c.colabB!.post<HighlightDetail>(`/hall/highlights/${hid}/praises`, { body: 'Ficou ótimo!' });
    const praiseId = praised.body.praiseList[0]!.id;
    expect((await c.colabB!.post(`/hall/praises/${praiseId}/hide`, { reason: 'x' })).status).toBe(403);
    expect((await c.ana!.post(`/hall/praises/${praiseId}/hide`, { reason: '' })).status).toBe(422);
    const hidden = await c.ana!.post<HighlightDetail>(`/hall/praises/${praiseId}/hide`, { reason: 'Fora do tom' });
    expect(hidden.body.praiseList[0]).toMatchObject({ hidden: true, hiddenReason: 'Fora do tom' });
    expect((await c.colabB!.get<HighlightDetail>(`/hall/highlights/${hid}`)).body.praiseList).toEqual([]);
  });

  it('CA-RN-78.1 / CA-T.1 vencido vai ao Hall da fama (job idempotente); revogar exige motivo e vai ao histórico', async () => {
    const idea = await implemented('colab1', 'Troca rápida');
    const hid = (await highlight(c.gestor!, idea.code)).body.card.id;
    await t.db.dataSource.query(`UPDATE highlight SET starts_on = $2, ends_on = $3 WHERE id = $1`, [
      hid,
      addDaysToDay(today, -40),
      addDaysToDay(today, -10),
    ]);
    expect(await t.db.dataSource.transaction((m) => expireHighlights(m, today))).toBeGreaterThanOrEqual(1);
    expect(await t.db.dataSource.transaction((m) => expireHighlights(m, today))).toBe(0);
    const fame = (await c.colab2!.get<Hall>('/hall')).body.fame;
    expect(fame.flatMap((y) => y.cards.map((x) => x.id))).toContain(hid);
    const other = await implemented('colab1', 'Revogável');
    const h2 = (await highlight(c.gestor!, other.code)).body.card.id;
    expect((await c.gestor!.post(`/hall/highlights/${h2}/revoke`, { reason: '' })).status).toBe(422);
    expect((await c.colab1!.post(`/hall/highlights/${h2}/revoke`, { reason: 'x' })).status).toBe(403);
    const revoked = await c.gestor!.post<HighlightDetail>(`/hall/highlights/${h2}/revoke`, {
      reason: 'Dado errado no ganho',
    });
    expect(revoked.body.card.state).toBe('revoked');
    expect((await c.colab2!.get(`/hall/highlights/${h2}`)).status).toBe(404);
    const events: { type: string; reason: string }[] = await t.db.dataSource.query(
      `SELECT type, reason FROM idea_event WHERE type = 'highlight_revoked' AND idea_id = (SELECT id FROM idea WHERE code = $1)`,
      [other.code],
    );
    expect(events).toEqual([{ type: 'highlight_revoked', reason: 'Dado errado no ganho' }]);
  });

  it('CA-RN-72.2 / 72.3 candidatas só sugerem; recusada não volta; entrada automática só com o admin ligando', async () => {
    expect((await settings({ 'hall.suggest_min_likes': 1 })).status).toBe(200);
    const idea = await implemented('colab1', 'Candidata por curtida');
    expect((await c.colabB!.get('/hall/candidates')).status).toBe(403);
    expect((await c.ana!.request('PUT', `/ideas/${idea.code}/like`)).status).toBe(200);
    const list = await c.gestor!.get<{ code: string; reason: string }[]>('/hall/candidates');
    expect(list.body).toContainEqual(expect.objectContaining({ code: idea.code, reason: 'likes' }));
    expect((await c.colab2!.get<Hall>('/hall')).body.current.map((x) => x.idea.code)).not.toContain(idea.code); // nada sozinho
    const after = await c.gestor!.post<{ code: string }[]>(`/hall/candidates/${idea.code}/dismiss`);
    expect(after.body.map((x) => x.code)).not.toContain(idea.code);
    await c.gestor!.request('PUT', `/ideas/${idea.code}/like`);
    expect((await c.gestor!.get<{ code: string }[]>('/hall/candidates')).body.map((x) => x.code)).not.toContain(
      idea.code,
    );
    // Entrada automática (RN-72): só com a opção ligada.
    const auto = await implemented('colab1', 'Entra sozinha');
    expect((await c.ana!.request('PUT', `/ideas/${auto.code}/like`)).status).toBe(200);
    expect((await runHallJobs(t.db.dataSource)).created).toBe(0);
    expect((await settings({ 'hall.auto_entry': true })).status).toBe(200);
    expect((await runHallJobs(t.db.dataSource)).created).toBeGreaterThanOrEqual(1);
    expect((await c.colab2!.get<Hall>('/hall')).body.current.map((x) => x.idea.code)).toContain(auto.code);
    await settings({ 'hall.auto_entry': false, 'hall.suggest_min_likes': 5 });
  });

  it('RN-66 com o reconhecimento ligado, o destaque pontua uma vez (evento "destacada no Hall")', async () => {
    expect((await settings({ 'recognition.enabled': true })).status).toBe(200);
    const idea = await implemented('colab2', 'Pontua no Hall');
    await highlight(c.gestor!, idea.code);
    await highlight(admin, idea.code, { scope: 'organization' });
    const rows = await t.db.dataSource.query(
      `SELECT points FROM point_ledger WHERE event_type = 'idea_highlighted' AND idea_id = (SELECT id FROM idea WHERE code = $1)`,
      [idea.code],
    );
    expect(rows.map((r: { points: number }) => r.points)).toEqual([30]); // dois destaques, uma pontuação
  });
});
