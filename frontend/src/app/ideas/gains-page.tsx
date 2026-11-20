import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { FormError } from '../auth/auth-layout';
import { HelpLink } from '../help';
import { usePageTitle } from '../page-title';
import { usePublicSettings } from '../session';
import { useDates } from '../use-dates';

/** Fila de quem valida ganhos (RN-63): realizados declarados, das ideias implementadas no escopo. */
export function PendingGainsPage() {
  const { t, i18n } = useTranslation();
  const dates = useDates();
  const { data: settings } = usePublicSettings();
  usePageTitle(t('ideas.gains.pageTitle'), settings?.organizationName);
  const pending = useQuery({
    queryKey: ['gains', 'pending'],
    queryFn: () => unwrap(api.GET('/api/gains/pending')),
  });
  const money = (v: number, currency: string) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
  return (
    <div className="mx-auto max-w-[72rem]">
      <div className="flex items-start gap-1.5">
        <h1 className="text-[1.75rem] leading-tight font-bold">{t('ideas.gains.title')}</h1>
        <span className="pt-1">
          <HelpLink topic="gains" />
        </span>
      </div>
      <p className="mt-1 max-w-[70ch] text-muted-foreground">{t('ideas.gains.intro')}</p>
      <FormError message={pending.isError ? errorText(t, pending.error) : null} />
      {pending.data && pending.data.length === 0 && (
        <p className="mt-6 rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t('ideas.gains.empty')}</p>
      )}
      {pending.data && pending.data.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('ideas.gains.idea')}
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                  {t('ideas.fields.entity')}
                </th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">
                  {t('ideas.gains.implementedAt')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('ideas.results.realized')}
                </th>
              </tr>
            </thead>
            <tbody>
              {pending.data.map((p) => (
                <tr key={p.code} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      to="/ideias/$ref"
                      params={{ ref: p.code }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {p.title}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">{p.code}</span>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">{p.entity.name}</td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    {p.implementedAt ? dates.date(p.implementedAt) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {p.gain.realized === null ? '—' : money(p.gain.realized, p.gain.currency)}
                    <span className="block text-xs text-muted-foreground">
                      {t(`ideas.results.periodicity.${p.gain.periodicity}` as never)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
