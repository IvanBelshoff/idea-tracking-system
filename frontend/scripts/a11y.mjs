// Acessibilidade das telas com axe-core (CA-T.8): abre cada rota num Chrome sem janela, injeta o
// axe e falha se houver violação "serious" ou "critical". Roda nos temas claro e escuro.
//
// Uso (com a pilha rodando e uma instalação de TESTE, nunca a de produção):
//   A11Y_BASE=http://127.0.0.1:8080 A11Y_EMAIL=admin@example.test A11Y_PASSWORD=... pnpm a11y
// Opcional: CHROME=/caminho/do/chrome, A11Y_IDEA=ITS-2026-0001 (abre o detalhe de uma ideia),
//           A11Y_PUBLIC_CODE=<código de acompanhamento> (abre a consulta pública),
//           A11Y_CAMPAIGN=<id> (abre o painel de uma campanha),
//           A11Y_HIGHLIGHT=<id> (abre um destaque do Hall).
//           A11Y_APPROVAL=<código> (ideia com pedido de aprovação aberto; a pessoa logada é da equipe),
//           A11Y_APPROVAL_NEW=<código> (ideia Em análise sem pedido), A11Y_APPROVAL_TOKEN=<link> (página
//           pública do link), A11Y_APPROVALS_PENDING=1 (a pessoa logada tem aprovações pendentes).
//           A11Y_USER_FIELDS=1 (há campos do usuário, um deles fechado), A11Y_USER_DETAIL=<id> (usuário com campos).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.A11Y_BASE ?? 'http://127.0.0.1:8080';
const email = process.env.A11Y_EMAIL;
const password = process.env.A11Y_PASSWORD;
const chrome =
  process.env.CHROME ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => {
    try {
      readFileSync(p, { flag: 'r' }).subarray(0, 1);
      return true;
    } catch {
      return false;
    }
  });
