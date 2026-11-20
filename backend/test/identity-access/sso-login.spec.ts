import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { AuthService } from '../../src/identity-access/auth.service.js';
import { Role, RolePermission } from '../../src/identity-access/entities/role.entity.js';
import { User, UserStatus } from '../../src/identity-access/entities/user.entity.js';
import { UserIdentity } from '../../src/identity-access/entities/user-identity.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { clearOidcCache } from '../../src/identity-access/sso/oidc.js';
import { SSO_RATE_LIMIT } from '../../src/identity-access/sso/sso.controller.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Browser } from '../support/browser.js';
import { type FakeClaims, FakeOidc } from '../support/fake-oidc.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = { id: 'client-id', secret: 'client-secret' };

interface AccessView {
  policy: { domains: string[]; allowExternal: boolean };
  sso: {
    mode: string;
    actorLinked: boolean;
    autoCreate: boolean;
    providers: {
      provider: string;
      configured: boolean;
      clientId: string;
      tenantId: string | null;
      clientSecretSet: boolean;
      enabled: boolean;
      lastTestOk: boolean | null;
      lastTestError: string | null;
      redirectUri: string | null;
      blockers: string[];
    }[];
  };
}
interface ErrorBody {
  code: string;
  details?: { blockers?: string[] };
}

