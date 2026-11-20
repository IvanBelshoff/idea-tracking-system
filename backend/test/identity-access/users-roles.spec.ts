import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User, UserStatus } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { ALL_PERMISSIONS } from '../../src/identity-access/permissions.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface UserDetail {
  id: string;
  name: string;
  email: string;
  status: string;
  scopes: { role: { id: string; name: string }; entity: { id: string; name: string }; includeChildren: boolean }[];
}
interface RoleView {
  id: string;
  name: string;
  systemKey: string | null;
  permissions: string[];
  usersCount: number;
}

describe('Permissões, escopo, usuários e perfis (M1, fatia 3)', () => {
  let t: TestApp;
  let admin: Client;
  const ent: Record<'org' | 'A' | 'A1' | 'B', OrgEntity> = {} as never;
  const roles: Record<string, Role> = {};

  async function entity(name: string, parent: OrgEntity | null) {
    const repo = t.db.dataSource.getTreeRepository(OrgEntity);
    return repo.save(repo.create({ name, parent }));
  }

  /** Usuário ativo com senha e perfis, criado direto no banco para montar o cenário. */
  async function user(email: string, grants: [Role, OrgEntity, boolean?][]) {
    const ds = t.db.dataSource;
    const u = await ds
      .getRepository(User)
      .save(
        ds
          .getRepository(User)
          .create({ email, name: email.split('@')[0] ?? email, passwordHash: await hashPassword(STRONG_PASSWORD) }),
      );
    const scopes = ds.getRepository(UserRoleScope);
    for (const [role, e, includeChildren = true] of grants) {
      await scopes.save(scopes.create({ userId: u.id, roleId: role.id, entityId: e.id, includeChildren }));
    }
    return u;
  }

  async function login(email: string) {
    const c = new Client(t.baseUrl);
    const res = await c.post('/auth/login', { email, password: STRONG_PASSWORD });
    expect(res.status).toBe(200);
    return c;
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    ent.org = await t.db.dataSource.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    ent.A = await entity('Unidade A', ent.org);
    ent.A1 = await entity('Setor A1', ent.A);
    ent.B = await entity('Unidade B', ent.org);
    for (const r of await t.db.dataSource.getRepository(Role).find()) roles[r.systemKey ?? r.name] = r;

    await user('colab1@example.test', [[roles.collaborator!, ent.A1]]);
    await user('colab3@example.test', [[roles.collaborator!, ent.B]]);
    await user('analista@example.test', [[roles.analyst!, ent.A]]);
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('verificação de permissão em toda rota (RN-01)', () => {
    it('CA-RN-01.1 colaborador chamando rotas de gestão recebe 403', async () => {
      const colab = await login('colab1@example.test');
      for (const res of [
        await colab.post('/users', { name: 'X', email: 'x@example.test' }),
        await colab.get('/users'),
        await colab.get('/roles'),
        await colab.post('/roles', { name: 'Hack', permissions: ['user.manage'] }),
      ]) {
        expect(res.status).toBe(403);
        expect((res.body as { code: string }).code).toBe('forbidden');
      }
    });

    it('/auth/me devolve as permissões efetivas (o frontend monta o menu; a API confere de novo)', async () => {
      const colab = await login('colab1@example.test');
      expect((await colab.get<{ permissions: string[] }>('/auth/me')).body.permissions).toEqual([
        'idea.comment',
        'idea.submit',
      ]);
      expect((await admin.get<{ permissions: string[] }>('/auth/me')).body.permissions).toEqual(
        [...ALL_PERMISSIONS].sort(),
      );
    });
  });

  describe('escopo por entidade e IDOR', () => {
    let manager: Client;
    let usersAdminA: RoleView;

    beforeAll(async () => {
      const res = await admin.post<RoleView>('/roles', {
        name: 'Gestão de usuários',
        description: 'Administra usuários da sua unidade',
        permissions: ['user.manage'],
      });
      expect(res.status).toBe(201);
      usersAdminA = res.body;
      const role = await t.db.dataSource.getRepository(Role).findOneByOrFail({ id: usersAdminA.id });
      await user('gestor-usuarios@example.test', [[role, ent.A]]);
      manager = await login('gestor-usuarios@example.test');
    });

    it('CA-RN-01.3 quem administra a Unidade A vê os usuários de A e A1, e não os de B', async () => {
      const res = await manager.get<{ items: { email: string }[]; meta: { total: number } }>('/users?pageSize=100');
      expect(res.status).toBe(200);
      const emails = res.body.items.map((u) => u.email);
      expect(emails).toEqual(
        expect.arrayContaining(['colab1@example.test', 'analista@example.test', 'gestor-usuarios@example.test']),
      );
      expect(emails).not.toContain('colab3@example.test');
      expect(emails).not.toContain('admin@example.test'); // admin está na raiz, fora de A
    });

    it('CA-T.5 trocar o id na URL nunca dá acesso a usuário de fora do escopo (404, sem revelar)', async () => {
      const outside = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'colab3@example.test' });
      expect((await manager.get(`/users/${outside.id}`)).status).toBe(404);
      expect((await manager.post(`/users/${outside.id}/disable`)).status).toBe(404);
      expect((await manager.post(`/users/${outside.id}/password-link`)).status).toBe(404);
      expect((await manager.get('/users/nao-e-um-uuid')).status).toBe(404);
      expect((await manager.get('/users/00000000-0000-7000-8000-000000000000')).status).toBe(404);
    });

    it('só concede perfis nas entidades que administra (dar acesso em B → 403)', async () => {
      const colab1 = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'colab1@example.test' });
      const toB = await manager.request('PUT', `/users/${colab1.id}/scopes`, {
        scopes: [{ roleId: roles.analyst!.id, entityId: ent.B.id, includeChildren: true }],
      });
      expect(toB.status).toBe(403);
      const inA = await manager.request<UserDetail>('PUT', `/users/${colab1.id}/scopes`, {
        scopes: [
          { roleId: roles.collaborator!.id, entityId: ent.A1.id, includeChildren: true },
          { roleId: roles.analyst!.id, entityId: ent.A1.id, includeChildren: false },
        ],
      });
      expect(inA.status).toBe(200);
      expect(inA.body.scopes.map((s) => s.role.name).sort()).toEqual(['Analista', 'Colaborador']);
    });

    it('CA-RN-01.7 perfil editado pelo admin sem a permissão → o usuário recebe 403 já na chamada seguinte', async () => {
      expect((await manager.get('/users')).status).toBe(200);
      const edit = await admin.request<RoleView>('PATCH', `/roles/${usersAdminA.id}`, { permissions: ['report.view'] });
      expect(edit.status).toBe(200);
      expect((await manager.get('/users')).status).toBe(403);
    });
  });

  describe('ciclo de vida do usuário (RN-40, RN-41, RN-42)', () => {
    let created: UserDetail;

    it('cria o usuário sem senha e devolve um link de uso único para ele definir a senha', async () => {
      const res = await admin.post<{ user: UserDetail; passwordLink: { token: string; expiresAt: string } }>('/users', {
        name: 'Bruno Lima',
        email: 'Bruno@Example.test',
      });
      expect(res.status).toBe(201);
      created = res.body.user;
      expect(created.email).toBe('bruno@example.test');
      expect(created.status).toBe('active');

      const anon = new Client(t.baseUrl);
      expect((await anon.post('/auth/login', { email: 'bruno@example.test', password: STRONG_PASSWORD })).status).toBe(
        401,
      );
      expect(
        (
          await anon.post('/auth/password-reset/redeem', {
            token: res.body.passwordLink.token,
            newPassword: STRONG_PASSWORD,
          })
        ).status,
      ).toBe(204);
      expect((await anon.post('/auth/login', { email: 'bruno@example.test', password: STRONG_PASSWORD })).status).toBe(
        200,
      );

      expect((await admin.post('/users', { name: 'Outro', email: 'BRUNO@example.test' })).status).toBe(409);
    });

    it('sem idioma informado, o usuário nasce com o idioma padrão da organização', async () => {
      expect(
        (await admin.request('PATCH', '/settings', { values: { 'organization.default_locale': 'en' } })).status,
      ).toBe(200);
      const english = await admin.post<{ user: UserDetail & { locale: string } }>('/users', {
        name: 'Pessoa Inglês',
        email: 'ingles@example.test',
      });
      expect(english.status).toBe(201);
      expect(english.body.user.locale).toBe('en');
      const chosen = await admin.post<{ user: UserDetail & { locale: string } }>('/users', {
        name: 'Pessoa Escolhida',
        email: 'escolhida@example.test',
        locale: 'pt-BR',
      });
      expect(chosen.body.user.locale).toBe('pt-BR');
      await admin.request('PATCH', '/settings', { values: { 'organization.default_locale': 'pt-BR' } });
    });

    it('edita nome e idioma; e-mail repetido é recusado', async () => {
      const res = await admin.request<UserDetail>('PATCH', `/users/${created.id}`, { name: 'Bruno L.', locale: 'en' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Bruno L.');
      expect((await admin.request('PATCH', `/users/${created.id}`, { email: 'colab1@example.test' })).status).toBe(409);
    });

    it('o admin gera link de recuperação para o usuário (CA-RN-42.3 pela tela do admin)', async () => {
      const res = await admin.post<{ token: string }>(`/users/${created.id}/password-link`);
      expect(res.status).toBe(200);
      const anon = new Client(t.baseUrl);
      expect(
        (await anon.post('/auth/password-reset/redeem', { token: res.body.token, newPassword: 'Trocada-Pelo-Link-1' }))
          .status,
      ).toBe(204);
    });

    it('CA-RN-41.1 usuário desativado não entra e as sessões abertas são invalidadas', async () => {
      const session = new Client(t.baseUrl);
      expect(
        (await session.post('/auth/login', { email: 'bruno@example.test', password: 'Trocada-Pelo-Link-1' })).status,
      ).toBe(200);

      const res = await admin.post<UserDetail>(`/users/${created.id}/disable`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('disabled');
      expect((await session.get('/auth/me')).status).toBe(401);
      expect(
        (
          await new Client(t.baseUrl).post('/auth/login', {
            email: 'bruno@example.test',
            password: 'Trocada-Pelo-Link-1',
          })
        ).status,
      ).toBe(401);
    });

    it('CA-RN-41.2 não existe exclusão física de usuário', async () => {
      expect((await admin.request('DELETE', `/users/${created.id}`)).status).toBe(404);
      expect(await t.db.dataSource.getRepository(User).countBy({ id: created.id })).toBe(1);
    });

    it('CA-RN-40.2 anonimizar usuário ATIVO é recusado', async () => {
      const colab3 = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'colab3@example.test' });
      const res = await admin.post<{ code: string }>(`/users/${colab3.id}/anonymize`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('user_active');
    });

    it('CA-RN-40.1 (parte) anonimizar desativado troca nome e e-mail, apaga a senha, mantém o registro e audita', async () => {
      const res = await admin.post<UserDetail>(`/users/${created.id}/anonymize`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Ex-colaborador');
      expect(res.body.email).not.toContain('bruno');
      expect(res.body.status).toBe('anonymized');
      expect(res.body.scopes).toEqual([]);

      const row = await t.db.dataSource
        .getRepository(User)
        .createQueryBuilder('u')
        .addSelect('u.passwordHash')
        .where('u.id = :id', { id: created.id })
        .getOneOrFail();
      expect(row.passwordHash).toBeNull();
      expect(row.anonymizedAt).not.toBeNull();
      expect((await admin.post(`/users/${created.id}/enable`)).status).toBe(409); // irreversível
      const audit = await t.db.dataSource
        .getRepository(AuditLog)
        .findOneBy({ action: 'user.anonymized', targetId: created.id });
      expect(audit).not.toBeNull();
    });

    it('reativa um usuário desativado', async () => {
      const colab3 = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'colab3@example.test' });
      await admin.post(`/users/${colab3.id}/disable`);
      const res = await admin.post<UserDetail>(`/users/${colab3.id}/enable`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(UserStatus.Active);
    });
  });

  describe('trava do último administrador', () => {
    it('o admin não pode se desativar nem tirar o próprio perfil se for o único', async () => {
      const me = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'admin@example.test' });
      expect((await admin.post<{ code: string }>(`/users/${me.id}/disable`)).body.code).toBe('cannot_disable_self');

      const drop = await admin.request<{ code: string }>('PUT', `/users/${me.id}/scopes`, { scopes: [] });
      expect(drop.status).toBe(409);
      expect(drop.body.code).toBe('last_admin');
      expect(await t.db.dataSource.getRepository(UserRoleScope).countBy({ userId: me.id })).toBe(1); // desfeito
    });

    it('com um segundo administrador, a troca é permitida', async () => {
      const second = await user('admin2@example.test', [[roles.admin!, ent.org]]);
      const me = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'admin@example.test' });
      const res = await admin.request<UserDetail>('PUT', `/users/${me.id}/scopes`, {
        scopes: [{ roleId: roles.collaborator!.id, entityId: ent.org.id, includeChildren: true }],
      });
      expect(res.status).toBe(200);
      // devolve o perfil para os próximos testes, agora pelo segundo admin
      const admin2 = await login('admin2@example.test');
      expect(
        (
          await admin2.request('PUT', `/users/${me.id}/scopes`, {
            scopes: [{ roleId: roles.admin!.id, entityId: ent.org.id, includeChildren: true }],
          })
        ).status,
      ).toBe(200);
      expect(second.id).toBeDefined();
    });
  });

  describe('perfis (§3.2)', () => {
    it('lista os perfis de fábrica e o catálogo de permissões', async () => {
      const list = await admin.get<RoleView[]>('/roles');
      expect(
        list.body
          .filter((r) => r.systemKey)
          .map((r) => r.systemKey)
          .sort(),
      ).toEqual(['admin', 'analyst', 'collaborator', 'manager', 'validator']);
      const catalog = await admin.get<{ code: string }[]>('/permissions');
      expect(catalog.body.map((p) => p.code)).toEqual(ALL_PERMISSIONS);
    });

    it('recusa: nome repetido, permissão inventada, reduzir o Administrador, apagar perfil de fábrica ou em uso', async () => {
      expect((await admin.post('/roles', { name: 'analista', permissions: [] })).status).toBe(409);
      expect((await admin.post('/roles', { name: 'Novo', permissions: ['tudo.liberado'] })).status).toBe(400);
      expect((await admin.request('PATCH', `/roles/${roles.admin!.id}`, { permissions: ['user.manage'] })).status).toBe(
        409,
      );
      expect((await admin.request('DELETE', `/roles/${roles.collaborator!.id}`)).status).toBe(409);

      const inUse = (await admin.get<RoleView[]>('/roles')).body.find((r) => r.name === 'Gestão de usuários');
      expect(inUse?.usersCount).toBe(1);
      expect((await admin.request('DELETE', `/roles/${inUse?.id}`)).status).toBe(409);
    });

    it('cria, renomeia e apaga um perfil sem uso; tudo fica na auditoria', async () => {
      const created = await admin.post<RoleView>('/roles', {
        name: 'Comitê',
        permissions: ['report.view', 'report.view'],
      });
      expect(created.status).toBe(201);
      expect(created.body.permissions).toEqual(['report.view']);
      expect(
        (await admin.request<RoleView>('PATCH', `/roles/${created.body.id}`, { name: 'Comitê de melhoria' })).body.name,
      ).toBe('Comitê de melhoria');
      expect((await admin.request('DELETE', `/roles/${created.body.id}`)).status).toBe(204);

      const actions = (await t.db.dataSource.getRepository(AuditLog).find()).map((a) => a.action);
      for (const a of [
        'role.created',
        'role.updated',
        'role.deleted',
        'user.created',
        'user.updated',
        'user.disabled',
        'user.enabled',
        'user.scopes_changed',
      ]) {
        expect(actions).toContain(a);
      }
    });
  });
});

