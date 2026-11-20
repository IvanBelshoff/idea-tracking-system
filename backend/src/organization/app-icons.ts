import sharp from 'sharp';
import { ITS_PA, ITS_PAS } from './its-symbol-path.js';

/**
 * Ícones e manifesto do app instalável (PWA, RN-83) na cor da organização. O símbolo é sempre o do
 * ITS (pás brancas); só o fundo segue a marca do tema claro, em que o branco passa de 4,5:1 por
 * regra da derivação. Mesma composição de frontend/scripts/gen-icons.mjs, que gera os PNGs
 * estáticos usados como reserva (índigo do ITS).
 */

type IconKind = 'rounded' | 'maskable' | 'apple';
export const APP_ICONS = {
  'icon-192.png': { size: 192, kind: 'rounded' },
  'icon-512.png': { size: 512, kind: 'rounded' },
  'maskable-512.png': { size: 512, kind: 'maskable' },
  'apple-touch-icon.png': { size: 180, kind: 'apple' },
} as const satisfies Record<string, { size: number; kind: IconKind }>;
export type AppIconFile = keyof typeof APP_ICONS;

export const isAppIconFile = (v: string): v is AppIconFile => Object.hasOwn(APP_ICONS, v);

const OPACITY = [1, 0.68, 0.36];
const pas = OPACITY.slice(0, ITS_PAS)
  .map(
    (o, i) => `<path d="${ITS_PA}" transform="rotate(${(360 / ITS_PAS) * i} 16 16)"${o < 1 ? ` opacity="${o}"` : ''}/>`,
  )
  .join('');

/** SVG do ícone: quadrado arredondado (comum) ou fundo cheio com o símbolo na zona segura. */
export function appIconSvg(kind: IconKind, hex: string): string {
  if (kind === 'rounded') {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      `<rect width="32" height="32" rx="8" fill="${hex}"/>` +
      `<g fill="#fff" transform="translate(3.2 3.2) scale(0.8)">${pas}</g></svg>`
    );
  }
  // "maskable" e Apple: o sistema recorta o fundo; o símbolo fica dentro da zona segura.
  const scale = kind === 'maskable' ? 0.56 : 0.7;
  const offset = 16 - 16 * scale;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    `<rect width="32" height="32" fill="${hex}"/>` +
    `<g fill="#fff" transform="translate(${offset} ${offset}) scale(${scale})">${pas}</g></svg>`
  );
}

export async function renderAppIcon(file: AppIconFile, hex: string): Promise<Buffer> {
  const { size, kind } = APP_ICONS[file];
  return sharp(Buffer.from(appIconSvg(kind, hex)), { density: 72 * (size / 32) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Versão dos ícones na URL: a própria cor, sem o "#". Trocar a cor troca a URL e renova o cache. */
export const iconVersion = (hex: string) => hex.replace('#', '').toLowerCase();

/**
 * Manifesto do app. O `id` é fixo ("/"): com a cor nova, o navegador atualiza o app já instalado
 * em vez de tratá-lo como outro. Espelhado em frontend/public/its.webmanifest (reserva do nginx
 * com a API fora do ar), conferido por teste.
 */
export function appManifest(hex: string) {
  const icon = (file: AppIconFile) => `/api/branding/icons/${file}?v=${iconVersion(hex)}`;
  return {
    id: '/',
    name: 'ITS · Acompanhamento de Ideias',
    short_name: 'ITS',
    description: 'Envie ideias de melhoria e acompanhe cada passo até a implementação.',
    lang: 'pt-BR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: hex,
    background_color: '#ffffff',
    categories: ['business', 'productivity'],
    icons: [
      { src: icon('icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icon('icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: icon('maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Enviar ideia',
        short_name: 'Enviar',
        url: '/ideias/nova',
        icons: [{ src: icon('icon-192.png'), sizes: '192x192', type: 'image/png' }],
      },
      { name: 'Minhas ideias', url: '/minhas-ideias' },
    ],
  };
}
