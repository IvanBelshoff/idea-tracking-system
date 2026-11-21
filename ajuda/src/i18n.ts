/** Idiomas da ajuda: os mesmos do ITS. Toda página existe nos dois (scripts/check-content.mjs). */
export const LANGS = ['pt-BR', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);

/** Textos da interface da ajuda (o conteúdo fica em content/). O inglês é tipado a partir deste. */
const ptBR = {
  site: {
    title: 'Ajuda do ITS',
    short: 'Ajuda',
    description: 'Aprenda a usar e a administrar o ITS, com exemplos para praticar.',
  },
  header: {
    home: 'Início da ajuda',
    backToIts: 'Voltar ao ITS',
    repo: 'Código no GitHub',
    siteHome: 'Início',
    menu: 'Abrir o menu da ajuda',
    closeMenu: 'Fechar o menu',
    language: 'Idioma',
    languageCode: 'PT',
    otherLanguage: 'English',
    otherLanguageHint: 'Read this page in English',
  },
  theme: { label: 'Tema', system: 'Automático', light: 'Claro', dark: 'Escuro' },
  nav: { label: 'Navegação da ajuda' },
  toc: { title: 'Nesta página' },
  pager: { label: 'Outras páginas', prev: 'Anterior', next: 'Próxima' },
  skip: 'Pular para o conteúdo',
  search: {
    open: 'Buscar',
    label: 'Buscar na ajuda',
    placeholder: 'O que você quer saber?',
    empty: 'Nada encontrado para essa busca. Tente outra palavra.',
    loading: 'Buscando…',
    unavailable: 'A busca fica disponível na versão publicada da ajuda.',
    shortcut: 'Atalho: Ctrl + K',
    close: 'Fechar a busca',
  },
  sim: {
    practice: 'Pratique',
    restart: 'Recomeçar',
    note: 'Simulação com dados fictícios: nada aqui muda o ITS.',
  },
  rule: { title: (id: string) => `Regra ${id} na referência` },
  callout: { tip: 'Dica', warning: 'Atenção' },
  status: {
    submitted: 'Enviada',
    in_review: 'Em análise',
    in_progress: 'Em andamento',
    implemented: 'Implementada',
    rejected: 'Não autorizada',
    late: 'Atrasada',
  },
  rules: { caption: 'Regras de negócio do ITS', id: 'Regra', rule: 'O que diz', where: 'Onde aprender' },
  capture: {
    expand: (alt: string) => `Ampliar a captura: ${alt}`,
    hint: 'Ampliar',
    viewer: 'Captura de tela ampliada',
    close: 'Fechar',
    zoomIn: 'Aproximar',
    zoomOut: 'Afastar',
  },
};

export type Messages = typeof ptBR;

const en: Messages = {
  site: {
    title: 'ITS Help',
    short: 'Help',
    description: 'Learn to use and run ITS, with examples you can practice.',
  },
  header: {
    home: 'Help home',
    backToIts: 'Back to ITS',
    repo: 'Code on GitHub',
    siteHome: 'Home',
    menu: 'Open the help menu',
    closeMenu: 'Close the menu',
    language: 'Language',
    languageCode: 'EN',
    otherLanguage: 'Português',
    otherLanguageHint: 'Ler esta página em português',
  },
  theme: { label: 'Theme', system: 'Automatic', light: 'Light', dark: 'Dark' },
  nav: { label: 'Help navigation' },
  toc: { title: 'On this page' },
  pager: { label: 'More pages', prev: 'Previous', next: 'Next' },
  skip: 'Skip to content',
  search: {
    open: 'Search',
    label: 'Search the help',
    placeholder: 'What do you want to know?',
    empty: 'Nothing found for that search. Try another word.',
    loading: 'Searching…',
    unavailable: 'Search is available in the published version of the help.',
    shortcut: 'Shortcut: Ctrl + K',
    close: 'Close search',
  },
  sim: {
    practice: 'Practice',
    restart: 'Start over',
    note: 'Simulation with made-up data: nothing here changes ITS.',
  },
  rule: { title: (id: string) => `Rule ${id} in the reference` },
  callout: { tip: 'Tip', warning: 'Heads up' },
  status: {
    submitted: 'Submitted',
    in_review: 'In review',
    in_progress: 'In progress',
    implemented: 'Implemented',
    rejected: 'Not approved',
    late: 'Late',
  },
  rules: { caption: 'ITS business rules', id: 'Rule', rule: 'What it says', where: 'Where to learn' },
  capture: {
    expand: (alt: string) => `Enlarge the screenshot: ${alt}`,
    hint: 'Enlarge',
    viewer: 'Enlarged screenshot',
    close: 'Close',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
  },
};

export const MESSAGES: Record<Lang, Messages> = { 'pt-BR': ptBR, en };
export const otherLang = (lang: Lang): Lang => (lang === 'pt-BR' ? 'en' : 'pt-BR');