if (!email || !password || !chrome) {
  console.error('Defina A11Y_EMAIL e A11Y_PASSWORD (e CHROME, se o Chrome não estiver no caminho padrão).');
  process.exit(2);
}
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const ROUTES = [
  ['/entrar', 'login (sem sessão)'],
  ['/esqueci-senha', 'esqueci minha senha (sem sessão)'],
  ...(process.env.A11Y_PUBLIC_CODE
    ? [[`/consulta/${process.env.A11Y_PUBLIC_CODE}`, 'consulta pública (sem sessão)']]
    : []),
  ['/consulta', 'consulta pública: entrada (sem sessão)'],
  ['/', 'início'],
  ['/notificacoes', 'notificações'],
  ['/ideias/nova', 'enviar ideia'],
  // Editor de texto formatado (M19, RN-136): carrega sob demanda; este estado espera o editor, escreve em negrito e abre o campo de link.
  [
    '/ideias/nova',
    'enviar ideia (editor com texto e campo de link)',
    `(async () => {
      const find = () => document.querySelector('[role=textbox][contenteditable=true]');
      for (let i = 0; i < 40 && !find(); i++) await new Promise((r) => setTimeout(r, 250));
      find()?.focus();
      document.execCommand('insertText', false, 'Texto de exemplo');
      [...document.querySelectorAll('[role=toolbar] button')].find((b) => /^(Negrito|Bold)$/.test(b.getAttribute('aria-label') ?? ''))?.click();
      [...document.querySelectorAll('[role=toolbar] button')].find((b) => /^(Inserir link|Insert link)$/.test(b.getAttribute('aria-label') ?? ''))?.click();
      await new Promise((r) => setTimeout(r, 300));
    })()`,
  ],
  ['/minhas-ideias', 'minhas ideias'],
  ['/ideias', 'fila de ideias'],
  ...(process.env.A11Y_IDEA ? [[`/ideias/${process.env.A11Y_IDEA}`, 'detalhe da ideia']] : []),
  // Visualizador de foto e vídeo (M20, RN-147): a ideia de A11Y_IDEA precisa ter uma imagem anexada.
  ...(process.env.A11Y_IDEA
    ? [
        [
          `/ideias/${process.env.A11Y_IDEA}`,
          'detalhe da ideia (visualizador de anexo aberto)',
          `(async () => {
      [...document.querySelectorAll('button')].find((b) => /^(Abrir|Open) /.test(b.getAttribute('aria-label') ?? ''))?.click();
      await new Promise((r) => setTimeout(r, 1200));
    })()`,
        ],
      ]
    : []),
  // Anexos escolhidos no envio da ideia (M20, RN-146).
  [
    '/ideias/nova',
    'enviar ideia (anexos escolhidos)',
    `(async () => {
      const pngFile = (name) => new Promise((r) => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; c.getContext('2d').fillRect(0, 0, 300, 200); c.toBlob((b) => r(new File([b], name, { type: 'image/png' })), 'image/png'); });
      const input = document.querySelector("input[type=file][multiple]");
      const dt = new DataTransfer();
      for (const f of await Promise.all([pngFile('foto.png'), pngFile('outra.png')])) dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
    })()`,
  ],
  // Prévia antes de enviar (M20): o PDF escolhido abre num iframe dentro de um diálogo.
  [
    '/ideias/nova',
    'enviar ideia (prévia do PDF escolhido aberta)',
    `(async () => {
      const input = document.querySelector('input[type=file][multiple]');
      const dt = new DataTransfer();
      dt.items.add(new File(['%PDF-1.4\\n%%EOF'], 'laudo.pdf', { type: 'application/pdf' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      [...document.querySelectorAll('button')].find((b) => /^(Ver|View) laudo\\.pdf$/.test(b.getAttribute('aria-label') ?? ''))?.click();
      await new Promise((r) => setTimeout(r, 1200));
    })()`,
  ],
  // Mural (M21): A11Y_MURAL é o código de uma ideia publicada, com comentários; a pessoa logada modera.
  ...(process.env.A11Y_MURAL
    ? [
        [`/mural/${process.env.A11Y_MURAL}`, 'mural: página da ideia e conversa'],
        [
          `/mural/${process.env.A11Y_MURAL}`,
          'mural: quem reagiu (diálogo)',
          `[...document.querySelectorAll('button')].find((b) => /^(Ver quem reagiu|See who reacted)$/.test(b.textContent.trim()))?.click()`,
        ],
        [
          `/mural/${process.env.A11Y_MURAL}`,
          'mural: enviar a um colega (diálogo)',
          `(async () => {
      const trigger = [...document.querySelectorAll('button')].find((b) => /^(Compartilhar|Share)$/.test(b.textContent.trim()));
      trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      await new Promise((r) => setTimeout(r, 400));
      [...document.querySelectorAll('[role=menuitem]')].find((b) => /colega|colleague/.test(b.textContent))?.click();
      await new Promise((r) => setTimeout(r, 600));
    })()`,
        ],
        [
          `/mural/${process.env.A11Y_MURAL}`,
          'mural: responder a um comentário',
          `[...document.querySelectorAll('#conversa button')].find((b) => /^(Responder|Reply)$/.test(b.textContent.trim()))?.click()`,
        ],
        [
          `/mural/${process.env.A11Y_MURAL}`,
          'mural: ocultar comentário (diálogo)',
          `[...document.querySelectorAll('#conversa button')].find((b) => /^(Ocultar|Hide)$/.test(b.textContent.trim()))?.click()`,
        ],
        [`/ideias/${process.env.A11Y_MURAL}`, 'detalhe da ideia (bloco do mural)'],
        [
          `/ideias/${process.env.A11Y_MURAL}`,
          'detalhe da ideia (retirar do mural, diálogo)',
          `[...document.querySelectorAll('button')].find((b) => /^(Retirar do mural|Remove from the wall)$/.test(b.textContent.trim()))?.click()`,
        ],
        ['/mural/denuncias', 'mural: denúncias'],
      ]
    : []),
  ...(process.env.A11Y_MURAL_PUBLISHABLE
    ? [
        [
          `/ideias/${process.env.A11Y_MURAL_PUBLISHABLE}`,
          'detalhe da ideia (publicar no mural, confirmação)',
          `[...document.querySelectorAll('button')].find((b) => /^(Publicar no mural|Publicar de novo|Publish on the wall|Publish again)$/.test(b.textContent.trim()))?.click()`,
        ],
      ]
    : []),
  // Loja (M22): A11Y_STORE=1 com a loja ligada, itens e pedidos; a pessoa logada gerencia a loja.
  ...(process.env.A11Y_STORE
    ? [
        ['/loja', 'loja: vitrine e saldo'],
        [
          '/loja',
          'loja: pedir (confirmação)',
          `[...document.querySelectorAll('button')].find((b) => /^(Pedir|Order)$/.test(b.textContent.trim()) && !b.disabled)?.click()`,
        ],
        [
          '/loja',
          'loja: meus pedidos',
          `document.querySelectorAll('[role=tab]')[1]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`,
        ],
        [
          '/loja',
          'loja: meu extrato',
          `document.querySelectorAll('[role=tab]')[2]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`,
        ],
        ['/loja/gerenciar', 'gerenciar loja: pedidos'],
        [
          '/loja/gerenciar',
          'gerenciar loja: recusar (diálogo)',
          `[...document.querySelectorAll('button')].find((b) => /^(Recusar|Reject)$/.test(b.textContent.trim()))?.click()`,
        ],
        [
          '/loja/gerenciar',
          'gerenciar loja: itens',
          `document.querySelectorAll('[role=tab]')[1]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`,
        ],
        [
          '/loja/gerenciar',
          'gerenciar loja: editar item (diálogo)',
          `(async () => {
      document.querySelectorAll('[role=tab]')[1]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await new Promise((r) => setTimeout(r, 1200));
      [...document.querySelectorAll('[role=tabpanel]:not([hidden]) button')].find((b) => /^(Editar|Edit)$/.test(b.textContent.trim()))?.click();
      await new Promise((r) => setTimeout(r, 600));
    })()`,
        ],
        [
          '/loja/gerenciar',
          'gerenciar loja: bonificações',
          `document.querySelectorAll('[role=tab]')[2]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`,
        ],
        [
          '/loja/gerenciar',
          'gerenciar loja: saldos e ajuste (diálogo)',
          `(async () => {
      document.querySelectorAll('[role=tab]')[3]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await new Promise((r) => setTimeout(r, 1200));
      [...document.querySelectorAll('[role=tabpanel]:not([hidden]) button')].find((b) => /^(Ajustar saldo|Adjust balance)$/.test(b.textContent.trim()))?.click();
      await new Promise((r) => setTimeout(r, 600));
    })()`,
        ],
      ]
    : []),
  // Aprovação de outras áreas (M24, CA-RN-192.1).
  ...(process.env.A11Y_APPROVAL
    ? [
        [`/ideias/${process.env.A11Y_APPROVAL}`, 'detalhe da ideia (bloco Aprovação)'],
        [
          `/ideias/${process.env.A11Y_APPROVAL}`,
          'aprovação: registrar a decisão (diálogo)',
          `[...document.querySelectorAll('button')].find((b) => /^(Registrar decisão|Record decision)$/.test(b.textContent.trim()))?.click()`,
        ],
        [
          `/ideias/${process.env.A11Y_APPROVAL}`,
          'aprovação: cancelar o pedido (diálogo)',
          `[...document.querySelectorAll('button')].find((b) => /^(Cancelar pedido|Cancel request)$/.test(b.textContent.trim()))?.click()`,
        ],
      ]
    : []),
  ...(process.env.A11Y_APPROVAL_NEW
    ? [
        [
          `/ideias/${process.env.A11Y_APPROVAL_NEW}`,
          'aprovação: pedir (diálogo com aprovador do ITS e de fora)',
          `(async () => {
      [...document.querySelectorAll('button')].find((b) => /^(Pedir aprovação|Request approval)$/.test(b.textContent.trim()))?.click();
      await new Promise((r) => setTimeout(r, 600));
      const dialog = document.querySelector('[role=dialog]');
      [...(dialog?.querySelectorAll('button') ?? [])].find((b) => /^(Pessoa do ITS|ITS user)$/.test(b.textContent.trim()))?.click();
      [...(dialog?.querySelectorAll('button') ?? [])].find((b) => /^(Pessoa de fora|Person from outside)$/.test(b.textContent.trim()))?.click();
      await new Promise((r) => setTimeout(r, 300));
    })()`,
        ],
      ]
    : []),
  ...(process.env.A11Y_APPROVAL_TOKEN
    ? [[`/aprovar#${process.env.A11Y_APPROVAL_TOKEN}`, 'aprovação: página do link (sem sessão)']]
    : []),
  ['/aprovar#link-que-nao-existe-de-jeito-nenhum', 'aprovação: link inválido (sem sessão)'],
  ...(process.env.A11Y_APPROVALS_PENDING ? [['/aprovacoes', 'aprovações pendentes']] : []),
  // Campos do usuário (M25, CA-RN-202.2).
  ...(process.env.A11Y_USER_FIELDS
    ? [
        ['/admin/campos-do-usuario', 'campos do usuário'],
        [
          '/admin/campos-do-usuario',
          'campos do usuário: novo campo (diálogo)',
          `[...document.querySelectorAll('button')].find((b) => /^(Novo campo|New field)$/.test(b.textContent.trim()))?.click()`,
        ],
        [
          '/admin/campos-do-usuario',
          'campos do usuário: opções (diálogo)',
          `[...document.querySelectorAll('button')].find((b) => /^(Opções|Options):/.test(b.getAttribute('aria-label') ?? ''))?.click()`,
        ],
        ['/admin/usuarios', 'usuários (selo e filtros dos campos)'],
      ]
    : []),
  ...(process.env.A11Y_USER_DETAIL
    ? [[`/admin/usuarios/${process.env.A11Y_USER_DETAIL}`, 'detalhe do usuário (campos)']]
    : []),
  ['/indicadores', 'indicadores'],
  ['/ganhos', 'ganhos a validar'],
  ['/campanhas', 'campanhas'],
  ['/reconhecimento', 'reconhecimento'],
  ['/hall', 'hall de destaques'],
  ...(process.env.A11Y_HIGHLIGHT ? [[`/hall/${process.env.A11Y_HIGHLIGHT}`, 'destaque do hall']] : []),
  ...(process.env.A11Y_CAMPAIGN ? [[`/campanhas/${process.env.A11Y_CAMPAIGN}`, 'painel da campanha']] : []),
  ['/minha-conta', 'minha conta'],
  // Avisos na tela (M23, CA-RN-175.6): um de sucesso e um de erro abertos.
  [
    '/minha-conta',
    'aviso na tela: sucesso (preferências salvas)',
    `[...document.querySelectorAll('button')].find((b) => /^(Salvar preferências|Save preferences)$/.test(b.textContent.trim()))?.click()`,
  ],
  [
    '/minha-conta',
    'aviso na tela: erro (senha atual errada)',
    `(() => {
      const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[autocomplete=current-password]'), 'senha-errada-de-proposito');
      for (const el of document.querySelectorAll('input[autocomplete=new-password]')) set(el, 'Outra-Senha-2026-Bb!');
      document.querySelector('input[autocomplete=current-password]').form.requestSubmit();
    })()`,
  ],
  // Recorte da foto (M20, RN-143): o diálogo aberto com uma imagem.
  [
    '/minha-conta',
    'minha conta (recorte da foto aberto)',
    `(async () => {
      const pngFile = (name) => new Promise((r) => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; c.getContext('2d').fillRect(0, 0, 300, 200); c.toBlob((b) => r(new File([b], name, { type: 'image/png' })), 'image/png'); });
      const input = document.querySelector('input[type=file][accept^=image]');
      const dt = new DataTransfer();
      for (const f of await Promise.all([pngFile('eu.png')])) dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1500));
    })()`,
  ],
  ['/informacoes', 'informações'],
  ['/admin/usuarios', 'admin: usuários'],
  ['/admin/perfis', 'admin: perfis'],
  ['/admin/entidades', 'admin: entidades'],
  ['/admin/categorias', 'admin: categorias'],
  ['/admin/configuracoes', 'admin: configurações'],
  ['/admin/identidade', 'admin: identidade visual'],
  ['/admin/atribuicao', 'admin: atribuição da triagem'],
  ['/admin/reconhecimento', 'admin: reconhecimento'],
  ['/admin/email', 'admin: e-mail'],
  ['/admin/auditoria', 'admin: auditoria'],
  ['/admin/observabilidade', 'admin: observabilidade'],
  ['/admin/acesso', 'admin: acesso corporativo'],
  // Campos sensíveis (M19, RN-135): as telas acima abrem com eles ocultos; estas abrem com todos revelados.
  [
    '/admin/acesso',
    'admin: acesso corporativo (campos revelados)',
    `[...document.querySelectorAll('button[aria-pressed]')].filter((b) => /^(Mostrar|Show) /.test(b.getAttribute('aria-label') ?? '')).forEach((b) => b.click())`,
  ],
  [
    '/admin/email',
    'admin: e-mail (campos revelados)',
    `[...document.querySelectorAll('button[aria-pressed]')].filter((b) => /^(Mostrar|Show) /.test(b.getAttribute('aria-label') ?? '')).forEach((b) => b.click())`,
  ],
  [
    '/admin/auditoria',
    'admin: auditoria (detalhes abertos e revelados)',
    `document.querySelectorAll('details').forEach((d) => { d.open = true; }); ${`[...document.querySelectorAll('button[aria-pressed]')].filter((b) => /^(Mostrar|Show) /.test(b.getAttribute('aria-label') ?? '')).forEach((b) => b.click())`}`,
  ],
  // Integrações (M16): a tela tem abas e diálogos; o 3º item é um trecho que roda depois de carregar (o Radix troca de aba no mousedown, não no click).
  ['/admin/integracoes', 'admin: integrações'],
  [
    '/admin/integracoes',
    'admin: integrações > módulos',
    `document.querySelectorAll('[role=tab]')[1]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`,
  ],
  [
    '/admin/integracoes',
    'admin: integrações > webhooks',
    `document.querySelectorAll('[role=tab]')[2]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`,
  ],
  [
    '/admin/integracoes',
    'admin: integrações > documentação',
    `document.querySelectorAll('[role=tab]')[3]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`,
  ],
  // Webhooks (M17): diálogos da aba. Cada trecho troca de aba, espera a tela carregar e então abre o diálogo.
  [
    '/admin/integracoes',
    'admin: integrações > webhooks > nova assinatura (diálogo)',
    `(async () => {
      document.querySelectorAll('[role=tab]')[2]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await new Promise((r) => setTimeout(r, 1500));
      [...document.querySelectorAll('button')].find((b) => /Nova assinatura|New subscription/.test(b.textContent))?.click();
    })()`,
  ],
  [
    '/admin/integracoes',
    'admin: integrações > webhooks > detalhe da assinatura (diálogo)',
    `(async () => {
      document.querySelectorAll('[role=tab]')[2]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await new Promise((r) => setTimeout(r, 1500));
      [...document.querySelectorAll('[role=tabpanel]:not([hidden]) button')].find((b) => /^(Abrir|Open)/.test(b.textContent.trim()))?.click();
    })()`,
  ],
  [
    '/admin/integracoes',
    'admin: integrações > nova integração (diálogo)',
    `[...document.querySelectorAll('button')].find((b) => /Nova integração|New integration/.test(b.textContent))?.click()`,
  ],
  [
    '/admin/integracoes',
    'admin: integrações > detalhe da integração (diálogo)',
    `[...document.querySelectorAll('button')].find((b) => /^(Abrir|Open)/.test(b.textContent.trim()))?.click()`,
  ],
];
const PUBLIC_ONLY = (path) => ['/entrar', '/esqueci-senha', '/consulta', '/aprovar'].some((p) => path.startsWith(p));

