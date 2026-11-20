// Verifica contraste WCAG dos tokens de src/tokens.css (claro, escuro, marca de exemplo e marcas
// derivadas pela regra da identidade visual, em scripts/brand-samples.json).
// Uso: pnpm design:contrast  (sai com código 1 se algum par ficar abaixo do mínimo).
import { readFileSync } from 'node:fs';

const css = readFileSync(process.argv[2] ?? new URL('../src/tokens.css', import.meta.url), 'utf8');
function block(sel) {
  const esc = sel.replace(/[.[\]"=]/g, (c) => String.fromCharCode(92) + c);
  // Aceita uma lista de seletores (`:root, .theme-light {`).
  const re = new RegExp(String.raw`(?:^|\n)` + esc + String.raw`(?:,[^{]*)?\s*\{([^}]*)\}`, 'g');
  const out = {};
  for (const m of css.matchAll(re)) for (const [, k, v] of m[1].matchAll(/--([\w-]+):\s*(oklch\([^)]*\))/g)) out[k] = v;
  return out;
}
const light = block(':root'),
  dark = { ...light, ...block('.dark') };
const orgL = { ...light, ...block('[data-brand="org"]') },
  orgD = { ...dark, ...block('[data-brand="org"].dark') };
function parse(s) {
  const [L, C, H, A] = s
    .match(/oklch\(([^)]*)\)/)[1]
    .replace('/', ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)));
  return { L, C, H, A: A ?? 1 };
}
function toRgb({ L, C, H }) {
  const a = C * Math.cos((H * Math.PI) / 180),
    b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => Math.min(1, Math.max(0, v)));
}
const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055),
  dec = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function rgbOf(t, name, over) {
  // returns linear rgb, alpha-composited (in gamma space, as browsers do)
  const c = parse(t[name]);
  const fg = toRgb(c).map(enc);
  if (c.A >= 1) return fg.map(dec);
  const bg = rgbOf(t, over).map(enc);
  return fg.map((v, i) => dec(v * c.A + bg[i] * (1 - c.A)));
}
function tint(t, ink, pct, over) {
  const fg = rgbOf(t, ink).map(enc),
    bg = rgbOf(t, over).map(enc);
  return fg.map((v, i) => dec(v * pct + bg[i] * (1 - pct)));
}
const Y = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ratio = (a, b) => {
  const [x, y] = [Y(a), Y(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const ST = ['submitted', 'review', 'progress', 'done', 'rejected', 'late'];
/** Opacidade do polegar da barra de rolagem (index.css, color-mix com a --brand). Manter em sincronia. */
const THUMB = 0.85;
function checks(t) {
  const c = (a, b, min, label) => ({ label: label ?? `${a} / ${b}`, r: ratio(rgbOf(t, a, b), rgbOf(t, b)), min });
  const out = [
    c('foreground', 'background', 4.5),
    c('foreground', 'card', 4.5),
    c('foreground', 'muted', 4.5),
    c('muted-foreground', 'background', 4.5),
    c('muted-foreground', 'card', 4.5),
    c('muted-foreground', 'muted', 4.5),
    c('shell-foreground', 'shell', 4.5),
    c('shell-muted', 'shell', 4.5),
    c('shell-active-foreground', 'shell-active', 4.5),
    c('brand-fg', 'brand', 4.5, 'brand-fg / brand (botão primário e iniciais do avatar, RN-142)'),
    c('brand', 'background', 3, 'brand / background (foco, ícones)'),
    c('brand', 'card', 4.5, 'brand / card (texto de link)'),
    {
      label: `brand ${THUMB * 100}% / background (polegar da barra de rolagem, 1.4.11)`,
      r: ratio(tint(t, 'brand', THUMB, 'background'), rgbOf(t, 'background')),
      min: 3,
    },
    c('input', 'card', 3, 'input / card (borda de campo, 1.4.11)'),
    c('input', 'background', 3, 'input / background (borda de campo)'),
    c('border', 'card', 1, 'border / card (divisória decorativa, sem mínimo)'),
  ];
  for (const s of ST) {
    out.push(c(`st-${s}`, 'background', 4.5), c(`st-${s}`, 'card', 4.5));
    out.push({
      label: `st-${s} / pílula 12% sobre card`,
      r: ratio(rgbOf(t, `st-${s}`), tint(t, `st-${s}`, 0.12, 'card')),
      min: 4.5,
    });
    out.push({
      label: `st-${s} / pílula 12% sobre muted`,
      r: ratio(rgbOf(t, `st-${s}`), tint(t, `st-${s}`, 0.12, 'muted')),
      min: 4.5,
    });
    out.push(c('st-on', `st-${s}`, 4.5, `st-on / st-${s} (contador cheio)`));
  }
  for (let i = 1; i <= 5; i++) out.push(c(`chart-${i}`, 'card', 3, `chart-${i} / card (gráfico, 1.4.11)`));
  return out;
}
let fails = 0;
const derivedTokens = (base, p) => ({
  ...base,
  brand: p.brand,
  'brand-fg': p.brandFg,
  'shell-active': p.shellActive,
  'shell-active-foreground': p.shellActiveFg,
});
const samples = JSON.parse(readFileSync(new URL('./brand-samples.json', import.meta.url), 'utf8')).samples;
const derived = samples.flatMap((s) => [
  [`CLARO marca org derivada (${s.name})`, derivedTokens(light, s.light)],
  [`ESCURO marca org derivada (${s.name})`, derivedTokens(dark, s.dark)],
]);
for (const [name, t] of [
  ['CLARO', light],
  ['ESCURO', dark],
  ['CLARO marca org', orgL],
  ['ESCURO marca org', orgD],
  ...derived,
]) {
  const list = name.includes('org')
    ? checks(t).filter((x) => x.label.startsWith('brand') || x.label.startsWith('shell-active'))
    : checks(t);
  console.log(`\n== ${name}`);
  for (const x of list) {
    const ok = x.r >= x.min;
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FALHA'} ${x.r.toFixed(2).padStart(5)} (mín ${x.min})  ${x.label}`);
  }
}
console.log(`\nfalhas: ${fails}`);
if (fails > 0) process.exitCode = 1;
