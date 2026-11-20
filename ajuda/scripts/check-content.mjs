// Confere o conteúdo da ajuda antes do build (também na CI). Falha se:
//  - uma página do mapa (content/nav.ts) não existir nos DOIS idiomas, ou sobrar arquivo fora do mapa;
//  - um .mdx não exportar `meta` com título e descrição;
//  - um <Regra id> citado não existir em content/regras.ts (ou a regra apontar para página inexistente);
//  - um link interno apontar para página que não existe;
//  - um tópico de ajuda do ITS (frontend/src/app/help-topics.ts) não existir na ajuda.
// Uso: node scripts/check-content.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const content = join(root, 'content');
const { SECTIONS } = await import('../content/nav.ts');
const { RULES } = await import('../content/regras.ts');
const LANGS = ['pt-BR', 'en'];
const slugs = new Set(SECTIONS.flatMap((s) => s.pages.map((p) => p.slug)));
const problems = [];

const fileOf = (lang, slug) => join(content, lang, `${slug || 'index'}.mdx`);
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

// 1. Paridade e arquivos órfãos
for (const lang of LANGS) {
  for (const slug of slugs) if (!existsSync(fileOf(lang, slug))) problems.push(`falta ${lang}/${slug || 'index'}.mdx`);
  for (const file of walk(join(content, lang)).filter((f) => f.endsWith('.mdx'))) {
    const slug = relative(join(content, lang), file)
      .split(sep)
      .join('/')
      .replace(/\.mdx$/, '')
      .replace(/^index$/, '');
    if (!slugs.has(slug)) problems.push(`${lang}/${slug}.mdx não está no mapa (content/nav.ts)`);
  }
}

// 2. Regras: ids únicos e páginas existentes
const ruleIds = new Set();
for (const r of RULES) {
  if (ruleIds.has(r.id)) problems.push(`regra repetida: ${r.id}`);
  ruleIds.add(r.id);
  if (!slugs.has(r.where)) problems.push(`${r.id} aponta para página inexistente: ${r.where}`);
  for (const lang of LANGS) if (!r.text[lang]?.trim()) problems.push(`${r.id} sem texto em ${lang}`);
}

// 3. Cada página: meta, regras citadas e links internos
const linkTarget = (href) => {
  const m = href.match(/^\/(pt-BR|en)\/(.*?)\/?(#.*)?$/);
  return m ? m[2].replace(/\/$/, '') : null;
};
for (const lang of LANGS) {
  for (const slug of slugs) {
    const file = fileOf(lang, slug);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const where = `${lang}/${slug || 'index'}`;
    if (!/export const meta = \{[\s\S]*?title:[\s\S]*?description:/.test(text))
      problems.push(`${where}: sem meta (title e description)`);
    for (const [, id] of text.matchAll(/<Regra id="([^"]+)"/g))
      if (!ruleIds.has(id)) problems.push(`${where}: <Regra id="${id}"> não existe em content/regras.ts`);
    for (const [, name] of text.matchAll(/<Captura nome="([^"]+)"/g)) {
      for (const l of LANGS) {
        for (const tema of ['claro', 'escuro']) {
          if (!existsSync(join(root, 'public', 'capturas', l, tema, `${name}.webp`)))
            problems.push(`${where}: falta a captura ${l}/${tema}/${name}.webp (rode scripts/capturas.mjs)`);
        }
      }
    }
    for (const [, href] of text.matchAll(/\]\((\/[^)\s]+)\)/g)) {
      const target = linkTarget(href);
      if (target === null || !slugs.has(target)) problems.push(`${where}: link quebrado ${href}`);
    }
  }
}

// 4. Tópicos de ajuda usados pelo ITS
const topicsFile = join(root, '..', 'frontend', 'src', 'app', 'help-topics.ts');
if (existsSync(topicsFile)) {
  const { HELP_TOPICS } = await import(new URL(`file:///${topicsFile.split(sep).join('/')}`).href);
  for (const [screen, slug] of Object.entries(HELP_TOPICS)) {
    if (!slugs.has(slug)) problems.push(`tópico do ITS "${screen}" aponta para página inexistente: ${slug}`);
  }
}

if (problems.length) {
  console.error(`Conteúdo da ajuda com ${problems.length} problema(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Conteúdo da ajuda ok: ${slugs.size} páginas × ${LANGS.length} idiomas, ${RULES.length} regras.`);
