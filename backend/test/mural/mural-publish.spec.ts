import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdeaStatus } from '../../src/ideas/entities/idea.entity.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { FACTORY_ROLES } from '../../src/identity-access/factory-roles.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { autoWithdrawCause, isPublishable, muralShowsName } from '../../src/mural/mural-rules.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Detail {
  id: string;
  code: string;
  status: string;
  steps: { id: string }[];
}
interface Publication {
  status: 'none' | 'published' | 'withdrawn';
  publishable: boolean;
  publishedAt: string | null;
  withdrawnReason: string | null;
  withdrawnAutomatically: boolean;
  canManage: boolean;
  myConsent: string | null;
}

describe('Mural: módulo, publicar, retirar e consentimento (M21, RN-148, RN-149, RN-151)', () => {
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
  const inProgress = async (who: string, title: string) => {
    const idea = await send(who, title);
    const d = await approve(idea.code);
    return { ...idea, steps: d.steps };
  };
  const publish = (who: Client, ref: string) =>
    who.post<Publication & { code?: string }>(`/mural/ideas/${ref}/publish`);
  const withdraw = (who: Client, ref: string, reason = 'Pediram para tirar') =>
    who.post<Publication & { code?: string }>(`/mural/ideas/${ref}/withdraw`, { reason });
  const publication = (who: Client, ref: string) => who.get<Publication>(`/mural/ideas/${ref}/publication`);
  const events = (ideaId: string): Promise<{ type: string; actor_id: string | null; reason: string | null }[]> =>
    t.db.dataSource.query(
      `SELECT type, actor_id, reason FROM idea_event WHERE idea_id = $1 AND type LIKE 'mural_%' ORDER BY id`,
      [ideaId],
    );
  const audits = (
    ideaId: string,
  ): Promise<{ action: string; actor_id: string | null; data: Record<string, unknown> }[]> =>
    t.db.dataSource.query(
      `SELECT action, actor_id, data FROM audit_log WHERE target_id = $1 AND action LIKE 'mural.%' ORDER BY id`,
      [ideaId],
    );

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
    await user('anaB', 'analyst', ent.B!);
    await user('gestor', 'manager', ent.A!);
    await user('colab1', 'collaborator', ent.A!);
    await user('colab2', 'collaborator', ent.A!);
    await user('colabB', 'collaborator', ent.B!);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('regras: só Em andamento e Implementada; retirada automática; nome só com aceite e sem opt-out', () => {
    expect(isPublishable(IdeaStatus.InProgress)).toBe(true);
    expect(isPublishable(IdeaStatus.Implemented)).toBe(true);
    for (const s of [IdeaStatus.Submitted, IdeaStatus.InReview, IdeaStatus.Rejected])
      expect(isPublishable(s)).toBe(false);
    expect(autoWithdrawCause('status_changed', { from: 'in_progress', to: 'rejected' })).toBe('idea_rejected');
    expect(autoWithdrawCause('archived', {})).toBe('idea_archived');
    expect(autoWithdrawCause('status_changed', { to: 'implemented' })).toBeNull();
    expect(autoWithdrawCause('reopened', { to: 'in_progress' })).toBeNull();
    expect(muralShowsName('accepted', { hideName: false, active: true })).toBe(true);
    expect(muralShowsName('pending', { hideName: false, active: true })).toBe(false);
    expect(muralShowsName(null, { hideName: false, active: true })).toBe(false);
    expect(muralShowsName('accepted', { hideName: true, active: true })).toBe(false);
    expect(muralShowsName('accepted', { hideName: false, active: false })).toBe(false);
  });

  it('CA-RN-148.4 Analista e Administrador têm mural.manage; Colaborador e Gestor não; só setting.manage liga', async () => {
    const roles = Object.fromEntries(FACTORY_ROLES.map((r) => [r.key, r.permissions]));
    expect(roles.analyst).toContain('mural.manage');
    expect(roles.admin).toContain('mural.manage');
    expect(roles.collaborator).not.toContain('mural.manage');
    expect(roles.manager).not.toContain('mural.manage');
    const grants: { system_key: string }[] = await t.db.dataSource.query(
      `SELECT r.system_key FROM role_permission p JOIN role r ON r.id = p.role_id WHERE p.permission = 'mural.manage' ORDER BY 1`,
    );
    expect(grants.map((g) => g.system_key)).toEqual(['admin', 'analyst']);
    expect((await c.ana!.request('PATCH', '/settings', { values: { 'mural.enabled': true } })).status).toBe(403);
  });

  it('CA-RN-148.1 desligado (padrão): as rotas do mural respondem 404 e nada é gravado', async () => {
    const idea = await inProgress('colab1', 'Mural desligado');
    expect((await publish(c.ana!, idea.code)).status).toBe(404);
    expect((await publication(c.ana!, idea.code)).status).toBe(404);
    expect((await c.colab1!.request('PUT', `/mural/ideas/${idea.code}/consent`, { accept: true })).status).toBe(404);
    expect(await events(idea.id)).toEqual([]);
    const pub = await admin.get<{ mural: { enabled: boolean } }>('/settings/public');
    expect(pub.body.mural).toEqual({ enabled: false });
  });

  it('CA-RN-148.3 ligar e desligar vai para a auditoria e aparece nas configurações públicas', async () => {
    expect((await settings({ 'mural.enabled': true })).status).toBe(200);
    const rows: { data: { before: unknown; after: unknown } }[] = await t.db.dataSource.query(
      `SELECT data FROM audit_log WHERE action = 'setting.updated' AND target_id = 'mural.enabled'`,
    );
    expect(rows.map((r) => [r.data.before, r.data.after])).toEqual([[false, true]]);
    expect((await admin.get<{ mural: { enabled: boolean } }>('/settings/public')).body.mural).toEqual({
      enabled: true,
    });
  });

  it('CA-RN-149.1 / 149.6 o analista publica; histórico e auditoria; o colaborador de outra entidade continua sem abrir a ideia', async () => {
    const idea = await inProgress('colab1', 'Gabarito na prensa');
    const before = await publication(c.ana!, idea.code);
    expect(before.body).toMatchObject({ status: 'none', publishable: true, canManage: true, myConsent: null });
    const res = await publish(c.ana!, idea.code);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'published', canManage: true });
    expect(res.body.publishedAt).not.toBeNull();
    expect(await events(idea.id)).toEqual([{ type: 'mural_published', actor_id: uid.ana, reason: null }]);
    expect((await audits(idea.id)).map((a) => [a.action, a.actor_id, a.data.republished])).toEqual([
      ['mural.published', uid.ana, false],
    ]);
    // Publicar não abre a ideia (CA-RN-150.2, CA-T.5): quem não a via continua sem vê-la.
    expect((await c.colabB!.get(`/ideas/${idea.code}`)).status).toBe(404);
    expect((await publication(c.colabB!, idea.code)).status).toBe(404);
    // O autor vê o estado e o consentimento pendente (RN-151).
    expect((await publication(c.colab1!, idea.code)).body).toMatchObject({
      status: 'published',
      canManage: false,
      myConsent: 'pending',
    });
  });

  it('CA-RN-149.2 só Em andamento ou Implementada; sem mural.manage → 403; quem nem vê a ideia → 404', async () => {
    const sent = await send('colab1', 'Ainda enviada');
    expect((await publish(c.ana!, sent.code)).body).toMatchObject({ code: 'not_publishable' });
    await c.ana!.post(`/ideas/${sent.code}/start-review`);
    expect((await publish(c.ana!, sent.code)).status).toBe(422); // Em análise
    await c.ana!.post(`/ideas/${sent.code}/reject`, { reason: 'Fora do escopo' });
    expect((await publish(c.ana!, sent.code)).status).toBe(422); // Não autorizada

    const idea = await inProgress('colab1', 'Sem permissão');
    expect((await publish(c.colab1!, idea.code)).status).toBe(403); // o autor vê a ideia, mas não publica
    expect((await publish(c.gestor!, idea.code)).status).toBe(403);
    expect((await publish(c.anaB!, idea.code)).status).toBe(404); // analista de outra entidade nem vê
    expect((await publish(c.colabB!, idea.code)).status).toBe(404);
    expect((await publish(c.ana!, 'ITS-2099-9999')).status).toBe(404);
    // Já no mural, todos a enxergam lá: a recusa passa a ser 403.
    expect((await publish(c.ana!, idea.code)).status).toBe(200);
    expect((await withdraw(c.anaB!, idea.code)).status).toBe(403);
    expect((await withdraw(c.colabB!, idea.code)).status).toBe(403);
  });

  it('CA-RN-149.3 retirar exige motivo; retirada some; publicar de novo reaproveita a publicação', async () => {
    const idea = await inProgress('colab1', 'Kanban de peças');
    expect((await withdraw(c.ana!, idea.code)).body).toMatchObject({ code: 'not_published' });
    await publish(c.ana!, idea.code);
    expect((await publish(c.ana!, idea.code)).body).toMatchObject({ code: 'already_published' });
    expect((await withdraw(c.ana!, idea.code, '')).status).toBe(422);
    expect((await withdraw(c.ana!, idea.code, '   ')).status).toBe(422);
    const out = await withdraw(c.ana!, idea.code, 'Contém dado de fornecedor');
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      status: 'withdrawn',
      withdrawnReason: 'Contém dado de fornecedor',
      withdrawnAutomatically: false,
    });
    const again = await publish(c.ana!, idea.code);
    expect(again.body).toMatchObject({ status: 'published', withdrawnReason: null });
    expect(await events(idea.id)).toEqual([
      { type: 'mural_published', actor_id: uid.ana, reason: null },
      { type: 'mural_withdrawn', actor_id: uid.ana, reason: 'Contém dado de fornecedor' },
      { type: 'mural_published', actor_id: uid.ana, reason: null },
    ]);
    expect((await audits(idea.id)).map((a) => [a.action, a.data.republished ?? a.data.automatic])).toEqual([
      ['mural.published', false],
      ['mural.withdrawn', false],
      ['mural.published', true],
    ]);
    const rows: { n: string }[] = await t.db.dataSource.query(
      'SELECT count(*) AS n FROM mural_post WHERE idea_id = $1',
      [idea.id],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('CA-RN-149.4 interromper ou arquivar retira sozinho (autor: o sistema); reabrir não publica de novo; excluir apaga junto', async () => {
    const interrupted = await inProgress('colab1', 'Vai ser interrompida');
    await publish(c.ana!, interrupted.code);
    expect((await c.ana!.post(`/ideas/${interrupted.code}/interrupt`, { reason: 'Sem verba' })).status).toBe(200);
    expect((await publication(c.ana!, interrupted.code)).body).toMatchObject({
      status: 'withdrawn',
      withdrawnReason: 'idea_rejected',
      withdrawnAutomatically: true,
      publishable: false,
    });
    expect((await events(interrupted.id)).at(-1)).toEqual({
      type: 'mural_withdrawn',
      actor_id: null,
      reason: 'idea_rejected',
    });
    expect((await audits(interrupted.id)).at(-1)).toMatchObject({
      action: 'mural.withdrawn',
      actor_id: null,
      data: { automatic: true, cause: 'idea_rejected' },
    });
    expect((await admin.post(`/ideas/${interrupted.code}/reopen`, { reason: 'Verba saiu' })).status).toBe(200);
    expect((await publication(c.ana!, interrupted.code)).body.status).toBe('withdrawn');

    const archived = await inProgress('colab1', 'Vai ser arquivada');
    await publish(c.ana!, archived.code);
    expect((await c.ana!.post(`/ideas/${archived.code}/archive`, { reason: 'Duplicada' })).status).toBe(200);
    const [post] = await t.db.dataSource.query('SELECT status, withdrawn_reason FROM mural_post WHERE idea_id = $1', [
      archived.id,
    ]);
    expect(post).toEqual({ status: 'withdrawn', withdrawn_reason: 'idea_archived' });

    const purged = await inProgress('colab1', 'Vai ser excluída');
    await publish(c.ana!, purged.code);
    expect((await admin.request('DELETE', `/ideas/${purged.code}`)).status).toBe(204);
    const left: { n: string }[] = await t.db.dataSource.query(
      'SELECT count(*) AS n FROM mural_post WHERE idea_id = $1',
      [purged.id],
    );
    expect(Number(left[0]?.n)).toBe(0);
  });

  it('CA-RN-149.5 implementar e reabrir uma Implementada mantêm a publicação', async () => {
    const idea = await inProgress('colab1', 'Vai ser implementada');
    await publish(c.ana!, idea.code);
    await c.ana!.post(`/ideas/${idea.code}/steps/${idea.steps[0]!.id}/complete`);
    expect((await c.ana!.post(`/ideas/${idea.code}/implement`, { resultText: 'Depois: ok' })).status).toBe(200);
    expect((await publication(c.ana!, idea.code)).body).toMatchObject({ status: 'published', publishable: true });
    expect((await admin.post(`/ideas/${idea.code}/reopen`, { reason: 'Faltou medir' })).status).toBe(200);
    expect((await publication(c.ana!, idea.code)).body.status).toBe('published');
    expect((await events(idea.id)).map((e) => e.type)).toEqual(['mural_published']);
  });

  it('CA-RN-149.7 publicar duas vezes em paralelo grava uma publicação só', async () => {
    const idea = await inProgress('colab1', 'Em paralelo');
    const results = await Promise.all([publish(c.ana!, idea.code), publish(admin, idea.code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await events(idea.id)).length).toBe(1);
  });

  it('CA-RN-151.1 / 151.2 autor e co-autores ficam pendentes; cada um decide por si e pode mudar', async () => {
    const idea = await send('colab1', 'Com co-autor');
    expect((await c.colab2!.post(`/ideas/${idea.code}/support`, {})).status).toBe(200);
    await approve(idea.code);
    await publish(c.ana!, idea.code);
    const consents: { user_id: string; role: string; status: string }[] = await t.db.dataSource.query(
      'SELECT user_id, role, status FROM mural_consent WHERE idea_id = $1 ORDER BY role',
      [idea.id],
    );
    expect(consents).toEqual([
      { user_id: uid.colab1, role: 'author', status: 'pending' },
      { user_id: uid.colab2, role: 'co_author', status: 'pending' },
    ]);
    const consent = (who: Client, accept: boolean) =>
      who.request<Publication>('PUT', `/mural/ideas/${idea.code}/consent`, { accept });
    expect((await consent(c.colab1!, true)).body.myConsent).toBe('accepted');
    expect((await publication(c.colab2!, idea.code)).body.myConsent).toBe('pending');
    expect((await consent(c.colab1!, false)).body.myConsent).toBe('declined');
    expect((await consent(c.ana!, true)).status).toBe(403); // não participa
    expect((await consent(c.colabB!, true)).status).toBe(404); // nem vê a ideia
    expect((await c.colab1!.request('PUT', `/mural/ideas/${idea.code}/consent`, { accept: 'sim' })).status).toBe(422);
    // Retirar e publicar de novo não zera a decisão.
    await withdraw(c.ana!, idea.code);
    await publish(c.ana!, idea.code);
    expect((await publication(c.colab1!, idea.code)).body.myConsent).toBe('declined');
  });
});
