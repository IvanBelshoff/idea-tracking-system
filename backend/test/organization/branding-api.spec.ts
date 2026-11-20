import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { ITS_BRAND } from '../../src/organization/brand-color.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Branding {
  light: { brand: string; brandFg: string };
  dark: { brand: string; brandFg: string };
  lightHex: string;
  adjusted: { light: boolean; dark: boolean };
}

describe('Identidade visual: cor da marca (M10)', () => {
  let t: TestApp;
  let admin: Client;
  let colab: Client;

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    const u = await ds
      .getRepository(User)
      .save(
        ds
          .getRepository(User)
          .create({ email: 'colab@example.test', name: 'Colab', passwordHash: await hashPassword(STRONG_PASSWORD) }),
      );
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: 'collaborator' });
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId: org.id }));
    colab = new Client(t.baseUrl);
    expect((await colab.post('/auth/login', { email: 'colab@example.test', password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  });
  afterAll(async () => {
    await t?.close();
  });

  const branding = async () =>
    (await new Client(t.baseUrl).get<{ branding: Branding }>('/settings/public')).body.branding;

  it('sem escolha, as configurações públicas (usadas no login, sem sessão) trazem o índigo do ITS', async () => {
    expect(await branding()).toEqual(ITS_BRAND);
  });

  it('o admin escolhe uma cor; os dois temas saem derivados e a mudança vai para a auditoria', async () => {
    const res = await admin.request('PATCH', '/settings', { values: { 'branding.color': '#0B6E4F' } });
    expect(res.status).toBe(200);
    const b = await branding();
    expect(b.lightHex).toBe('#0b6e4f');
    expect(b.light.brand).not.toBe(ITS_BRAND.light.brand);
    expect(b.dark.brand).not.toBe(ITS_BRAND.dark.brand);
    expect(b.adjusted).toEqual({ light: false, dark: false });
    const audit = await t.db.dataSource.query(
      `SELECT data FROM audit_log WHERE action = 'setting.updated' AND target_id = 'branding.color'`,
    );
    expect(audit[0]?.data).toMatchObject({ before: null, after: '#0b6e4f' });
  });

  it('cor inválida → 400; sem setting.manage → 403; voltar ao padrão com nulo', async () => {
    expect((await admin.request('PATCH', '/settings', { values: { 'branding.color': 'verde' } })).status).toBe(400);
    expect((await admin.request('PATCH', '/settings', { values: { 'branding.color': '#0B6E4' } })).status).toBe(400);
    expect((await colab.request('PATCH', '/settings', { values: { 'branding.color': '#123456' } })).status).toBe(403);
    expect((await admin.request('PATCH', '/settings', { values: { 'branding.color': null } })).status).toBe(200);
    expect(await branding()).toEqual(ITS_BRAND);
  });

  it('pré-visualização: o mesmo cálculo de salvar; amarelo volta corrigido e marcado; só para quem administra', async () => {
    const yellow = await admin.post<Branding>('/settings/branding/preview', { color: '#FFD400' });
    expect(yellow.status).toBe(200);
    expect(yellow.body.adjusted.light).toBe(true);
    const darkBad = await admin.post<Branding>('/settings/branding/preview', {
      color: '#0b6e4f',
      colorDark: '#0b3020',
    });
    expect(darkBad.body.adjusted).toEqual({ light: false, dark: true });
    expect((await admin.post('/settings/branding/preview', { color: 'azul' })).status).toBe(400);
    expect((await colab.post('/settings/branding/preview', { color: '#0b6e4f' })).status).toBe(403);
    // Pré-visualizar não salva nada.
    expect(await branding()).toEqual(ITS_BRAND);
  });

  it('ajuda: /ajuda/ por padrão (público); aceita outro caminho ou https://; recusa http:// e //host', async () => {
    const helpUrl = async () => (await new Client(t.baseUrl).get<{ helpUrl: string }>('/settings/public')).body.helpUrl;
    expect(await helpUrl()).toBe('/ajuda/');
    const set = (v: string) => admin.request('PATCH', '/settings', { values: { 'help.docs_url': v } });
    expect((await set('/manual')).status).toBe(200);
    expect(await helpUrl()).toBe('/manual/'); // sempre termina em /
    expect((await set('https://ajuda.example.com/its')).status).toBe(200);
    expect(await helpUrl()).toBe('https://ajuda.example.com/its/');
    expect((await set('http://ajuda.example.com')).status).toBe(400);
    expect((await set('//outro-host/ajuda')).status).toBe(400);
    expect((await set('javascript:alert(1)')).status).toBe(400);
    expect((await colab.request('PATCH', '/settings', { values: { 'help.docs_url': '/x/' } })).status).toBe(403);
    expect((await set('/ajuda/')).status).toBe(200);
    expect(await helpUrl()).toBe('/ajuda/');
  });

  it('fonte: Geist por padrão; o admin escolhe entre as quatro; outra qualquer → 400', async () => {
    const font = async () => (await new Client(t.baseUrl).get<{ font: string }>('/settings/public')).body.font;
    expect(await font()).toBe('geist');
    expect((await admin.request('PATCH', '/settings', { values: { 'branding.font': 'atkinson' } })).status).toBe(200);
    expect(await font()).toBe('atkinson');
    expect((await admin.request('PATCH', '/settings', { values: { 'branding.font': 'comic-sans' } })).status).toBe(400);
    expect((await colab.request('PATCH', '/settings', { values: { 'branding.font': 'inter' } })).status).toBe(403);
    // Voltar ao padrão apaga a linha (o banco guarda só o que difere do padrão).
    expect((await admin.request('PATCH', '/settings', { values: { 'branding.font': 'geist' } })).status).toBe(200);
    expect(await font()).toBe('geist');
    expect(await t.db.dataSource.query(`SELECT 1 FROM setting WHERE key = 'branding.font'`)).toHaveLength(0);
  });

  // --- Logo da organização (co-branding) ---------------------------------------------------------
  /** PNG 400×200 com borda transparente e um retângulo verde de 300×60 no meio. */
  const logoPng = () =>
    sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        {
          input: { create: { width: 300, height: 60, channels: 4, background: { r: 11, g: 110, b: 79, alpha: 1 } } },
          left: 50,
          top: 70,
        },
      ])
      .png()
      .toBuffer();
  const logoFiles = () => readdirSync(join(process.env.STORAGE_DIR ?? '', 'branding'));

  it('logo: PNG aceito, borda aparada, encaixado sem distorcer, sugere a cor dominante e é público', async () => {
    const res = await admin.upload<{ version: string; suggestedColor: string | null }>(
      '/branding/logo/light',
      'logo.png',
      await logoPng(),
      'image/png',
      'PUT',
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.version).toMatch(/^\d+$/);
    expect(res.body.suggestedColor).toBe('#0b6e4f');
    const anon = await new Client(t.baseUrl).raw('/branding/logo/light');
    expect(anon.status).toBe(200);
    expect(anon.headers.get('content-type')).toBe('image/webp');
    expect(anon.headers.get('x-content-type-options')).toBe('nosniff');
    const meta = await sharp(Buffer.from(await anon.arrayBuffer())).metadata();
    // 300×60 aparado, encaixado em até 480×96 sem ampliar: continua 300×60 (proporção 5:1).
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 300, 60]);
    expect(meta.exif).toBeUndefined();
    const pub = (
      await new Client(t.baseUrl).get<{ logo: { light: string | null; dark: string | null } }>('/settings/public')
    ).body.logo;
    expect(pub).toEqual({ light: res.body.version, dark: null });
    expect((await new Client(t.baseUrl).raw('/branding/logo/dark')).status).toBe(404);
  });

  it('logo: SVG, JPEG ou arquivo qualquer → 415; acima de 2 MB → 413; sem setting.manage → 403', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    expect((await admin.upload('/branding/logo/light', 'logo.png', svg, 'image/png', 'PUT')).status).toBe(415);
    const jpeg = await sharp({ create: { width: 50, height: 20, channels: 3, background: '#0b6e4f' } })
      .jpeg()
      .toBuffer();
    expect((await admin.upload('/branding/logo/light', 'logo.png', jpeg, 'image/png', 'PUT')).status).toBe(415);
    expect(
      (await admin.upload('/branding/logo/light', 'logo.png', Buffer.from('MZ fake exe'), 'image/png', 'PUT')).status,
    ).toBe(415);
    const noise = Buffer.alloc(1400 * 1400 * 3);
    for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) % 251;
    const big = await sharp(noise, { raw: { width: 1400, height: 1400, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(big.length).toBeGreaterThan(2 * 1024 * 1024);
    expect((await admin.upload('/branding/logo/light', 'logo.png', big, 'image/png', 'PUT')).status).toBe(413);
    expect((await colab.upload('/branding/logo/light', 'logo.png', await logoPng(), 'image/png', 'PUT')).status).toBe(
      403,
    );
    expect(
      (await admin.upload('/branding/logo/sideways', 'logo.png', await logoPng(), 'image/png', 'PUT')).status,
    ).toBe(404);
  });

  it('logo: WebP no tema escuro; trocar apaga o arquivo anterior; remover apaga e registra auditoria', async () => {
    const webp = await sharp(await logoPng())
      .webp()
      .toBuffer();
    expect((await admin.upload('/branding/logo/dark', 'logo.webp', webp, 'image/webp', 'PUT')).status).toBe(200);
    const before = logoFiles().length;
    expect((await admin.upload('/branding/logo/light', 'logo.png', await logoPng(), 'image/png', 'PUT')).status).toBe(
      200,
    );
    expect(logoFiles().length).toBe(before); // o anterior saiu
    expect((await admin.request('DELETE', '/branding/logo/dark')).status).toBe(204);
    expect((await new Client(t.baseUrl).raw('/branding/logo/dark')).status).toBe(404);
    expect(logoFiles().length).toBe(before - 1);
    const audit = await t.db.dataSource.query(`SELECT action FROM audit_log WHERE action LIKE 'branding.logo_%'`);
    expect(audit.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['branding.logo_changed', 'branding.logo_removed']),
    );
  });
});
