import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import {
  emailDomain,
  isEmailAllowed,
  isInternalEmail,
  isValidDomain,
  normalizeDomain,
  normalizeDomains,
  outsidePolicy,
} from '../../src/identity-access/domain-policy.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface AccessView {
  policy: { domains: string[]; allowExternal: boolean };
  outsideUsers: { id: string; name: string; email: string }[];
  outsideTotal: number;
}

describe('Política de domínio (M13, regras puras)', () => {
  it('CA-RN-95.1 normaliza: minúsculas, sem @, sem espaço e sem repetição', () => {
    expect(normalizeDomain('  @Empresa.COM ')).toBe('empresa.com');
    expect(normalizeDomains(['Empresa.com', '@empresa.com', 'outra.org'])).toEqual(['empresa.com', 'outra.org']);
  });

  it('CA-RN-95.1 só aceita domínio com formato válido', () => {
    for (const ok of ['empresa.com', 'es.senac.br', 'a-b.co']) expect(isValidDomain(ok)).toBe(true);
    for (const bad of ['', 'empresa', '-a.com', 'a..com', 'a b.com', 'a@b.com', 'empresa.c', `${'a'.repeat(64)}.com`]) {
      expect(isValidDomain(bad)).toBe(false);
    }
  });

  it('o domínio do e-mail ignora caixa e usa o último @', () => {
    expect(emailDomain('Ana@Empresa.COM')).toBe('empresa.com');
    expect(emailDomain('sem-arroba')).toBe('');
    expect(isInternalEmail('ana@empresa.com', ['empresa.com'])).toBe(true);
    expect(isInternalEmail('ana@sub.empresa.com', ['empresa.com'])).toBe(false);
    expect(isInternalEmail('ana@empresa.com.evil.io', ['empresa.com'])).toBe(false);
  });

  it('CA-RN-95.2 a 95.5 isEmailAllowed: lista vazia e e-mail de fora liberam; senão, só dentro', () => {
    expect(isEmailAllowed('x@fora.io', { domains: [], allowExternal: false })).toBe(true);
    expect(isEmailAllowed('x@fora.io', { domains: ['empresa.com'], allowExternal: true })).toBe(true);
    expect(isEmailAllowed('x@fora.io', { domains: ['empresa.com'], allowExternal: false })).toBe(false);
    expect(isEmailAllowed('x@empresa.com', { domains: ['empresa.com'], allowExternal: false })).toBe(true);
  });

  it('CA-RN-95.6 outsidePolicy lista quem está fora; sem domínios, ninguém', () => {
    const users = [{ email: 'a@empresa.com' }, { email: 'b@fora.io' }];
    expect(outsidePolicy(users, ['empresa.com'])).toEqual([{ email: 'b@fora.io' }]);
    expect(outsidePolicy(users, [])).toEqual([]);
  });
});

