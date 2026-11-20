import { Check, Copy } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HelpLink } from '../help';
import type { HelpTopic } from '../help-topics';
import { usePageTitle } from '../page-title';
import { usePublicSettings } from '../session';

export type EntityView = components['schemas']['EntityView'];

/** Moldura das telas de administração: título, introdução curta e ações à direita. */
export function AdminPage({
  title,
  intro,
  actions,
  help,
  narrow,
  children,
}: {
  title: string;
  intro?: string;
  actions?: ReactNode;
  /** Página da ajuda sobre esta tela: um "?" discreto ao lado do título. */
  help?: HelpTopic;
  /** Página de um formulário só: título e conteúdo numa coluna estreita, centralizada. */
  narrow?: boolean;
  children: ReactNode;
}) {
  const { data: settings } = usePublicSettings();
  usePageTitle(title, settings?.organizationName);
  return (
    <div className={narrow ? 'mx-auto max-w-3xl' : 'mx-auto max-w-[72rem]'}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-start gap-1.5">
            <h1 className="text-[1.75rem] leading-tight font-bold">{title}</h1>
            {help && (
              <span className="pt-1">
                <HelpLink topic={help} />
              </span>
            )}
          </div>
          {intro && <p className="mt-1 max-w-[70ch] text-muted-foreground">{intro}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-5 sm:p-6">
      <h2 className="font-semibold">{title}</h2>
      {intro && <p className="mt-1 text-sm text-muted-foreground">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav
      aria-label={t('admin.common.pageOf', { page, pages })}
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span className="text-muted-foreground">
        {t('admin.common.total', { count: total })} · {t('admin.common.pageOf', { page, pages })}
      </span>
      <span className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('admin.common.previous')}
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('admin.common.next')}
        </Button>
      </span>
    </nav>
  );
}

/** Campo somente leitura com botão de copiar (links de senha). */
export function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono text-xs"
      />
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span aria-live="polite">{copied ? t('admin.common.copied') : t('admin.common.copy')}</span>
      </Button>
    </div>
  );
}

/** Mensagem curta de sucesso, anunciada pelo leitor de tela. */
export function SuccessNote({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="text-sm text-(--st-done)">
      {message}
    </p>
  );
}

/** Link de "definir senha" a partir do token (o token vai depois do #; ver set-password-page). */
export function passwordLinkUrl(token: string): string {
  return `${window.location.origin}/definir-senha#${token}`;
}

/** Ordena a árvore de entidades em profundidade (pai, filhos em ordem alfabética, netos...). */
export function orderTree(list: EntityView[]): EntityView[] {
  const byParent = new Map<string | null, EntityView[]>();
  for (const e of list) {
    const siblings = byParent.get(e.parentId) ?? [];
    siblings.push(e);
    byParent.set(e.parentId, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.name.localeCompare(b.name));
  const out: EntityView[] = [];
  const visit = (parentId: string | null) => {
    for (const e of byParent.get(parentId) ?? []) {
      out.push(e);
      visit(e.id);
    }
  };
  visit(null);
  return out;
}

/** Rótulo com recuo pela profundidade, para listas de seleção de entidade. */
export function entityOptionLabel(e: EntityView): string {
  return `${'  '.repeat(e.depth)}${e.depth > 0 ? '└ ' : ''}${e.name}`;
}
