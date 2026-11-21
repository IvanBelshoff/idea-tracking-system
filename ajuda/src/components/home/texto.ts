import type { Lang } from '../../i18n';

/**
 * Textos da página inicial do site público (pt-BR é a fonte; o inglês é tipado a partir dele).
 * Os dados da ideia de exemplo são fictícios, como os da demonstração das capturas.
 */
export type Situacao = 'submitted' | 'in_review' | 'in_progress' | 'implemented';

const ptBR = {
  meta: {
    title: 'ITS – Sistema de Acompanhamento de Ideias',
    description:
      'Sistema aberto e gratuito de gestão de ideias e melhoria contínua: toda ideia tem situação, prazo e próximo passo à vista de quem enviou.',
  },
  skip: 'Pular para o conteúdo',
  nav: {
    label: 'Navegação principal',
    how: 'Como funciona',
    features: 'Recursos',
    docs: 'Documentação',
    github: 'GitHub',
    language: 'PT',
    otherLanguage: 'Read this page in English',
  },
  hero: {
    title: ['Nenhuma ideia', 'sem resposta.'],
    lede: 'No ITS, toda ideia tem uma situação, um prazo e um próximo passo que quem enviou consegue ver. Cada mudança fica registrada: quem fez, quando e por quê.',
    ideaCode: 'ITS-2026-0042',
    ideaTitle: 'Kit de parafusos já separado na linha',
    note: 'Exemplo com dados fictícios.',
    logLabel: 'Histórico da ideia de exemplo',
    log: [
      { when: '03/11 08:12', what: 'Carla Dias enviou a ideia', why: 'Pelo celular, da Usinagem', status: 'submitted' },
      {
        when: '04/11 10:40',
        what: 'Bruno Lima assumiu a triagem',
        why: 'Prazo de retorno: 13/11',
        status: 'in_review',
      },
      {
        when: '06/11 16:05',
        what: 'Aprovada, com 3 etapas',
        why: '"Reduz 12 minutos por turno na separação"',
        status: 'in_progress',
      },
      { when: '14/11 09:30', what: 'Etapa 1 concluída', why: 'Kits montados para a linha 1', status: 'in_progress' },
      {
        when: 'hoje',
        what: 'Etapa 2 em andamento',
        why: 'Teste na linha 3, prazo 04/12',
        status: 'in_progress',
        live: true,
      },
    ] as { when: string; what: string; why: string; status: Situacao; live?: boolean }[],
    yourTurn: 'sua vez',
    install: 'Instalar o ITS',
    docs: 'Ver a documentação',
  },
  status: { submitted: 'Enviada', in_review: 'Em análise', in_progress: 'Em andamento', implemented: 'Implementada' },
  how: {
    title: 'Do envio ao resultado, à vista de quem enviou',
    steps: [
      {
        name: 'Enviar',
        status: 'submitted',
        text: 'Qualquer colaborador envia uma ideia, do celular ou do computador, em poucos campos.',
      },
      {
        name: 'Triar',
        status: 'in_review',
        text: 'A equipe de melhoria analisa dentro de um prazo de retorno, junta ideias parecidas e decide. Se recusar, explica o porquê a quem enviou.',
      },
      {
        name: 'Executar',
        status: 'in_progress',
        text: 'A ideia aprovada vira etapas com responsável e prazo. Quem enviou vê o andamento e o próximo passo.',
      },
      {
        name: 'Reconhecer',
        status: 'implemented',
        text: 'O ganho é validado, e as melhores ideias vão para o Hall de destaques, com o consentimento de quem aparece.',
      },
    ] as { name: string; status: Situacao; text: string }[],
  },
  features: {
    title: 'Feito para quem cuida de um programa de ideias',
    items: [
      {
        title: 'Fila e triagem',
        text: 'Toda ideia nova entra numa fila com prazo de retorno, filtros e ações em lote.',
        shot: 'fila',
        alt: 'Fila de ideias do ITS, com filtros, situação e prazo de cada ideia.',
      },
      {
        title: 'Cada ideia com o seu histórico',
        text: 'Etapas, responsáveis, prazos, comentários e tudo o que mudou, numa página só.',
        shot: 'detalhe',
        alt: 'Página de uma ideia no ITS, com situação, etapas e prazo.',
      },
      {
        title: 'Indicadores e relatórios',
        text: 'Ideias por situação, tempo de triagem e de execução, participação e ganhos, por área e período, com exportação em CSV e PDF.',
        shot: 'indicadores',
        alt: 'Painel de indicadores do ITS, com ideias por situação e tempos de triagem e execução.',
      },
      {
        title: 'Do jeito da sua organização',
        text: 'Unidades e áreas em árvore, perfis com permissões, sua marca, campos próprios no cadastro dos usuários e login com Microsoft ou Google.',
        shot: 'identidade',
        alt: 'Tela de identidade visual do ITS, com cor da marca, logo e fonte da organização.',
      },
      {
        title: 'Reconhecimento com respeito',
        text: 'Pontos, Hall de destaques, mural de ideias e loja de pontos, sempre com o consentimento de quem aparece.',
        shot: 'hall',
        alt: 'Hall de destaques do ITS, com uma ideia implementada em destaque; o autor aparece como colaborador anônimo.',
      },
      {
        title: 'Para o TI',
        text: 'Saúde do sistema com alertas, e API de integração e webhooks, desligados até alguém ligar.',
        shot: 'observabilidade',
        alt: 'Tela de observabilidade do ITS, com a saúde de cada parte do sistema.',
      },
    ] as { title: string; text: string; shot?: string; alt?: string }[],
  },
  video: {
    title: 'Veja o caminho de uma ideia',
    caption: 'Menos de um minuto, sem som, com dados fictícios.',
    label: 'Vídeo: uma ideia do envio à implementação no ITS',
  },
  install: {
    title: 'Instale em três passos',
    lede: 'Precisa só do Docker com o Compose v2. As imagens vêm prontas.',
    steps: [
      { title: 'Baixe os dois arquivos.', text: '' },
      {
        title: 'Preencha o .env.',
        text: 'Coloque a senha do banco em POSTGRES_PASSWORD e uma chave para os segredos em APP_SECRET_KEY. Sem as duas, o ITS não sobe.',
      },
      {
        title: 'Suba e abra.',
        text: 'Rode o comando e abra http://127.0.0.1:8080. O assistente de instalação cria a conta de administrador; não existe usuário nem senha padrão.',
      },
    ],
    copy: 'Copiar',
    copied: 'Copiado',
    copyLabel: (what: string) => `Copiar: ${what}`,
    command: 'Comando',
    guide: 'Guia completo de instalação',
  },
  open: {
    title: 'Gratuito e no seu servidor',
    items: [
      { title: 'Código aberto (MIT).', text: 'Use, adapte e distribua sem pagar licença, inclusive em uso comercial.' },
      {
        title: 'Na sua infraestrutura.',
        text: 'O ITS roda no seu servidor; os dados das ideias ficam com a sua organização.',
      },
      { title: 'Imagens prontas.', text: 'No GitHub e no Docker Hub, para amd64 e arm64.' },
      { title: 'Português e inglês.', text: 'Na interface e na documentação, que tem simuladores para praticar.' },
    ],
  },
  footer: {
    name: 'ITS – Idea Tracking System',
    by: 'Criado por',
    links: {
      docs: 'Documentação',
      github: 'GitHub',
      releases: 'Versões',
      dockerHub: 'Docker Hub',
      license: 'Licença MIT',
    },
  },
};

