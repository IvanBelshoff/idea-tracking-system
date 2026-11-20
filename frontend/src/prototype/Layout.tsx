import { Link, type LinkProps, Outlet, useLocation } from '@tanstack/react-router';
import {
  Award,
  BarChart3,
  Inbox,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  Menu,
  ScanSearch,
  Shapes,
} from 'lucide-react';
import { ItsSymbol } from '@/components/brand/its-symbol';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CURRENT_USER, IDEAS, isTriageLate } from './data';
import { BRANDS, useTheme } from './theme';

interface NavItem {
  to: NonNullable<LinkProps['to']>;
  label: string;
  Icon: LucideIcon;
  count?: number;
}

const queueLate = IDEAS.filter(isTriageLate).length;

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Colaborador',
    items: [
      { to: '/prototipo/enviar', label: 'Enviar ideia', Icon: Lightbulb },
      { to: '/prototipo/minhas-ideias', label: 'Minhas ideias', Icon: ListChecks },
      { to: '/prototipo/hall', label: 'Hall de destaques', Icon: Award },
    ],
  },
  {
    group: 'Equipe de melhoria',
    items: [
      { to: '/prototipo/fila', label: 'Fila de ideias', Icon: Inbox, count: queueLate },
      { to: '/prototipo/painel', label: 'Indicadores', Icon: BarChart3 },
    ],
  },
  {
    group: 'Sem login',
    items: [{ to: '/prototipo/consulta', label: 'Consulta por código', Icon: ScanSearch }],
  },
  {
    group: 'M0V',
    items: [{ to: '/prototipo/marca', label: 'Símbolo', Icon: Shapes }],
  },
];

export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const { brand } = useTheme();
  const b = BRANDS[brand];
  const dim = size === 'lg' ? 'size-10 text-base' : 'size-8 text-sm';
  // Identidade padrão: o símbolo do ITS. Organização: o logo dela (aqui, as iniciais como substituto).
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-lg bg-primary font-bold text-primary-foreground ${dim}`}
    >
      {brand === 'its' ? <ItsSymbol size={size === 'lg' ? 30 : 24} /> : b.initials}
    </span>
  );
}

function BrandBlock() {
  const { brand } = useTheme();
  const b = BRANDS[brand];
  return (
    <Link to="/prototipo" className="flex min-w-0 items-center gap-3 rounded-md">
      <BrandMark />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-heading text-[0.95rem] font-bold">{b.name}</span>
        <span className="block truncate text-xs text-shell-muted">{b.org}</span>
      </span>
    </Link>
  );
}

function NavItemLink({ item }: { item: NavItem }) {
  const active = 'bg-shell-active text-shell-active-foreground';
  return (
    <Link
      to={item.to}
      activeProps={{ className: active }}
      inactiveProps={{ className: 'text-shell-foreground/90 hover:bg-shell-foreground/8' }}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
    >
      <item.Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.count ? (
        <span
          className="rounded-full bg-(--st-late-fill) px-1.5 text-[0.7rem] font-bold text-(--st-late-on)"
          title={`${item.count} com retorno atrasado`}
        >
          {item.count}
          <span className="sr-only"> com retorno atrasado</span>
        </span>
      ) : null}
    </Link>
  );
}

export function Layout() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const current = NAV.flatMap((g) => g.items).find((i) => pathname.startsWith(i.to));

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[15.5rem_1fr]">
      {/* Trilho lateral (desktop) */}
      <aside className="sticky top-0 hidden h-svh flex-col bg-shell text-shell-foreground lg:flex">
        <div className="px-4 pt-5 pb-6">
          <BrandBlock />
        </div>
        <nav aria-label="Principal" className="flex-1 space-y-6 overflow-y-auto px-3">
          {NAV.map((g) => (
            <div key={g.group}>
              <p className="mb-1.5 px-3 text-[0.7rem] font-semibold tracking-[0.08em] text-shell-muted uppercase">
                {g.group}
              </p>
              <div className="space-y-0.5">
                {g.items.map((item) => (
                  <NavItemLink key={item.to} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-shell-border px-4 py-4">
          <Avatar size="sm">
            <AvatarFallback>AS</AvatarFallback>
          </Avatar>
          <div className="min-w-0 text-sm leading-tight">
            <p className="truncate font-medium">{CURRENT_USER}</p>
            <p className="truncate text-xs text-shell-muted">Analista · Unidade Norte</p>
          </div>
        </div>
      </aside>

      {/* Barra superior (celular e tablet) */}
      <header className="sticky top-0 z-40 bg-shell text-shell-foreground lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          <BrandBlock />
          <span className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-shell-foreground/10"
              aria-label="Abrir menu"
            >
              <span className="max-w-32 truncate">{current?.label ?? 'Menu'}</span>
              <Menu aria-hidden="true" className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {NAV.map((g, gi) => (
                <div key={g.group}>
                  {gi > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>{g.group}</DropdownMenuLabel>
                  {g.items.map((item) => (
                    <DropdownMenuItem key={item.to} asChild className="py-2.5">
                      <Link to={item.to}>
                        <item.Icon aria-hidden="true" />
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="min-w-0 px-4 pt-6 pb-48 sm:px-6 lg:px-10 lg:pt-9">
        <Outlet />
      </main>
    </div>
  );
}
