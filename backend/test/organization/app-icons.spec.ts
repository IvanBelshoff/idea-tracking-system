import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ICONS, type AppIconFile, appManifest, renderAppIcon } from '../../src/organization/app-icons.js';
import { deriveBrand, ITS_BRAND } from '../../src/organization/brand-color.js';
import { ITS_PA } from '../../src/organization/its-symbol-path.js';
import { Client, createTestApp, INSTALL_INPUT, type TestApp } from '../support/test-app.js';

const FRONT = join(process.cwd(), '..', 'frontend');

/** Diferença média por canal (0 a 255) entre dois PNGs do mesmo tamanho. */
async function meanDiff(a: Buffer, b: Buffer): Promise<number> {
  const x = await sharp(a).ensureAlpha().raw().toBuffer();
  const y = await sharp(b).ensureAlpha().raw().toBuffer();
  let sum = 0;
  for (let i = 0; i < x.length; i += 1) sum += Math.abs((x[i] ?? 0) - (y[i] ?? 0));
  return sum / x.length;
}

const pixel = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  const hex = (v: number | undefined) => (v ?? 0).toString(16).padStart(2, '0');
  return `#${hex(data[i])}${hex(data[i + 1])}${hex(data[i + 2])}`;
};

describe('App instalável na cor da organização (M10, RN-83)', () => {
  describe('composição', () => {
    it('o caminho do símbolo no backend é o mesmo do frontend (gerados juntos pelo gen-symbol)', () => {
      const front = readFileSync(join(FRONT, 'src/components/brand/its-symbol-path.ts'), 'utf8');
      expect(front).toContain(`'${ITS_PA}'`);
    });

    it('no padrão, os ícones gerados são os mesmos PNGs estáticos do ITS (mesma composição)', async () => {
      for (const file of Object.keys(APP_ICONS) as AppIconFile[]) {
        const generated = await renderAppIcon(file, ITS_BRAND.lightHex);
        const stat = readFileSync(join(FRONT, 'public/icons', file));
        const [g, s] = await Promise.all([sharp(generated).metadata(), sharp(stat).metadata()]);
        expect([file, g.width, g.height]).toEqual([file, s.width, s.height]);
        // Só a suavização das bordas pode variar.
        expect(await meanDiff(generated, stat)).toBeLessThan(1.5);
      }
    });

    it('a reserva estática do nginx (public/its.webmanifest) é o manifesto padrão, com os PNGs estáticos', () => {
      const stat = JSON.parse(readFileSync(join(FRONT, 'public/its.webmanifest'), 'utf8'));
      const toStatic = (src: string) => src.replace(/^\/api\/branding\/icons\/([^?]+)\?v=.*$/, '/icons/$1');
      const generated = JSON.parse(JSON.stringify(appManifest(ITS_BRAND.lightHex)), (key, value) =>
        key === 'src' ? toStatic(value) : value,
      );
      expect(stat).toEqual(generated);
    });
  });

  describe('API', () => {
    let t: TestApp;
    let admin: Client;
    const anon = () => new Client(t.baseUrl);

    beforeAll(async () => {
      t = await createTestApp();
      admin = new Client(t.baseUrl);
      // Antes do assistente: manifesto e ícones já respondem (o app é instalável desde a 1ª página).
      expect((await anon().raw('/branding/manifest.webmanifest')).status).toBe(200);
      expect((await anon().raw('/branding/icons/icon-192.png')).status).toBe(200);
      expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    });
    afterAll(async () => {
      await t?.close();
    });

    const manifest = async () => {
      const res = await anon().raw('/branding/manifest.webmanifest');
      return { res, body: (await res.json()) as ReturnType<typeof appManifest> };
    };

    it('sem cor escolhida: manifesto público com o índigo do ITS, id fixo e sem cache', async () => {
      const { res, body } = await manifest();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/manifest+json');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(body.id).toBe('/');
      expect(body.theme_color).toBe('#5458c8');
      expect(body.icons.map((i) => i.src)).toEqual([
        '/api/branding/icons/icon-192.png?v=5458c8',
        '/api/branding/icons/icon-512.png?v=5458c8',
        '/api/branding/icons/maskable-512.png?v=5458c8',
      ]);
    });

    it('com a cor da organização: manifesto e ícones mudam; o símbolo continua branco', async () => {
      expect((await admin.request('PATCH', '/settings', { values: { 'branding.color': '#0B6E4F' } })).status).toBe(200);
      const hex = deriveBrand('#0b6e4f').lightHex;
      const v = hex.slice(1);
      const { body } = await manifest();
      expect(body.theme_color).toBe(hex);
      expect(body.icons[0]?.src).toBe(`/api/branding/icons/icon-192.png?v=${v}`);

      const res = await anon().raw(`/branding/icons/maskable-512.png?v=${v}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      const png = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(png).metadata();
      expect([meta.width, meta.height]).toEqual([512, 512]);
      expect(await pixel(png, 4, 4)).toBe(hex); // fundo cheio na cor da marca
      // O centro do símbolo (pá de 100%) é branco.
      const colors = new Set<string>();
      for (let x = 160; x < 352; x += 8) colors.add(await pixel(png, x, 256));
      expect(colors).toContain('#ffffff');

      // Ícone do iPhone (sem versão na URL): sempre revalida, já na cor nova.
      const apple = await anon().raw('/branding/icons/apple-touch-icon.png');
      expect(apple.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
      const applePng = Buffer.from(await apple.arrayBuffer());
      expect((await sharp(applePng).metadata()).width).toBe(180);
      expect(await pixel(applePng, 2, 2)).toBe(hex);
    });

    it('ícone de versão antiga não fica em cache longo; arquivo desconhecido → 404', async () => {
      const old = await anon().raw('/branding/icons/icon-192.png?v=5458c8');
      expect(old.status).toBe(200);
      expect(old.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
      expect((await anon().raw('/branding/icons/favicon.ico')).status).toBe(404);
      expect((await anon().raw('/branding/icons/..%2F..%2Fpackage.json')).status).toBe(404);
    });

    it('voltar ao padrão devolve o índigo do ITS', async () => {
      expect((await admin.request('PATCH', '/settings', { values: { 'branding.color': null } })).status).toBe(200);
      expect((await manifest()).body.theme_color).toBe('#5458c8');
    });
  });
});
