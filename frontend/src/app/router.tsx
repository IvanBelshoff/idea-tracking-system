import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import './admin/nav';
import { ApprovalLinkPage } from './approvals/link-page';
import { PendingApprovalsPage } from './approvals/pending-page';
import { ForgotPasswordPage } from './auth/forgot-password-page';
import { InstallPage } from './auth/install-page';
import { LoginPage } from './auth/login-page';
import { SetPasswordPage } from './auth/set-password-page';
import { CampaignPage, CampaignsPage } from './campaigns/campaigns-ui';
import { LoadError, PageLoading, withPermission } from './guards';
import { HallPage, HighlightPage } from './hall/hall-ui';
import { PendingGainsPage } from './ideas/gains-page';
import { IdeaPage } from './ideas/idea-page';
import { MyIdeasPage, QueuePage } from './ideas/list-pages';
import { SubmitIdeaPage } from './ideas/submit-page';
import { MuralReportsPage } from './mural/mural-manage';
import { MuralIdeaPage } from './mural/mural-pages';
import { NotificationsPage } from './notifications/notifications-page';
import { AccountPage } from './pages/account-page';
import { HomePage } from './pages/home-page';
import { InfoPage } from './pages/info-page';
import { NotFoundPage } from './pages/status-pages';
import { PublicIdeaPage, PublicLookupPage } from './public/public-pages';
import { RecognitionPage } from './recognition/recognition-page';
import { ReportsPage } from './reports/reports-page';
import { installStatusQuery, meQuery, publicSettingsQuery } from './session';
import { StoreAdminPage } from './store/store-admin';
import { StorePage } from './store/store-pages';
import { SessionShell } from './user-fields/profile-gate';

/*
 * Rotas (TanStack Router, definidas em código). Endereços em pt-BR: são parte da interface.
 * Guardas em `beforeLoad`, antes de a tela renderizar, usando o mesmo cache do TanStack Query:
 *   raiz → [instalação concluída] → [sessão] → moldura do sistema → telas
 * Telas de administração e protótipos carregam sob demanda (lazyRouteComponent).
 */

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

/** Sem instalação, só existe o assistente (RN-43); instalado, o assistente some. */
const installGate = createRoute({
  getParentRoute: () => rootRoute,
  id: 'instalacao',
  beforeLoad: async ({ context, location }) => {
    const { installed } = await context.queryClient.ensureQueryData(installStatusQuery);
    const onWizard = location.pathname === '/instalar';
    if (!installed && !onWizard) throw redirect({ to: '/instalar', replace: true });
    if (installed && onWizard) throw redirect({ to: '/', replace: true });
  },
  errorComponent: LoadError,
});

const installRoute = createRoute({ getParentRoute: () => installGate, path: '/instalar', component: InstallPage });

const loginRoute = createRoute({
  getParentRoute: () => installGate,
  path: '/entrar',
  validateSearch: z.object({ voltar: z.string().optional(), sso_erro: z.string().max(60).optional() }),
  component: LoginPage,
});

const setPasswordRoute = createRoute({
  getParentRoute: () => installGate,
  path: '/definir-senha',
  component: SetPasswordPage,
});

// Consulta pública (RN-33): sem login. Desligada por padrão; a API responde 404 igual para tudo.
const publicLookupRoute = createRoute({
  getParentRoute: () => installGate,
  path: '/consulta',
  component: PublicLookupPage,
});
const publicIdeaRoute = createRoute({
  getParentRoute: () => installGate,
  path: '/consulta/$code',
  component: PublicIdeaPage,
});

// Link de uso único da aprovação de outra área (RN-184): sem login; o link vem depois do #.
const approvalLinkRoute = createRoute({
  getParentRoute: () => installGate,
  path: '/aprovar',
  component: ApprovalLinkPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => installGate,
  path: '/esqueci-senha',
  component: ForgotPasswordPage,
});

