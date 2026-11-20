import { ITS_PA, ITS_PAS } from './its-symbol-path';

/** Cor do quadrado do favicon estático (`public/favicon.svg`): o índigo do ITS. */
export const ITS_FAVICON_HEX = '#5458c8';

const OPACITY = [1, 0.68, 0.36];

/**
 * Favicon do ITS na cor da organização: a mesma composição de `public/favicon.svg` (gerado por
 * scripts/gen-symbol.mjs), com as pás brancas sobre o quadrado na cor da marca. O branco sobre a
 * marca do tema claro sempre passa de 4,5:1 (é uma das regras da derivação da cor).
 */
export function itsFaviconSvg(hex: string): string {
  const paths = OPACITY.slice(0, ITS_PAS)
    .map(
      (o, i) =>
        `<path d="${ITS_PA}" transform="rotate(${(360 / ITS_PAS) * i} 16 16)"${o < 1 ? ` opacity="${o}"` : ''}/>`,
    )
    .join('');
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    `<rect width="32" height="32" rx="8" fill="${hex}"/>` +
    `<g fill="#fff" transform="translate(3.2 3.2) scale(0.8)">${paths}</g></svg>`
  );
}

/** O favicon como URL `data:`, pronta para o `<link rel="icon">`. */
export function itsFaviconUrl(hex: string): string {
  return `data:image/svg+xml,${encodeURIComponent(itsFaviconSvg(hex))}`;
}
