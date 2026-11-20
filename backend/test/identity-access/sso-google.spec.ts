import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserIdentity } from '../../src/identity-access/entities/user-identity.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { clearOidcCache } from '../../src/identity-access/sso/oidc.js';
import { Browser } from '../support/browser.js';
import { type FakeClaims, FakeOidc } from '../support/fake-oidc.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

const CLIENT = { id: 'google-client.apps.googleusercontent.com', secret: 'google-secret' };

describe('Login corporativo com o Google (M13, integração com o provedor falso)', () => {
  let t: TestApp;
  let admin: Client;
  const fake = new FakeOidc();
  const savedEnv = process.env.SSO_ISSUER_OVERRIDE_GOOGLE;

  const google = (email: string, key: string, over: Partial<FakeClaims> = {}): FakeClaims => ({
    sub: `google-${key}`,
    email,
    email_verified: true,
    name: key,
    hd: 'example.test',
    ...over,
  });

  async function flow(b: Browser, user: FakeClaims, query = '') {
    fake.user = user;
    const start = await b.hop(`/api/auth/sso/google/start${query}`);
    const authz = await b.hop(start.location as string);
    return b.hop(authz.location as string);
  }
  const errorOf = (location: string | null) => new URL(location ?? '/', 'http://x').searchParams.get('sso_erro');
  const identities = (userId: string) => t.db.dataSource.getRepository(UserIdentity).findBy({ userId });

  async function dbUser(email: string) {
    const users = t.db.dataSource.getRepository(User);
    return users.save(users.create({ email, name: email, passwordHash: await hashPassword(STRONG_PASSWORD) }));
  }

  beforeAll(async () => {
    await fake.start();
    process.env.SSO_ISSUER_OVERRIDE_GOOGLE = fake.issuer;
    clearOidcCache();
    fake.expectClient = CLIENT;
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    expect((await admin.request('PATCH', '/settings', { values: { 'email.app_url': t.baseUrl } })).status).toBe(200);
    expect((await admin.put('/admin/access/policy', { domains: ['example.test'], allowExternal: false })).status).toBe(
      200,
    );
    // O Google não tem tenant: o cliente e o segredo bastam.
    const saved = await admin.put('/admin/access/providers/google', {
      clientId: CLIENT.id,
      clientSecret: CLIENT.secret,
      tenantId: 'ignorado-no-google',
    });
    expect(saved.status).toBe(200);
    const b = new Browser(t.baseUrl);
    await b.hop('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: INSTALL_INPUT.adminEmail, password: STRONG_PASSWORD }),
    });
    const test = await flow(b, google(INSTALL_INPUT.adminEmail, 'admin'), '?teste=1');
    expect(test.location).toBe('/admin/acesso?teste=ok&provedor=google&vinculado=1');
    expect((await admin.post('/admin/access/providers/google/enable')).status).toBe(200);
    expect((await admin.put('/admin/access/mode', { mode: 'password_sso' })).status).toBe(200);
  });
  afterAll(async () => {
    if (savedEnv === undefined) delete process.env.SSO_ISSUER_OVERRIDE_GOOGLE;
    else process.env.SSO_ISSUER_OVERRIDE_GOOGLE = savedEnv;
    await t?.close();
    await fake.stop();
  });

  it('CA-RN-96.6 o Google não guarda tenant, mesmo que a tela mande um', async () => {
    const view = (
      await admin.get<{ sso: { providers: { provider: string; tenantId: string | null }[] } }>('/admin/access')
    ).body;
    expect(view.sso.providers.find((p) => p.provider === 'google')?.tenantId).toBeNull();
  });

  it('CA-RN-96.1 conta do Workspace do domínio, de quem já existe pelo e-mail: vincula e entra', async () => {
    const ana = await dbUser('ana@example.test');
    const b = new Browser(t.baseUrl);
    const cb = await flow(b, google('ana@example.test', 'ana'));
    expect(cb.location).toBe('/');
    expect(JSON.parse((await b.hop('/api/auth/me')).body).email).toBe('ana@example.test');
    const links = await identities(ana.id);
    expect(links.map((l) => [l.provider, l.subject, l.issuer])).toEqual([['google', 'google-ana', fake.issuer]]);
  });

  it('CA-RN-96.6 conta pessoal (sem hd) ou de outro domínio do Workspace é recusada', async () => {
    await dbUser('pessoal@example.test');
    for (const over of [{ hd: undefined }, { hd: 'outra.com' }]) {
      const b = new Browser(t.baseUrl);
      const cb = await flow(b, google('pessoal@example.test', 'pessoal', over));
      expect(errorOf(cb.location)).toBe('sso_domain_not_allowed');
      expect(b.cookie('its_session')).toBeUndefined();
    }
    // O e-mail de fora do domínio também, ainda que o hd seja do domínio.
    const fora = await flow(new Browser(t.baseUrl), google('x@gmail.com', 'fora'));
    expect(errorOf(fora.location)).toBe('sso_domain_not_allowed');
  });

  it('CA-RN-96.6 e-mail não verificado no Google → sso_email_unverified', async () => {
    const cb = await flow(new Browser(t.baseUrl), google('ana@example.test', 'ana', { email_verified: false }));
    expect(errorOf(cb.location)).toBe('sso_email_unverified');
  });

  it('CA-RN-96.2 o segundo login acha pelo `sub`, e o e-mail igual ao de outra pessoa não troca de conta', async () => {
    const outra = await dbUser('outra@example.test');
    const b = new Browser(t.baseUrl);
    await flow(b, google('outra@example.test', 'ana'));
    expect(JSON.parse((await b.hop('/api/auth/me')).body).email).toBe('ana@example.test');
    expect(await identities(outra.id)).toHaveLength(0);
  });

  it('CA-RN-96.4 token do Google com público ou `nonce` errados é recusado', async () => {
    for (const tamper of [{ aud: 'outro-cliente' }, { nonce: 'de-outro-fluxo' }]) {
      fake.tamper = tamper;
      const b = new Browser(t.baseUrl);
      const cb = await flow(b, google('ana@example.test', 'ana'));
      expect(errorOf(cb.location)).toBe('sso_token_invalid');
      expect(b.cookie('its_session')).toBeUndefined();
    }
    fake.tamper = {};
  });

  it('CA-RN-96.1 a Microsoft continua desligada enquanto só o Google está ligado', async () => {
    const res = await new Browser(t.baseUrl).hop('/api/auth/sso/microsoft/start');
    expect(errorOf(res.location)).toBe('sso_not_configured');
    const pub = await new Client(t.baseUrl).get<{ sso: { providers: string[] } }>('/settings/public');
    expect(pub.body.sso.providers).toEqual(['google']);
  });
});