/** Área logada: sem sessão, vai para o login e volta para a página pedida depois. */
const sessionGate = createRoute({
  getParentRoute: () => installGate,
  id: 'sessao',
  beforeLoad: async ({ context, location }) => {
    const [me] = await Promise.all([
      context.queryClient.ensureQueryData(meQuery),
      // Fuso da instalação já disponível na primeira renderização (datas na tela).
      context.queryClient.ensureQueryData(publicSettingsQuery).catch(() => null),
    ]);
    if (!me) {
      const back = location.href;
      throw redirect({ to: '/entrar', search: back === '/' ? {} : { voltar: back }, replace: true });
    }
    return { me };
  },
  component: SessionShell,
  notFoundComponent: NotFoundPage,
  errorComponent: LoadError,
});

const homeRoute = createRoute({ getParentRoute: () => sessionGate, path: '/', component: HomePage });
const accountRoute = createRoute({ getParentRoute: () => sessionGate, path: '/minha-conta', component: AccountPage });
const infoRoute = createRoute({ getParentRoute: () => sessionGate, path: '/informacoes', component: InfoPage });
const notificationsRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/notificacoes',
  component: NotificationsPage,
});

// Ideias (M2). O detalhe não exige permissão na tela: a API decide quem vê (autor ou escopo; 404 fora).
const submitRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/ideias/nova',
  component: withPermission(['idea.submit', 'idea.register_for_other'], SubmitIdeaPage),
});
const myIdeasRoute = createRoute({ getParentRoute: () => sessionGate, path: '/minhas-ideias', component: MyIdeasPage });
const queueRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/ideias',
  component: withPermission(['idea.view_scope'], QueuePage),
});
const reportsRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/indicadores',
  component: withPermission(['report.view'], ReportsPage),
});
const gainsRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/ganhos',
  component: withPermission(['gain.validate'], PendingGainsPage),
});
const campaignsRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/campanhas',
  component: withPermission(['campaign.manage', 'report.view'], CampaignsPage),
});
const campaignRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/campanhas/$id',
  component: withPermission(['campaign.manage', 'report.view'], CampaignPage),
});
const recognitionRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/reconhecimento',
  component: RecognitionPage,
});
const pendingApprovalsRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/aprovacoes',
  component: PendingApprovalsPage,
});
const hallRoute = createRoute({ getParentRoute: () => sessionGate, path: '/hall', component: HallPage });
const highlightRoute = createRoute({ getParentRoute: () => sessionGate, path: '/hall/$id', component: HighlightPage });
const ideaRoute = createRoute({ getParentRoute: () => sessionGate, path: '/ideias/$ref', component: IdeaPage });
// Mural (M21): a página de cada ideia publicada e a fila de denúncias de quem modera (RN-150, RN-154).
const muralIdeaRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/mural/$ref',
  component: MuralIdeaPage,
});
// Loja (M22): a vitrine de todos e a gestão de quem tem store.manage (RN-164, RN-166).
const storeRoute = createRoute({ getParentRoute: () => sessionGate, path: '/loja', component: StorePage });
const storeAdminRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/loja/gerenciar',
  component: withPermission(['store.manage'], StoreAdminPage),
});
const muralReportsRoute = createRoute({
  getParentRoute: () => sessionGate,
  path: '/mural/denuncias',
  component: withPermission(['mural.manage'], MuralReportsPage),
});

