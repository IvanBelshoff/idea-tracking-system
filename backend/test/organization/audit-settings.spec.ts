import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface AuditEntry {
  id: string;
  at: string;
  action: string;
  actor: { id: string; name: string } | null;
  targetType: string | null;
  targetId: string | null;
  data: Record<string, unknown>;
}
interface AuditPage {
  items: AuditEntry[];
  meta: { page: number; pageSize: number; total: number };
}
interface SettingItem {
  key: string;
  value: unknown;
  defaultValue: unknown;
  updatedAt: string | null;
}

describe('Configurações públicas antes da instalação', () => {
  let t: TestApp;
  afterAll(async () => {
    await t?.close();
  });

  it('respondem com os padrões, sem login, para o assistente e a tela de login', async () => {
    t = await createTestApp();
    const res = await new Client(t.baseUrl).get<{ organizationName: string; passwordPolicy: { minLength: number } }>(
      '/settings/public',
    );
    expect(res.status).toBe(200);
    expect(res.body.organizationName).toBe('');
    expect(res.body.passwordPolicy.minLength).toBe(10);
  });
});

describe('Auditoria e configurações (M1, fatia 5)', () => {
  let t: TestApp;
  let admin: Client;
  let analyst: Client;
  let colab: Client;
  let rootId: string;

  async function userWith(email: string, systemKey: string) {
    const ds = t.db.dataSource;
    const u = await ds
      .getRepository(User)
      .save(
        ds
          .getRepository(User)
          .create({ email, name: email.split('@')[0], passwordHash: await hashPassword(STRONG_PASSWORD) }),
      );
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey });
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId: rootId }));
    const c = new Client(t.baseUrl);
    expect((await c.post('/auth/login', { email, password: STRONG_PASSWORD })).status).toBe(200);
    return c;
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    rootId = (await t.db.dataSource.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;
    analyst = await userWith('analista@example.test', 'analyst');
    colab = await userWith('colab@example.test', 'collaborator');
    await new Client(t.baseUrl).post('/auth/login', { email: 'colab@example.test', password: 'Errada-123x' });
    await admin.post('/users', { name: 'Novo Usuário', email: 'novo@example.test' });
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('log de auditoria (RN-39)', () => {
    it('CA-RN-39.1 somente quem tem audit.view (o Administrador) lê o log', async () => {
      expect((await analyst.get('/audit')).status).toBe(403);
      expect((await colab.get('/audit')).status).toBe(403);
      expect((await colab.get('/audit/actions')).status).toBe(403);
      const res = await admin.get<AuditPage>('/audit');
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBeGreaterThan(0);
    });

    it('CA-RN-39.1 instalação, login com sucesso e com falha e criação de usuário estão no log, do mais recente ao mais antigo', async () => {
      const { items } = (await admin.get<AuditPage>('/audit?pageSize=100')).body;
      const actions = items.map((i) => i.action);
      for (const a of ['install.completed', 'auth.login', 'auth.login_failed', 'user.created'])
        expect(actions).toContain(a);
      const ids = items.map((i) => Number(i.id));
      expect([...ids].sort((a, b) => b - a)).toEqual(ids);
      const created = items.find((i) => i.action === 'user.created');
      expect(created?.actor?.name).toBe('Admin Teste');
    });

    it('filtra por ação exata, por família (auth.), por alvo e por período, com paginação', async () => {
      const exact = (await admin.get<AuditPage>('/audit?action=auth.login_failed')).body;
      expect(exact.items.length).toBeGreaterThan(0);
      expect(exact.items.every((i) => i.action === 'auth.login_failed')).toBe(true);

      const family = (await admin.get<AuditPage>('/audit?action=auth.&pageSize=100')).body;
      expect(family.items.every((i) => i.action.startsWith('auth.'))).toBe(true);
      expect(new Set(family.items.map((i) => i.action)).size).toBeGreaterThan(1);

      const target = (await admin.get<AuditPage>(`/audit?targetType=entity&targetId=${rootId}`)).body;
      expect(target.items.map((i) => i.action)).toContain('install.completed');

      const future = (await admin.get<AuditPage>(`/audit?from=${new Date(Date.now() + 3_600_000).toISOString()}`)).body;
      expect(future.meta.total).toBe(0);

      const page2 = (await admin.get<AuditPage>('/audit?pageSize=1&page=2')).body;
      expect(page2.items).toHaveLength(1);
      expect(page2.meta).toMatchObject({ page: 2, pageSize: 1 });

      expect((await admin.get('/audit?actorId=nao-uuid')).status).toBe(400);
      expect((await admin.get<string[]>('/audit/actions')).body).toEqual(
        expect.arrayContaining(['auth.login', 'install.completed']),
      );
    });
  });

  describe('configurações (§16)', () => {
    it('só quem tem setting.manage lê e altera; chaves internas não aparecem', async () => {
      expect((await analyst.get('/settings')).status).toBe(403);
      expect((await colab.request('PATCH', '/settings', { values: { 'auth.lockout_minutes': 1 } })).status).toBe(403);
      const list = (await admin.get<SettingItem[]>('/settings')).body;
      const keys = list.map((s) => s.key);
      expect(keys).toContain('auth.password_min_length');
      expect(keys).not.toContain('installation.completed_at');
      expect(list.find((s) => s.key === 'organization.name')?.value).toBe('Org');
      expect(list.find((s) => s.key === 'auth.lockout_minutes')?.updatedAt).toBeNull(); // padrão de fábrica
    });

    it('valor fora da regra ou chave desconhecida → 400 e NADA é salvo (tudo ou nada)', async () => {
      const bad = await admin.request<{ code: string; details: { key: string }[] }>('PATCH', '/settings', {
        values: {
          'auth.lockout_minutes': 30,
          'auth.password_min_length': 4,
          'installation.completed_at': null,
          inventada: 1,
        },
      });
      expect(bad.status).toBe(400);
      expect(bad.body.details.map((d) => d.key).sort()).toEqual([
        'auth.password_min_length',
        'installation.completed_at',
        'inventada',
      ]);
      const lockout = (await admin.get<SettingItem[]>('/settings')).body.find((s) => s.key === 'auth.lockout_minutes');
      expect(lockout?.value).toBe(15);
      expect(
        (await admin.request('PATCH', '/settings', { values: { 'organization.timezone': 'Lua/Base' } })).status,
      ).toBe(400);
    });

    it('CA-RN-39.1 alterar configuração fica na auditoria com o valor anterior e o novo', async () => {
      const res = await admin.request<SettingItem[]>('PATCH', '/settings', {
        values: { 'auth.max_failed_attempts': 3, 'organization.timezone': 'America/Manaus' },
      });
      expect(res.status).toBe(200);
      expect(res.body.find((s) => s.key === 'auth.max_failed_attempts')?.value).toBe(3);

      const log = (await admin.get<AuditPage>('/audit?action=setting.updated&targetId=auth.max_failed_attempts')).body
        .items[0];
      expect(log?.data).toMatchObject({ key: 'auth.max_failed_attempts', before: 5, after: 3 });
    });

    it('a configuração vale na hora: com limite 3, a conta bloqueia na 3ª falha', async () => {
      const c = new Client(t.baseUrl);
      for (let i = 0; i < 3; i++)
        await c.post('/auth/login', { email: 'analista@example.test', password: 'Errada-123x' });
      expect((await c.post('/auth/login', { email: 'analista@example.test', password: STRONG_PASSWORD })).status).toBe(
        401,
      );
      const u = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'analista@example.test' });
      expect(u.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    });

    it('CA-RN-42.1 política de senha mais rígida passa a valer na troca de senha', async () => {
      await admin.request('PATCH', '/settings', { values: { 'auth.password_min_length': 16 } });
      const weak = await colab.post<{ details: { policy: { minLength: number } } }>('/auth/password', {
        currentPassword: STRONG_PASSWORD,
        newPassword: 'Senha-Media-2026', // 16 caracteres: aceita
      });
      expect(weak.status).toBe(204);
      const short = await colab.post<{ code: string }>('/auth/password', {
        currentPassword: 'Senha-Media-2026',
        newPassword: 'Curta-Demais-26', // 15: recusa
      });
      expect(short.status).toBe(422);
      expect(
        (await new Client(t.baseUrl).get<{ passwordPolicy: { minLength: number } }>('/settings/public')).body
          .passwordPolicy.minLength,
      ).toBe(16);
    });

    it('o nome da organização e o da entidade raiz andam juntos, nos dois sentidos', async () => {
      await admin.request('PATCH', '/settings', { values: { 'organization.name': 'Ideias Vale Verde' } });
      expect((await t.db.dataSource.getRepository(OrgEntity).findOneByOrFail({ id: rootId })).name).toBe(
        'Ideias Vale Verde',
      );
      expect(
        (await new Client(t.baseUrl).get<{ organizationName: string }>('/settings/public')).body.organizationName,
      ).toBe('Ideias Vale Verde');

      await admin.request('PATCH', `/entities/${rootId}`, { name: 'Vale Verde S.A.' });
      const s = (await admin.get<SettingItem[]>('/settings')).body.find((i) => i.key === 'organization.name');
      expect(s?.value).toBe('Vale Verde S.A.');
    });

    it('CA-RN-39.2 nenhuma senha, token ou hash aparece em lugar algum do log', async () => {
      const rows: { data: string }[] = await t.db.dataSource.query('SELECT data::text AS data FROM audit_log');
      const dump = rows.map((r) => r.data).join('\n');
      for (const secret of [STRONG_PASSWORD, 'Errada-123x', 'Senha-Media-2026', 'Curta-Demais-26', '$argon2id$']) {
        expect(dump).not.toContain(secret);
      }
      expect(dump).not.toMatch(/"(password|token|hash|senha|secret)"/i);
    });
  });
});
