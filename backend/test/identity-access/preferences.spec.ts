import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Me {
  locale: string;
  theme: string;
  navCollapsed: boolean;
}

describe('Preferências da conta (idioma, tema e menu lateral)', () => {
  let t: TestApp;
  let admin: Client;

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('a conta nasce com tema igual ao sistema, menu aberto e o idioma da instalação', async () => {
    const me = (await admin.get<Me>('/auth/me')).body;
    expect(me).toMatchObject({ locale: 'pt-BR', theme: 'system', navCollapsed: false });
  });

  it('salva as preferências na conta e elas voltam em outro navegador (nova sessão)', async () => {
    const res = await admin.request<Me>('PATCH', '/auth/me/preferences', {
      theme: 'dark',
      navCollapsed: true,
      locale: 'en',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ theme: 'dark', navCollapsed: true, locale: 'en' });

    const other = new Client(t.baseUrl);
    const login = await other.post<Me>('/auth/login', { email: INSTALL_INPUT.adminEmail, password: STRONG_PASSWORD });
    expect(login.body).toMatchObject({ theme: 'dark', navCollapsed: true, locale: 'en' });
  });

  it('altera só o que foi enviado', async () => {
    const res = await admin.request<Me>('PATCH', '/auth/me/preferences', { navCollapsed: false });
    expect(res.body).toMatchObject({ theme: 'dark', navCollapsed: false, locale: 'en' });
  });

  it('recusa valores inválidos ou corpo vazio, e exige sessão', async () => {
    expect((await admin.request('PATCH', '/auth/me/preferences', { theme: 'roxo' })).status).toBe(400);
    expect((await admin.request('PATCH', '/auth/me/preferences', { locale: 'fr' })).status).toBe(400);
    expect((await admin.request('PATCH', '/auth/me/preferences', {})).status).toBe(400);
    expect((await new Client(t.baseUrl).request('PATCH', '/auth/me/preferences', { theme: 'light' })).status).toBe(401);
  });
});
