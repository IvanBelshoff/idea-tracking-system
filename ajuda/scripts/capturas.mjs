// Capturas de tela do ITS para a ajuda, nos dois idiomas e nos dois temas, em WebP.
// Rode a cada versão, numa instalação de DEMONSTRAÇÃO (nunca na de verdade):
//
//   1. instalação nova + dados fictícios:  DEMO_PASSWORD='...' node ../scripts/seed-demo.mjs http://127.0.0.1:5173
//   2. capturas:  ITS_BASE=http://127.0.0.1:5173 CAPTURA_EMAIL=ana@example.test CAPTURA_PASSWORD='...' pnpm capturas
//
// Grava em public/capturas/<idioma>/<claro|escuro>/<nome>.webp. A ajuda usa com <Captura nome="…" />
// e o scripts/check-content.mjs confere que toda captura citada existe nas quatro versões.
//
// Antes das telas, o script deixa a demonstração no estado que elas mostram (endereço do sistema,
// provedores de e-mail, login corporativo e uma integração), sempre com dados fictícios. Por isso,
// de novo: só numa instalação de demonstração.
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.env.ITS_BASE ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const email = process.env.CAPTURA_EMAIL;
const password = process.env.CAPTURA_PASSWORD;
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
if (!email || !password || !chrome) {
  console.error('Defina CAPTURA_EMAIL e CAPTURA_PASSWORD (conta de demonstração) e, se preciso, CHROME.');
  process.exit(2);
}
const out = fileURLToPath(new URL('../public/capturas', import.meta.url));

/** Dados fictícios que as telas mostram. */
const DEMO = {
  appUrl: 'https://ideias.suaempresa.com.br',
  sender: 'nao-responder@ideias.suaempresa.com.br',
  replyTo: 'contato@suaempresa.com.br',
};
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
/** Conta de serviço do Google com uma chave RSA gerada agora: válida no formato e sem uso fora daqui. */
function fakeServiceAccount() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    type: 'service_account',
    client_email: 'its-email@ideias-demo.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
}

/** Provedor de e-mail que cada captura mostra. */
const PROVIDERS = {
  smtp: () => ({
    type: 'smtp',
    host: 'smtp.suaempresa.com.br',
    port: 587,
    security: 'starttls',
    username: DEMO.sender,
    password: 'senha-ficticia-da-demonstracao',
    fromAddress: DEMO.sender,
    fromName: 'Ideias Demo',
  }),
  microsoft: () => ({
    type: 'microsoft_graph',
    tenantId: '11111111-2222-3333-4444-555555555555',
    clientId: '22222222-3333-4444-5555-666666666666',
    clientSecret: 'segredo-ficticio-da-demonstracao',
    fromAddress: DEMO.sender,
    replyTo: DEMO.replyTo,
    secretExpiresOn: inDays(540),
  }),
  google: () => ({
    type: 'google_workspace',
    serviceAccountJson: fakeServiceAccount(),
    fromAddress: DEMO.sender,
    fromName: 'Ideias Demo',
    replyTo: DEMO.replyTo,
    secretExpiresOn: inDays(365),
  }),
};

/**
 * Telas capturadas: [nome do arquivo, caminho no ITS, opções]. O detalhe usa uma ideia Em andamento da
 * demonstração. `altura` é a da janela (padrão 800); `prepara` deixa a tela no estado certo antes.
 */
