import type { Lang } from '../src/i18n';

/**
 * Mapa da ajuda: seções e páginas, na ordem de leitura (também a ordem de "Anterior/Próxima").
 * O endereço é o mesmo nos dois idiomas (/ajuda/pt-BR/<slug>/ e /ajuda/en/<slug>/), para o ITS
 * montar o link de ajuda de cada tela sem depender do idioma. Cada slug tem um arquivo
 * content/<idioma>/<slug>.mdx (o slug vazio é content/<idioma>/index.mdx).
 */
export interface NavPage {
  slug: string;
  title: Record<Lang, string>;
}
export interface NavSection {
  id: string;
  title: Record<Lang, string>;
  pages: NavPage[];
}

export const SECTIONS: NavSection[] = [
  {
    id: 'comece',
    title: { 'pt-BR': 'Comece aqui', en: 'Start here' },
    pages: [{ slug: '', title: { 'pt-BR': 'Boas-vindas', en: 'Welcome' } }],
  },
  {
    id: 'colaborador',
    title: { 'pt-BR': 'Para quem envia ideias', en: 'For people sending ideas' },
    pages: [
      { slug: 'colaborador/enviar-ideia', title: { 'pt-BR': 'Enviar uma ideia', en: 'Submit an idea' } },
      { slug: 'colaborador/acompanhar', title: { 'pt-BR': 'Acompanhar sua ideia', en: 'Follow your idea' } },
      { slug: 'colaborador/apoiar', title: { 'pt-BR': 'Apoiar uma ideia', en: 'Support an idea' } },
      { slug: 'colaborador/consulta-publica', title: { 'pt-BR': 'Consulta pública', en: 'Public lookup' } },
      {
        slug: 'colaborador/entrar-com-microsoft-ou-google',
        title: { 'pt-BR': 'Entrar com Microsoft ou Google', en: 'Sign in with Microsoft or Google' },
      },
      { slug: 'colaborador/mural', title: { 'pt-BR': 'Mural de ideias', en: 'Idea wall' } },
      {
        slug: 'colaborador/hall-e-pontos',
        title: { 'pt-BR': 'Hall, pontos e privacidade', en: 'Hall, points and privacy' },
      },
      { slug: 'colaborador/loja', title: { 'pt-BR': 'Loja: trocar pontos', en: 'Store: trading points' } },
    ],
  },
  {
    id: 'analista',
    title: { 'pt-BR': 'Para a equipe de melhoria', en: 'For the improvement team' },
    pages: [
      { slug: 'analista/triagem', title: { 'pt-BR': 'Fila e triagem', en: 'Queue and triage' } },
      {
        slug: 'analista/aprovar-e-etapas',
        title: { 'pt-BR': 'Aprovar e conduzir etapas', en: 'Approve and run steps' },
      },
      { slug: 'analista/convergencia', title: { 'pt-BR': 'Juntar ideias parecidas', en: 'Merge similar ideas' } },
      { slug: 'analista/resultado', title: { 'pt-BR': 'Resultado e padronização', en: 'Results and standardization' } },
      {
        slug: 'analista/mural',
        title: { 'pt-BR': 'Publicar e moderar o mural', en: 'Publish and moderate the idea wall' },
      },
      {
        slug: 'analista/pedir-aprovacao',
        title: { 'pt-BR': 'Pedir aprovação de outra área', en: 'Request approval from another area' },
      },
    ],
  },
  {
    id: 'gestor',
    title: { 'pt-BR': 'Para gestores', en: 'For managers' },
    pages: [
      { slug: 'gestor/indicadores', title: { 'pt-BR': 'Indicadores e relatórios', en: 'Indicators and reports' } },
      { slug: 'gestor/campanhas', title: { 'pt-BR': 'Campanhas', en: 'Campaigns' } },
      { slug: 'gestor/hall', title: { 'pt-BR': 'Destacar ideias no Hall', en: 'Highlight ideas in the Hall' } },
      { slug: 'gestor/ganhos', title: { 'pt-BR': 'Validar ganhos', en: 'Validate gains' } },
      { slug: 'gestor/aprovar-uma-ideia', title: { 'pt-BR': 'Aprovar uma ideia', en: 'Approve an idea' } },
    ],
  },
  {
    id: 'admin',
    title: { 'pt-BR': 'Para quem administra', en: 'For administrators' },
    pages: [
      { slug: 'admin/primeiros-passos', title: { 'pt-BR': 'Primeiros passos', en: 'First steps' } },
      {
        slug: 'admin/usuarios-e-perfis',
        title: { 'pt-BR': 'Usuários, perfis e escopo', en: 'Users, roles and scope' },
      },
      {
        slug: 'admin/campos-do-usuario',
        title: { 'pt-BR': 'Campos personalizados do usuário', en: 'User custom fields' },
      },
      {
        slug: 'admin/entidades-e-categorias',
        title: { 'pt-BR': 'Entidades e categorias', en: 'Entities and categories' },
      },
      { slug: 'admin/configuracoes', title: { 'pt-BR': 'Configurações e identidade', en: 'Settings and identity' } },
      {
        slug: 'admin/tela-de-login',
        title: { 'pt-BR': 'Personalizar a tela de login', en: 'Customize the sign-in screen' },
      },
      {
        slug: 'admin/loja',
        title: { 'pt-BR': 'Gerenciar a loja e as bonificações', en: 'Manage the store and bonuses' },
      },
      {
        slug: 'admin/acesso-corporativo',
        title: { 'pt-BR': 'Acesso corporativo: configurar', en: 'Corporate access: setting up' },
      },
      {
        slug: 'admin/acesso-corporativo-no-dia-a-dia',
        title: { 'pt-BR': 'Acesso corporativo: no dia a dia', en: 'Corporate access: day to day' },
      },
      { slug: 'admin/email', title: { 'pt-BR': 'E-mail', en: 'Email' } },
      { slug: 'admin/integracoes', title: { 'pt-BR': 'Integrações: configurar', en: 'Integrations: setting up' } },
      { slug: 'admin/webhooks', title: { 'pt-BR': 'Webhooks: configurar', en: 'Webhooks: setting up' } },
      { slug: 'admin/auditoria-e-privacidade', title: { 'pt-BR': 'Auditoria e privacidade', en: 'Audit and privacy' } },
      { slug: 'admin/ler-a-observabilidade', title: { 'pt-BR': 'Ler a observabilidade', en: 'Reading observability' } },
    ],
  },
  {
    id: 'ti',
    title: { 'pt-BR': 'Para quem instala', en: 'For whoever installs it' },
    pages: [
      { slug: 'ti/instalacao', title: { 'pt-BR': 'Instalação', en: 'Installation' } },
      { slug: 'ti/backup-e-atualizacao', title: { 'pt-BR': 'Backup e atualização', en: 'Backup and updates' } },
      { slug: 'ti/login-corporativo', title: { 'pt-BR': 'Login corporativo', en: 'Corporate sign-in' } },
      {
        slug: 'ti/envio-pela-microsoft',
        title: { 'pt-BR': 'Envio de e-mail pela Microsoft', en: 'Sending email through Microsoft' },
      },
      {
        slug: 'ti/envio-pelo-google',
        title: { 'pt-BR': 'Envio de e-mail pelo Google', en: 'Sending email through Google' },
      },
      {
        slug: 'ti/api-de-integracao',
        title: { 'pt-BR': 'API de integração: como consumir', en: 'Integration API: how to consume it' },
      },
      {
        slug: 'ti/escrita-pela-api',
        title: {
          'pt-BR': 'Escrita pela API: enviar, comentar e declarar',
          en: 'Writing through the API: submit, comment, declare',
        },
      },
      {
        slug: 'ti/webhooks-receber',
        title: { 'pt-BR': 'Webhooks: como receber', en: 'Webhooks: how to receive' },
      },
      { slug: 'ti/operacao-e-alertas', title: { 'pt-BR': 'Operação e alertas', en: 'Operation and alerts' } },
    ],
  },
  {
    id: 'referencia',
    title: { 'pt-BR': 'Referência', en: 'Reference' },
    pages: [
      { slug: 'referencia/situacoes', title: { 'pt-BR': 'Situações da ideia', en: 'Idea statuses' } },
      { slug: 'referencia/glossario', title: { 'pt-BR': 'Glossário', en: 'Glossary' } },
      { slug: 'referencia/regras', title: { 'pt-BR': 'Regras de negócio', en: 'Business rules' } },
      {
        slug: 'referencia/perfis-e-permissoes',
        title: { 'pt-BR': 'Perfis e permissões', en: 'Roles and permissions' },
      },
      {
        slug: 'referencia/perguntas-frequentes',
        title: { 'pt-BR': 'Perguntas frequentes', en: 'Frequently asked questions' },
      },
    ],
  },
];

export const ALL_PAGES: NavPage[] = SECTIONS.flatMap((s) => s.pages);

/** Endereço da página dentro da ajuda (sem o /ajuda, que o Next acrescenta pelo basePath). */
export const pageHref = (lang: Lang, slug: string) => (slug ? `/${lang}/${slug}/` : `/${lang}/`);
