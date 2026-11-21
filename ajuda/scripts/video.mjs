// Vídeo da página inicial do site público: uma ideia de demonstração do envio à implementação, nas telas
// reais do ITS, com legendas curtas no idioma do vídeo. Rode numa instalação de DEMONSTRAÇÃO nova, uma
// por idioma (o código da ideia sai igual nos dois), como as capturas (veja o ajuda/README.md):
//
//   DEMO_PASSWORD='...' node ../scripts/seed-demo.mjs http://127.0.0.1:8090
//   ITS_BASE=http://127.0.0.1:8090 VIDEO_PASSWORD='...' VIDEO_LANG=pt-BR pnpm video
//
// Grava os quadros com o tempo real e monta public/video/ciclo-<idioma>.webm (VP9, sem som, ffmpeg) e o
// pôster public/video/ciclo-<idioma>.webp (cwebp). Precisa de um navegador Chromium, do ffmpeg e do cwebp.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const B = (process.env.ITS_BASE ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const pw = process.env.VIDEO_PASSWORD;
const lang = process.env.VIDEO_LANG ?? 'pt-BR';
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
if (!pw || !chrome || (lang !== 'pt-BR' && lang !== 'en')) {
  console.error('Defina VIDEO_PASSWORD (contas de demonstração), VIDEO_LANG (pt-BR ou en) e, se preciso, CHROME.');
  process.exit(2);
}
const W = 1280;
const H = 720;
const out = fileURLToPath(new URL('../public/video', import.meta.url));
const frames = mkdtempSync(join(tmpdir(), `video-${lang}-`));
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const T = {
  'pt-BR': {
    s1: 'Carla, da Usinagem, envia uma ideia',
    s2: 'Na hora, ela vê a situação e o próximo passo',
    s3: 'A ideia chega à fila da equipe, com prazo de retorno',
    s4: 'Bruno assume a triagem',
    s5: 'Aprovada, a ideia vira etapas com responsável e prazo',
    s6: 'Implementada: tudo fica na linha do tempo',
    s7: 'E Carla acompanhou cada passo',
    title: 'Placa de aviso na saída da doca 3',
    desc: 'Empilhadeiras saem da doca 3 sem aviso, e quem passa pelo corredor não as vê a tempo.',
    step1: 'Comprar e instalar a placa',
    step2: 'Conferir com a equipe da doca',
    result: 'Placa instalada e equipe orientada; nenhum quase-acidente na saída da doca 3 desde então.',
  },
  en: {
    s1: 'Carla, from Machining, submits an idea',
    s2: 'Right away, she sees the status and the next step',
    s3: "The idea reaches the team's queue, with a response deadline",
    s4: 'Bruno takes over triage',
    s5: 'Approved, the idea becomes steps with an owner and a deadline',
    s6: 'Implemented: everything stays on the timeline',
    s7: 'And Carla followed every step',
    title: 'Warning sign at the dock 3 exit',
    desc: 'Forklifts leave dock 3 without warning, and people in the aisle do not see them in time.',
    step1: 'Buy and install the sign',
    step2: 'Check with the dock team',
    result: 'Sign installed and team briefed; no near misses at the dock 3 exit since then.',
  },
}[lang];

const port = 9100 + Math.floor(Math.random() * 90);
const proc = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    `--lang=${lang}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'video-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
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
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result.result.value;
};
const api = (method, path, body) =>
  ev(
    `fetch('/api${path}', { method: '${method}', credentials: 'include', headers: { 'content-type': 'application/json' }${body ? `, body: JSON.stringify(${JSON.stringify(body)})` : ''} }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error('${method} ${path} ' + r.status + ' ' + t.slice(0,200)); return t ? JSON.parse(t) : null; })`,
  );

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Page.navigate', { url: `${B}/entrar` });
await sleep(2500);

async function login(email) {
  await api('POST', '/auth/logout').catch(() => {});
  await api('POST', '/auth/login', { email, password: pw });
  await api('PATCH', '/auth/me/preferences', { locale: lang, theme: 'system' });
  await ev(`localStorage.setItem('its-lang', '${lang}')`);
}

// Legenda: uma faixa escura embaixo, no estilo do ITS (Geist), sem cobrir a interface.
async function legenda(text) {
  await ev(`(() => { let el = document.getElementById('video-legenda'); if (!el) { el = document.createElement('div'); el.id = 'video-legenda'; document.body.appendChild(el); }
    el.setAttribute('style', 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;background:oklch(0.2 0.012 270 / 0.94);color:#fff;font:600 24px/1.3 Geist Variable, system-ui, sans-serif;padding:14px 26px;border-radius:14px;box-shadow:0 12px 40px -12px rgba(0,0,0,.45);white-space:nowrap;letter-spacing:-0.01em');
    el.textContent = ${JSON.stringify(text)}; })()`);
}

const marks = [];
let n = 0;
async function frame() {
  const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
  const file = `${String(n++).padStart(5, '0')}.jpg`;
  writeFileSync(join(frames, file), Buffer.from(s.result.data, 'base64'));
  marks.push({ file, t: Date.now() });
}
/** Grava por `ms`, com a ação opcional rodando no meio (digitar, rolar). */
async function rec(ms, action) {
  const end = Date.now() + ms;
  const running = action ? action() : Promise.resolve();
  while (Date.now() < end) await frame();
  await running;
}
async function go(path, caption) {
  await send('Page.navigate', { url: B + path });
  await sleep(2200);
  await legenda(caption);
  await sleep(150);
}
async function waitFor(selector, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ev(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await sleep(150);
  }
  throw new Error(`não apareceu: ${selector} em ${await ev('location.pathname')}`);
}
async function type(selector, text, delay = 45) {
  await waitFor(selector);
  await ev(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); })()`,
  );
  for (const ch of text) {
    await send('Input.insertText', { text: ch });
    await sleep(delay);
  }
}

