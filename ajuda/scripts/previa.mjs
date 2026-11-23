// Imagem de prévia do site público (Open Graph, 1200×630), que aparece quando o link é compartilhado no
// WhatsApp, no LinkedIn e afins. Uma por idioma, em public/previa/og-<idioma>.png. Rode de novo quando o
// título, o histórico de exemplo (src/components/home/texto.ts) ou a identidade mudarem:
//
//   pnpm previa
//
// Monta uma página com a identidade do ITS (símbolo, Geist, cores do tema escuro de frontend/src/tokens.css)
// e a fotografa no navegador (Chrome, Edge ou Chromium; CHROME aponta outro caminho).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { HOME } = await import('../src/components/home/texto.ts');

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const outDir = here('../public/previa/');
const font = (pkg, file) => pathToFileURL(here(`../node_modules/@fontsource-variable/${pkg}/files/${file}`)).href;
const symbol = readFileSync(here('../../frontend/public/favicon.svg'), 'utf8').replace(/<title>.*?<\/title>/, '');
const HOST = 'idea-tracking-system.silexcode.com.br';

const chrome =
  process.env.CHROME ??
  [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p));
if (!chrome) {
  console.error('Navegador não encontrado (Chrome, Edge ou Chromium): defina CHROME.');
  process.exit(1);
}

// Tema escuro do ITS (frontend/src/tokens.css).
const INK = {
  submitted: 'oklch(0.78 0.03 255)',
  in_review: 'oklch(0.82 0.12 80)',
  in_progress: 'oklch(0.76 0.12 255)',
  implemented: 'oklch(0.78 0.13 155)',
};
const SUB = {
  'pt-BR': 'Sistema aberto e gratuito de gestão de ideias',
  en: 'Free, open-source idea management system',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function page(lang) {
  const t = HOME[lang];
  const log = t.hero.log.slice(0, 4);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
@font-face { font-family: Geist; src: url(${font('geist', 'geist-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'Geist Mono'; src: url(${font('geist-mono', 'geist-mono-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; }
body {
  background: oklch(0.14 0.008 270); color: oklch(0.96 0.004 270); font-family: Geist, sans-serif;
  display: grid; grid-template-columns: 1fr 350px; gap: 48px; padding: 60px 64px 56px;
  position: relative; overflow: hidden;
}
body::before { content: ''; position: absolute; inset: 0; background: radial-gradient(60% 80% at 0% 0%, oklch(0.52 0.17 277 / 0.22), transparent 70%); }
.left, .right { position: relative; }
.left { display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
.brand svg { width: 44px; height: 44px; }
.brand span { font-weight: 500; color: oklch(0.72 0.01 270); }
h1 { margin-top: auto; font-size: 80px; line-height: 0.98; font-weight: 800; letter-spacing: -0.035em; white-space: nowrap; }
h1 b { display: block; font-weight: 800; color: oklch(0.74 0.13 277); }
.sub { margin-top: 26px; font-size: 27px; color: oklch(0.8 0.008 270); }
.host { margin-top: 30px; font-family: 'Geist Mono', monospace; font-size: 21px; color: oklch(0.66 0.01 270); }
.right { align-self: center; border-left: 3px solid oklch(0.3 0.01 270); padding-left: 32px; display: grid; gap: 26px; }
.e { position: relative; }
.e::before { content: ''; position: absolute; left: -45px; top: 7px; width: 19px; height: 19px; border-radius: 50%; background: var(--ink); box-shadow: 0 0 0 5px oklch(0.14 0.008 270); }
.when { font-size: 18px; color: oklch(0.66 0.01 270); font-variant-numeric: tabular-nums; }
.what { margin-top: 4px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
</style></head><body>
<div class="left">
  <div class="brand">${symbol}ITS <span>– Idea Tracking System</span></div>
  <h1>${esc(t.hero.title[0])}<b>${esc(t.hero.title[1])}</b></h1>
  <p class="sub">${esc(SUB[lang])}</p>
  <p class="host">${HOST}</p>
</div>
<div class="right">
  ${log.map((e) => `<div class="e" style="--ink:${INK[e.status]}"><div class="when">${esc(e.when)}</div><div class="what">${esc(e.what)}</div></div>`).join('\n  ')}
</div>
</body></html>`;
}

const port = 9600 + Math.floor(Math.random() * 200);
const dir = mkdtempSync(join(tmpdir(), 'its-previa-'));
const proc = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((x) => x.type === 'page');
    if (target) ws = new WebSocket(target.webSocketDebuggerUrl);
  } catch {}
  if (!ws) await sleep(250);
}
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
mkdirSync(outDir, { recursive: true });
for (const lang of ['pt-BR', 'en']) {
  const html = join(dir, `previa-${lang}.html`);
  writeFileSync(html, page(lang));
  await send('Page.navigate', { url: pathToFileURL(html).href });
  await sleep(800);
  await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true });
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 },
  });
  writeFileSync(join(outDir, `og-${lang}.png`), Buffer.from(shot.result.data, 'base64'));
  console.log(`public/previa/og-${lang}.png`);
}
ws.close();
proc.kill();