// Administração: cada tela exige a sua permissão; sem ela, "Sem permissão" (CA-RN-01.6). A API também nega.
const admin = (file: string, name: string) => lazyRouteComponent(() => import(`./admin/${file}.tsx`), name);
const adminRoute = createRoute({ getParentRoute: () => sessionGate, path: '/admin' });
const adminChildren = [
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'usuarios',
    component: withPermission(['user.manage'], admin('users-page', 'UsersPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'campos-do-usuario',
    component: withPermission(
      ['user.manage'],
      lazyRouteComponent(() => import('./user-fields/admin-page.tsx'), 'UserFieldsPage'),
    ),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'usuarios/$id',
    component: withPermission(['user.manage'], admin('user-detail-page', 'UserDetailPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'perfis',
    component: withPermission(['role.manage'], admin('roles-page', 'RolesPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'entidades',
    component: withPermission(['entity.manage'], admin('entities-page', 'EntitiesPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'categorias',
    component: withPermission(['category.manage'], admin('categories-page', 'CategoriesPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'configuracoes',
    component: withPermission(['setting.manage'], admin('settings-page', 'SettingsPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'atribuicao',
    component: withPermission(['setting.manage'], admin('triage-rules-page', 'TriageRulesPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'identidade',
    component: withPermission(['setting.manage'], admin('branding-page', 'BrandingPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'reconhecimento',
    component: withPermission(['setting.manage'], admin('recognition-page', 'RecognitionAdminPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'email',
    component: withPermission(['email.manage'], admin('email-page', 'EmailPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'acesso',
    component: withPermission(['sso.manage'], admin('access-page', 'AccessPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'integracoes',
    component: withPermission(['integration.manage'], admin('integrations-page', 'IntegrationsPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'auditoria',
    component: withPermission(['audit.view'], admin('audit-page', 'AuditPage')),
  }),
  createRoute({
    getParentRoute: () => adminRoute,
    path: 'observabilidade',
    component: withPermission(['ops.view'], admin('ops-page', 'OpsPage')),
  }),
] as const;

// Protótipos do M0V: referência visual até as telas reais do M2 os substituírem.
const proto = (file: string, name: string) => lazyRouteComponent(() => import(`../prototype/pages/${file}.tsx`), name);
const protoRoot = createRoute({
  getParentRoute: () => rootRoute,
  path: '/prototipo',
  component: lazyRouteComponent(() => import('../prototype/root'), 'PrototypeRoot'),
});
const protoLayout = createRoute({
  getParentRoute: () => protoRoot,
  id: 'moldura',
  component: lazyRouteComponent(() => import('../prototype/Layout'), 'Layout'),
});
const protoChildren = [
  createRoute({
    getParentRoute: () => protoLayout,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: '/prototipo/fila', replace: true });
    },
  }),
  createRoute({ getParentRoute: () => protoLayout, path: 'enviar', component: proto('SubmitIdea', 'SubmitIdea') }),
  createRoute({ getParentRoute: () => protoLayout, path: 'minhas-ideias', component: proto('MyIdeas', 'MyIdeas') }),
  createRoute({ getParentRoute: () => protoLayout, path: 'fila', component: proto('AnalystQueue', 'AnalystQueue') }),
  createRoute({
    getParentRoute: () => protoLayout,
    path: 'ideias/$code',
    component: proto('IdeaDetail', 'IdeaDetail'),
  }),
  createRoute({ getParentRoute: () => protoLayout, path: 'painel', component: proto('Dashboard', 'Dashboard') }),
  createRoute({ getParentRoute: () => protoLayout, path: 'hall', component: proto('Hall', 'Hall') }),
  createRoute({ getParentRoute: () => protoLayout, path: 'marca', component: proto('BrandSymbol', 'BrandSymbol') }),
] as const;
const protoLookup = createRoute({
  getParentRoute: () => protoRoot,
  path: 'consulta',
  component: proto('PublicLookup', 'PublicLookup'),
});

const routeTree = rootRoute.addChildren([
  installGate.addChildren([
    installRoute,
    loginRoute,
    setPasswordRoute,
    forgotPasswordRoute,
    publicLookupRoute,
    publicIdeaRoute,
    approvalLinkRoute,
    sessionGate.addChildren([
      homeRoute,
      accountRoute,
      infoRoute,
      notificationsRoute,
      pendingApprovalsRoute,
      submitRoute,
      myIdeasRoute,
      queueRoute,
      reportsRoute,
      gainsRoute,
      campaignsRoute,
      campaignRoute,
      recognitionRoute,
      hallRoute,
      highlightRoute,
      ideaRoute,
      muralIdeaRoute,
      muralReportsRoute,
      storeRoute,
      storeAdminRoute,
      adminRoute.addChildren(adminChildren),
    ]),
  ]),
  protoRoot.addChildren([protoLayout.addChildren(protoChildren), protoLookup]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPendingComponent: PageLoading,
    defaultPreload: 'intent',
    // O cache é do TanStack Query; o roteador não guarda dados por conta própria.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
