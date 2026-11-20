import { useMutation } from '@tanstack/react-query';
import { Link, type LinkProps, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import {
  BadgeCheck,
  Bell,
  ChartColumn,
  Flag,
  House,
  Inbox,
  Info,
  Lightbulb,
  ListChecks,
  LogOut,
  type LucideIcon,
  Medal,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShoppingBag,
  Stamp,
  Store,
  Trophy,
  UserRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { CoBrand } from '@/components/brand/co-brand';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMyPendingApprovals } from '../approvals/queries';
import { useUnreadCount } from '../notifications/queries';
import { MyAvatar } from '../pages/photo-section';
import { type Permission, useCan, useMe, usePublicSettings, useSetSession, useUpdatePreferences } from '../session';

export interface NavItem {
  to: NonNullable<LinkProps['to']>;
  label: string;
  Icon: LucideIcon;
  /** Aparece só para quem tem uma destas permissões (a API confere de novo; RN-01). */
  anyOf?: Permission[];
  exact?: boolean;
  /** Contador ao lado do item (ex.: notificações não lidas). */
  badge?: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Itens da administração, preenchidos pelas telas do admin (registro único em admin/nav.ts). */
export type AdminNavFactory = (t: (key: string) => string) => NavItem[];
let adminNav: AdminNavFactory = () => [];
export function registerAdminNav(factory: AdminNavFactory) {
  adminNav = factory;
}

function useNavGroups(): NavGroup[] {
  const { t } = useTranslation();
  const can = useCan();
  const { data: settings } = usePublicSettings();
  const pendingApprovals = useMyPendingApprovals().data?.length ?? 0;
  const groups: NavGroup[] = [
    {
      label: t('shell.navGroups.start'),
      items: [
        { to: '/', label: t('shell.nav.home'), Icon: House, exact: true },
        ...(pendingApprovals > 0
          ? [{ to: '/aprovacoes' as const, label: t('shell.nav.approvals'), Icon: Stamp, badge: pendingApprovals }]
          : []),
        { to: '/hall', label: t('shell.nav.hall'), Icon: Trophy },
      ],
    },
    {
      label: t('shell.navGroups.ideas'),
      items: [
        {
          to: '/ideias/nova',
          label: t('shell.nav.submit'),
          Icon: Lightbulb,
          anyOf: ['idea.submit', 'idea.register_for_other'],
        },
        { to: '/minhas-ideias', label: t('shell.nav.mine'), Icon: ListChecks, anyOf: ['idea.submit'] },
        // Reconhecimento só existe com o módulo ligado (CA-RN-66.2).
        ...(settings?.recognition.enabled
          ? [{ to: '/reconhecimento' as const, label: t('shell.nav.recognition'), Icon: Medal }]
          : []),
        // Loja (M22, RN-173): só com a loja ligada.
        ...(settings?.store.enabled
          ? [{ to: '/loja' as const, label: t('shell.nav.store'), Icon: ShoppingBag, exact: true }]
          : []),
      ],
    },
    {
      label: t('shell.navGroups.team'),
      items: [
        { to: '/ideias', label: t('shell.nav.queue'), Icon: Inbox, anyOf: ['idea.view_scope'], exact: true },
        { to: '/indicadores', label: t('shell.nav.reports'), Icon: ChartColumn, anyOf: ['report.view'] },
        { to: '/ganhos', label: t('shell.nav.gains'), Icon: BadgeCheck, anyOf: ['gain.validate'] },
        {
          to: '/campanhas',
          label: t('shell.nav.campaigns'),
          Icon: Megaphone,
          anyOf: ['campaign.manage', 'report.view'],
        },
        ...(settings?.store.enabled
          ? [
              {
                to: '/loja/gerenciar' as const,
                label: t('shell.nav.storeManage'),
                Icon: Store,
                anyOf: ['store.manage' as const],
              },
            ]
          : []),
        // Fila de denúncias do mural (RN-154): só com o módulo ligado e para quem modera.
        ...(settings?.mural.enabled
          ? [
              {
                to: '/mural/denuncias' as const,
                label: t('shell.nav.muralReports'),
                Icon: Flag,
                anyOf: ['mural.manage' as const],
              },
            ]
          : []),
      ],
    },
    { label: t('shell.navGroups.admin'), items: adminNav((key) => t(key as never) as string) },
  ];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.anyOf || can(...i.anyOf)) }))
    .filter((g) => g.items.length > 0);
}