const port = 9700 + Math.floor(Math.random() * 200);
const proc = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--lang=pt-BR',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'a11y-'))}`,
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
const go = async (path, wait = 1800) => {
  await send('Page.navigate', { url: base + path });
  await sleep(wait);
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await go('/entrar', 3000);
const login = await evaluate(
  `fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} }) }).then(r => r.status)`,
);
if (login !== 200) {
  console.error(`Login falhou (${login}).`);
  proc.kill();
  process.exit(2);
}

let failures = 0;
for (const theme of ['light', 'dark']) {
  // Tema "igual ao sistema": o navegador simula o modo claro ou escuro.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  for (const [path, name, after] of ROUTES) {
    if (PUBLIC_ONLY(path)) {
      // Telas sem sessão: sai da sessão só para esta, depois entra de novo.
      await evaluate(`fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })`);
    }
    await go(path, 2200);
    if (after) {
      await evaluate(after);
      await sleep(900);
    }
    await evaluate(axeSource);
    const result = await evaluate(
      `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }).then(r => JSON.stringify(r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }))))`,
    );
    const violations = JSON.parse(result);
    const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const minor = violations.filter((v) => !blocking.includes(v));
    console.log(
      `${blocking.length ? 'FALHOU' : 'OK    '} [${theme}] ${name} (${path})${minor.length ? ` · ${minor.length} aviso(s) leve(s)` : ''}`,
    );
    for (const v of blocking) {
      failures += 1;
      console.log(`   - ${v.id} (${v.impact}): ${v.help}\n     ${v.nodes.join(' | ')}`);
    }
    for (const v of minor) console.log(`   · ${v.id} (${v.impact ?? 'n/a'}): ${v.help} → ${v.nodes.join(' | ')}`);
    if (PUBLIC_ONLY(path)) {
      await evaluate(
        `fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} }) })`,
      );
    }
  }
}
console.log(
  failures === 0 ? '\nSem violações graves ou críticas.' : `\n${failures} violação(ões) grave(s) ou crítica(s).`,
);
ws.close();
proc.kill();
process.exit(failures === 0 ? 0 : 1);
