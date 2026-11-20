import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserAvatar } from '../../src/identity-access/entities/user-avatar.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { clearOidcCache } from '../../src/identity-access/sso/oidc.js';
import { Browser } from '../support/browser.js';
import { type FakeClaims, FakeOidc } from '../support/fake-oidc.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

const TENANT = '11111111-2222-3333-4444-555555555555';
const MS_CLIENT = { id: 'client-id', secret: 'client-secret' };
const G_CLIENT = { id: 'google-client.apps.googleusercontent.com', secret: 'google-secret' };
const ENV = [
  'SSO_ISSUER_OVERRIDE_MICROSOFT',
  'SSO_ISSUER_OVERRIDE_GOOGLE',
  'SSO_GRAPH_BASE_OVERRIDE',
  'SSO_PHOTO_TEST_HOST',
];

interface Options {
  choice: string;
  sources: { source: string; version: string }[];
}
interface Me {
  id: string;
  photoVersion: string | null;
}

const image = (color: string, format: 'jpeg' | 'png' = 'jpeg') =>
  sharp({ create: { width: 300, height: 300, channels: 3, background: color } })
    [format]()
    .toBuffer();

describe('Foto do login corporativo, por escolha da pessoa (M20, RN-144)', () => {
  let t: TestApp;
  let admin: Client;
  const ms = new FakeOidc();
  const gg = new FakeOidc();
  const saved: Record<string, string | undefined> = {};
  /** Um servidor que só conta conexões: endereço de foto fora da lista nunca pode chegar nele. */
  let trap: Server;
  let trapPort = 0;
  let trapHits = 0;

  const msUser = (email: string, key: string): FakeClaims => ({
    sub: `sub-${key}`,
    oid: `oid-${key}`,
    tid: TENANT,
    email,
    name: key,
  });
  const gUser = (email: string, key: string, picture?: string): FakeClaims => ({
    sub: `google-${key}`,
    email,
    email_verified: true,
    name: key,
    hd: 'example.test',
    ...(picture ? { picture } : {}),
  });

  /** Um clique em "Entrar com…" e devolve o navegador com a sessão (ou o erro). */
  async function login(provider: 'microsoft' | 'google', user: FakeClaims, query = '') {
    const fake = provider === 'microsoft' ? ms : gg;
    fake.user = user;
    const b = new Browser(t.baseUrl);
    const start = await b.hop(`/api/auth/sso/${provider}/start${query}`);
    const authz = await b.hop(start.location as string);
    const cb = await b.hop(authz.location as string);
    return { b, cb };
  }
  async function adminBrowser() {
    const b = new Browser(t.baseUrl);
    await b.hop('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: INSTALL_INPUT.adminEmail, password: STRONG_PASSWORD }),
    });
    return b;
  }
  async function dbUser(email: string) {
    const users = t.db.dataSource.getRepository(User);
    return users.save(users.create({ email, name: email, passwordHash: await hashPassword(STRONG_PASSWORD) }));
  }
  const rows = (userId: string) =>
    t.db.dataSource.getRepository(UserAvatar).find({ where: { userId }, order: { source: 'ASC' } });
  const meOf = async (b: Browser) => JSON.parse((await b.hop('/api/auth/me')).body) as Me;
  const api = (b: Browser) => ({
    get: async <T>(path: string) => {
      const r = await b.hop(`/api${path}`);
      return { status: r.status, body: (r.body ? JSON.parse(r.body) : null) as T };
    },
    put: async <T>(path: string, body: unknown) => {
      const r = await b.hop(`/api${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: (r.body ? JSON.parse(r.body) : null) as T };
    },
  });
  const setPhoto = (provider: string, enabled: boolean) =>
    admin.put<{ sso: { providers: { provider: string; photoEnabled: boolean }[] } }>(
      `/admin/access/providers/${provider}/photo`,
      { enabled },
    );

  beforeAll(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    await ms.start();
    await gg.start();
    trap = createServer((_req, res) => {
      trapHits++;
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end();
    });
    await new Promise<void>((r) => trap.listen(0, '127.0.0.1', r));
    const address = trap.address();
    trapPort = typeof address === 'object' && address ? address.port : 0;
    process.env.SSO_ISSUER_OVERRIDE_MICROSOFT = ms.issuer;
    process.env.SSO_ISSUER_OVERRIDE_GOOGLE = gg.issuer;
    process.env.SSO_GRAPH_BASE_OVERRIDE = ms.base;
    process.env.SSO_PHOTO_TEST_HOST = `127.0.0.1:${gg.port}`;
    clearOidcCache();
    ms.expectClient = MS_CLIENT;
    gg.expectClient = G_CLIENT;
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    expect((await admin.request('PATCH', '/settings', { values: { 'email.app_url': t.baseUrl } })).status).toBe(200);
    expect((await admin.put('/admin/access/policy', { domains: ['example.test'], allowExternal: false })).status).toBe(
      200,
    );
    expect(
      (
        await admin.put('/admin/access/providers/microsoft', {
          clientId: MS_CLIENT.id,
          tenantId: TENANT,
          clientSecret: MS_CLIENT.secret,
        })
      ).status,
    ).toBe(200);
    expect(
      (await admin.put('/admin/access/providers/google', { clientId: G_CLIENT.id, clientSecret: G_CLIENT.secret }))
        .status,
    ).toBe(200);
    // O teste de conexão do administrador libera ligar cada provedor (RN-97).
    for (const [provider, user] of [
      ['microsoft', msUser(INSTALL_INPUT.adminEmail, 'admin')],
      ['google', gUser(INSTALL_INPUT.adminEmail, 'admin')],
    ] as const) {
      const b = await adminBrowser();
      const fake = provider === 'microsoft' ? ms : gg;
      fake.user = user;
      const start = await b.hop(`/api/auth/sso/${provider}/start?teste=1`);
      const authz = await b.hop(start.location as string);
      await b.hop(authz.location as string);
      expect((await admin.post(`/admin/access/providers/${provider}/enable`)).status).toBe(200);
    }
    expect((await admin.put('/admin/access/mode', { mode: 'password_sso' })).status).toBe(200);
  }, 120_000);
  afterAll(async () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await t?.close();
    await ms.stop();
    await gg.stop();
    await new Promise<void>((r) => trap.close(() => r()));
  });
  beforeEach(() => {
    ms.graphRequests.length = 0;
    gg.pictureRequests = 0;
  });

  it('CA-RN-144.1 com a opção desligada (padrão), o login não pede User.Read nem busca foto (negativo)', async () => {
    const view = await admin.get<{ sso: { providers: { provider: string; photoEnabled: boolean }[] } }>(
      '/admin/access',
    );
    expect(view.body.sso.providers.map((p) => [p.provider, p.photoEnabled])).toEqual([
      ['microsoft', false],
      ['google', false],
    ]);
    ms.graphPhoto = { status: 200, body: await image('#0f766e'), type: 'image/jpeg' };
    const ana = await dbUser('ana@example.test');
    const { cb } = await login('microsoft', msUser('ana@example.test', 'ana'));
    expect(cb.location).toBe('/');
    expect(ms.lastScope).toBe('openid profile email');
    expect(ms.graphRequests).toHaveLength(0);
    expect(await rows(ana.id)).toHaveLength(0);
  });

  it('CA-RN-144.8 ligar a opção vai para a auditoria; provedor não configurado → 422', async () => {
    const on = await setPhoto('microsoft', true);
    expect(on.status).toBe(200);
    expect(on.body.sso.providers.find((p) => p.provider === 'microsoft')?.photoEnabled).toBe(true);
    expect(await t.db.dataSource.getRepository(AuditLog).countBy({ action: 'sso.photo_enabled' })).toBe(1);
    // Ligar de novo não registra outra vez.
    await setPhoto('microsoft', true);
    expect(await t.db.dataSource.getRepository(AuditLog).countBy({ action: 'sso.photo_enabled' })).toBe(1);
    expect((await admin.put('/admin/access/providers/x/photo', { enabled: true })).status).toBeGreaterThanOrEqual(400);
  });

  it('CA-RN-144.2 e .5 Microsoft: pede User.Read, busca pelo Graph com o token, guarda à parte e NÃO troca a foto sozinha', async () => {
    const ana = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'ana@example.test' });
    const { b, cb } = await login('microsoft', msUser('ana@example.test', 'ana'));
    expect(cb.location).toBe('/');
    expect(ms.lastScope).toBe('openid profile email User.Read');
    expect(ms.graphRequests).toEqual([{ path: '/v1.0/me/photos/504x504/$value', authorized: true }]);
    const stored = await rows(ana.id);
    expect(stored.map((r) => [r.source, r.mime, r.width])).toEqual([['microsoft', 'image/webp', 256]]);
    // Nada troca sozinho: a pessoa continua com as iniciais.
    expect((await meOf(b)).photoVersion).toBeNull();
    const opts = await api(b).get<Options>(`/users/${ana.id}/photo/options`);
    expect(opts.body.choice).toBe('upload');
    expect(opts.body.sources.map((s) => s.source)).toEqual(['microsoft']);
    // A prévia da origem abre para a própria pessoa.
    expect((await b.hop(`/api/users/${ana.id}/photo/sources/microsoft`)).status).toBe(200);
    // Escolher a da Microsoft: passa a valer em todas as telas.
    const chosen = await api(b).put<Options>(`/users/${ana.id}/photo/choice`, { choice: 'microsoft' });
    expect([chosen.status, chosen.body.choice]).toEqual([200, 'microsoft']);
    const version = (await meOf(b)).photoVersion;
    expect(version).toMatch(/^m\d+$/);
    const list = await admin.get<{ items: { id: string; photoVersion: string | null }[] }>('/users?pageSize=100');
    expect(list.body.items.find((u) => u.id === ana.id)?.photoVersion).toBe(version);
    expect((await admin.raw(`/users/${ana.id}/photo`)).status).toBe(200);
    expect(await t.db.dataSource.getRepository(AuditLog).countBy({ action: 'user.photo_choice_changed' })).toBe(1);
  });

  it('CA-RN-144.6 escolhida a do provedor, o login seguinte atualiza; com a enviada escolhida, nada muda', async () => {
    const ana = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'ana@example.test' });
    const { b: b1 } = await login('microsoft', msUser('ana@example.test', 'ana'));
    const before = (await meOf(b1)).photoVersion;
    await new Promise((r) => setTimeout(r, 10));
    ms.graphPhoto = { status: 200, body: await image('#b45309'), type: 'image/jpeg' };
    const { b: b2 } = await login('microsoft', msUser('ana@example.test', 'ana'));
    const after = (await meOf(b2)).photoVersion;
    expect(after).not.toBe(before);
    expect(after).toMatch(/^m\d+$/);
    // Enviar uma foto passa a usá-la; o próximo login não a troca.
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(await image('#4f46e5', 'png'))], { type: 'image/png' }), 'eu.png');
    const up = await b2.hop(`/api/users/${ana.id}/photo`, { method: 'PUT', body: form });
    expect(up.status).toBe(200);
    const sent = JSON.parse(up.body) as { version: string };
    expect(sent.version).toMatch(/^u\d+$/);
    ms.graphPhoto = { status: 200, body: await image('#be123c'), type: 'image/jpeg' };
    const { b: b3 } = await login('microsoft', msUser('ana@example.test', 'ana'));
    expect((await meOf(b3)).photoVersion).toBe(sent.version);
  });

  it('o Graph sem o tamanho pedido cai na foto original; escolher origem sem foto → 422; a padrão sempre vale', async () => {
    const bia = await dbUser('bia@example.test');
    ms.graphPhoto = { status: 200, body: await image('#0f766e'), type: 'image/jpeg', sizedMissing: true };
    const { b } = await login('microsoft', msUser('bia@example.test', 'bia'));
    expect(ms.graphRequests.map((r) => r.path)).toEqual(['/v1.0/me/photos/504x504/$value', '/v1.0/me/photo/$value']);
    expect((await rows(bia.id)).map((r) => r.source)).toEqual(['microsoft']);
    expect((await api(b).put(`/users/${bia.id}/photo/choice`, { choice: 'google' })).status).toBe(422);
    expect((await api(b).put(`/users/${bia.id}/photo/choice`, { choice: 'upload' })).status).toBe(422);
    expect((await api(b).put(`/users/${bia.id}/photo/choice`, { choice: 'microsoft' })).status).toBe(200);
    expect((await api(b).put(`/users/${bia.id}/photo/choice`, { choice: 'default' })).status).toBe(200);
    expect((await meOf(b)).photoVersion).toBeNull();
    // Outra pessoa não escolhe nem vê as opções de Bia (negativo).
    const { b: ana } = await login('microsoft', msUser('ana@example.test', 'ana'));
    expect((await api(ana).get(`/users/${bia.id}/photo/options`)).status).toBe(403);
    expect((await api(ana).put(`/users/${bia.id}/photo/choice`, { choice: 'microsoft' })).status).toBe(403);
    expect((await ana.hop(`/api/users/${bia.id}/photo/sources/microsoft`)).status).toBe(403);
  });

  it('CA-RN-144.3 foto que falha (404, tempo, 6 MB, HTML, redirecionamento) não impede o login nem grava nada (negativo)', async () => {
    const caio = await dbUser('caio@example.test');
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const big = Buffer.alloc(6 * 1024 * 1024, 1);
    const cases = [
      { status: 404, body: Buffer.alloc(0), type: 'text/plain' },
      { status: 200, body: await image('#0f766e'), type: 'image/jpeg', delayMs: 5_600 },
      { status: 200, body: big, type: 'image/jpeg' },
      { status: 200, body: html, type: 'image/jpeg' },
      { status: 200, body: Buffer.alloc(0), type: 'image/jpeg', redirect: `http://127.0.0.1:${trapPort}/foto.jpg` },
    ];
    for (const photo of cases) {
      ms.graphPhoto = photo;
      const { cb } = await login('microsoft', msUser('caio@example.test', 'caio'));
      expect(cb.location, JSON.stringify({ ...photo, body: photo.body.length })).toBe('/');
      expect(await rows(caio.id)).toHaveLength(0);
    }
    expect(trapHits).toBe(0);
  }, 30_000);

  it('CA-RN-144.2 e .4 Google: busca o `picture` (512 px) só no host permitido; outro endereço não recebe conexão', async () => {
    expect((await setPhoto('google', true)).status).toBe(200);
    gg.googlePhoto = { status: 200, body: await image('#7c3aed', 'png'), type: 'image/png' };
    const duda = await dbUser('duda@example.test');
    const ok = await login('google', gUser('duda@example.test', 'duda', `${gg.base}/picture/abc=s96-c`));
    expect(ok.cb.location).toBe('/');
    expect(gg.pictureRequests).toBe(1);
    expect((await rows(duda.id)).map((r) => r.source)).toEqual(['google']);
    // Fora da lista: loopback de outra porta, http, domínio qualquer, com usuário na URL.
    const eva = await dbUser('eva@example.test');
    for (const picture of [
      `http://127.0.0.1:${trapPort}/picture/x`,
      `http://localhost:${trapPort}/picture/x`,
      'https://exemplo-malicioso.test/foto.jpg',
      `http://user:pass@127.0.0.1:${gg.port}/picture/x`,
    ]) {
      const r = await login('google', gUser('eva@example.test', 'eva', picture));
      expect(r.cb.location, picture).toBe('/');
    }
    expect(trapHits).toBe(0);
    expect(await rows(eva.id)).toHaveLength(0);
  });

  it('CA-RN-144.7 desligar apaga as fotos do provedor (quem usava volta à enviada ou à padrão); desvincular apaga a daquele provedor', async () => {
    const duda = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'duda@example.test' });
    const { b } = await login('google', gUser('duda@example.test', 'duda', `${gg.base}/picture/abc=s96-c`));
    expect((await api(b).put(`/users/${duda.id}/photo/choice`, { choice: 'google' })).status).toBe(200);
    expect((await meOf(b)).photoVersion).toMatch(/^g\d+$/);
    expect((await setPhoto('google', false)).status).toBe(200);
    expect(await rows(duda.id)).toHaveLength(0);
    expect((await t.db.dataSource.getRepository(User).findOneByOrFail({ id: duda.id })).photoChoice).toBe('upload');
    expect((await meOf(b)).photoVersion).toBeNull();
    expect(
      (await t.db.dataSource.getRepository(AuditLog).findOneByOrFail({ action: 'sso.photo_disabled' })).data,
    ).toMatchObject({ provider: 'google' });
    // Desvincular a Microsoft de Bia apaga a foto da Microsoft dela.
    const bia = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'bia@example.test' });
    expect((await rows(bia.id)).map((r) => r.source)).toEqual(['microsoft']);
    expect((await admin.request('DELETE', `/users/${bia.id}/identities/microsoft`)).status).toBe(200);
    expect(await rows(bia.id)).toHaveLength(0);
    // Anonimizar apaga todas (enviada e do provedor).
    const ana = await t.db.dataSource.getRepository(User).findOneByOrFail({ email: 'ana@example.test' });
    expect((await rows(ana.id)).length).toBe(2);
    expect((await admin.post(`/users/${ana.id}/disable`)).status).toBe(200);
    expect((await admin.post(`/users/${ana.id}/anonymize`)).status).toBe(200);
    expect(await rows(ana.id)).toHaveLength(0);
  });

  it('CA-T.22 o token de acesso do provedor não aparece no banco (auditoria e usuários)', async () => {
    expect(ms.accessTokens.length).toBeGreaterThan(0);
    const dump = JSON.stringify([
      await t.db.dataSource.query('SELECT action, data FROM audit_log'),
      await t.db.dataSource.query('SELECT * FROM user_identity'),
      await t.db.dataSource.query('SELECT stored_name, source FROM user_avatar'),
    ]);
    for (const token of ms.accessTokens) expect(dump).not.toContain(token);
  });
});