// --- Roteiro ---
await login('carla@example.test');
const ents = await api('GET', '/entities');
const cats = await api('GET', '/categories');
const usinagem = ents.find((e) => e.name === 'Usinagem') ?? ents[0];
const seguranca = cats.find((c) => /Segurança|Safety/.test(c.name)) ?? cats[0];

// 1. Carla começa a enviar (digita o título e a descrição).
await go('/ideias/nova', T.s1);
await waitFor('.ProseMirror');
await rec(5200, async () => {
  await sleep(500);
  await type('form input:not([type]), form input[type=text]', T.title, 40);
  await sleep(250);
  await type('.ProseMirror, [contenteditable=true]', T.desc, 18);
});
await ev(`document.activeElement && document.activeElement.blur()`);
await rec(500);
const idea = await api('POST', '/ideas', {
  title: T.title,
  description: T.desc,
  entityId: usinagem.id,
  categoryId: seguranca.id,
});

// 2. A ideia como Enviada, vista por quem enviou.
await go(`/ideias/${idea.code}`, T.s2);
await rec(4200);

// 3. Na fila do Bruno.
await login('bruno@example.test');
const bruno = await api('GET', '/auth/me');
await go('/ideias', T.s3);
await waitFor('main input');
await rec(4600, async () => {
  await sleep(900);
  await type('main input:not([type]), main input[type=search], main input[type=text]', idea.code, 70);
});

// 4. Bruno assume a triagem.
await api('POST', `/ideas/${idea.code}/start-review`);
await go(`/ideias/${idea.code}`, T.s4);
await rec(3800);

// 5. Aprovada, com etapas.
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const approved = await api('POST', `/ideas/${idea.code}/approve`, {
  stepName: T.step1,
  assigneeId: bruno.id,
  dueDate: day(5),
});
await go(`/ideas/${idea.code}`.replace('/ideas/', '/ideias/'), T.s5);
await rec(4500, async () => {
  await sleep(1500);
  await ev(`window.scrollBy({top: 260, behavior: 'smooth'})`);
});

// 6. Etapas concluídas e implementada; a linha do tempo.
// Uma etapa aberta por vez (regra do ITS): conclui a primeira, cria a segunda e conclui.
await api('POST', `/ideas/${idea.code}/steps/${approved.steps[0].id}/complete`);
const second = await api('POST', `/ideas/${idea.code}/steps`, { name: T.step2, assigneeId: bruno.id, dueDate: day(9) });
const secondId = second.steps?.find((s) => s.name === T.step2)?.id ?? second.id;
await api('POST', `/ideas/${idea.code}/steps/${secondId}/complete`);
await api('POST', `/ideas/${idea.code}/implement`, { resultText: T.result });
await go(`/ideias/${idea.code}`, T.s6);
await rec(5800, async () => {
  await sleep(1200);
  await ev(
    `(() => { const h = [...document.querySelectorAll('h2,h3')].find(x => /Linha do tempo|Timeline/i.test(x.textContent)); if (h) window.scrollTo({ top: h.getBoundingClientRect().top + scrollY - 90, behavior: 'smooth' }); })()`,
  );
});

// 7. Carla acompanhou tudo (os avisos dela).
await login('carla@example.test');
await go('/notificacoes', T.s7);
await rec(4500);

// Pôster: a ideia implementada, sem legenda.
await go(`/ideias/${idea.code}`, '');
await ev(`document.getElementById('video-legenda')?.remove()`);
const poster = await send('Page.captureScreenshot', { format: 'png' });
const posterPng = join(frames, 'poster.png');
writeFileSync(posterPng, Buffer.from(poster.result.data, 'base64'));

// Lista para o ffmpeg (concat): cada quadro com o tempo real até o seguinte.
const lines = ['ffconcat version 1.0'];
marks.forEach((m, i) => {
  const next = marks[i + 1]?.t ?? m.t + 80;
  lines.push(`file '${m.file}'`, `duration ${((next - m.t) / 1000).toFixed(3)}`);
});
lines.push(`file '${marks.at(-1).file}'`);
writeFileSync(join(frames, 'lista.txt'), lines.join('\n'));
ws.close();
proc.kill();

// Montagem: WebM VP9 a 24 quadros por segundo, sem som; pôster em WebP.
const webm = join(out, `ciclo-${lang}.webm`);
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    join(frames, 'lista.txt'),
    '-vf',
    `fps=24,scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '0',
    '-crf',
    '36',
    '-row-mt',
    '1',
    '-deadline',
    'good',
    '-cpu-used',
    '2',
    '-an',
    webm,
  ],
  { stdio: 'inherit' },
);
execFileSync(
  'cwebp',
  ['-quiet', '-q', '82', '-resize', String(W), String(H), posterPng, '-o', join(out, `ciclo-${lang}.webp`)],
  { stdio: 'inherit' },
);
console.log(
  `${lang}: ${marks.length} quadros em ${((marks.at(-1).t - marks[0].t) / 1000).toFixed(1)} s (ideia ${idea.code}); public/video/ciclo-${lang}.webm e .webp`,
);
process.exit(0);
