import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User, UserStatus } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { decodeCursor, personView } from '../../src/mural/mural-common.js';
import { COMMENTS_PER_HOUR, SHARES_PER_HOUR } from '../../src/mural/mural-talk.service.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Detail {
  id: string;
  code: string;
}
interface Person {
  name: string | null;
  userId: string | null;
  photoVersion: string | null;
  label: string | null;
  revealed: boolean;
}
interface Card {
  code: string;
  title: string;
  status: string;
  category: { id: string; name: string } | null;
  entity: { id: string; name: string };
  publishedAt: string;
  people: { name: string; userId: string; role: string }[];
  reactions: Record<string, number>;
  reactionTotal: number;
  myReaction: string | null;
  commentCount: number;
  canOpen: boolean;
  canReact: boolean;
  canManage: boolean;
}
interface Feed {
  items: Card[];
  nextCursor: string | null;
}
interface CommentView {
  id: string;
  parentId: string | null;
  author: Person | null;
  body: string | null;
  state: string;
  hiddenReason: string | null;
  editedAt: string | null;
  mine: boolean;
  canEdit: boolean;
  canReport: boolean;
  reportedByMe: boolean;
  pendingReports: number;
  replies: CommentView[];
}
interface Page {
  card: Card;
  comments: CommentView[];
}
interface QueueItem {
  commentId: string;
  ideaCode: string;
  body: string;
  count: number;
  author: Person;
  reasons: { reason: string; count: number }[];
  notes: { reason: string; note: string }[];
}

