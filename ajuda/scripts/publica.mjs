// Acabamento do build da ajuda PÚBLICA (GitHub Pages, M28). Roda depois do `next build`; no build da
// instalação (sem AJUDA_PUBLICA=1) não faz nada.
//
//   AJUDA_PUBLICA=1 pnpm build                                  (na raiz: o domínio próprio)
//   AJUDA_PUBLICA=1 AJUDA_BASE_PATH=/idea-tracking-system pnpm build   (sem domínio próprio)
//
// - A página estática "não encontrada" (public/nao-encontrada.html) traz /ajuda/ escrito: aqui passa para
//   o caminho base público. A raiz (index.html) é a página inicial, gerada pelo Next com o caminho certo.
// - 404.html: a página que o GitHub Pages mostra quando o endereço não existe.
// - favicon.svg: na instalação, o ícone vem do ITS (mesmo endereço); no Pages, vai uma cópia do símbolo.
// - sitemap.xml e robots.txt: as páginas do mapa (content/nav.ts) nos dois idiomas, com a versão de cada uma
//   no outro idioma (hreflang), para os mecanismos de busca. O endereço vem de AJUDA_SITE_URL (pages.yml).
// - .nojekyll: se o Pages for publicado a partir de um branch (com Jekyll), sem ele as pastas que começam
//   com "_" (_next e _pagefind) ficam de fora. Pelo fluxo de Actions (release.yml) não faz diferença.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.AJUDA_PUBLICA !== '1') process.exit(0);

// Vazio = raiz do domínio próprio; senão, o caminho do Pages sem domínio (ex.: /idea-tracking-system).
const base = process.env.AJUDA_BASE_PATH ?? '';
if (base !== '' && (!/^\/[a-z0-9-]+$/.test(base) || base === '/ajuda')) {
  console.error(
    `A ajuda pública fica na raiz (AJUDA_BASE_PATH vazio) ou num caminho como /idea-tracking-system, não "${base}".`,
  );
  process.exit(1);
}
const out = (file) => fileURLToPath(new URL(`../out/${file}`, import.meta.url));
// O mesmo endereço que o next.config.ts usa na prévia e no endereço canônico.
const site = (process.env.AJUDA_SITE_URL || `https://idea-tracking-system.silexcode.com.br${base}`).replace(/\/$/, '');

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

const { ALL_PAGES } = await import('../content/nav.ts');
const LANGS = ['pt-BR', 'en'];
const href = (lang, slug) => `${site}/${lang}/${slug ? `${slug}/` : ''}`;
const entry = (slug, lang) =>
  [
    '  <url>',
    `    <loc>${href(lang, slug)}</loc>`,
    ...[...LANGS.map((l) => [l, href(l, slug)]), ['x-default', href('pt-BR', slug)]].map(
      ([l, u]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${u}"/>`,
    ),
    '  </url>',
  ].join('\n');
const urls = [
  `  <url>\n    <loc>${site}/</loc>\n  </url>`,
  ...ALL_PAGES.flatMap((p) => LANGS.map((l) => entry(p.slug, l))),
];
writeFileSync(
  out('sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`,
);
writeFileSync(out('robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`);
console.log(
  `Ajuda pública pronta em out/ para ${site}/ (404.html, favicon.svg, sitemap.xml com ${urls.length} endereços, robots.txt e .nojekyll).`,
);
