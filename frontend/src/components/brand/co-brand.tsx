import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ItsSymbol } from './its-symbol';

export type LogoVariant = 'light' | 'dark';
/** Versões dos logos da organização (nulo = sem logo naquele tema). */
export type LogoVersions = { light: string | null; dark: string | null };
/** Cores da marca para as amostras (a interface usa os tokens). */
export type BrandPair = { brand: string; brandFg: string };

/** URL pública do logo; a versão no `?v=` renova o cache quando o logo muda. */
export function logoUrl(variant: LogoVariant, version: string): string {
  return `/api/branding/logo/${variant}?v=${encodeURIComponent(version)}`;
}

/**
 * Medidas da assinatura dupla. O símbolo solto tem altura ótica um pouco menor que a caixa do logo
 * (o logo é aparado rente; o círculo do símbolo pesa mais que um retângulo da mesma altura).
 * O respiro dos dois lados do fio é o mesmo, para nenhum dos dois parecer "dono" do outro.
 */
const SIZES = {
  sm: {
    tile: 'size-8 rounded-lg',
    tileSymbol: 24,
    mark: 30,
    logo: 'max-h-9 max-w-40',
    plate: 'h-9 px-2',
    plated: 'max-h-7 max-w-36',
    rule: 'h-5',
    gap: 'gap-3',
    name: 'text-[0.95rem]',
  },
  lg: {
    tile: 'size-10 rounded-lg',
    tileSymbol: 30,
    mark: 40,
    logo: 'max-h-12 max-w-60',
    plate: 'h-12 px-2.5',
    plated: 'max-h-9 max-w-56',
    rule: 'h-7',
    gap: 'gap-4',
    name: 'text-lg',
  },
} as const;

type Size = keyof typeof SIZES;

/**
 * Logo da organização, no tamanho natural limitado pela caixa (a caixa acompanha o desenho, sem
 * sobra transparente). Sem logo próprio para o escuro, o do claro vai sobre uma placa clara (um
 * logo escuro sumiria no fundo escuro). `theme` força um tema (amostras); sem ele, decide o CSS.
 */
function OrgLogo({
  logo,
  name,
  size,
  theme,
  onError,
}: {
  logo: LogoVersions & { light: string };
  name: string;
  size: Size;
  theme?: LogoVariant;
  onError: () => void;
}) {
  const s = SIZES[size];
  const img = (variant: LogoVariant, version: string, className: string) => (
    <img
      src={logoUrl(variant, version)}
      alt={name}
      draggable={false}
      onError={onError}
      className={cn('block h-auto w-auto min-w-0 shrink', className)}
    />
  );
  const plate = cn('inline-flex min-w-0 shrink items-center rounded-md bg-white', s.plate);

  if (logo.dark) {
    if (theme) return img(theme, theme === 'dark' ? logo.dark : logo.light, s.logo);
    return (
      <>
        {img('light', logo.light, cn(s.logo, 'dark:hidden'))}
        {img('dark', logo.dark, cn(s.logo, 'hidden dark:block'))}
      </>
    );
  }
  if (theme === 'light') return img('light', logo.light, s.logo);
  if (theme === 'dark') return <span className={plate}>{img('light', logo.light, s.plated)}</span>;
  return (
    <>
      {img('light', logo.light, cn(s.logo, 'dark:hidden'))}
      <span className={cn(plate, 'hidden dark:inline-flex')}>{img('light', logo.light, s.plated)}</span>
    </>
  );
}

/**
 * Marca do produto num lugar só. Sem logo da organização: o quadro do ITS + nome (assinatura
 * padrão). Com logo: assinatura dupla, o símbolo do ITS solto na cor da marca, um fio curto e o
 * logo, na mesma altura ótica. O símbolo nunca sai. `compact` mostra só o quadro do símbolo.
 */
export function CoBrand({
  name,
  subtitle,
  logo,
  size = 'sm',
  compact,
  theme,
  pair,
  mutedClassName = 'text-muted-foreground',
  className,
}: {
  name: string;
  subtitle?: string;
  logo?: LogoVersions | null;
  size?: Size;
  compact?: boolean;
  theme?: LogoVariant;
  /** Cor da marca nas amostras da tela de identidade visual. */
  pair?: BrandPair;
  mutedClassName?: string;
  className?: string;
}) {
  const s = SIZES[size];
  const [failed, setFailed] = useState<string | null>(null);
  const light = logo?.light ?? null;
  const usable = !compact && !!logo && !!light && failed !== light;
  const tile = (
    <span
      aria-hidden="true"
      style={pair ? { background: pair.brand, color: pair.brandFg } : undefined}
      className={cn('grid shrink-0 place-items-center bg-primary text-primary-foreground', s.tile)}
    >
      <ItsSymbol size={s.tileSymbol} />
    </span>
  );
  if (compact) return tile;

  if (usable && logo && light) {
    return (
      <span className={cn('flex max-w-full min-w-0 items-center', s.gap, className)} data-cobrand="logo">
        <span
          aria-hidden="true"
          style={pair ? { color: pair.brand } : undefined}
          data-surface={theme}
          className="shrink-0 text-primary"
        >
          <ItsSymbol size={s.mark} free />
        </span>
        <span aria-hidden="true" className={cn('w-px shrink-0 rounded-full bg-current opacity-25', s.rule)} />
        <OrgLogo logo={{ ...logo, light }} name={name} size={size} theme={theme} onError={() => setFailed(light)} />
      </span>
    );
  }

  return (
    <span className={cn('flex min-w-0 items-center gap-3', className)} data-cobrand="name">
      {tile}
      <span className="min-w-0 leading-tight">
        <span className={cn('block truncate font-heading font-bold', s.name)}>{name}</span>
        {subtitle && <span className={cn('block truncate text-xs', mutedClassName)}>{subtitle}</span>}
      </span>
    </span>
  );
}
