import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Appearance {
  allowed: boolean;
  color: string | null;
  font: string | null;
  branding: { light: { brand: string }; lightHex: string } | null;
  palette: { key: string }[];
}
interface Me {
  appearance: Appearance;
}

describe('Cor e fonte de cada pessoa (M20, RN-145)', () => {
  let t: TestApp;
  let admin: Client;
  let ana: Client;
  let bia: Client;

  async function person(key: string) {
    const ds = t.db.dataSource;
    const u = await ds
      .getRepository(User)
      .save(
        ds
          .getRepository(User)
          .create({ email: `${key}@example.test`, name: key, passwordHash: await hashPassword(STRONG_PASSWORD) }),
      );
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: 'collaborator' });
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId: org.id }));
    const c = new Client(t.baseUrl);
    expect((await c.post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(200);
    return c;
  }
  const prefs = (c: Client, body: object) => c.request<Me>('PATCH', '/auth/me/preferences', body);
  const setting = (on: boolean) => admin.request('PATCH', '/settings', { values: { 'branding.user_theme': on } });
  const me = async (c: Client) => (await c.get<Me>('/auth/me')).body.appearance;

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    ana = await person('ana');
    bia = await person('bia');
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-145.1 com a chave desligada (padrão), ninguém grava cor nem fonte e a aparência não aparece (negativo)', async () => {
    expect(await me(ana)).toEqual({ allowed: false, color: null, font: null, branding: null, palette: [] });
    const denied = await prefs(ana, { uiColor: 'teal' });
    expect([denied.status, (denied.body as unknown as { code: string }).code]).toEqual([403, 'user_theme_disabled']);
    expect((await prefs(ana, { uiFont: 'plex' })).status).toBe(403);
    // O resto das preferências segue funcionando.
    expect((await prefs(ana, { navCollapsed: true })).status).toBe(200);
  });

  it('CA-RN-145.2 ligada, grava cor da paleta e fonte conhecida; cor livre ou fonte inventada → recusa (negativo)', async () => {
    expect((await setting(true)).status).toBe(200);
    const ok = await prefs(ana, { uiColor: 'teal', uiFont: 'plex' });
    expect(ok.status).toBe(200);
    expect(ok.body.appearance).toMatchObject({ allowed: true, color: 'teal', font: 'plex' });
    expect(ok.body.appearance.branding?.lightHex).toMatch(/^#[0-9a-f]{6}$/);
    expect(ok.body.appearance.palette).toHaveLength(8);
    for (const bad of [{ uiColor: '#ff0000' }, { uiColor: 'turquesa' }, { uiFont: 'comic-sans' }]) {
      const r = await prefs(ana, bad);
      expect(r.status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
    expect(await me(ana)).toMatchObject({ color: 'teal', font: 'plex' });
  });

  it('CA-RN-145.4 e .5 a escolha vale só para a própria pessoa; a identidade da organização não muda', async () => {
    const other = await me(bia);
    expect(other).toMatchObject({ allowed: true, color: null, font: null, branding: null });
    const pub = (await new Client(t.baseUrl).get<{ branding: { lightHex: string }; font: string }>('/settings/public'))
      .body;
    expect(pub.branding.lightHex).toBe('#5458c8');
    expect(pub.font).toBe('geist');
    // Voltar à da organização.
    const back = await prefs(bia, { uiColor: 'violet' });
    expect(back.body.appearance.color).toBe('violet');
    const reset = await prefs(bia, { uiColor: null, uiFont: null });
    expect(reset.body.appearance).toMatchObject({ color: null, font: null, branding: null });
  });

  it('CA-RN-145.6 desligar devolve todos à identidade da organização; religar devolve a escolha guardada', async () => {
    expect((await setting(false)).status).toBe(200);
    expect(await me(ana)).toEqual({ allowed: false, color: null, font: null, branding: null, palette: [] });
    expect((await setting(true)).status).toBe(200);
    expect(await me(ana)).toMatchObject({ allowed: true, color: 'teal', font: 'plex' });
  });
});