describe('Login corporativo com a Microsoft (M13, integração com o provedor falso)', () => {
  let t: TestApp;
  let admin: Client;
  let adminId: string;
  let orgId: string;
  const fake = new FakeOidc();
  const roles: Record<string, Role> = {};
  const savedEnv = process.env.SSO_ISSUER_OVERRIDE_MICROSOFT;

  const ms = (email: string, key: string, name = key): FakeClaims => ({
    sub: `sub-${key}`,
    oid: `oid-${key}`,
    tid: TENANT,
    email,
    name,
  });

  async function dbUser(email: string, roleKey: string | null, extra: Partial<User> = {}) {
    const ds = t.db.dataSource;
    const users = ds.getRepository(User);
    const u = await users.save(
      users.create({
        email,
        name: email.split('@')[0] ?? email,
        passwordHash: await hashPassword(STRONG_PASSWORD),
        ...extra,
      }),
    );
    if (roleKey) {
      const scopes = ds.getRepository(UserRoleScope);
      await scopes.save(
        scopes.create({ userId: u.id, roleId: (roles[roleKey] as Role).id, entityId: orgId, includeChildren: true }),
      );
    }
    return u;
  }

  /** Um clique em "Entrar com…": início → provedor → retorno. Devolve o salto final do ITS. */
  async function flow(b: Browser, user: FakeClaims, query = '', provider = 'microsoft') {
    fake.user = user;
    const start = await b.hop(`/api/auth/sso/${provider}/start${query}`);
    if (!start.location?.startsWith(fake.base)) return { start, authz: null, cb: start };
    const authz = await b.hop(start.location);
    const cb = await b.hop(authz.location as string);
    return { start, authz, cb };
  }

  const errorOf = (location: string | null) => new URL(location ?? '/', 'http://x').searchParams.get('sso_erro');
  const audits = (action: string) =>
    t.db.dataSource.getRepository(AuditLog).find({ where: { action }, order: { id: 'ASC' } });
  const identitiesOf = (userId: string) => t.db.dataSource.getRepository(UserIdentity).findBy({ userId });

  async function adminBrowser() {
    const b = new Browser(t.baseUrl);
    const res = await b.hop('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: INSTALL_INPUT.adminEmail, password: STRONG_PASSWORD }),
    });
    expect(res.status).toBe(200);
    return b;
  }

  const saveProvider = (body: object = { clientId: CLIENT.id, tenantId: TENANT, clientSecret: CLIENT.secret }) =>
    admin.put<AccessView>('/admin/access/providers/microsoft', body);
  const view = async () => (await admin.get<AccessView>('/admin/access')).body;
  const provider = async () => (await view()).sso.providers.find((p) => p.provider === 'microsoft');

  beforeAll(async () => {
    await fake.start();
    process.env.SSO_ISSUER_OVERRIDE_MICROSOFT = fake.issuer;
    clearOidcCache();
    fake.expectClient = CLIENT;
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    orgId = (await t.db.dataSource.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;
    adminId = (await t.db.dataSource.getRepository(User).findOneByOrFail({ email: INSTALL_INPUT.adminEmail })).id;
    for (const r of await t.db.dataSource.getRepository(Role).find()) roles[r.systemKey ?? r.name] = r;
  });
  afterAll(async () => {
    if (savedEnv === undefined) delete process.env.SSO_ISSUER_OVERRIDE_MICROSOFT;
    else process.env.SSO_ISSUER_OVERRIDE_MICROSOFT = savedEnv;
    await t?.close();
    await fake.stop();
  });

  describe('configuração, teste de conexão e pré-condições (RN-97)', () => {
    it('CA-RN-97.10 de fábrica: só senha, sem provedor; a tela pública não expõe nada do SSO', async () => {
      const pub = await new Client(t.baseUrl).get<{ sso: { mode: string; providers: string[] } }>('/settings/public');
      expect(pub.body.sso).toEqual({ mode: 'password', providers: [] });
      const v = await view();
      expect(v.sso.mode).toBe('password');
      expect(v.sso.providers.map((p) => [p.provider, p.configured, p.enabled])).toEqual([
        ['microsoft', false, false],
        ['google', false, false],
      ]);
    });

    it('CA-RN-97.6 sem nada configurado não liga o provedor nem escolhe outro modo', async () => {
      const enable = await admin.post<ErrorBody>('/admin/access/providers/microsoft/enable');
      expect(enable.status).toBe(422);
      expect(enable.body.code).toBe('sso_blocked');
      expect(enable.body.details?.blockers).toEqual(
        expect.arrayContaining(['app_url_required', 'provider_incomplete', 'domains_required', 'test_required']),
      );
      const mode = await admin.put<ErrorBody>('/admin/access/mode', { mode: 'password_sso' });
      expect(mode.status).toBe(422);
      expect(mode.body.code).toBe('sso_mode_blocked');
      expect(mode.body.details?.blockers).toEqual(expect.arrayContaining(['no_provider_enabled', 'domains_required']));
      expect((await admin.put('/admin/access/mode', { mode: 'password' })).status).toBe(200);
    });

    it('CA-RN-97.9 o segredo fica cifrado e nunca volta pela API nem pela auditoria', async () => {
      expect((await admin.request('PATCH', '/settings', { values: { 'email.app_url': t.baseUrl } })).status).toBe(200);
      expect(
        (await admin.put('/admin/access/policy', { domains: ['example.test'], allowExternal: false })).status,
      ).toBe(200);
      // O tenant da Microsoft é um GUID ou um domínio; qualquer outra coisa é recusada.
      expect((await saveProvider({ clientId: CLIENT.id, tenantId: 'isto não é um tenant' })).status).toBe(400);
      const saved = await saveProvider();
      expect(saved.status).toBe(200);
      const p = saved.body.sso.providers.find((x) => x.provider === 'microsoft');
      expect(p?.clientSecretSet).toBe(true);
      expect(p?.configured).toBe(true);
      expect(p?.redirectUri).toBe(`${t.baseUrl}/api/auth/sso/microsoft/callback`);
      expect(JSON.stringify(saved.body)).not.toContain(CLIENT.secret);
      const rows: { config_encrypted: Buffer }[] = await t.db.dataSource.query(
        'SELECT config_encrypted FROM sso_provider',
      );
      expect(rows[0]?.config_encrypted.includes(Buffer.from(CLIENT.secret))).toBe(false);
      const log = await audits('sso.provider_updated');
      expect(JSON.stringify(log.map((l) => l.data))).not.toContain(CLIENT.secret);
      // Manter o segredo (ausente) não desliga nada e não pede o segredo de novo.
      expect((await saveProvider({ clientId: CLIENT.id, tenantId: TENANT })).status).toBe(200);
      expect((await provider())?.clientSecretSet).toBe(true);
    });

    it('CA-RN-97.6 o endereço, antes do teste, só confere o alcance de rede', async () => {
      const ok = await admin.post<{ ok: boolean; error: string | null }>(
        '/admin/access/providers/microsoft/test-address',
      );
      expect(ok.body).toEqual({ ok: true, error: null });
      expect((await admin.post('/admin/access/providers/desconhecido/test-address')).status).toBe(404);
      // Ainda falta o teste de entrada.
      expect((await provider())?.blockers).toEqual(['test_required']);
    });

    it('CA-RN-97.7 o teste de conexão falho (outro tenant) registra o motivo e não vincula', async () => {
      const b = await adminBrowser();
      const { cb } = await flow(b, { ...ms(INSTALL_INPUT.adminEmail, 'admin'), tid: 'outro-tenant' }, '?teste=1');
      expect(cb.location).toBe('/admin/acesso?teste=erro&provedor=microsoft&motivo=sso_tenant_mismatch');
      const p = await provider();
      expect(p?.lastTestOk).toBe(false);
      expect(p?.lastTestError).toBe('sso_tenant_mismatch');
      expect(await identitiesOf(adminId)).toHaveLength(0);
      expect((await audits('sso.test_failed')).length).toBe(1);
    });

    it('CA-RN-97.7 o teste de conexão exige administrador logado com sso.manage', async () => {
      const anon = await new Browser(t.baseUrl).hop('/api/auth/sso/microsoft/start?teste=1');
      expect(anon.status).toBe(401);
      await dbUser('colab-teste@example.test', 'collaborator');
      const b = new Browser(t.baseUrl);
      await b.hop('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'colab-teste@example.test', password: STRONG_PASSWORD }),
      });
      expect((await b.hop('/api/auth/sso/microsoft/start?teste=1')).status).toBe(403);
    });

    it('CA-RN-97.7 o teste de conexão aprovado vincula o administrador e libera o provedor', async () => {
      const b = await adminBrowser();
      const { start, cb } = await flow(b, ms(INSTALL_INPUT.adminEmail, 'admin', 'Admin'), '?teste=1');
      // O cookie do fluxo é só do SSO: HttpOnly, SameSite e só em /api/auth/sso.
      const flowCookie = start.setCookies.find((c) => c.startsWith('its_sso='));
      expect(flowCookie).toMatch(/HttpOnly/i);
      expect(flowCookie).toMatch(/SameSite=Lax/i);
      expect(flowCookie).toMatch(/Path=\/api\/auth\/sso/i);
      expect(cb.location).toBe('/admin/acesso?teste=ok&provedor=microsoft&vinculado=1');
      // O teste não troca a sessão: o cookie de sessão do administrador segue o mesmo.
      expect(cb.setCookies.some((c) => c.startsWith('its_session='))).toBe(false);
      const p = await provider();
      expect(p?.lastTestOk).toBe(true);
      expect(p?.blockers).toEqual([]);
      expect(await identitiesOf(adminId)).toHaveLength(1);
      expect((await view()).sso.actorLinked).toBe(true);
    });

    it('CA-RN-97.7 trocar o cliente desliga o provedor e zera o teste', async () => {
      expect((await admin.post('/admin/access/providers/microsoft/enable')).status).toBe(200);
      expect((await provider())?.enabled).toBe(true);
      const changed = await saveProvider({ clientId: 'outro-cliente', tenantId: TENANT });
      const p = changed.body.sso.providers.find((x) => x.provider === 'microsoft');
      expect(p?.enabled).toBe(false);
      expect(p?.lastTestOk).toBeNull();
      expect(p?.blockers).toEqual(['test_required']);
      // Volta ao cliente certo e refaz o teste.
      await saveProvider({ clientId: CLIENT.id, tenantId: TENANT });
      const b = await adminBrowser();
      expect((await flow(b, ms(INSTALL_INPUT.adminEmail, 'admin'), '?teste=1')).cb.location).toContain('teste=ok');
      expect((await provider())?.blockers).toEqual([]);
    });

    it('CA-RN-97.6 liga o provedor e o modo "Senha + SSO"; a tela pública mostra o botão, sem cliente nem tenant', async () => {
      expect((await admin.post('/admin/access/providers/microsoft/enable')).status).toBe(200);
      expect((await admin.put('/admin/access/mode', { mode: 'password_sso' })).status).toBe(200);
      const pub = await new Client(t.baseUrl).get<{ sso: { mode: string; providers: string[] } }>('/settings/public');
      expect(pub.body.sso).toEqual({ mode: 'password_sso', providers: ['microsoft'] });
      expect(JSON.stringify(pub.body)).not.toContain(TENANT);
      expect(JSON.stringify(pub.body)).not.toContain(CLIENT.id);
    });

    it('CA-RN-95.4 com o SSO em uso não dá para esvaziar os domínios', async () => {
      const res = await admin.put<ErrorBody>('/admin/access/policy', { domains: [], allowExternal: false });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('sso_domains_required');
    });
  });

  describe('entrada, vínculo e recusas (RN-96)', () => {
    let ana: User;

    it('CA-RN-96.1 primeiro login de quem já existe pelo e-mail: vincula, audita e abre a sessão normal', async () => {
      ana = await dbUser('ana@example.test', 'collaborator');
      const b = new Browser(t.baseUrl);
      const { cb } = await flow(b, ms('ana@example.test', 'ana', 'Ana Souza'));
      expect(cb.status).toBe(302);
      expect(cb.location).toBe('/');
      const session = cb.setCookies.find((c) => c.startsWith('its_session='));
      expect(session).toMatch(/HttpOnly/i);
      expect(session).toMatch(/SameSite=Lax/i);
      expect(session).toMatch(/Path=\/api/i);
      const me = await b.hop('/api/auth/me');
      expect(JSON.parse(me.body).email).toBe('ana@example.test');
      expect(await identitiesOf(ana.id)).toHaveLength(1);
      expect((await audits('auth.sso_identity_linked')).some((a) => a.targetId === ana.id)).toBe(true);
      expect((await audits('auth.sso_login')).some((a) => a.actorId === ana.id)).toBe(true);
      // O fluxo é de uso único: o cookie do fluxo foi apagado.
      expect(b.cookie('its_sso')).toBeUndefined();
    });

    it('CA-RN-96.13 a sessão do login corporativo dura 8 horas; a da senha, 12; o cookie leva o mesmo prazo', async () => {
      const hoursLeft = async (email: string) => {
        const rows: { expires_at: Date }[] = await t.db.dataSource.query(
          `SELECT s.expires_at FROM session s JOIN "user" u ON u.id = s.user_id
            WHERE u.email = $1 ORDER BY s.created_at DESC LIMIT 1`,
          [email],
        );
        return ((rows[0] as { expires_at: Date }).expires_at.getTime() - Date.now()) / 3_600_000;
      };
      const b = new Browser(t.baseUrl);
      const { cb } = await flow(b, ms('ana@example.test', 'ana'));
      expect(await hoursLeft('ana@example.test')).toBeGreaterThan(7.9);
      expect(await hoursLeft('ana@example.test')).toBeLessThanOrEqual(8);
      const maxAge = Number(/Max-Age=(\d+)/i.exec(cb.setCookies.find((c) => c.startsWith('its_session=')) ?? '')?.[1]);
      expect(maxAge).toBe(8 * 3600);
      expect(
        (await new Client(t.baseUrl).post('/auth/login', { email: 'ana@example.test', password: STRONG_PASSWORD }))
          .status,
      ).toBe(200);
      expect(await hoursLeft('ana@example.test')).toBeGreaterThan(11.9);
      // O prazo do SSO é ajustável em Configurações (CA-RN-96.13).
      expect((await admin.request('PATCH', '/settings', { values: { 'auth.sso_session_hours': 2 } })).status).toBe(200);
      await flow(new Browser(t.baseUrl), ms('ana@example.test', 'ana'));
      expect(await hoursLeft('ana@example.test')).toBeLessThanOrEqual(2);
      expect((await admin.request('PATCH', '/settings', { values: { 'auth.sso_session_hours': 8 } })).status).toBe(200);
    });

    it('CA-RN-96.2 segundo login: acha pelo identificador, mesmo que o e-mail do ITS tenha mudado', async () => {
      await t.db.dataSource.getRepository(User).update(ana.id, { email: 'ana.nova@example.test' });
      const b = new Browser(t.baseUrl);
      const { cb } = await flow(b, ms('ana@example.test', 'ana'));
      expect(cb.location).toBe('/');
      expect(JSON.parse((await b.hop('/api/auth/me')).body).email).toBe('ana.nova@example.test');
      expect(await identitiesOf(ana.id)).toHaveLength(1);
    });

    it('CA-RN-96.2 o e-mail do provedor igual ao de outra pessoa não troca de conta', async () => {
      const outra = await dbUser('outra@example.test', 'collaborator');
      const b = new Browser(t.baseUrl);
      // A conta do provedor da Ana, agora declarando o e-mail da outra pessoa, continua sendo a Ana.
      await flow(b, ms('outra@example.test', 'ana'));
      expect(JSON.parse((await b.hop('/api/auth/me')).body).email).toBe('ana.nova@example.test');
      expect(await identitiesOf(outra.id)).toHaveLength(0);
    });

    it('CA-RN-96.3 e-mail de quem já tem outra conta do provedor vinculada → sso_identity_conflict', async () => {
      const b = new Browser(t.baseUrl);
      const { cb } = await flow(b, ms('ana.nova@example.test', 'ana-2'));
      expect(errorOf(cb.location)).toBe('sso_identity_conflict');
      expect(b.cookie('its_session')).toBeUndefined();
      const log = await audits('auth.sso_login_failed');
      expect(log.some((l) => (l.data as { reason?: string }).reason === 'sso_identity_conflict')).toBe(true);
    });

    it('CA-RN-96.4 token com tenant, público, nonce, validade, chave ou algoritmo errados é recusado', async () => {
      const other = new Browser(t.baseUrl);
      const wrongTenant = await flow(other, { ...ms('ana.nova@example.test', 'ana'), tid: 'outro-tenant' });
      expect(errorOf(wrongTenant.cb.location)).toBe('sso_tenant_mismatch');
      expect(other.cookie('its_session')).toBeUndefined();
      const tampers = [
        { aud: 'outro-cliente' },
        { nonce: 'nonce-de-outro-fluxo' },
        { omitNonce: true },
        { iss: 'https://outro-emissor.test' },
        { expIn: -3600 },
        { otherKey: true },
        { alg: 'HS256' },
      ];
      for (const tamper of tampers) {
        fake.tamper = tamper;
        const b = new Browser(t.baseUrl);
        const { cb } = await flow(b, ms('ana.nova@example.test', 'ana'));
        expect(errorOf(cb.location), JSON.stringify(tamper)).toBe('sso_token_invalid');
        expect(b.cookie('its_session')).toBeUndefined();
      }
      fake.tamper = {};
    });

    it('CA-RN-96.5 state diferente, retorno repetido, retorno sem cookie e erro do provedor não abrem sessão', async () => {
      const b = new Browser(t.baseUrl);
      fake.user = ms('ana.nova@example.test', 'ana');
      const start = await b.hop('/api/auth/sso/microsoft/start');
      const authz = await b.hop(start.location as string);
      const callback = new URL(authz.location as string);

      const wrong = new URL(callback);
      wrong.searchParams.set('state', 'state-de-outro-fluxo');
      const bad = await new Browser(t.baseUrl).hop(wrong.toString());
      expect(errorOf(bad.location)).toBe('sso_state_invalid');

      const semCookie = await new Browser(t.baseUrl).hop(callback.toString());
      expect(errorOf(semCookie.location)).toBe('sso_state_invalid');

      const first = await b.hop(callback.toString());
      expect(first.location).toBe('/');
      const replay = await b.hop(callback.toString());
      expect(errorOf(replay.location)).toBe('sso_state_invalid');

      const b2 = new Browser(t.baseUrl);
      const s2 = await b2.hop('/api/auth/sso/microsoft/start');
      const state = new URL(s2.location as string).searchParams.get('state');
      const denied = await b2.hop(`/api/auth/sso/microsoft/callback?error=access_denied&state=${state}`);
      expect(errorOf(denied.location)).toBe('sso_provider_error');
      expect(b2.cookie('its_session')).toBeUndefined();
    });

    it('CA-RN-96.5 PKCE: o provedor recebe o verificador e confere o desafio; segredo errado é recusado', async () => {
      const b = new Browser(t.baseUrl);
      await flow(b, ms('ana.nova@example.test', 'ana'));
      expect(fake.lastTokenBody?.get('code_verifier')?.length).toBeGreaterThan(40);
      expect(fake.lastTokenBody?.get('grant_type')).toBe('authorization_code');
      fake.expectClient = { id: CLIENT.id, secret: 'segredo-errado' };
      const { cb } = await flow(new Browser(t.baseUrl), ms('ana.nova@example.test', 'ana'));
      expect(errorOf(cb.location)).toBe('sso_provider_error');
      fake.expectClient = CLIENT;
      // O provedor recusou: o texto que ele devolve não pode ir para a auditoria.
      fake.tokenError = 'invalid_client';
      await flow(new Browser(t.baseUrl), ms('ana.nova@example.test', 'ana'));
      fake.tokenError = null;
      expect(JSON.stringify((await audits('auth.sso_login_failed')).map((a) => a.data))).not.toContain(
        'segredo-secreto',
      );
    });

    it('CA-RN-96.7 e-mail fora dos domínios não entra por SSO', async () => {
      await dbUser('consultor@outra.org', 'collaborator');
      const { cb } = await flow(new Browser(t.baseUrl), ms('consultor@outra.org', 'consultor'));
      expect(errorOf(cb.location)).toBe('sso_domain_not_allowed');
    });

    it('CA-RN-96.8 usuário desativado ou anonimizado é recusado, sem vínculo e com a recusa auditada', async () => {
      const off = await dbUser('inativo@example.test', 'collaborator', { status: UserStatus.Disabled });
      const anon = await dbUser('anon@example.test', null, { status: UserStatus.Anonymized });
      for (const [email, key, u] of [
        ['inativo@example.test', 'inativo', off],
        ['anon@example.test', 'anon', anon],
      ] as const) {
        const b = new Browser(t.baseUrl);
        const { cb } = await flow(b, ms(email, key));
        expect(errorOf(cb.location)).toBe('sso_user_disabled');
        expect(b.cookie('its_session')).toBeUndefined();
        expect(await identitiesOf(u.id)).toHaveLength(0);
      }
      const log = await audits('auth.sso_login_failed');
      expect(log.filter((l) => (l.data as { reason?: string }).reason === 'sso_user_disabled')).toHaveLength(2);
    });

    it('CA-RN-96.9 sem cadastro e com a criação automática desligada → sso_user_not_found e nada é criado', async () => {
      const before = await t.db.dataSource.getRepository(User).count();
      const { cb } = await flow(new Browser(t.baseUrl), ms('ninguem@example.test', 'ninguem'));
      expect(errorOf(cb.location)).toBe('sso_user_not_found');
      expect(await t.db.dataSource.getRepository(User).count()).toBe(before);
    });

    it('CA-RN-96.10 o bloqueio por senha errada não impede o SSO, e o SSO não mexe nas tentativas', async () => {
      const bruno = await dbUser('bruno@example.test', 'collaborator', {
        failedAttempts: 3,
        lockedUntil: new Date(Date.now() + 3_600_000),
      });
      const b = new Browser(t.baseUrl);
      const { cb } = await flow(b, ms('bruno@example.test', 'bruno'));
      expect(cb.location).toBe('/');
      const after = await t.db.dataSource.getRepository(User).findOneByOrFail({ id: bruno.id });
      expect(after.failedAttempts).toBe(3);
      expect(after.lockedUntil).not.toBeNull();
      expect(after.lastLoginAt).not.toBeNull();
    });

    it('CA-RN-96.11 o administrador desvincula; o vínculo some, é auditado, e o próximo login o refaz pelo e-mail', async () => {
      const bruno = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'bruno@example.test' });
      expect((await admin.delete(`/users/${bruno.id}/identities/microsoft`)).status).toBe(200);
      expect(await identitiesOf(bruno.id)).toHaveLength(0);
      expect((await admin.delete(`/users/${bruno.id}/identities/microsoft`)).status).toBe(404);
      expect((await audits('auth.sso_unlinked')).some((a) => a.targetId === bruno.id)).toBe(true);
      await flow(new Browser(t.baseUrl), ms('bruno@example.test', 'bruno'));
      expect(await identitiesOf(bruno.id)).toHaveLength(1);
      // Anonimizar apaga os vínculos.
      expect((await admin.post(`/users/${bruno.id}/disable`)).status).toBe(200);
      expect((await admin.post(`/users/${bruno.id}/anonymize`)).status).toBe(200);
      expect(await identitiesOf(bruno.id)).toHaveLength(0);
    });

    it('CA-RN-96.12 o destino só aceita caminho interno', async () => {
      const ok = await flow(new Browser(t.baseUrl), ms('ana.nova@example.test', 'ana'), '?voltar=/ideias/nova');
      expect(ok.cb.location).toBe('/ideias/nova');
      for (const evil of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
        const r = await flow(
          new Browser(t.baseUrl),
          ms('ana.nova@example.test', 'ana'),
          `?voltar=${encodeURIComponent(evil)}`,
        );
        expect(r.cb.location).toBe('/');
      }
    });

    it('CA-RN-96.12 provedor desconhecido → 404; provedor desligado → volta à entrada com sso_not_configured', async () => {
      expect((await new Browser(t.baseUrl).hop('/api/auth/sso/okta/start')).status).toBe(404);
      const res = await new Browser(t.baseUrl).hop('/api/auth/sso/google/start');
      expect(errorOf(res.location)).toBe('sso_not_configured');
    });
  });

  describe('modos de login e acesso de emergência (RN-97)', () => {
    it('CA-RN-97.2 "Senha + SSO": a senha continua valendo como antes', async () => {
      const res = await new Client(t.baseUrl).post('/auth/login', {
        email: 'ana.nova@example.test',
        password: STRONG_PASSWORD,
      });
      expect(res.status).toBe(200);
    });

    it('CA-RN-97.3, 97.4 e 97.5 "Só SSO": a senha certa de quem entra por SSO → sso_required; emergência e e-mail de fora seguem', async () => {
      const ana = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'ana.nova@example.test' });
      // Um link de senha emitido antes da troca de modo.
      const oldLink = await t.app.get(AuthService).createPasswordReset(ana.id, null, { ip: null, userAgent: null });
      expect((await admin.put('/admin/access/mode', { mode: 'sso' })).status).toBe(200);

      const login = (email: string, password = STRONG_PASSWORD) =>
        new Client(t.baseUrl).post<ErrorBody>('/auth/login', { email, password });
      const blocked = await login('ana.nova@example.test');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('sso_required');
      // Senha errada continua igual a qualquer outra: não revela nada.
      expect((await login('ana.nova@example.test', 'Senha-Errada-1')).body.code).toBe('invalid_credentials');
      expect((await login('naoexiste@example.test')).body.code).toBe('invalid_credentials');
      // Acesso de emergência (setting.manage) e e-mail de fora dos domínios.
      expect((await login(INSTALL_INPUT.adminEmail)).status).toBe(200);
      expect((await login('consultor@outra.org')).status).toBe(200);
      expect(
        (await audits('auth.login_failed')).some((a) => (a.data as { reason?: string }).reason === 'sso_required'),
      ).toBe(true);

      // Link de senha: não se gera para quem entra por SSO, e o antigo não vale.
      expect((await admin.post<ErrorBody>(`/users/${ana.id}/password-link`)).body.code).toBe('sso_required');
      const redeem = await new Client(t.baseUrl).post<ErrorBody>('/auth/password-reset/redeem', {
        token: oldLink.token,
        newPassword: 'Outra-Senha-2026',
      });
      expect(redeem.status).toBe(403);
      expect(redeem.body.code).toBe('sso_required');
      const consultor = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'consultor@outra.org' });
      expect((await admin.post(`/users/${consultor.id}/password-link`)).status).toBe(200);

      // Cadastro: quem tem e-mail do domínio nasce sem link de senha; o detalhe mostra o vínculo.
      const created = await admin.post<{ passwordLink: unknown; user: { canUsePassword: boolean } }>('/users', {
        name: 'Novo Sso',
        email: 'novo.sso@example.test',
      });
      expect(created.status).toBe(201);
      expect(created.body.passwordLink).toBeNull();
      expect(created.body.user.canUsePassword).toBe(false);
      const detail = await admin.get<{ identities: { provider: string }[]; canUsePassword: boolean }>(
        `/users/${ana.id}`,
      );
      expect(detail.body.canUsePassword).toBe(false);
      expect(detail.body.identities.map((i) => i.provider)).toEqual(['microsoft']);
    });

    it('CA-RN-97.8 no modo "Só SSO" não se desliga nem se altera o último provedor ligado', async () => {
      const off = await admin.post<ErrorBody>('/admin/access/providers/microsoft/disable');
      expect(off.status).toBe(409);
      expect(off.body.code).toBe('sso_mode_requires_provider');
      const change = await saveProvider({ clientId: 'outro', tenantId: TENANT });
      expect(change.status).toBe(409);
      expect((await provider())?.enabled).toBe(true);
    });

    it('CA-RN-97.8 volta ao "Senha + SSO" e a senha de quem entra por SSO volta a valer', async () => {
      expect((await admin.put('/admin/access/mode', { mode: 'password_sso' })).status).toBe(200);
      const res = await new Client(t.baseUrl).post('/auth/login', {
        email: 'ana.nova@example.test',
        password: STRONG_PASSWORD,
      });
      expect(res.status).toBe(200);
    });
  });

  describe('criação automática de conta (RN-98)', () => {
    const provisioning = (roleId: string | null, entityId: string | null, autoCreate = true) =>
      admin.put<AccessView & ErrorBody>('/admin/access/provisioning', { autoCreate, roleId, entityId });

    it('CA-RN-98.6 não salva sem perfil e entidade, nem com perfil administrativo', async () => {
      const none = await provisioning(null, null);
      expect(none.status).toBe(422);
      expect(none.body.code).toBe('sso_provisioning_incomplete');
      const adm = await provisioning((roles.admin as Role).id, orgId);
      expect(adm.status).toBe(422);
      expect(adm.body.code).toBe('sso_role_administrative');
      // Um perfil criado pelo administrador com permissão administrativa também não.
      const custom = await admin.post<{ id: string }>('/roles', {
        name: 'Auditor',
        permissions: ['idea.submit', 'audit.view'],
      });
      expect(custom.status).toBe(201);
      expect((await provisioning(custom.body.id, orgId)).body.code).toBe('sso_role_administrative');
      // Um analista não é administrativo.
      expect((await provisioning((roles.analyst as Role).id, orgId, false)).status).toBe(200);
    });

    it('CA-RN-98.1 desligada: quem não tem cadastro não ganha conta (já coberto em 96.9)', async () => {
      expect((await view()).sso.autoCreate).toBe(false);
    });

    it('CA-RN-98.2 ligada: cria a conta no primeiro login, sem senha, com perfil e entidade iniciais, e audita', async () => {
      expect((await provisioning((roles.collaborator as Role).id, orgId)).status).toBe(200);
      const b = new Browser(t.baseUrl);
      const { cb } = await flow(b, ms('Nova.Pessoa@Example.test', 'nova', 'Nova Pessoa'));
      expect(cb.location).toBe('/');
      const user = await t.db.dataSource
        .getRepository(User)
        .createQueryBuilder('u')
        .addSelect('u.passwordHash')
        .where('u.email = :e', { e: 'nova.pessoa@example.test' })
        .getOneOrFail();
      expect(user.name).toBe('Nova Pessoa');
      expect(user.passwordHash).toBeNull();
      expect(user.status).toBe(UserStatus.Active);
      expect(user.locale).toBe('pt-BR');
      const scopes = await t.db.dataSource.getRepository(UserRoleScope).findBy({ userId: user.id });
      expect(scopes.map((s) => [s.roleId, s.entityId])).toEqual([[(roles.collaborator as Role).id, orgId]]);
      expect(await identitiesOf(user.id)).toHaveLength(1);
      expect((await audits('auth.sso_user_provisioned')).some((a) => a.targetId === user.id)).toBe(true);
      // CA-RN-98.9: a conta tem as permissões do perfil inicial e nada além.
      const me = JSON.parse((await b.hop('/api/auth/me')).body) as { permissions: string[] };
      expect(me.permissions).toEqual(expect.arrayContaining(['idea.submit']));
      expect(me.permissions).not.toContain('user.manage');
      expect(me.permissions).not.toContain('setting.manage');
      expect(me.permissions).not.toContain('sso.manage');
    });

    it('CA-RN-98.3 não cria conta para e-mail de fora, tenant errado ou e-mail ausente', async () => {
      const before = await t.db.dataSource.getRepository(User).count();
      for (const [claims, code] of [
        [ms('quem@outra.org', 'quem'), 'sso_domain_not_allowed'],
        [{ ...ms('quem@example.test', 'quem2'), tid: 'outro-tenant' }, 'sso_tenant_mismatch'],
        [{ ...ms('x@example.test', 'sem-email'), email: undefined }, 'sso_email_missing'],
      ] as const) {
        const { cb } = await flow(new Browser(t.baseUrl), claims);
        expect(errorOf(cb.location)).toBe(code);
      }
      expect(await t.db.dataSource.getRepository(User).count()).toBe(before);
    });

    it('CA-RN-98.4 dois logins simultâneos do mesmo e-mail criam uma conta só', async () => {
      const claims = ms('simultaneo@example.test', 'simultaneo', 'Simultâneo');
      fake.user = claims;
      const a = new Browser(t.baseUrl);
      const c = new Browser(t.baseUrl);
      const starts = await Promise.all([
        a.hop('/api/auth/sso/microsoft/start'),
        c.hop('/api/auth/sso/microsoft/start'),
      ]);
      const authz = await Promise.all(starts.map((s, i) => (i === 0 ? a : c).hop(s.location as string)));
      const cbs = await Promise.all(authz.map((z, i) => (i === 0 ? a : c).hop(z.location as string)));
      expect(cbs.map((x) => x.location)).toEqual(['/', '/']);
      expect(await t.db.dataSource.getRepository(User).countBy({ email: 'simultaneo@example.test' })).toBe(1);
      const u = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'simultaneo@example.test' });
      expect(await identitiesOf(u.id)).toHaveLength(1);
    });

    it('CA-RN-98.6 perfil que se torna administrativo depois é recusado na criação, sem conta parcial', async () => {
      const perm = t.db.dataSource.getRepository(RolePermission);
      await perm.insert({ roleId: (roles.collaborator as Role).id, permission: 'audit.view' });
      const before = await t.db.dataSource.getRepository(User).count();
      const { cb } = await flow(new Browser(t.baseUrl), ms('depois@example.test', 'depois'));
      expect(errorOf(cb.location)).toBe('sso_provisioning_unavailable');
      expect(await t.db.dataSource.getRepository(User).count()).toBe(before);
      await perm.delete({ roleId: (roles.collaborator as Role).id, permission: 'audit.view' });
    });

    it('CA-RN-98.7 entidade inicial inativa → login recusado e nenhuma conta parcial', async () => {
      const entities = t.db.dataSource.getRepository(OrgEntity);
      await entities.update(orgId, { active: false });
      const before = await t.db.dataSource.getRepository(User).count();
      const { cb } = await flow(new Browser(t.baseUrl), ms('inativa@example.test', 'inativa'));
      expect(errorOf(cb.location)).toBe('sso_provisioning_unavailable');
      expect(await t.db.dataSource.getRepository(User).count()).toBe(before);
      await entities.update(orgId, { active: true });
      // Quem já tem conta não depende disso.
      expect((await flow(new Browser(t.baseUrl), ms('ana.nova@example.test', 'ana'))).cb.location).toBe('/');
    });

    it('CA-RN-98.8 nome vazio do provedor vira o que vem antes do @', async () => {
      await flow(new Browser(t.baseUrl), { ...ms('sem.nome@example.test', 'sem-nome'), name: undefined });
      const u = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'sem.nome@example.test' });
      expect(u.name).toBe('sem.nome');
    });
  });

  describe('nada vaza e há limite (CA-T.12, CA-RN-96.12)', () => {
    it('CA-T.12 token, código e segredo não aparecem na auditoria, nas respostas, nos redirecionamentos nem na sessão', async () => {
      expect(fake.idTokens.length).toBeGreaterThan(5);
      const everything = JSON.stringify([
        (await t.db.dataSource.getRepository(AuditLog).find()).map((a) => [a.action, a.data]),
        (await admin.get('/admin/access')).body,
        (await new Client(t.baseUrl).get('/settings/public')).body,
      ]);
      for (const secret of [CLIENT.secret, 'segredo-secreto', ...fake.idTokens, ...fake.codes_issued]) {
        expect(everything).not.toContain(secret);
      }
      // O que o navegador recebe do ITS é só redirecionamento e cookies; sem token na URL.
      const b = new Browser(t.baseUrl);
      const { cb } = await flow(b, ms('ana.nova@example.test', 'ana'));
      expect(cb.location).toBe('/');
      for (const token of fake.idTokens)
        expect(`${cb.location}${cb.body}${cb.setCookies.join(';')}`).not.toContain(token);
    });

    it('CA-RN-96.12 muitas requisições do mesmo IP no início do fluxo → 429', async () => {
      const b = new Browser(t.baseUrl);
      let limited = 0;
      for (let i = 0; i < SSO_RATE_LIMIT + 5 && limited === 0; i++) {
        const r = await b.hop('/api/auth/sso/google/start');
        if (r.status === 429) limited = i;
      }
      expect(limited).toBeGreaterThan(0);
    });
  });
});
