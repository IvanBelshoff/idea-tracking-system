// Acabamento do build da ajuda PÚBLICA (GitHub Pages, M28). Roda depois do `next build`; no build da
// instalação (sem AJUDA_PUBLICA=1) não faz nada.
//
//   AJUDA_PUBLICA=1 AJUDA_BASE_PATH=/idea-tracking-system pnpm build
//
// - A página estática "não encontrada" (public/nao-encontrada.html) traz /ajuda/ escrito: aqui passa para
//   o caminho base público. A raiz (index.html) é a página inicial, gerada pelo Next com o caminho certo.
// - 404.html: a página que o GitHub Pages mostra quando o endereço não existe.
// - favicon.svg: na instalação, o ícone vem do ITS (mesmo endereço); no Pages, vai uma cópia do símbolo.
// - .nojekyll: se o Pages for publicado a partir de um branch (com Jekyll), sem ele as pastas que começam
//   com "_" (_next e _pagefind) ficam de fora. Pelo fluxo de Actions (release.yml) não faz diferença.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.AJUDA_PUBLICA !== '1') process.exit(0);

const base = process.env.AJUDA_BASE_PATH ?? '';
if (!/^\/[a-z0-9-]+$/.test(base) || base === '/ajuda') {
  console.error(
    `A ajuda pública precisa de AJUDA_BASE_PATH com o caminho do Pages (ex.: /idea-tracking-system), não "${base}".`,
  );
  process.exit(1);
}
const out = (file) => fileURLToPath(new URL(`../out/${file}`, import.meta.url));

for (const file of ['nao-encontrada.html']) {
  const html = readFileSync(out(file), 'utf8')
    .replaceAll('/ajuda/', `${base}/`)
    .replaceAll('href="/favicon.svg"', `href="${base}/favicon.svg"`);
  if (html.includes('/ajuda/')) throw new Error(`${file} ainda cita /ajuda/`);
  writeFileSync(out(file), html);
}
copyFileSync(out('nao-encontrada.html'), out('404.html'));
copyFileSync(fileURLToPath(new URL('../../frontend/public/favicon.svg', import.meta.url)), out('favicon.svg'));
writeFileSync(out('.nojekyll'), '');
console.log(`Ajuda pública pronta em out/ para ${base}/ (404.html, favicon.svg e .nojekyll).`);