describe('Política de domínio (M13, integração)', () => {
  let t: TestApp;
  let admin: Client;
  let colab: Client;

  async function user(email: string, roleKey: string) {
    const ds = t.db.dataSource;
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: roleKey });
    const u = await ds
      .getRepository(User)
      .save(
        ds
          .getRepository(User)
          .create({ email, name: email.split('@')[0] ?? email, passwordHash: await hashPassword(STRONG_PASSWORD) }),
      );
    const scopes = ds.getRepository(UserRoleScope);
    await scopes.save(scopes.create({ userId: u.id, roleId: role.id, entityId: org.id, includeChildren: true }));
    return u;
  }

  async function login(email: string) {
    const c = new Client(t.baseUrl);
    expect((await c.post('/auth/login', { email, password: STRONG_PASSWORD })).status).toBe(200);
    return c;
  }

  const setPolicy = (domains: string[], allowExternal: boolean) =>
    admin.put('/admin/access/policy', { domains, allowExternal });

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    await user('colab@example.test', 'collaborator');
    colab = await login('colab@example.test');
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-95.8 só o Administrador de fábrica recebe sso.manage', async () => {
    const rows: { system_key: string }[] = await t.db.dataSource.query(
      `SELECT r.system_key FROM role_permission p JOIN role r ON r.id = p.role_id
        WHERE p.permission = 'sso.manage' ORDER BY r.system_key`,
    );
    expect(rows.map((r) => r.system_key)).toEqual(['admin']);
  });

  it('CA-RN-95.7 sem login → 401; sem sso.manage → 403; Administrador → 200', async () => {
    expect((await new Client(t.baseUrl).get('/admin/access')).status).toBe(401);
    expect((await colab.get('/admin/access')).status).toBe(403);
    expect((await colab.put('/admin/access/policy', { domains: [], allowExternal: false })).status).toBe(403);
    const res = await admin.get('/admin/access');
    expect(res.status).toBe(200);
    expect((res.body as AccessView).policy).toEqual({ domains: [], allowExternal: false });
  });

  it('CA-RN-95.4 sem domínios cadastrados qualquer e-mail é aceito (instalação sem configuração não muda)', async () => {
    const res = await admin.post('/users', { name: 'Livre', email: 'livre@qualquer.io' });
    expect(res.status).toBe(201);
  });

  it('CA-RN-95.1 domínio inválido → 400; os válidos são normalizados na gravação', async () => {
    expect((await setPolicy(['sem-ponto'], false)).status).toBe(400);
    const ok = await setPolicy(['Example.TEST', '@example.test'], false);
    expect(ok.status).toBe(200);
    expect((ok.body as AccessView).policy.domains).toEqual(['example.test']);
  });

  it('CA-RN-95.2 com domínios e e-mail de fora desligado, cadastrar fora do domínio → 422', async () => {
    const fora = await admin.post('/users', { name: 'Fora', email: 'fora@outra.org' });
    expect(fora.status).toBe(422);
    expect((fora.body as { code: string }).code).toBe('email_domain_not_allowed');
    const dentro = await admin.post('/users', { name: 'Dentro', email: 'dentro@example.test' });
    expect(dentro.status).toBe(201);
  });

  it('CA-RN-95.3 trocar o e-mail para fora do domínio → 422; trocar dentro do domínio funciona', async () => {
    const created = await admin.post('/users', { name: 'Troca', email: 'troca@example.test' });
    const id = (created.body as { user: { id: string } }).user.id;
    const fora = await admin.request('PATCH', `/users/${id}`, { email: 'troca@outra.org' });
    expect(fora.status).toBe(422);
    const dentro = await admin.request('PATCH', `/users/${id}`, { email: 'troca2@example.test' });
    expect(dentro.status).toBe(200);
  });

  it('CA-RN-95.6 quem já está fora da política continua entrando, editável, e aparece no aviso', async () => {
    // "livre@qualquer.io" foi cadastrado antes de haver domínios.
    const livre = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'livre@qualquer.io' });
    const edit = await admin.request('PATCH', `/users/${livre.id}`, {
      name: 'Livre Renomeado',
      email: 'livre@qualquer.io',
    });
    expect(edit.status).toBe(200);
    const view = (await admin.get('/admin/access')).body as AccessView;
    expect(view.outsideUsers.map((u) => u.email)).toContain('livre@qualquer.io');
    expect(view.outsideTotal).toBe(view.outsideUsers.length);
    // O administrador instalado tem e-mail do domínio de teste e não aparece.
    expect(view.outsideUsers.map((u) => u.email)).not.toContain(INSTALL_INPUT.adminEmail);
  });

  it('CA-RN-95.5 com e-mail de fora ligado qualquer domínio é aceito', async () => {
    expect((await setPolicy(['example.test'], true)).status).toBe(200);
    const res = await admin.post('/users', { name: 'Externo', email: 'externo@outra.org' });
    expect(res.status).toBe(201);
  });

  it('CA-RN-95.7 a alteração da política é auditada, sem dado pessoal', async () => {
    await setPolicy(['example.test'], false);
    const rows = await t.db.dataSource
      .getRepository(AuditLog)
      .find({ where: { action: 'access.policy_updated' }, order: { id: 'DESC' }, take: 1 });
    const data = rows[0]?.data as { domains: string[]; allowExternal: boolean; before: unknown };
    expect(data.domains).toEqual(['example.test']);
    expect(data.allowExternal).toBe(false);
    expect(data.before).toBeDefined();
    expect(JSON.stringify(rows[0]?.data)).not.toMatch(/@/);
  });

  it('CA-RN-95.4 esvaziar a lista tira a restrição', async () => {
    expect((await setPolicy([], false)).status).toBe(200);
    const res = await admin.post('/users', { name: 'Solto', email: 'solto@qualquer.io' });
    expect(res.status).toBe(201);
  });
});
