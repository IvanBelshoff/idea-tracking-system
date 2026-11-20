import 'reflect-metadata';
import { IsNull } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { AuthService } from '../../src/identity-access/auth.service.js';
import { PasswordReset } from '../../src/identity-access/entities/password-reset.entity.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User, UserStatus } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Setting } from '../../src/organization/entities/setting.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

describe('Instalação e autenticação (M1, fatia 2)', () => {
  let t: TestApp;
  let admin: Client;

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
  });
  afterAll(async () => {
    await t?.close();
  });

  /** Cria um usuário ativo direto no banco (a tela de usuários chega na fatia 3). */
  async function createUser(email: string, password = STRONG_PASSWORD) {
    const repo = t.db.dataSource.getRepository(User);
    return repo.save(
      repo.create({ email, name: email.split('@')[0] ?? email, passwordHash: await hashPassword(password) }),
    );
  }

  describe('assistente de instalação (RN-43)', () => {
    it('CA-RN-43.1 com o banco vazio só o assistente (e o health) responde', async () => {
      const anon = new Client(t.baseUrl);
      expect((await anon.get('/health')).status).toBe(200);
      expect((await anon.get('/install/status')).body).toEqual({ installed: false });

      const me = await anon.get<{ code: string }>('/auth/me');
      expect(me.status).toBe(503);
      expect(me.body.code).toBe('not_installed');
      expect((await anon.post('/auth/login', { email: 'x@example.test', password: 'y' })).status).toBe(503);
    });

    it('recusa senha fora da política e dados inválidos, sem instalar', async () => {
      const weak = await admin.post<{ code: string; details: { violations: string[] } }>('/install', {
        ...INSTALL_INPUT,
        password: 'curta',
      });
      expect(weak.status).toBe(422);
      expect(weak.body.code).toBe('weak_password');
      expect(weak.body.details.violations).toContain('too_short');

      const bad = await admin.post<{ code: string }>('/install', {
        ...INSTALL_INPUT,
        adminEmail: 'não-é-email',
        timezone: 'Lua/Base',
      });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('validation_failed');
      expect((await admin.get('/install/status')).body).toEqual({ installed: false });
    });

    it('CA-RN-43.1 conclui criando a organização e o administrador, já com sessão aberta', async () => {
      const res = await admin.post<{ email: string; name: string }>('/install', {
        ...INSTALL_INPUT,
        adminEmail: '  Admin@Example.TEST ',
      });
      expect(res.status).toBe(200);
      expect(res.body.email).toBe('admin@example.test');
      expect(res.setCookie).toMatch(/its_session=.+; .*HttpOnly/i);
      expect(res.setCookie).toMatch(/SameSite=Lax/i);
      expect(res.setCookie).toMatch(/Path=\/api/i);

      const me = await admin.get<{ name: string }>('/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.name).toBe('Admin Teste');

      const ds = t.db.dataSource;
      const user = await ds.getRepository(User).findOneByOrFail({ email: 'admin@example.test' });
      const scope = await ds
        .getRepository(UserRoleScope)
        .findOneOrFail({ where: { userId: user.id }, relations: { role: true, entity: true } });
      expect(scope.role.systemKey).toBe('admin');
      // CA-RN-43.4: instalação em pt-BR mantém os perfis de fábrica em português.
      expect(scope.role.name).toBe('Administrador');
      expect(scope.entity.name).toBe('Org');
      expect(scope.includeChildren).toBe(true);
      const org = await ds.getRepository(Setting).findOneByOrFail({ key: 'organization.name' });
      expect(org.value).toBe('Org');
      expect((await admin.get('/install/status')).body).toEqual({ installed: true });
    });

    it('CA-RN-43.2 depois de instalado o assistente devolve 404 e não cria outro admin', async () => {
      const again = await new Client(t.baseUrl).post('/install', {
        ...INSTALL_INPUT,
        adminEmail: 'outro@example.test',
      });
      expect(again.status).toBe(404);
      const admins = await t.db.dataSource.getRepository(Role).findOneByOrFail({ systemKey: 'admin' });
      expect(await t.db.dataSource.getRepository(UserRoleScope).countBy({ roleId: admins.id })).toBe(1);
    });
  });

  describe('login e sessão (RN-42)', () => {
    it('rotas protegidas exigem sessão (401 sem cookie)', async () => {
      const res = await new Client(t.baseUrl).get<{ code: string }>('/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('unauthenticated');
    });

    it('login por e-mail abre sessão e logout a encerra de verdade', async () => {
      await createUser('colab1@example.test');
      const c = new Client(t.baseUrl);
      expect((await c.post('/auth/login', { email: 'COLAB1@example.test', password: STRONG_PASSWORD })).status).toBe(
        200,
      );
      const cookie = c.cookie;
      expect((await c.get('/auth/me')).status).toBe(200);

      expect((await c.post('/auth/logout')).status).toBe(204);
      expect(c.cookie).toBeNull();
      // O token antigo não vale mais, mesmo reapresentado.
      c.cookie = cookie;
      expect((await c.get('/auth/me')).status).toBe(401);
    });

    it('CA-RN-42.2 a mensagem não diferencia e-mail inexistente de senha incorreta', async () => {
      await createUser('colab2@example.test');
      const c = new Client(t.baseUrl);
      const unknown = await c.post('/auth/login', { email: 'ninguem@example.test', password: STRONG_PASSWORD });
      const wrong = await c.post('/auth/login', { email: 'colab2@example.test', password: 'Senha-Errada-1' });
      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.body).toEqual(wrong.body);
    });

    it('CA-RN-42.2 após N falhas seguidas a conta fica bloqueada por um tempo, mesmo com a senha certa', async () => {
      const user = await createUser('colab3@example.test');
      const c = new Client(t.baseUrl);
      for (let i = 0; i < 5; i++) {
        expect((await c.post('/auth/login', { email: 'colab3@example.test', password: 'Senha-Errada-1' })).status).toBe(
          401,
        );
      }
      const blocked = await c.post('/auth/login', { email: 'colab3@example.test', password: STRONG_PASSWORD });
      expect(blocked.status).toBe(401);
      expect(blocked.body).toEqual(
        (await c.post('/auth/login', { email: 'ninguem@example.test', password: 'x' })).body,
      );

      const row = await t.db.dataSource.getRepository(User).findOneByOrFail({ id: user.id });
      expect(row.lockedUntil?.getTime()).toBeGreaterThan(Date.now());

      // Passado o prazo, volta a entrar.
      await t.db.dataSource.getRepository(User).update(user.id, { lockedUntil: new Date(Date.now() - 1000) });
      expect((await c.post('/auth/login', { email: 'colab3@example.test', password: STRONG_PASSWORD })).status).toBe(
        200,
      );
    });

    it('CA-RN-41.1 (parte) usuário desativado não entra e perde a sessão aberta na hora', async () => {
      const user = await createUser('colab4@example.test');
      const c = new Client(t.baseUrl);
      expect((await c.post('/auth/login', { email: 'colab4@example.test', password: STRONG_PASSWORD })).status).toBe(
        200,
      );

      await t.db.dataSource.getRepository(User).update(user.id, { status: UserStatus.Disabled });
      expect((await c.get('/auth/me')).status).toBe(401);
      expect(
        (await new Client(t.baseUrl).post('/auth/login', { email: 'colab4@example.test', password: STRONG_PASSWORD }))
          .status,
      ).toBe(401);
    });
  });

  describe('senha (RN-42)', () => {
    it('trocar a própria senha exige a atual, segue a política e encerra as outras sessões', async () => {
      await createUser('colab5@example.test');
      const a = new Client(t.baseUrl);
      const b = new Client(t.baseUrl);
      await a.post('/auth/login', { email: 'colab5@example.test', password: STRONG_PASSWORD });
      await b.post('/auth/login', { email: 'colab5@example.test', password: STRONG_PASSWORD });

      expect(
        (await a.post('/auth/password', { currentPassword: 'errada', newPassword: 'Nova-Senha-2026' })).status,
      ).toBe(400);
      expect((await a.post('/auth/password', { currentPassword: STRONG_PASSWORD, newPassword: 'fraca' })).status).toBe(
        422,
      );
      expect(
        (await a.post('/auth/password', { currentPassword: STRONG_PASSWORD, newPassword: 'Nova-Senha-2026' })).status,
      ).toBe(204);

      expect((await a.get('/auth/me')).status).toBe(200); // a sessão atual continua
      expect((await b.get('/auth/me')).status).toBe(401); // a outra foi encerrada
      expect(
        (await new Client(t.baseUrl).post('/auth/login', { email: 'colab5@example.test', password: 'Nova-Senha-2026' }))
          .status,
      ).toBe(200);
    });

    it('CA-RN-42.3 recuperação: link de uso único e com prazo; segundo uso e uso vencido são recusados', async () => {
      const user = await createUser('colab6@example.test');
      const auth = t.app.get(AuthService);
      const meta = { ip: null, userAgent: null };
      const session = new Client(t.baseUrl);
      await session.post('/auth/login', { email: 'colab6@example.test', password: STRONG_PASSWORD });

      const { token, expiresAt } = await auth.createPasswordReset(user.id, null, meta);
      expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(55 * 60_000); // padrão: 1 h

      const anon = new Client(t.baseUrl);
      expect((await anon.post('/auth/password-reset/redeem', { token, newPassword: 'Recuperada-2026' })).status).toBe(
        204,
      );
      const again = await anon.post<{ code: string }>('/auth/password-reset/redeem', {
        token,
        newPassword: 'Outra-Senha-2026',
      });
      expect(again.status).toBe(400);
      expect(again.body.code).toBe('reset_link_invalid');
      expect((await session.get('/auth/me')).status).toBe(401); // sessões antigas encerradas
      expect(
        (await anon.post('/auth/login', { email: 'colab6@example.test', password: 'Recuperada-2026' })).status,
      ).toBe(200);

      // Vencido
      const late = await auth.createPasswordReset(user.id, null, meta);
      await t.db.dataSource
        .getRepository(PasswordReset)
        .update({ usedAt: IsNull(), userId: user.id }, { expiresAt: new Date(Date.now() - 1000) });
      expect(
        (await anon.post('/auth/password-reset/redeem', { token: late.token, newPassword: 'Vencida-2026x' })).status,
      ).toBe(400);

      // Um link novo invalida o anterior
      const first = await auth.createPasswordReset(user.id, null, meta);
      await auth.createPasswordReset(user.id, null, meta);
      expect(
        (await anon.post('/auth/password-reset/redeem', { token: first.token, newPassword: 'Primeira-2026' })).status,
      ).toBe(400);
    });
  });

  describe('auditoria (RN-39)', () => {
    it('CA-RN-39.1 (parte) instalação, login com sucesso e falha, bloqueio e senhas geram registro', async () => {
      const actions = (await t.db.dataSource.getRepository(AuditLog).find()).map((a) => a.action);
      for (const action of [
        'install.completed',
        'auth.login',
        'auth.login_failed',
        'auth.locked',
        'auth.logout',
        'auth.password_changed',
        'auth.password_reset_created',
        'auth.password_reset_used',
      ]) {
        expect(actions).toContain(action);
      }
    });

    it('CA-RN-39.2 nenhuma senha, token ou hash aparece no log', async () => {
      const rows = await t.db.dataSource.query('SELECT data::text AS data FROM audit_log');
      const dump = rows.map((r: { data: string }) => r.data).join('\n');
      for (const secret of [STRONG_PASSWORD, 'Senha-Errada-1', 'Nova-Senha-2026', 'Recuperada-2026', '$argon2id$']) {
        expect(dump).not.toContain(secret);
      }
      expect(dump).not.toMatch(/"(password|token|hash|senha)"/i);
    });
  });
});
