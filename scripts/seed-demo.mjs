// Dados de DEMONSTRAÇÃO, todos fictícios, para conhecer o sistema sem digitar nada.
//
// Pela API, numa instalação ainda NÃO instalada (o assistente roda uma única vez). Não existe senha
// no código: você escolhe a senha de todas as contas de demonstração.
//
//   DEMO_PASSWORD='uma-senha-forte-aqui' node scripts/seed-demo.mjs http://127.0.0.1:8080
//
// Cria: a organização "Ideias Demo", 2 unidades com setores, categorias prontas, 5 pessoas com perfis
// diferentes (@example.test) e ideias em todas as situações, com etapas e comentários.
// NUNCA use numa instalação de verdade: as contas de demonstração ficam com a mesma senha.
// O envio de e-mail continua desligado: nada sai do sistema.

const base = (process.argv[2] ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const password = process.env.DEMO_PASSWORD;
if (!password) {
  console.error('Defina DEMO_PASSWORD com a senha das contas de demonstração (siga a política: 10+ caracteres, 3 tipos).');
  process.exit(2);
}

class Api {
  cookie = null;
  async call(method, path, body) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) {
      const pair = set.split(';')[0];
      this.cookie = pair.endsWith('=') ? null : pair;
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    return json;
  }
}
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const status = await fetch(`${base}/api/install/status`).then((r) => r.json());
if (status.installed) {
  console.error('Esta instalação já foi concluída. O seed de demonstração só roda numa instalação nova.');
  process.exit(1);
}

const admin = new Api();
await admin.call('POST', '/install', {
  organizationName: 'Ideias Demo',
  timezone: 'America/Sao_Paulo',
  locale: 'pt-BR',
  adminName: 'Ana Souza (demo)',
  adminEmail: 'ana@example.test',
  password,
});
const root = (await admin.call('GET', '/entities')).find((e) => e.parentId === null);
const fabrica = await admin.call('POST', '/entities', { name: 'Fábrica', parentId: root.id });
const logistica = await admin.call('POST', '/entities', { name: 'Logística', parentId: root.id });
const usinagem = await admin.call('POST', '/entities', { name: 'Usinagem', parentId: fabrica.id });
const montagem = await admin.call('POST', '/entities', { name: 'Montagem', parentId: fabrica.id });
const expedicao = await admin.call('POST', '/entities', { name: 'Expedição', parentId: logistica.id });
await admin.call('POST', '/categories/import', { set: 'safety_qdcep' });
const categories = await admin.call('GET', '/categories');
const roles = await admin.call('GET', '/roles');
const roleId = (key) => roles.find((r) => r.systemKey === key).id;

async function person(name, email, roleKey, entity) {
  const created = await admin.call('POST', '/users', { name, email });
  await admin.call('PUT', `/users/${created.user.id}/scopes`, {
    scopes: [{ roleId: roleId(roleKey), entityId: entity.id, includeChildren: true }],
  });
  await fetch(`${base}/api/auth/password-reset/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: created.passwordLink.token, newPassword: password }),
  }).then((r) => {
    if (!r.ok) throw new Error('Não foi possível definir a senha da conta de demonstração (confira a política de senha).');
  });
  const api = new Api();
  await api.call('POST', '/auth/login', { email, password });
  return { ...created.user, api };
}
const bruno = await person('Bruno Lima (demo)', 'bruno@example.test', 'analyst', root);
const marta = await person('Marta Reis (demo)', 'marta@example.test', 'manager', fabrica);
const carla = await person('Carla Dias (demo)', 'carla@example.test', 'collaborator', usinagem);
const diego = await person('Diego Alves (demo)', 'diego@example.test', 'collaborator', montagem);
const eva = await person('Eva Prado (demo)', 'eva@example.test', 'collaborator', expedicao);
void marta;

const cat = (name) => categories.find((c) => c.name === name)?.id ?? categories[0].id;
const send = (who, entity, title, description, category, extra = {}) =>
  who.api.call('POST', '/ideas', { title, description, entityId: entity.id, categoryId: category, ...extra });

// Enviadas
await send(carla, usinagem, 'Protetor de acrílico na serra de fita', 'O operador fica exposto à lâmina durante o corte de peças pequenas.', cat('Segurança'), {
  proposedSolution: 'Instalar um protetor articulado de acrílico.',
  expectedGain: 'Menos risco de acidente com corte.',
});
await send(diego, montagem, 'Bancada com altura regulável', 'As bancadas têm altura única e parte da equipe trabalha curvada.', cat('Pessoas'));
// Em análise
const analise = await send(carla, usinagem, 'Etiqueta de cor para ferramentas por posto', 'Ferramentas se misturam entre os postos e o operador perde tempo procurando.', cat('Qualidade'));
await bruno.api.call('POST', `/ideas/${analise.code}/start-review`);
await bruno.api.call('POST', `/ideas/${analise.code}/comments`, { body: 'Vamos testar em um posto antes de decidir.', visibility: 'public' });
await bruno.api.call('POST', `/ideas/${analise.code}/comments`, { body: 'Comparar com o custo do quadro de sombra.', visibility: 'internal' });
// Em andamento (com duas etapas, uma concluída)
const andamento = await send(diego, montagem, 'Kit de parafusos pré-separados na linha', 'A separação de parafusos consome 12 minutos por turno.', cat('Qualidade'));
const aprovada = await bruno.api.call('POST', `/ideas/${andamento.code}/approve`, { stepName: 'Levantar os itens do kit', assigneeId: bruno.id, dueDate: day(5) });
await bruno.api.call('POST', `/ideas/${andamento.code}/steps/${aprovada.steps[0].id}/complete`);
await bruno.api.call('POST', `/ideas/${andamento.code}/steps`, { name: 'Montar e testar o kit', assigneeId: diego.id, dueDate: day(14) });
// Implementada
const feita = await send(eva, expedicao, 'Faixa de pedestres na doca 3', 'Pedestres cruzam o pátio de carga fora de qualquer faixa.', cat('Segurança'));
const feitaAprovada = await bruno.api.call('POST', `/ideas/${feita.code}/approve`, { stepName: 'Pintar a faixa', assigneeId: bruno.id, dueDate: day(3) });
await bruno.api.call('POST', `/ideas/${feita.code}/steps/${feitaAprovada.steps[0].id}/complete`);
await bruno.api.call('POST', `/ideas/${feita.code}/implement`, { resultText: 'Faixa pintada e sinalização instalada. Nenhum quase-acidente registrado no mês seguinte.' });
// Não autorizada
const recusada = await send(carla, usinagem, 'Trocar todas as máquinas por modelos novos', 'As máquinas atuais são antigas.', cat('Qualidade'));
await bruno.api.call('POST', `/ideas/${recusada.code}/start-review`);
await bruno.api.call('POST', `/ideas/${recusada.code}/reject`, { reason: 'Fora do escopo de melhoria contínua: é investimento de capital. Sugira melhorias pontuais de manutenção.' });

console.log(`
Demonstração criada em ${base}

Entre com qualquer conta abaixo (a senha é a que você definiu em DEMO_PASSWORD):
  ana@example.test    Administradora (tudo)
  bruno@example.test  Analista da organização toda (tria, aprova, conduz etapas)
  marta@example.test  Gestora da Fábrica (indicadores)
  carla@example.test  Colaboradora da Usinagem
  diego@example.test  Colaborador da Montagem
  eva@example.test    Colaboradora da Expedição
`);