describe('trava do último administrador sob concorrência', () => {
  let t: TestApp;

  afterAll(async () => {
    await t?.close();
  });

  it('dois admins se desativando ao mesmo tempo: só um consegue, sempre resta um ativo', async () => {
    t = await createTestApp();
    const a = new Client(t.baseUrl);
    expect((await a.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    const adminRole = await ds.getRepository(Role).findOneByOrFail({ systemKey: 'admin' });
    const second = await ds
      .getRepository(User)
      .save(
        ds
          .getRepository(User)
          .create({ email: 'b@example.test', name: 'B', passwordHash: await hashPassword(STRONG_PASSWORD) }),
      );
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: second.id, roleId: adminRole.id, entityId: org.id }));
    const b = new Client(t.baseUrl);
    expect((await b.post('/auth/login', { email: 'b@example.test', password: STRONG_PASSWORD })).status).toBe(200);
    const first = await ds.getRepository(User).findOneByOrFail({ email: 'admin@example.test' });

    const results = await Promise.all([a.post(`/users/${second.id}/disable`), b.post(`/users/${first.id}/disable`)]);
    // O perdedor recebe 409 (trava) ou 401 (se chegou depois, sua sessão já foi revogada).
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.find((s) => s !== 200)).toBeOneOf([401, 409]);
    expect(await ds.getRepository(User).countBy({ status: UserStatus.Active })).toBe(1);
  });
});