describe('Mural: lista, página, reações, conversa, denúncia e envio (M21, RN-150 a RN-155, CA-T.24)', () => {
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
  const settings = (values: Record<string, unknown>) => admin.request('PATCH', '/settings', { values });
  const send = async (who: string, title: string, over: Record<string, unknown> = {}) => {
    const res = await c[who]!.post<Detail>('/ideas', {
      title,
      description: `Antes: ${title}`,
      entityId: ent.A,
      categoryId: cat.Q,
      ...over,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const approve = async (analyst: string, code: string) => {
    const res = await c[analyst]!.post(`/ideas/${code}/approve`, {
      stepName: 'Fazer',
      assigneeId: uid[analyst],
      dueDate: '2099-12-31',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  /** Ideia Em andamento e publicada pelo analista da entidade. */
  const published = async (who: string, title: string, over: Record<string, unknown> = {}, analyst = 'ana') => {
    const idea = await send(who, title, over);
    await approve(analyst, idea.code);
    expect((await c[analyst]!.post(`/mural/ideas/${idea.code}/publish`)).status).toBe(200);
    return idea;
  };
  const page = (who: Client, code: string) => who.get<Page & { code?: string }>(`/mural/ideas/${code}`);
  const comment = (who: Client, code: string, body: string, parentId?: string) =>
    who.post<CommentView[] & { code?: string }>(`/mural/ideas/${code}/comments`, { body, parentId });
  const react = (who: Client, code: string, kind: string) =>
    who.request<{ reactions: Record<string, number>; reactionTotal: number; myReaction: string | null; code?: string }>(
      'PUT',
      `/mural/ideas/${code}/reaction`,
      { kind },
    );
  const feed = (who: Client, query = '') => who.get<Feed>(`/mural${query ? `?${query}` : ''}`);
  const find = (list: CommentView[], body: string): CommentView | undefined =>
    list.flatMap((x) => [x, ...x.replies]).find((x) => x.body === body);

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    ent.Org = org.id;
    ent.A = (await tree.save(tree.create({ name: 'Unidade A', parent: org }))).id;
    ent.B = (await tree.save(tree.create({ name: 'Unidade B', parent: org }))).id;
    const cats = ds.getRepository(Category);
    cat.Q = (await cats.save(cats.create({ name: 'Qualidade', color: '#4f46e5' }))).id;
    cat.S = (await cats.save(cats.create({ name: 'Segurança', color: '#dc2626' }))).id;
    await user('ana', 'analyst', ent.A!);
    await user('anaB', 'analyst', ent.B!);
    await user('colab1', 'collaborator', ent.A!);
    await user('colab2', 'collaborator', ent.A!);
    await user('colab3', 'collaborator', ent.A!);
    await user('colabB', 'collaborator', ent.B!);
    await user('colabB2', 'collaborator', ent.B!);
    expect((await settings({ 'mural.enabled': true })).status).toBe(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('regras: como a pessoa aparece (RN-151 a RN-153) e cursor inválido', () => {
    const photos = new Map([['u1', 'u123']]);
    const ana = { id: 'u1', name: 'Ana', status: UserStatus.Active, hideName: false };
    expect(personView(ana, { participant: null, consent: null, reveal: false, photos })).toEqual({
      name: 'Ana',
      userId: 'u1',
      photoVersion: 'u123',
      label: null,
      revealed: false,
    });
    // Participante sem consentimento: "Autor da ideia" sem nada; a equipe vê, marcado.
    expect(personView(ana, { participant: 'author', consent: 'pending', reveal: false, photos })).toEqual({
      name: null,
      userId: null,
      photoVersion: null,
      label: 'author',
      revealed: false,
    });
    expect(personView(ana, { participant: 'co_author', consent: null, reveal: true, photos })).toMatchObject({
      name: 'Ana',
      label: 'co_author',
      revealed: true,
    });
    expect(personView(ana, { participant: 'author', consent: 'accepted', reveal: false, photos }).label).toBeNull();
    // Opt-out (RN-70) vence o consentimento de participante, mas não esconde quem só comenta.
    const hidden = { ...ana, hideName: true };
    expect(personView(hidden, { participant: 'author', consent: 'accepted', reveal: false, photos }).name).toBeNull();
    expect(personView(hidden, { participant: null, consent: null, reveal: false, photos }).name).toBe('Ana');
    expect(
      personView({ ...ana, status: UserStatus.Anonymized }, { participant: null, consent: null, reveal: true, photos }),
    ).toEqual({ name: null, userId: null, photoVersion: null, label: 'former', revealed: false });
    expect(() => decodeCursor('não-é-cursor')).toThrow();
    expect(() => decodeCursor(Buffer.from('{"p":"1.5","id":"x"}').toString('base64url'))).toThrow();
  });

  it('CA-RN-148.1 desligado: lista, página, reação, conversa e fila respondem 404', async () => {
    const idea = await published('colab1', 'Antes de desligar');
    expect((await settings({ 'mural.enabled': false })).status).toBe(200);
    expect((await feed(c.colabB!)).status).toBe(404);
    expect((await page(c.colabB!, idea.code)).status).toBe(404);
    expect((await react(c.colabB!, idea.code, 'like')).status).toBe(404);
    expect((await comment(c.colabB!, idea.code, 'Oi')).status).toBe(404);
    expect((await c.ana!.get('/mural/reports')).status).toBe(404);
    expect((await settings({ 'mural.enabled': true })).status).toBe(200);
    expect((await page(c.colabB!, idea.code)).status).toBe(200);
  });

  it('CA-RN-150.1 / 150.2 / 151.4 / 151.5 / CA-T.24 o mural não abre a ideia nem revela quem não consentiu', async () => {
    const idea = await send('colab1', 'Gabarito na prensa', {
      description: 'SEGREDO-DESCRICAO da linha 3',
      proposedSolution: 'SEGREDO-SOLUCAO com fornecedor',
    });
    expect((await c.colab2!.post(`/ideas/${idea.code}/support`, {})).status).toBe(200);
    await c.ana!.post(`/ideas/${idea.code}/comments`, { body: 'SEGREDO-INTERNO', visibility: 'internal' });
    await c.ana!.post(`/ideas/${idea.code}/comments`, { body: 'SEGREDO-PUBLICO da ideia' });
    expect(
      (
        await c.colab1!.upload(
          `/ideas/${idea.code}/attachments`,
          'segredo-anexo.pdf',
          Buffer.from('%PDF-1.4'),
          'application/pdf',
        )
      ).status,
    ).toBe(201);
    await approve('ana', idea.code);
    await c.ana!.post(`/mural/ideas/${idea.code}/publish`);
    // O co-autor consente; o autor não responde (fica anônimo) e comenta como "Autor da ideia".
    await c.colab2!.request('PUT', `/mural/ideas/${idea.code}/consent`, { accept: true });
    await comment(c.colab1!, idea.code, 'Obrigado a todos');
    await react(c.colabB!, idea.code, 'brilliant');
    await comment(c.colabB!, idea.code, 'Que boa ideia');

    // Varredura de todas as rotas do mural como colaborador de outra entidade (a busca de colegas é um
    // diretório que não liga ninguém a ideia nenhuma, por isso fica de fora).
    const routes = [
      '/mural',
      '/mural?sort=reactions',
      `/mural?entityId=${ent.A}`,
      `/mural/ideas/${idea.code}`,
      `/mural/ideas/${idea.code}/reactions`,
      `/mural/ideas/${idea.code}/reactions?kind=brilliant`,
    ];
    for (const route of routes) {
      const res = await c.colabB!.get(route);
      expect(res.status, route).toBe(200);
      const text = JSON.stringify(res.body);
      for (const secret of ['SEGREDO', 'segredo-anexo', 'Antes: ', uid.colab1!, 'Pessoa colab1']) {
        expect(text, `${route} vazou ${secret}`).not.toContain(secret);
      }
    }
    const view = (await page(c.colabB!, idea.code)).body;
    expect(Object.keys(view.card).sort()).toEqual(
      [
        'canManage',
        'canOpen',
        'canReact',
        'category',
        'code',
        'commentCount',
        'entity',
        'myReaction',
        'people',
        'publishedAt',
        'reactionTotal',
        'reactions',
        'status',
        'title',
      ].sort(),
    );
    expect(view.card).toMatchObject({ canOpen: false, canReact: true, canManage: false, commentCount: 2 });
    expect(view.card.people).toEqual([
      { name: 'Pessoa colab2', userId: uid.colab2, photoVersion: null, role: 'co_author' },
    ]);
    expect(find(view.comments, 'Obrigado a todos')?.author).toEqual({
      name: null,
      userId: null,
      photoVersion: null,
      label: 'author',
      revealed: false,
    });
    expect(find(view.comments, 'Que boa ideia')?.author).toMatchObject({ name: 'Pessoa colabB', label: null });
    // Publicar não abre a ideia (CA-T.5).
    for (const path of [`/ideas/${idea.code}`, `/ideas/${idea.code}/attachments`]) {
      expect((await c.colabB!.get(path)).status).toBe(404);
    }
    // A equipe vê quem é (revelado); o autor abre a ideia e não reage a ela.
    expect(find((await page(c.ana!, idea.code)).body.comments, 'Obrigado a todos')?.author).toMatchObject({
      name: 'Pessoa colab1',
      label: 'author',
      revealed: true,
    });
    expect((await page(c.ana!, idea.code)).body.card).toMatchObject({ canOpen: true, canManage: true });
    const own = (await page(c.colab1!, idea.code)).body;
    expect(own.card).toMatchObject({ canOpen: true, canReact: false });
    expect(find(own.comments, 'Obrigado a todos')).toMatchObject({ mine: true, canEdit: true });
  });

  it('CA-RN-151.3 opt-out de nome e anonimização vencem o consentimento', async () => {
    const idea = await published('colab3', 'Com opt-out');
    await c.colab3!.request('PUT', `/mural/ideas/${idea.code}/consent`, { accept: true });
    expect((await page(c.colabB!, idea.code)).body.card.people.map((p) => p.name)).toEqual(['Pessoa colab3']);
    await c.colab3!.request('PATCH', '/auth/me/preferences', { hideName: true });
    expect((await page(c.colabB!, idea.code)).body.card.people).toEqual([]);
    await c.colab3!.request('PATCH', '/auth/me/preferences', { hideName: false });
    expect((await page(c.colabB!, idea.code)).body.card.people).toHaveLength(1);
  });

  it('CA-RN-150.3 sem sessão não há mural', async () => {
    expect((await new Client(t.baseUrl).get('/mural')).status).toBe(401);
  });

  it('CA-RN-150.4 / 150.5 ordem pela publicação ou por reações; filtros por situação, categoria e entidade', async () => {
    const first = await published('colab2', 'Ordem 1');
    const second = await published('colab2', 'Ordem 2', { categoryId: cat.S });
    const fromB = await published('colabB', 'Da unidade B', { entityId: ent.B }, 'anaB');
    await react(c.colabB2!, first.code, 'like');
    await react(c.colab3!, first.code, 'support');
    await react(c.colab3!, fromB.code, 'like');
    const recent = (await feed(c.colabB!)).body.items.map((i) => i.code);
    expect(recent.slice(0, 3)).toEqual([fromB.code, second.code, first.code]);
    const byReactions = (await feed(c.colabB!, 'sort=reactions')).body.items;
    expect(byReactions.findIndex((i) => i.code === first.code)).toBeLessThan(
      byReactions.findIndex((i) => i.code === fromB.code),
    );
    for (let i = 1; i < byReactions.length; i++) {
      expect(byReactions[i - 1]!.reactionTotal).toBeGreaterThanOrEqual(byReactions[i]!.reactionTotal);
    }
    const codes = async (q: string) => (await feed(c.colabB!, q)).body.items.map((i) => i.code);
    expect(await codes(`entityId=${ent.B}`)).toEqual([fromB.code]);
    expect(await codes(`entityId=${ent.A}`)).not.toContain(fromB.code);
    expect(await codes(`entityId=${ent.Org}`)).toContain(fromB.code); // com as sub-entidades
    expect(await codes(`categoryId=${cat.S}`)).toEqual([second.code]);
    expect(await codes(`categoryId=${cat.S}&entityId=${ent.B}`)).toEqual([]);
    expect(await codes('status=implemented')).toEqual([]);
    expect((await codes('status=in_progress&status=implemented')).length).toBeGreaterThan(2);
    expect((await feed(c.colabB!, 'sort=popular')).status).toBe(422);
  });

  it('CA-RN-150.6 páginas de 20 por cursor estável: publicar no meio não repete nem pula', async () => {
    for (let i = 0; i < 22; i++) await published('colab2', `Página ${i}`);
    const p1 = (await feed(c.colabB!)).body;
    expect(p1.items).toHaveLength(20);
    expect(p1.nextCursor).not.toBeNull();
    const late = await published('colab2', 'Chegou no meio');
    const seen = [...p1.items.map((i) => i.code)];
    let cursor = p1.nextCursor;
    while (cursor) {
      const next = (await feed(c.colabB!, `cursor=${encodeURIComponent(cursor)}`)).body;
      seen.push(...next.items.map((i) => i.code));
      cursor = next.nextCursor;
    }
    expect(new Set(seen).size).toBe(seen.length); // nada repetido
    const all: { code: string }[] = await t.db.dataSource.query(
      `SELECT i.code FROM mural_post p JOIN idea i ON i.id = p.idea_id WHERE p.status = 'published'`,
    );
    // Tudo o que já estava publicado aparece uma vez; só a recém-chegada fica para a próxima carga.
    expect([...seen].sort()).toEqual(
      all
        .map((a) => a.code)
        .filter((code) => code !== late.code)
        .sort(),
    );
    // Cursor de uma ordem não vale na outra.
    expect((await feed(c.colabB!, `sort=reactions&cursor=${encodeURIComponent(p1.nextCursor!)}`)).status).toBe(422);
  });

  it('CA-RN-152.1 a 152.5 reagir, trocar, tirar; uma por pessoa; participante não reage; lista; sem pontos', async () => {
    expect((await settings({ 'recognition.enabled': true })).status).toBe(200);
    const idea = await send('colab1', 'Reações');
    expect((await c.colab2!.post(`/ideas/${idea.code}/support`, {})).status).toBe(200);
    await approve('ana', idea.code);
    await c.ana!.post(`/mural/ideas/${idea.code}/publish`);
    const points = async () =>
      Number(((await t.db.dataSource.query('SELECT count(*) AS n FROM point_ledger')) as { n: string }[])[0]?.n);
    const before = await points();

    expect((await react(c.colabB!, idea.code, 'brilliant')).body).toMatchObject({
      reactionTotal: 1,
      myReaction: 'brilliant',
    });
    const changed = await react(c.colabB!, idea.code, 'congrats');
    expect(changed.body).toMatchObject({ reactionTotal: 1, myReaction: 'congrats' });
    expect(changed.body.reactions).toMatchObject({ congrats: 1, brilliant: 0 });
    const removed = await c.colabB!.request<{ reactionTotal: number; myReaction: string | null }>(
      'DELETE',
      `/mural/ideas/${idea.code}/reaction`,
    );
    expect(removed.body).toMatchObject({ reactionTotal: 0, myReaction: null });
    // Em paralelo, continua uma só (CA-T.2).
    await Promise.all([react(c.colabB!, idea.code, 'like'), react(c.colabB!, idea.code, 'support')]);
    expect((await page(c.colabB!, idea.code)).body.card.reactionTotal).toBe(1);
    expect((await react(c.colabB!, idea.code, 'love')).status).toBe(422);
    // Autor e co-autor não reagem à própria ideia (RN-151).
    expect((await react(c.colab1!, idea.code, 'like')).body).toMatchObject({ code: 'own_idea' });
    expect((await react(c.colab2!, idea.code, 'like')).status).toBe(403);
    // Lista de quem reagiu, por tipo; anonimizado vira "Ex-colaborador".
    await react(c.colabB2!, idea.code, 'inspiring');
    const list = await c.colab3!.get<{ person: Person; kind: string }[]>(`/mural/ideas/${idea.code}/reactions`);
    expect(list.body.map((r) => r.person.name).sort()).toEqual(['Pessoa colabB', 'Pessoa colabB2']);
    const inspiring = await c.colab3!.get<{ person: Person; kind: string }[]>(
      `/mural/ideas/${idea.code}/reactions?kind=inspiring`,
    );
    expect(inspiring.body).toEqual([
      { person: expect.objectContaining({ name: 'Pessoa colabB2' }), kind: 'inspiring' },
    ]);
    await t.db.dataSource.getRepository(User).update(uid.colabB2!, { status: UserStatus.Anonymized });
    const after = await c.colab3!.get<{ person: Person }[]>(`/mural/ideas/${idea.code}/reactions?kind=inspiring`);
    expect(after.body[0]?.person).toEqual({
      name: null,
      userId: null,
      photoVersion: null,
      label: 'former',
      revealed: false,
    });
    await t.db.dataSource.getRepository(User).update(uid.colabB2!, { status: UserStatus.Active });
    // Sem pontos e sem mexer nas curtidas do Hall.
    expect(await points()).toBe(before);
    const likes: { n: string }[] = await t.db.dataSource.query(
      'SELECT count(*) AS n FROM idea_like WHERE idea_id = $1',
      [idea.id],
    );
    expect(Number(likes[0]?.n)).toBe(0);
    expect((await settings({ 'recognition.enabled': false })).status).toBe(200);
  });

  it('CA-RN-153.1 / 153.2 / 153.3 conversa separada da ideia; na hora; texto puro; resposta em um nível', async () => {
    const idea = await published('colab1', 'Conversa');
    await c.ana!.post(`/ideas/${idea.code}/comments`, { body: 'Comentário da ideia' });
    const list = (await comment(c.colabB!, idea.code, '<script>alert(1)</script> legal')).body;
    const top = find(list, '<script>alert(1)</script> legal');
    expect(top?.author?.name).toBe('Pessoa colabB');
    expect(find((await page(c.colab3!, idea.code)).body.comments, 'Comentário da ideia')).toBeUndefined();
    const ideaComments = await c.colab1!.get<{ comments: { body: string }[] }>(`/ideas/${idea.code}`);
    expect(JSON.stringify(ideaComments.body)).not.toContain('alert(1)');
    expect((await comment(c.colabB!, idea.code, 'x'.repeat(2001))).status).toBe(422);
    expect((await comment(c.colabB!, idea.code, '   ')).status).toBe(422);
    const reply = find((await comment(c.colab3!, idea.code, 'Resposta', top!.id)).body, 'Resposta');
    const nested = (await comment(c.colabB2!, idea.code, 'Resposta à resposta', reply!.id)).body;
    expect(find(nested, 'Resposta à resposta')?.parentId).toBe(top!.id);
    expect(nested.find((x) => x.id === top!.id)?.replies.map((r) => r.body)).toEqual([
      'Resposta',
      'Resposta à resposta',
    ]);
    expect((await comment(c.colab3!, idea.code, 'Órfã', '00000000-0000-4000-8000-000000000000')).status).toBe(422);
  });

  it('CA-RN-153.4 / 153.5 editar marca "editado" e guarda o anterior para a equipe; apagar com e sem respostas', async () => {
    const idea = await published('colab1', 'Edição');
    const mine = find((await comment(c.colabB!, idea.code, 'Primeira versão')).body, 'Primeira versão')!;
    expect((await c.colab3!.request('PATCH', `/mural/comments/${mine.id}`, { body: 'Invasão' })).status).toBe(403);
    const edited = await c.colabB!.request<CommentView[]>('PATCH', `/mural/comments/${mine.id}`, {
      body: 'Segunda versão',
    });
    expect(find(edited.body, 'Segunda versão')?.editedAt).not.toBeNull();
    expect((await c.colabB!.get(`/mural/comments/${mine.id}/revisions`)).status).toBe(403);
    const revs = await c.ana!.get<{ body: string }[]>(`/mural/comments/${mine.id}/revisions`);
    expect(revs.body.map((r) => r.body)).toEqual(['Primeira versão']);

    const lonely = find((await comment(c.colabB!, idea.code, 'Vou apagar')).body, 'Vou apagar')!;
    expect((await c.colab3!.request('DELETE', `/mural/comments/${lonely.id}`)).status).toBe(403);
    const gone = await c.colabB!.request<CommentView[]>('DELETE', `/mural/comments/${lonely.id}`);
    expect(gone.body.some((x) => x.id === lonely.id)).toBe(false);

    await comment(c.colab3!, idea.code, 'Respondi', mine.id);
    const kept = await c.colabB!.request<CommentView[]>('DELETE', `/mural/comments/${mine.id}`);
    const placeholder = kept.body.find((x) => x.id === mine.id);
    expect(placeholder).toMatchObject({ state: 'deleted', body: null, author: null, mine: false });
    expect(placeholder?.replies.map((r) => r.body)).toEqual(['Respondi']);
    expect((await c.colabB!.request('PATCH', `/mural/comments/${mine.id}`, { body: 'Volta' })).status).toBe(404);
  });

  it('CA-RN-153.6 / 153.7 oculto não se edita; limite por hora; retirada esconde a conversa e a volta devolve', async () => {
    const idea = await published('colab1', 'Limites');
    const target = find((await comment(c.colabB!, idea.code, 'Vai ser oculto')).body, 'Vai ser oculto')!;
    await c.ana!.post(`/mural/comments/${target.id}/hide`, { reason: 'Fora do assunto' });
    expect((await c.colabB!.request('PATCH', `/mural/comments/${target.id}`, { body: 'Mudei' })).status).toBe(409);

    // Limite, com uma pessoa que ainda não comentou nada (o contador é por pessoa, de todas as ideias).
    await user('falador', 'collaborator', ent.B!);
    const spam = await published('colab1', 'Muitos comentários');
    for (let i = 0; i < COMMENTS_PER_HOUR; i++) {
      expect((await comment(c.falador!, spam.code, `Comentário ${i}`)).status).toBe(200);
    }
    expect((await comment(c.falador!, spam.code, 'Mais um')).body).toMatchObject({ code: 'too_many_comments' });
    expect((await comment(c.colab3!, spam.code, 'Outra pessoa pode')).status).toBe(200);

    expect((await c.ana!.post(`/mural/ideas/${idea.code}/withdraw`, { reason: 'Revisar' })).status).toBe(200);
    const withdrawn = await page(c.colabB!, idea.code);
    expect([withdrawn.status, withdrawn.body.code]).toEqual([404, 'mural_withdrawn']);
    expect((await comment(c.colab3!, idea.code, 'Ainda dá?')).status).toBe(404);
    expect((await c.ana!.get(`/mural/comments/${target.id}/revisions`)).status).toBe(404);
    expect((await c.ana!.post(`/mural/ideas/${idea.code}/publish`)).status).toBe(200);
    expect((await page(c.ana!, idea.code)).body.comments.map((x) => x.body)).toEqual(['Vai ser oculto']);
  });

  it('CA-RN-154.1 a 154.4 denunciar, fila, ocultar com motivo, dispensar, restaurar e auditoria sem o texto', async () => {
    const idea = await published('colab1', 'Moderação');
    const bad = find((await comment(c.colab2!, idea.code, 'Texto ofensivo')).body, 'Texto ofensivo')!;
    const meh = find((await comment(c.colab2!, idea.code, 'Fora do tema')).body, 'Fora do tema')!;
    const report = (who: Client, id: string, reason = 'offensive', note?: string) =>
      who.post<CommentView[] & { code?: string }>(`/mural/comments/${id}/report`, { reason, note });
    const reported = await report(c.colabB!, bad.id, 'offensive', 'Xingou a equipe');
    expect(reported.status).toBe(200);
    expect(find(reported.body, 'Texto ofensivo')).toMatchObject({
      reportedByMe: true,
      canReport: false,
      pendingReports: 0,
    });
    expect((await report(c.colabB!, bad.id)).body).toMatchObject({ code: 'already_reported' });
    expect((await report(c.colab2!, bad.id)).body).toMatchObject({ code: 'own_comment' });
    expect((await report(c.colabB!, bad.id, 'spam')).status).toBe(422);
    await report(c.colab3!, bad.id, 'personal_data');
    await report(c.colab3!, meh.id, 'off_topic');

    // A fila: só a equipe da entidade; quem denunciou não aparece.
    expect((await c.colabB!.get('/mural/reports')).status).toBe(403);
    expect((await c.anaB!.get<QueueItem[]>('/mural/reports')).body).toEqual([]);
    const queue = (await c.ana!.get<QueueItem[]>('/mural/reports')).body.filter((q) => q.ideaCode === idea.code);
    const item = queue.find((q) => q.commentId === bad.id)!;
    expect(item).toMatchObject({
      body: 'Texto ofensivo',
      count: 2,
      notes: [{ reason: 'offensive', note: 'Xingou a equipe' }],
    });
    expect(item.reasons.sort((a, b) => a.reason.localeCompare(b.reason))).toEqual([
      { reason: 'offensive', count: 1 },
      { reason: 'personal_data', count: 1 },
    ]);
    expect(JSON.stringify(queue)).not.toContain(uid.colabB!);
    expect(find((await page(c.ana!, idea.code)).body.comments, 'Texto ofensivo')?.pendingReports).toBe(2);

    // Ocultar: sem motivo não; sem permissão não; quem escreveu vê o motivo, os outros o aviso.
    expect((await c.ana!.post(`/mural/comments/${bad.id}/hide`, { reason: '' })).status).toBe(422);
    expect((await c.anaB!.post(`/mural/comments/${bad.id}/hide`, { reason: 'x' })).status).toBe(403);
    expect((await c.colab3!.post(`/mural/comments/${bad.id}/hide`, { reason: 'x' })).status).toBe(403);
    expect((await c.ana!.post(`/mural/comments/${bad.id}/hide`, { reason: 'Linguagem ofensiva' })).status).toBe(200);
    const writer = (await page(c.colab2!, idea.code)).body.comments.find((x) => x.id === bad.id);
    expect(writer).toMatchObject({ state: 'hidden', body: 'Texto ofensivo', hiddenReason: 'Linguagem ofensiva' });
    const other = (await page(c.colabB!, idea.code)).body.comments.find((x) => x.id === bad.id);
    expect(other).toMatchObject({ state: 'hidden', body: null, hiddenReason: null, canReport: false });
    expect((await page(c.colabB!, idea.code)).body.card.commentCount).toBe(1);
    expect((await c.ana!.get<QueueItem[]>('/mural/reports')).body.some((q) => q.commentId === bad.id)).toBe(false);
    expect((await report(c.colabB2!, bad.id)).body).toMatchObject({ code: 'comment_hidden' });

    // Dispensar a outra; sem pendência → 409; restaurar a oculta.
    expect((await c.anaB!.post(`/mural/comments/${meh.id}/dismiss`)).status).toBe(403);
    expect((await c.ana!.post(`/mural/comments/${meh.id}/dismiss`)).status).toBe(200);
    expect((await c.ana!.post(`/mural/comments/${meh.id}/dismiss`)).status).toBe(409);
    expect((await c.ana!.post(`/mural/comments/${bad.id}/restore`)).status).toBe(200);
    expect((await c.ana!.post(`/mural/comments/${bad.id}/restore`)).status).toBe(409);
    expect((await page(c.colabB!, idea.code)).body.comments.find((x) => x.id === bad.id)?.body).toBe('Texto ofensivo');

    const audit: { action: string; data: Record<string, unknown> }[] = await t.db.dataSource.query(
      `SELECT action, data FROM audit_log WHERE target_id = ANY($1) ORDER BY id`,
      [[bad.id, meh.id]],
    );
    expect(audit.map((a) => a.action)).toEqual([
      'mural.comment_hidden',
      'mural.reports_dismissed',
      'mural.comment_restored',
    ]);
    expect(audit[0]?.data).toMatchObject({ ideaCode: idea.code, reports: 2 });
    expect(JSON.stringify(audit)).not.toMatch(/ofensivo|Fora do tema|Xingou/);
  });

  it('CA-RN-155.1 / 155.2 enviar a um colega: pessoa ativa, mensagem curta e limite por hora', async () => {
    const idea = await published('colab1', 'Para compartilhar');
    const share = (who: Client, recipientId: string, message?: string) =>
      who.post<{ code?: string }>(`/mural/ideas/${idea.code}/share`, { recipientId, message });
    expect((await share(c.colabB!, uid.colab3!, 'Olha que legal')).status).toBe(204);
    const rows: { sender_id: string; recipient_id: string; message: string }[] = await t.db.dataSource.query(
      'SELECT sender_id, recipient_id, message FROM mural_share WHERE idea_id = $1',
      [idea.id],
    );
    expect(rows).toEqual([{ sender_id: uid.colabB, recipient_id: uid.colab3, message: 'Olha que legal' }]);
    expect((await share(c.colabB!, uid.colabB!)).status).toBe(422);
    expect((await share(c.colabB!, '00000000-0000-4000-8000-000000000000')).status).toBe(422);
    expect((await share(c.colabB!, uid.colab3!, 'x'.repeat(301))).status).toBe(422);
    await t.db.dataSource.getRepository(User).update(uid.colab2!, { status: UserStatus.Disabled });
    expect((await share(c.colabB!, uid.colab2!)).body).toMatchObject({ code: 'invalid_recipient' });
    await t.db.dataSource.getRepository(User).update(uid.colab2!, { status: UserStatus.Active });
    for (let i = 1; i < SHARES_PER_HOUR; i++) expect((await share(c.colabB!, uid.colab3!)).status).toBe(204);
    expect((await share(c.colabB!, uid.colab3!)).body).toMatchObject({ code: 'too_many_shares' });
    // A busca de colegas traz nome e foto, nunca o e-mail, e não traz quem busca.
    const people = await c.colab3!.get<Record<string, unknown>[]>('/mural/people?search=colab');
    expect(people.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(people.body)).not.toContain('@example.test');
    expect(people.body.some((p) => p.id === uid.colab3)).toBe(false);
  });
});
