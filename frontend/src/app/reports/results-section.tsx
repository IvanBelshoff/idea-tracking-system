import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Metric, type ReportFilterValues } from './engagement-section';

type Results = components['schemas']['ResultsReport'];
type Group = components['schemas']['GainGroup'];

export function useResultsReport(f: ReportFilterValues) {
  return useQuery({
    queryKey: ['reports', 'results', f],
    queryFn: () =>
      unwrap(
        api.GET('/api/reports/results', {
          params: {
            query: {
              from: f.from || undefined,
              to: f.to || undefined,
              entityId: f.entityId || undefined,
              categoryId: f.categoryId || undefined,
              options: f.option ? [f.option] : undefined,
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });
}

/**
 * Resultado financeiro (RN-46, RN-82): só ganhos **validados** são oficiais (CA-RN-63.3). O que
 * ainda está declarado aparece como "aguardando validação", nunca somado ao total.
 */
export function ResultsSection({ data }: { data: Results }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const money = (v: number, currency: string) =>
    new Intl.NumberFormat(lng, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  const times = (v: number | null) =>
    v === null
      ? null
      : t('reports.results.roiValue', { value: new Intl.NumberFormat(lng, { maximumFractionDigits: 1 }).format(v) });
  return (
    <section aria-labelledby="resultado-financeiro" className="mt-8">
      <h2 id="resultado-financeiro" className="font-semibold">
        {t('reports.results.title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('reports.results.intro')}</p>
      {data.currencies.length === 0 ? (
        <p className="mt-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t('reports.results.empty')}</p>
      ) : (
        data.currencies.map((c) => (
          <dl key={c.currency} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric
              label={t('reports.results.validated', { currency: c.currency })}
              value={c.validatedIdeas === 0 ? null : money(c.validatedAnnual, c.currency)}
              hint={[
                t('reports.results.validatedHint', { count: c.validatedIdeas }),
                c.declaredIdeas > 0
                  ? t('reports.results.pending', { count: c.declaredIdeas, value: money(c.declaredAnnual, c.currency) })
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
            />
            <Metric
              label={t('reports.results.average')}
              value={c.avgPerIdea === null ? null : money(c.avgPerIdea, c.currency)}
              hint={t('reports.results.averageHint')}
            />
            <Metric label={t('reports.results.roi')} value={times(c.roi)} hint={t('reports.results.roiHint')} />
          </dl>
        ))
      )}
      {data.currencies.length > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <GainBars id="ganho-categoria" title={t('reports.results.byCategory')} rows={data.byCategory} money={money} />
          <GainBars id="ganho-entidade" title={t('reports.results.byEntity')} rows={data.byEntity} money={money} />
        </div>
      )}
    </section>
  );
}

function GainBars({
  id,
  title,
  rows,
  money,
}: {
  id: string;
  title: string;
  rows: Group[];
  money: (v: number, currency: string) => string;
}) {
  const { t } = useTranslation();
  const max = Math.max(0, ...rows.map((r) => r.validatedAnnual));
  return (
    <section aria-labelledby={id} className="rounded-lg border bg-card p-5">
      <h3 id={id} className="mb-4 font-semibold">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('reports.results.emptyGroup')}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={`${r.id ?? 'none'}-${r.currency}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {r.color && (
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: r.color }}
                    />
                  )}
                  <span className="truncate">{r.id ? r.name : t('reports.noCategory')}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {money(r.validatedAnnual, r.currency)}
                </span>
              </div>
              <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${max === 0 ? 0 : Math.max(2, (100 * r.validatedAnnual) / max)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
