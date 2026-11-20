import { Check, Clock, Hammer, Inbox, type LucideIcon, Search, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { CATEGORY_COLORS, type IdeaStatus } from './data';

// Status sempre com cor + ícone + texto (nunca só cor; DESIGN.md).

export type Mark = IdeaStatus | 'late';
type Key = 'submitted' | 'review' | 'progress' | 'done' | 'rejected' | 'late';

const META: Record<Mark, { label: string; key: Key; Icon: LucideIcon }> = {
  submitted: { label: 'Enviada', key: 'submitted', Icon: Inbox },
  in_review: { label: 'Em análise', key: 'review', Icon: Search },
  in_progress: { label: 'Em andamento', key: 'progress', Icon: Hammer },
  implemented: { label: 'Implementada', key: 'done', Icon: Check },
  rejected: { label: 'Não autorizada', key: 'rejected', Icon: X },
  late: { label: 'Atrasada', key: 'late', Icon: Clock },
};

export const statusLabel = (status: Mark) => META[status].label;
export const statusVar = (status: Mark, part: '' | '-fill' | '-on' = '') => `var(--st-${META[status].key}${part})`;

type Size = 'md' | 'lg';

export function StatusBadge({ status, label, size = 'md' }: { status: Mark; label?: string; size?: Size }) {
  const { Icon } = META[status];
  const lg = size === 'lg';
  return (
    <span
      data-status={status}
      style={{ '--ink': statusVar(status) } as CSSProperties}
      className={`inline-flex max-w-full items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--ink)_12%,transparent)] font-medium text-(--ink) ${lg ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs'}`}
    >
      <Icon aria-hidden="true" className={`shrink-0 ${lg ? 'size-4' : 'size-3.5'}`} />
      <span className="truncate">{label ?? META[status].label}</span>
    </span>
  );
}

export function LateBadge({ label = 'Atrasada', size }: { label?: string; size?: Size }) {
  return <StatusBadge status="late" label={label} size={size} />;
}

/** Identificador legível (ex.: ITS-2026-0042), em fonte de código. */
export function IdCode({ code, size = 'md' }: { code: string; size?: Size }) {
  return (
    <span className={`font-mono text-muted-foreground ${size === 'lg' ? 'text-sm font-medium' : 'text-xs'}`}>
      {code}
    </span>
  );
}

/** Categoria: cor configurável pela organização + nome (a cor nunca vem sozinha). */
export function CategoryTag({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-[2px]"
        style={{ background: CATEGORY_COLORS[name] ?? 'var(--muted-foreground)' }}
      />
      {name}
    </span>
  );
}