function Brand({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { data: settings } = usePublicSettings();
  const name = settings?.organizationName || t('common.appName');
  return (
    <Link to="/" className="flex min-w-0 items-center rounded-md" aria-label={compact ? name : undefined}>
      <CoBrand
        name={name}
        subtitle={t('common.appFullName')}
        logo={settings?.logo}
        compact={compact}
        mutedClassName="text-shell-muted"
      />
    </Link>
  );
}

const itemBase = 'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors';
const itemActive = 'bg-shell-active text-shell-active-foreground';
const itemIdle = 'text-shell-foreground/90 hover:bg-shell-foreground/8';

/** Contador de não lidas: número no menu aberto, ponto no recolhido; texto para leitor de tela. */
function CountBadge({ count, compact }: { count: number; compact?: boolean }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  const text = count > 99 ? '99+' : String(count);
  return (
    <>
      <span className="sr-only">{t('shell.unread', { count })}</span>
      {compact ? (
        <span
          aria-hidden="true"
          className="absolute top-1.5 right-2.5 size-2 rounded-full bg-primary ring-2 ring-shell"
        />
      ) : (
        <span
          aria-hidden="true"
          className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[0.7rem] leading-5 font-semibold text-primary-foreground"
        >
          {text}
        </span>
      )}
    </>
  );
}

function NavItemLink({ item, compact, onNavigate }: { item: NavItem; compact?: boolean; onNavigate?: () => void }) {
  const link = (
    <Link
      to={item.to}
      onClick={onNavigate}
      activeOptions={{ exact: item.exact }}
      activeProps={{ className: `${itemBase} ${itemActive}`, 'aria-current': 'page' }}
      inactiveProps={{ className: `${itemBase} ${itemIdle}` }}
      className={compact ? 'relative justify-center px-0' : undefined}
    >
      <item.Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className={compact ? 'sr-only' : 'flex-1 truncate'}>{item.label}</span>
      {item.badge !== undefined && <CountBadge count={item.badge} compact={compact} />}
    </Link>
  );
  if (!compact) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function NavGroups({
  groups,
  compact,
  onNavigate,
}: {
  groups: NavGroup[];
  compact?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      {groups.map((g, gi) => (
        <div key={g.label}>
          {compact ? (
            gi > 0 && <hr className="mx-2 mb-3 border-shell-border" />
          ) : (
            <p className="mb-1.5 px-3 text-[0.7rem] font-semibold tracking-[0.08em] text-shell-muted uppercase">
              {g.label}
            </p>
          )}
          <div className="space-y-0.5">
            {g.items.map((item) => (
              <NavItemLink key={item.to} item={item} compact={compact} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export function useSignOut() {
  const navigate = useNavigate();
  const setSession = useSetSession();
  return useMutation({
    meta: { silent: true },
    mutationFn: () => api.POST('/api/auth/logout'),
    onSettled: () => {
      setSession(null);
      void navigate({ to: '/entrar', replace: true });
    },
  });
}

function UserMenu({ variant }: { variant: 'rail' | 'compact' | 'bar' }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!me) return null;
  const full = variant === 'rail';
  // "Minha conta" e "Informações" moram neste menu: o gatilho fica marcado enquanto se está nelas.
  const here = pathname.startsWith('/minha-conta') || pathname.startsWith('/informacoes');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-current={here ? 'page' : undefined}
        className={
          full
            ? `flex w-full min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors ${
                here ? itemActive : 'hover:bg-shell-foreground/8'
              }`
            : `mx-auto grid size-10 place-items-center rounded-full ${
                here ? 'bg-shell-active ring-2 ring-shell-active-foreground/40' : 'hover:bg-shell-foreground/10'
              }`
        }
      >
        <MyAvatar me={me} />
        {/* Recolhido: o nome vem de um texto só para o leitor de tela, não de aria-label. As iniciais à
            vista não fazem parte do nome, e o aria-label quebrava a WCAG 2.5.3 (o texto visível no nome). */}
        {!full && <span className="sr-only">{t('shell.userMenu')}</span>}
        {full && (
          <span className="min-w-0 text-sm leading-tight">
            <span className="block truncate font-medium">{me.name}</span>
            <span className={`block truncate text-xs ${here ? 'opacity-80' : 'text-shell-muted'}`}>{me.email}</span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === 'bar' ? 'end' : 'start'}
        side={variant === 'bar' ? 'bottom' : 'top'}
        className="w-56"
      >
        <DropdownMenuLabel className="truncate">{me.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate({ to: '/minha-conta' })}>
          <UserRound aria-hidden="true" />
          {t('shell.myAccount')}
        </DropdownMenuItem>
        {/* A ajuda fica dentro de "Informações" (links para a documentação), sem item próprio no menu. */}
        <DropdownMenuItem onSelect={() => void navigate({ to: '/informacoes' })}>
          <Info aria-hidden="true" />
          {t('shell.info')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut.mutate()}>
          <LogOut aria-hidden="true" />
          {t('shell.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Sino de notificações ao lado da conta (RN-139): link com o contador de não lidas, sem menu suspenso.
 * Na barra expandida fica à direita do bloco da conta; na recolhida, junto à conta; no celular, na barra.
 */
function NotificationBell({ variant }: { variant: 'rail' | 'compact' | 'bar' }) {
  const { t } = useTranslation();
  const { data: unread = 0 } = useUnreadCount();
  const label = t('shell.nav.notifications');
  const link = (
    <Link
      to="/notificacoes"
      activeProps={{ 'aria-current': 'page', className: 'bg-shell-active text-shell-active-foreground' }}
      inactiveProps={{ className: 'text-shell-foreground/90 hover:bg-shell-foreground/10' }}
      className="relative grid size-10 shrink-0 place-items-center rounded-md transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Bell aria-hidden="true" className="size-5" />
      <span className="sr-only">{unread > 0 ? `${label}, ${t('shell.unread', { count: unread })}` : label}</span>
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[0.65rem] leading-4 font-semibold text-primary-foreground ring-2 ring-shell"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
  if (variant === 'bar') return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side={variant === 'compact' ? 'right' : 'top'}>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Moldura do sistema logado (DESIGN.md).
 * - Computador: trilho lateral que recolhe para só ícones; a escolha fica salva na conta.
 * - Celular: barra superior com botão que abre o menu como gaveta (fecha ao escolher uma página).
 */
export function AppShell() {
  const { t } = useTranslation();
  const groups = useNavGroups();
  const { data: me } = useMe();
  const updatePreferences = useUpdatePreferences();
  const collapsed = me?.navCollapsed ?? false;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const router = useRouter();

  // Mudou de página (inclusive pelo voltar do navegador): a gaveta fecha.
  useEffect(() => router.subscribe('onResolved', () => setDrawerOpen(false)), [router]);

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? t('shell.expandNav') : t('shell.collapseNav');

  return (
    <div
      className={`min-h-svh transition-[grid-template-columns] duration-200 lg:grid ${
        collapsed ? 'lg:grid-cols-[4.25rem_1fr]' : 'lg:grid-cols-[15.5rem_1fr]'
      }`}
    >
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('shell.skipToContent')}
      </a>

      {/* Computador: trilho lateral recolhível */}
      <aside
        id="menu-lateral"
        className="sticky top-0 hidden h-svh flex-col overflow-hidden bg-shell text-shell-foreground lg:flex"
      >
        <div className={`flex items-center gap-2 pt-5 pb-6 ${collapsed ? 'flex-col px-2' : 'px-4'}`}>
          <div className={collapsed ? '' : 'min-w-0 flex-1'}>
            <Brand compact={collapsed} />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => updatePreferences({ navCollapsed: !collapsed })}
                aria-label={toggleLabel}
                aria-expanded={!collapsed}
                aria-controls="menu-lateral"
                className="grid size-8 shrink-0 place-items-center rounded-md text-shell-muted hover:bg-shell-foreground/10 hover:text-shell-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <ToggleIcon aria-hidden="true" className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{toggleLabel}</TooltipContent>
          </Tooltip>
        </div>
        <nav
          aria-label={t('shell.mainNav')}
          className={`flex-1 space-y-6 overflow-y-auto pb-6 ${collapsed ? 'px-2' : 'px-3'}`}
        >
          <NavGroups groups={groups} compact={collapsed} />
        </nav>
        <div className={`border-t border-shell-border pt-4 pb-3 ${collapsed ? 'px-1' : 'px-2'}`}>
          <div className={collapsed ? 'flex flex-col items-center gap-1' : 'flex items-center gap-1'}>
            <UserMenu variant={collapsed ? 'compact' : 'rail'} />
            <NotificationBell variant={collapsed ? 'compact' : 'rail'} />
          </div>
        </div>
      </aside>

      {/* Celular e tablet: barra superior + gaveta */}
      <header className="sticky top-0 z-40 bg-shell text-shell-foreground lg:hidden">
        <div className="flex h-14 items-center gap-2 px-2 sm:px-4">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={t('shell.openMenu')}
            aria-expanded={drawerOpen}
            aria-controls="menu-gaveta"
            className="grid size-10 shrink-0 place-items-center rounded-md hover:bg-shell-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <Brand />
          </div>
          <NotificationBell variant="bar" />
          <UserMenu variant="bar" />
        </div>
      </header>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent id="menu-gaveta" closeLabel={t('shell.closeMenu')} className="bg-shell text-shell-foreground">
          <SheetTitle className="sr-only">{t('shell.mainNav')}</SheetTitle>
          <div className="px-4 pt-4 pb-5 pr-14">
            <Brand />
          </div>
          <nav aria-label={t('shell.mainNav')} className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
            <NavGroups groups={groups} onNavigate={() => setDrawerOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>

      <main id="conteudo" tabIndex={-1} className="min-w-0 px-4 pt-6 pb-24 outline-none sm:px-6 lg:px-10 lg:pt-9">
        <Outlet />
      </main>
    </div>
  );
}
