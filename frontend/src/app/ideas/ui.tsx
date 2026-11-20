import { useTranslation } from 'react-i18next';
import type { components } from '@/api/schema';
import { StatusPill } from '@/components/status-pill';

export type IdeaStatus = components['schemas']['IdeaSummary']['status'];
export const IDEA_STATUSES: IdeaStatus[] = ['submitted', 'in_review', 'in_progress', 'implemented', 'rejected'];

export function IdeaStatusBadge({ status, size = 'md' }: { status: IdeaStatus; size?: 'md' | 'lg' }) {
  const { t } = useTranslation();
  return <StatusPill status={status} label={t(`ideas.status.${status}`)} size={size} />;
}

/** Identificador legível (ITS-2026-0042), em fonte de código. */
export function IdCode({ code, size = 'md' }: { code: string; size?: 'md' | 'lg' }) {
  return (
    <span className={`font-mono text-muted-foreground ${size === 'lg' ? 'text-sm font-medium' : 'text-xs'}`}>
      {code}
    </span>
  );
}

/** Categoria: cor da organização + nome (a cor nunca vem sozinha). */
export function CategoryTag({ category }: { category: { name: string; color: string } | null }) {
  const { t } = useTranslation();
  if (!category) return <span className="text-sm text-muted-foreground">{t('ideas.fields.noCategory')}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px]" style={{ background: category.color }} />
      {category.name}
    </span>
  );
}