const SHOTS = [
  ['enviar', '/ideias/nova'],
  ['fila', '/ideias'],
  ['detalhe', null],
  ['indicadores', '/indicadores'],
  ['usuarios', '/admin/usuarios'],
  ['perfis', '/admin/perfis'],
  ['entidades', '/admin/entidades'],
  ['configuracoes', '/admin/configuracoes'],
  ['identidade', '/admin/identidade'],
  ['email', '/admin/email', { altura: 1500, prepara: (api) => api('PUT', '/admin/email/provider', PROVIDERS.smtp()) }],
  [
    'email-microsoft',
    '/admin/email',
    { altura: 1700, prepara: (api) => api('PUT', '/admin/email/provider', PROVIDERS.microsoft()) },
  ],
  [
    'email-google',
    '/admin/email',
    { altura: 1700, prepara: (api) => api('PUT', '/admin/email/provider', PROVIDERS.google()) },
  ],
  ['observabilidade', '/admin/observabilidade', { altura: 1500 }],
  ['acesso', '/admin/acesso', { altura: 2600 }],
  ['integracoes', '/admin/integracoes', { altura: 1100 }],
];
// CAPTURA_SO=a,b grava só essas telas (as outras ficam como estão); CAPTURA_ALTURA força a altura da janela.
const only = process.env.CAPTURA_SO?.split(',').map((name) => name.trim());
const forcedHeight = process.env.CAPTURA_ALTURA ? Number(process.env.CAPTURA_ALTURA) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Confere a resposta de uma chamada de preparação; um erro aqui para o script com a causa. */
function expectOk(label, res) {
  if (res.status >= 200 && res.status < 300) return res.body;
  throw new Error(`${label} → ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
}

/**
 * Estado comum das telas de administração, idempotente: endereço do sistema, domínios e login com a
 * Microsoft (sem teste de entrada, que exige uma conta real), API de integração ligada com uma integração.
 */
async function prepareDemo(api) {
  expectOk('endereço do sistema', await api('PATCH', '/settings', { values: { 'email.app_url': DEMO.appUrl } }));
  expectOk('domínios', await api('PUT', '/admin/access/policy', { domains: ['example.test'], allowExternal: false }));
  expectOk(
    'login com a Microsoft',
    await api('PUT', '/admin/access/providers/microsoft', {
      clientId: '00000000-1111-2222-3333-444444444444',
      tenantId: '11111111-2222-3333-4444-555555555555',
      clientSecret: 'segredo-ficticio-da-demonstracao',
      secretExpiresOn: inDays(540),
    }),
  );
  expectOk(
    'módulos',
    await api('PUT', '/admin/integrations/modules', { modules: ['ideas', 'indicators', 'campaigns'] }),
  );
  const view = expectOk('chave da integração', await api('PUT', '/admin/integrations/enabled', { enabled: true }));
  if (!view.integrations?.some((i) => i.name === 'ERP da Fábrica')) {
    const entities = expectOk('entidades', await api('GET', '/entities'));
    const fabrica = entities.find((e) => e.name === 'Fábrica') ?? entities.find((e) => e.parentId === null);
    expectOk(
      'integração',
      await api('POST', '/admin/integrations', {
        name: 'ERP da Fábrica',
        owner: 'TI – Sistemas corporativos',
        modules: ['ideas', 'indicators'],
        scope: [{ entityId: fabrica.id, includeChildren: true }],
        expiresAt: `${inDays(180)}T00:00:00Z`,
      }),
    );
  }
}

/** Um navegador sem janela no idioma dado (os campos nativos, como datas, seguem o idioma do navegador). */
async function openBrowser(lang) {
  const port = 9600 + Math.floor(Math.random() * 200);
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--hide-scrollbars',
      `--lang=${lang}`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'capturas-'))}`,
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
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'erro');
    return r.result.result.value;
  };
  const api = (method, path, body) =>
    evaluate(
      `fetch('/api${path}', { method: '${method}', credentials: 'include', headers: { 'content-type': 'application/json' }${
        body ? `, body: JSON.stringify(${JSON.stringify(body)})` : ''
      } }).then(async r => ({ status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null }))`,
    );
  const close = () => {
    ws.close();
    proc.kill();
  };
  return { send, evaluate, api, close };
}

let count = 0;
for (const lang of ['pt-BR', 'en']) {
  const { send, evaluate, api, close } = await openBrowser(lang);
  await send('Page.enable');
  await send('Page.navigate', { url: `${base}/entrar` });
  await sleep(3000);
  const login = await api('POST', '/auth/login', { email, password });
  if (login.status !== 200) {
    console.error(`Login falhou (${login.status}).`);
    close();
    process.exit(2);
  }
  // O idioma do ITS vem da preferência da conta; o tema, do "igual ao sistema" simulado abaixo.
  await api('PATCH', '/auth/me/preferences', { locale: lang, theme: 'system' });
  await prepareDemo(api);
  const doing = await api('GET', '/ideas?status=in_progress&pageSize=1');
  const detail = doing.body?.items?.[0]?.code;
  if (!detail) console.warn('Nenhuma ideia Em andamento na demonstração: a captura "detalhe" fica de fora.');
  for (const [tema, scheme] of [
    ['claro', 'light'],
    ['escuro', 'dark'],
  ]) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    const dir = join(out, lang, tema);
    mkdirSync(dir, { recursive: true });
    for (const [name, path, opts = {}] of SHOTS) {
      if (only && !only.includes(name)) continue;
      const to = path ?? (detail ? `/ideias/${detail}` : null);
      if (!to) continue;
      if (opts.prepara) expectOk(`preparação de "${name}"`, await opts.prepara(api));
      await send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: forcedHeight ?? opts.altura ?? 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send('Page.navigate', { url: base + to });
      await sleep(2500);
      // Sem cursor piscando nem foco desenhado na captura.
      await evaluate('document.activeElement?.blur?.()');
      const shot = await send('Page.captureScreenshot', { format: 'webp', quality: 82 });
      writeFileSync(join(dir, `${name}.webp`), Buffer.from(shot.result.data, 'base64'));
      count += 1;
    }
  }
  await api('PATCH', '/auth/me/preferences', { locale: 'pt-BR' });
  close();
}
console.log(`${count} capturas em public/capturas/.`);
process.exit(0);
