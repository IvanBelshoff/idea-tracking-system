// Ícones do app instalável (PWA, RN-83) gerados a partir do símbolo do favicon.
// Uso: node scripts/gen-icons.mjs   (rode de novo só se o símbolo mudar; os PNGs ficam versionados)
// Usa o `sharp` já instalado no backend, para não pôr uma dependência nativa no build do frontend.
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');
const sharp = createRequire(join(here, '..', '..', 'backend', 'package.json'))('sharp');

const favicon = readFileSync(join(pub, 'favicon.svg'), 'utf8');
const paths = [...favicon.matchAll(/<path [^>]*\/>/g)].map((m) => m[0]).join('\n');
const BRAND = '#5458c8';

/** Ícone comum: quadrado arredondado como o favicon. */
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="${BRAND}"/>
  <g fill="#fff" transform="translate(3.2 3.2) scale(0.8)">${paths}</g>
</svg>`;

/** "maskable" e Apple: fundo cheio (o sistema recorta) e símbolo dentro da zona segura (80% central). */
const fullBleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${BRAND}"/>
  <g fill="#fff" transform="translate(${16 - 16 * scale} ${16 - 16 * scale}) scale(${scale})">${paths}</g>
</svg>`;

mkdirSync(join(pub, 'icons'), { recursive: true });
const out = [
  ['icons/icon-192.png', rounded, 192],
  ['icons/icon-512.png', rounded, 512],
  ['icons/maskable-512.png', fullBleed(0.56), 512],
  ['icons/apple-touch-icon.png', fullBleed(0.7), 180],
];
for (const [file, svg, size] of out) {
  await sharp(Buffer.from(svg), { density: 72 * (size / 32) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(pub, file));
  console.log(`${file} (${size}×${size})`);
}
