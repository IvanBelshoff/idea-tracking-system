// Acessibilidade da ajuda com axe-core (CA-T.8): abre cada página do mapa, nos dois idiomas e nos
// dois temas, num Chrome sem janela, e falha se houver violação "serious" ou "critical". Também abre
// o simulador de cada página e confere a tela com o formulário aberto.
//
// Uso (com o build servido: node scripts/serve.mjs, ou o ITS no Docker):
//   A11Y_BASE=http://127.0.0.1:3200 pnpm a11y          (padrão: http://127.0.0.1:3200)
// Opcional: CHROME=/caminho/do/chrome
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { SECTIONS } = await import('../content/nav.ts');
const base = process.env.A11Y_BASE ?? 'http://127.0.0.1:3200';
// Caminho base do build (AJUDA_BASE_PATH): /ajuda na instalação, /idea-tracking-system na ajuda pública.
const prefix = process.env.AJUDA_BASE_PATH || '/ajuda';
// Qualquer navegador Chromium serve (Chrome, Edge ou Chromium); CHROME aponta outro caminho.
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
  process.exit(2);
}
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const LANGS = ['pt-BR', 'en'];
const slugs = SECTIONS.flatMap((s) => s.pages.map((p) => p.slug));

const port = 9500 + Math.floor(Math.random() * 200);
const proc = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'a11y-ajuda-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'erro');
  return r.result.result.value;
};
const runAxe = async () => {
  await evaluate(axeSource);
  const result = await evaluate(
    `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }).then(r => JSON.stringify(r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }))))`,
  );
  return JSON.parse(result);
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
let failures = 0;
let pages = 0;
for (const theme of ['light', 'dark']) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  // A página "não encontrada" é estática e fica fora do mapa (content/nav.ts): confere uma vez por tema.
  const targets = [
    ...LANGS.flatMap((lang) => slugs.map((slug) => `${prefix}/${lang}/${slug ? `${slug}/` : ''}`)),
    `${prefix}/nao-encontrada.html`,
    // A página inicial só existe na ajuda pública; na instalação, a raiz redireciona para a documentação.
    ...(prefix === '/ajuda' ? [] : [`${prefix}/`]),
  ];
  for (const path of targets) {
    await send('Page.navigate', { url: base + path });
    await sleep(1500);
    // Com simulador na página: abre o primeiro formulário (ação que pede texto), para conferir também esse estado.
    await evaluate(
      `(() => { const b = [...document.querySelectorAll('section[aria-label] button[aria-expanded="false"]')][0]; b?.click(); })()`,
    );
    await sleep(300);
    const violations = await runAxe();
    pages += 1;
    const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const minor = violations.filter((v) => !blocking.includes(v));
    console.log(
      `${blocking.length ? 'FALHOU' : 'OK    '} [${theme}] ${path}${minor.length ? ` · ${minor.length} aviso(s) leve(s)` : ''}`,
    );
    for (const v of blocking) {
      failures += 1;
      console.log(`   - ${v.id} (${v.impact}): ${v.help}\n     ${v.nodes.join(' | ')}`);
    }
    for (const v of minor) console.log(`   · ${v.id} (${v.impact ?? 'n/a'}): ${v.help} → ${v.nodes.join(' | ')}`);
  }
}
console.log(
  failures === 0
    ? `\n${pages} telas sem violações graves ou críticas.`
    : `\n${failures} violação(ões) grave(s) ou crítica(s).`,
);
ws.close();
proc.kill();
process.exit(failures === 0 ? 0 : 1);
