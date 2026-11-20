import { Check, Clock, Hammer, Inbox, type LucideIcon, Search, X } from 'lucide-react';
import type { CSSProperties } from 'react';

/** Situações da ideia, mais o sinal "atrasada" (prazo vencido). */
export type StatusMark = 'submitted' | 'in_review' | 'in_progress' | 'implemented' | 'rejected' | 'late';

// Status sempre com cor + ícone + texto (nunca só cor; DESIGN.md).
const META: Record<StatusMark, { token: string; Icon: LucideIcon }> = {
  submitted: { token: 'submitted', Icon: Inbox },
  in_review: { token: 'review', Icon: Search },
  in_progress: { token: 'progress', Icon: Hammer },
  implemented: { token: 'done', Icon: Check },
  rejected: { token: 'rejected', Icon: X },
  late: { token: 'late', Icon: Clock },
};

/**
 * Pílula de status, só apresentação: o texto vem de quem usa (o ITS traduz com i18next; a ajuda,
 * com os próprios textos). Compartilhada com a ajuda (its/ajuda), para os simuladores serem iguais.
 */
export function StatusPill({ status, label, size = 'md' }: { status: StatusMark; label: string; size?: 'md' | 'lg' }) {
  const { token, Icon } = META[status];
  const lg = size === 'lg';
  return (
    <span
      data-status={status}
      style={{ '--ink': `var(--st-${token})` } as CSSProperties}
      className={`inline-flex max-w-full items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--ink)_12%,transparent)] font-medium text-(--ink) ${lg ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs'}`}
    >
      <Icon aria-hidden="true" className={`shrink-0 ${lg ? 'size-4' : 'size-3.5'}`} />
      <span className="truncate">{label}</span>
    </span>
  );
}
