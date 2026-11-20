import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { LOGIN_DEFAULT, type LoginScreenConfig } from '../../src/organization/login-screen-rules.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

type Media = { version: string; sizeBytes: number } | null;
type Admin = { config: LoginScreenConfig; media: { image: Media; poster: Media; video: Media } };
type PublicLogin = {
  layout: string;
  background: {
    type: string;
    color1: string;
    color2: string;
    imageVersion: string | null;
    videoVersion: string | null;
  };
  title: { ptBR: string; en: string };
  text: { onBackground: boolean; tone: string; plate: number | null };
};

/** Um MP4 mínimo: só o cabeçalho `ftyp` (o tipo é decidido pelo conteúdo, não pelo nome). */
const mp4 = (size = 4096) => {
  const head = Buffer.from('\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41', 'latin1');
  return Buffer.concat([head, Buffer.alloc(size - head.length, 1)]);
};

describe('Tela de login: API (M23)', () => {
  let t: TestApp;
  let admin: Client;
  let colab: Client;
  const anon = () => new Client(t.baseUrl);
  const publicLogin = async () => (await anon().get<{ login: PublicLogin }>('/settings/public')).body.login;
  const config = (
    change: Partial<Omit<LoginScreenConfig, 'background'>> & { background?: Partial<LoginScreenConfig['background']> },
  ) => ({
    ...LOGIN_DEFAULT,
    ...change,
    background: { ...LOGIN_DEFAULT.background, ...(change.background ?? {}) },
  });

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

  it('CA-RN-176.1 de fábrica, a configuração pública traz o cartão central sem fundo nem textos', async () => {
    const login = await publicLogin();
    expect(login.layout).toBe('card');
    expect(login.background.type).toBe('none');
    expect(login.title).toEqual({ ptBR: '', en: '' });
    expect(login.text.onBackground).toBe(false);
  });

  it('CA-RN-180.1 sem setting.manage, toda rota de configuração → 403; sem sessão → 401', async () => {
    expect((await colab.get('/branding/login')).status).toBe(403);
    expect((await colab.request('PUT', '/branding/login', LOGIN_DEFAULT)).status).toBe(403);
    expect((await colab.post('/branding/login/reset', {})).status).toBe(403);
    expect(
      (await colab.upload('/branding/login/media/image', 'f.png', Buffer.from('x'), 'image/png', 'PUT')).status,
    ).toBe(403);
    expect((await colab.request('DELETE', '/branding/login/media/image')).status).toBe(403);
    expect((await anon().get('/branding/login')).status).toBe(401);
  });

  it('CA-RN-176.2 CA-RN-177.2 CA-RN-179.1 valores fora da regra → 422 e nada muda', async () => {
    for (const body of [
      config({ layout: 'carousel' as never }),
      config({ background: { overlayOpacity: 95 } }),
      config({ background: { blur: 30 } }),
      config({ background: { type: 'gradient', color1: 'azul' } }),
      config({ title: { ptBR: 'x'.repeat(81), en: '' } }),
      config({ subtitle: { ptBR: 'y'.repeat(201), en: '' } }),
    ]) {
      expect((await admin.request('PUT', '/branding/login', body)).status).toBe(422);
    }
    expect((await publicLogin()).layout).toBe('card');
  });

  it('CA-RN-179.1 CA-RN-180.3 salvar grava os campos e a auditoria lista o que mudou, sem os valores', async () => {
    const body = config({
      layout: 'split',
      side: 'left',
      background: { type: 'gradient', color1: '#0B6E4F', color2: '#063D2C' },
      title: { ptBR: '<b>Melhoria</b> contínua', en: 'Continuous improvement' },
    });
    const res = await admin.request<Admin>('PUT', '/branding/login', body);
    expect(res.status).toBe(200);
    expect(res.body.config.background.color1).toBe('#0b6e4f');
    // HTML fica guardado como texto: quem mostra escapa (nunca interpreta).
    expect(res.body.config.title.ptBR).toBe('<b>Melhoria</b> contínua');
    const login = await publicLogin();
    expect(login.layout).toBe('split');
    expect(login.background.color1).toBe('#0b6e4f');
    expect(login.text).toEqual({ onBackground: true, tone: 'light', plate: null });
    const [row] = await t.db.dataSource.query(
      `SELECT data FROM audit_log WHERE action = 'branding.login_changed' ORDER BY at DESC LIMIT 1`,
    );
    expect(row.data.fields).toEqual([
      'layout',
      'side',
      'background.type',
      'background.color1',
      'background.color2',
      'title.ptBR',
      'title.en',
    ]);
    expect(JSON.stringify(row.data)).not.toContain('Melhoria');
    // Salvar de novo igual não gera auditoria.
    const before = await t.db.dataSource.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'branding.login_changed'`,
    );
    await admin.request('PUT', '/branding/login', body);
    const after = await t.db.dataSource.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'branding.login_changed'`,
    );
    expect(after[0].n).toBe(before[0].n);
  });

  it('CA-RN-180.2 a prévia calcula a tela de uma configuração não salva, sem gravar nada', async () => {
    const before = await publicLogin();
    const draft = config({
      layout: 'panel',
      background: { type: 'color', color1: '#ffffff' },
      title: { ptBR: 'Prévia', en: '' },
    });
    const res = await admin.post<PublicLogin>('/branding/login/preview', draft);
    expect(res.status).toBe(200);
    expect(res.body.layout).toBe('panel');
    expect(res.body.background.color1).toBe('#ffffff');
    // Fundo branco: o texto claro não passa, o escuro sim.
    expect(res.body.text).toEqual({ onBackground: true, tone: 'dark', plate: null });
    expect(await publicLogin()).toEqual(before);
    expect((await admin.post('/branding/login/preview', config({ layout: 'x' as never }))).status).toBe(422);
    expect((await colab.post('/branding/login/preview', draft)).status).toBe(403);
  });

  it('CA-RN-177.3 gradiente sem contraste: o texto fica no fundo com a placa; a cor escolhida é respeitada', async () => {
    const draft = config({ layout: 'split', background: { type: 'gradient', color1: '#0b4f8a', color2: '#ffbb00' } });
    const auto = await admin.post<PublicLogin>('/branding/login/preview', draft);
    expect(auto.body.text.onBackground).toBe(true);
    expect(auto.body.text.plate).toBeGreaterThanOrEqual(0.35);
    const dark = await admin.post<PublicLogin>('/branding/login/preview', { ...draft, textTone: 'dark' });
    expect(dark.body.text.tone).toBe('dark');
    expect(dark.body.text.plate).not.toBeNull();
    expect((await admin.post('/branding/login/preview', { ...draft, textTone: 'roxo' })).status).toBe(422);
  });

  it('o PATCH geral de configurações não grava a tela de login (só a API dela, que confere e audita)', async () => {
    const res = await admin.request('PATCH', '/settings', { values: { 'branding.login': LOGIN_DEFAULT } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('CA-RN-178.1 escolher imagem ou vídeo sem o arquivo → 422 (vídeo sem capa: login_video_needs_poster)', async () => {
    const image = await admin.request<{ code: string }>(
      'PUT',
      '/branding/login',
      config({ background: { type: 'image' } }),
    );
    expect(image.status).toBe(422);
    expect(image.body.code).toBe('login_media_missing');
    const up = await admin.upload('/branding/login/media/video', 'v.mp4', mp4(), 'video/mp4', 'PUT');
    expect(up.status).toBe(200);
    const video = await admin.request<{ code: string }>(
      'PUT',
      '/branding/login',
      config({ background: { type: 'video' } }),
    );
    expect(video.status).toBe(422);
    expect(video.body.code).toBe('login_video_needs_poster');
  });

  it('CA-RN-177.1 a imagem vira WebP sem metadados e com até 2560 px; outro tipo → 415; grande → 413', async () => {
    const photo = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: '#336699' } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'segredo-do-exif' } } })
      .toBuffer();
    const res = await admin.upload<Admin>('/branding/login/media/image', 'foto.jpg', photo, 'image/jpeg', 'PUT');
    expect(res.status).toBe(200);
    expect(res.body.media.image).not.toBeNull();
    const served = await fetch(`${t.baseUrl}/api/branding/login/media/image?v=${res.body.media.image?.version}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('cache-control')).toContain('public');
    const bytes = Buffer.from(await served.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(2560);
    expect(meta.exif).toBeUndefined();
    expect(bytes.toString('latin1')).not.toContain('segredo-do-exif');

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await admin.upload('/branding/login/media/image', 'f.png', svg, 'image/png', 'PUT')).status).toBe(415);
    const html = Buffer.from('<!doctype html><script>alert(1)</script>');
    expect((await admin.upload('/branding/login/media/poster', 'f.png', html, 'image/png', 'PUT')).status).toBe(415);
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    expect((await admin.upload('/branding/login/media/image', 'f.png', big, 'image/png', 'PUT')).status).toBe(413);
  });

  it('CA-RN-178.1 o vídeo é aceito pelo conteúdo (MP4 ou WebM); outro tipo → 415; acima de 20 MB → 413', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    expect((await admin.upload('/branding/login/media/video', 'v.mp4', png, 'video/mp4', 'PUT')).status).toBe(415);
    expect(
      (await admin.upload('/branding/login/media/video', 'v.mp4', mp4(20 * 1024 * 1024 + 1), 'video/mp4', 'PUT'))
        .status,
    ).toBe(413);
  });

  it('CA-RN-178.2 o vídeo é servido sem login, em partes (206), com nosniff; faixa fora → 416', async () => {
    const whole = await fetch(`${t.baseUrl}/api/branding/login/media/video`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/mp4');
    const part = await fetch(`${t.baseUrl}/api/branding/login/media/video`, { headers: { range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 0-99/4096');
    expect(part.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    const out = await fetch(`${t.baseUrl}/api/branding/login/media/video`, { headers: { range: 'bytes=9000-' } });
    expect(out.status).toBe(416);
    expect((await fetch(`${t.baseUrl}/api/branding/login/media/nada`)).status).toBe(404);
  });

  it('CA-RN-178.1 com a capa, o vídeo vira o fundo; o arquivo em uso não pode ser removido', async () => {
    const poster = await sharp({ create: { width: 800, height: 450, channels: 3, background: '#112233' } })
      .png()
      .toBuffer();
    expect((await admin.upload('/branding/login/media/poster', 'capa.png', poster, 'image/png', 'PUT')).status).toBe(
      200,
    );
    const res = await admin.request<Admin>(
      'PUT',
      '/branding/login',
      config({ background: { type: 'video', overlayOpacity: 60 } }),
    );
    expect(res.status).toBe(200);
    const login = await publicLogin();
    expect(login.background.type).toBe('video');
    expect(login.background.videoVersion).not.toBeNull();
    expect(login.text).toEqual({ onBackground: true, tone: 'light', plate: null });
    const inUse = await admin.request<{ code: string }>('DELETE', '/branding/login/media/poster');
    expect(inUse.status).toBe(422);
    expect(inUse.body.code).toBe('login_media_in_use');
    // A imagem não está em uso: sai, e a auditoria registra.
    const removed = await admin.request<Admin>('DELETE', '/branding/login/media/image');
    expect(removed.status).toBe(200);
    expect(removed.body.media.image).toBeNull();
  });

  it('CA-RN-177.4 trocar um arquivo apaga o antigo do disco; enviar e remover vão para a auditoria', async () => {
    const dir = join(process.env.STORAGE_DIR ?? 'storage', 'branding');
    const posters = () => readdirSync(dir).filter((f) => f.startsWith('login-poster-'));
    expect(posters()).toHaveLength(1);
    const poster = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#445566' } })
      .png()
      .toBuffer();
    expect((await admin.upload('/branding/login/media/poster', 'capa2.png', poster, 'image/png', 'PUT')).status).toBe(
      200,
    );
    expect(posters()).toHaveLength(1);
    const actions = (
      await t.db.dataSource.query(`SELECT action FROM audit_log WHERE action LIKE 'branding.login_media_%'`)
    ).map((r: { action: string }) => r.action);
    expect(actions).toContain('branding.login_media_changed');
    expect(actions).toContain('branding.login_media_removed');
  });

  it('CA-RN-180.4 a configuração pública traz só o layout, o fundo e os textos', async () => {
    const login = (await anon().get<{ login: Record<string, unknown> }>('/settings/public')).body.login;
    expect(Object.keys(login).sort()).toEqual(['background', 'layout', 'side', 'subtitle', 'text', 'title']);
  });

  it('CA-RN-180.3 restaurar o padrão volta ao cartão central e apaga os arquivos', async () => {
    const res = await admin.post<Admin>('/branding/login/reset', {});
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual(LOGIN_DEFAULT);
    expect(res.body.media).toEqual({ image: null, poster: null, video: null });
    const dir = join(process.env.STORAGE_DIR ?? 'storage', 'branding');
    expect(readdirSync(dir).filter((f) => f.startsWith('login-'))).toEqual([]);
    expect((await publicLogin()).layout).toBe('card');
    const [reset] = await t.db.dataSource.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'branding.login_reset'`,
    );
    expect(reset.n).toBe(1);
  });
});