export type HomeText = typeof ptBR;

const en: HomeText = {
  meta: {
    title: 'ITS – Idea Tracking System',
    description:
      'Free, open-source system for managing ideas and continuous improvement: every idea has a status, a deadline and a next step the author can see.',
  },
  skip: 'Skip to content',
  nav: {
    label: 'Main navigation',
    how: 'How it works',
    features: 'Features',
    docs: 'Documentation',
    github: 'GitHub',
    language: 'EN',
    otherLanguage: 'Ler esta página em português',
  },
  hero: {
    title: ['No idea goes', 'unanswered.'],
    lede: 'In ITS, every idea has a status, a deadline and a next step that the person who sent it can see. Every change is recorded: who did it, when and why.',
    ideaCode: 'ITS-2026-0042',
    ideaTitle: 'Screw kit pre-sorted on the line',
    note: 'Example with fictitious data.',
    logLabel: 'History of the example idea',
    log: [
      {
        when: '11/03 08:12',
        what: 'Carla Dias submitted the idea',
        why: 'From her phone, in Machining',
        status: 'submitted',
      },
      {
        when: '11/04 10:40',
        what: 'Bruno Lima took over triage',
        why: 'Response deadline: 11/13',
        status: 'in_review',
      },
      {
        when: '11/06 16:05',
        what: 'Approved, with 3 steps',
        why: '"Saves 12 minutes per shift on sorting"',
        status: 'in_progress',
      },
      { when: '11/14 09:30', what: 'Step 1 completed', why: 'Kits assembled for line 1', status: 'in_progress' },
      {
        when: 'today',
        what: 'Step 2 in progress',
        why: 'Trial on line 3, due 12/04',
        status: 'in_progress',
        live: true,
      },
    ],
    yourTurn: 'your turn',
    install: 'Install ITS',
    docs: 'Read the documentation',
  },
  status: { submitted: 'Submitted', in_review: 'In review', in_progress: 'In progress', implemented: 'Implemented' },
  how: {
    title: 'From submission to results, in plain sight of the author',
    steps: [
      {
        name: 'Submit',
        status: 'submitted',
        text: 'Any employee submits an idea, from a phone or a computer, in a few fields.',
      },
      {
        name: 'Triage',
        status: 'in_review',
        text: 'The improvement team reviews it within a response deadline, merges similar ideas and decides. If they reject it, they tell the author why.',
      },
      {
        name: 'Run',
        status: 'in_progress',
        text: 'The approved idea becomes steps with an owner and a deadline. The author sees the progress and the next step.',
      },
      {
        name: 'Recognize',
        status: 'implemented',
        text: 'The gain is validated, and the best ideas go to the Hall of fame, with the consent of whoever appears.',
      },
    ],
  },
  features: {
    title: 'Built for whoever runs an ideas program',
    items: [
      {
        title: 'Queue and triage',
        text: 'Every new idea lands in a queue with a response deadline, filters and bulk actions.',
        shot: 'fila',
        alt: 'ITS idea queue, with filters and the status and deadline of each idea.',
      },
      {
        title: 'Every idea with its history',
        text: 'Steps, owners, deadlines, comments and everything that changed, on a single page.',
        shot: 'detalhe',
        alt: 'An idea page in ITS, with status, steps and deadline.',
      },
      {
        title: 'Indicators and reports',
        text: 'Ideas by status, triage and execution time, participation and gains, by area and period, with CSV and PDF export.',
        shot: 'indicadores',
        alt: 'ITS indicators dashboard, with ideas by status and triage and execution times.',
      },
      {
        title: 'Your organization, your way',
        text: 'Units and areas in a tree, roles with permissions, your brand, custom user fields and sign-in with Microsoft or Google.',
        shot: 'identidade',
        alt: 'ITS visual identity screen, with the organization brand color, logo and font.',
      },
      {
        title: 'Recognition with respect',
        text: 'Points, Hall of fame, idea wall and points store, always with the consent of whoever appears.',
        shot: 'hall',
        alt: 'ITS Hall of fame, with an implemented idea featured; the author appears as an anonymous employee.',
      },
      {
        title: 'For IT',
        text: 'System health with alerts, plus an integration API and webhooks, off until someone turns them on.',
        shot: 'observabilidade',
        alt: 'ITS observability screen, with the health of each part of the system.',
      },
    ],
  },
  video: {
    title: 'Follow an idea along its way',
    caption: 'Under a minute, no sound, with fictitious data.',
    label: 'Video: an idea from submission to implementation in ITS',
  },
  install: {
    title: 'Install in three steps',
    lede: 'All you need is Docker with Compose v2. The images come ready.',
    steps: [
      { title: 'Download the two files.', text: '' },
      {
        title: 'Fill in the .env.',
        text: 'Put the database password in POSTGRES_PASSWORD and a key for secrets in APP_SECRET_KEY. Without both, ITS does not start.',
      },
      {
        title: 'Start it and open it.',
        text: 'Run the command and open http://127.0.0.1:8080. The installation wizard creates the administrator account; there is no default user or password.',
      },
    ],
    copy: 'Copy',
    copied: 'Copied',
    copyLabel: (what: string) => `Copy: ${what}`,
    command: 'Command',
    guide: 'Full installation guide',
  },
  open: {
    title: 'Free, and on your own server',
    items: [
      {
        title: 'Open source (MIT).',
        text: 'Use, adapt and distribute it without paying for a license, including commercial use.',
      },
      {
        title: 'On your infrastructure.',
        text: 'ITS runs on your server; the ideas data stays with your organization.',
      },
      { title: 'Ready-made images.', text: 'On GitHub and Docker Hub, for amd64 and arm64.' },
      {
        title: 'Portuguese and English.',
        text: 'In the interface and in the documentation, which has simulators to practice with.',
      },
    ],
  },
  footer: {
    name: 'ITS – Idea Tracking System',
    by: 'Created by',
    links: {
      docs: 'Documentation',
      github: 'GitHub',
      releases: 'Releases',
      dockerHub: 'Docker Hub',
      license: 'MIT License',
    },
  },
};

export const HOME: Record<Lang, HomeText> = { 'pt-BR': ptBR, en };

/** Âncoras das seções, uma por idioma (os dois idiomas estão no HTML, então os ids não se repetem). */
export const ANCHORS: Record<Lang, { how: string; features: string; main: string }> = {
  'pt-BR': { how: 'como-funciona', features: 'recursos', main: 'conteudo' },
  en: { how: 'how-it-works', features: 'features', main: 'content' },
};

/** Os três comandos da instalação (iguais nos dois idiomas). */
const RAW = 'https://raw.githubusercontent.com/IvanBelshoff/idea-tracking-system/main';
export const COMMANDS = {
  download: [
    'mkdir its && cd its',
    `curl -fsSLO ${RAW}/docker-compose.yml`,
    `curl -fsSL ${RAW}/.env.example -o .env`,
  ].join('\n'),
  start: 'docker compose up -d',
};
