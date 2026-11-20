import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { formatMonth } from '@/lib/dates';
import { cn } from '@/lib/utils';

type Engagement = components['schemas']['EngagementReport'];
type Month = Engagement['monthly'][number];

export interface ReportFilterValues {
  from: string;
  to: string;
  entityId: string;
  categoryId: string;
  /** Opção de um campo fechado do autor (M25, RN-201). */
  option: string;
}

export function useEngagement(f: ReportFilterValues) {
  return useQuery({
    queryKey: ['reports', 'engagement', f],
    queryFn: () =>
      unwrap(
        api.GET('/api/reports/engagement', {
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

/** Um indicador: valor grande, rótulo e uma linha de apoio. Sem dado para calcular → "Sem dados". */
export function Metric({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        {value === null ? (
          <span className="text-lg font-medium text-muted-foreground">{t('reports.noData')}</span>
        ) : (
          <span className="text-2xl font-bold tabular-nums">{value}</span>
        )}
        {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}

/** Engajamento (RN-81): participação, ideias por colaborador ativo, implementação e evolução mensal. */
export function EngagementSection({ data }: { data: Engagement }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const percent = (v: number | null) =>
    v === null ? null : new Intl.NumberFormat(lng, { style: 'percent', maximumFractionDigits: 0 }).format(v);
  const decimal = (v: number | null) =>
    v === null ? null : new Intl.NumberFormat(lng, { maximumFractionDigits: 1 }).format(v);
  return (
    <section aria-labelledby="engajamento" className="mt-8">
      <h2 id="engajamento" className="font-semibold">
        {t('reports.engagement.title')}
      </h2>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          label={t('reports.engagement.participation')}
          value={percent(data.participationRate)}
          hint={t('reports.engagement.participationHint', {
            participants: data.participants,
            total: data.activeCollaborators,
          })}
        />
        <Metric
          label={t('reports.engagement.perCollaborator')}
          value={decimal(data.ideasPerCollaborator)}
          hint={t('reports.engagement.perCollaboratorHint', { count: data.activeCollaborators })}
        />
        <Metric
          label={t('reports.engagement.implementation')}
          value={percent(data.implementationRate)}
          hint={t('reports.engagement.implementationHint', { implemented: data.implemented, total: data.ideas })}
        />
      </dl>
      <MonthlyChart months={data.monthly} />
    </section>
  );
}

/**
 * Colunas de série única (ideias enviadas por mês), um eixo só. Implementadas e participantes são
 * outras medidas: aparecem no detalhe ao passar o mouse e na tabela, nunca num segundo eixo.
 */
function MonthlyChart({ months }: { months: Month[] }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...months.map((m) => m.submitted));
  const total = months.reduce((sum, m) => sum + m.submitted, 0);
  const every = Math.ceil(months.length / 12); // no máximo ~12 rótulos no eixo
  const label = (m: string, i: number) => formatMonth(m, lng, i === 0 || m.endsWith('-01') ? 'shortYear' : 'short');
  const active = hover === null ? null : months[hover];
  const edge =
    hover === null ? 'center' : hover < months.length * 0.2 ? 'start' : hover > months.length * 0.8 ? 'end' : 'center';

  return (
    <div className="mt-4 rounded-lg border bg-card p-5">
      <h3 className="font-semibold">{t('reports.engagement.monthly')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('reports.engagement.monthlyIntro')}</p>
      {months.length === 0 || total === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('reports.empty')}</p>
      ) : (
        <>
          <div
            role="img"
            aria-label={t('reports.engagement.chartLabel', {
              from: formatMonth(months[0]?.month ?? '', lng, 'long'),
              to: formatMonth(months.at(-1)?.month ?? '', lng, 'long'),
              total,
              max,
            })}
            className="relative mt-4"
          >
            <div className="flex items-baseline justify-between text-xs text-muted-foreground tabular-nums">
              <span>{max}</span>
            </div>
            <div
              className="relative flex h-40 items-end gap-0.5 border-t border-dashed border-border/70"
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const i = Math.floor(((e.clientX - r.left) / r.width) * months.length);
                setHover(Math.min(months.length - 1, Math.max(0, i)));
              }}
              onPointerLeave={() => setHover(null)}
            >
              {months.map((m, i) => (
                <div key={m.month} className="flex h-full min-w-0 flex-1 items-end justify-center">
                  <div
                    className={cn(
                      'w-full max-w-10 rounded-t-lg bg-primary transition-opacity',
                      hover !== null && hover !== i && 'opacity-45',
                    )}
                    style={{
                      height: m.submitted === 0 ? 0 : `${Math.max(2, (100 * m.submitted) / Math.max(1, max))}%`,
                    }}
                  />
                </div>
              ))}
              {active && hover !== null && (
                <div
                  className={cn(
                    'pointer-events-none absolute top-1 z-10 min-w-40 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md',
                    edge === 'center' && '-translate-x-1/2',
                    edge === 'end' && '-translate-x-full',
                  )}
                  style={{
                    left: `${((hover + (edge === 'center' ? 0.5 : edge === 'end' ? 1 : 0)) / months.length) * 100}%`,
                  }}
                >
                  <p className="font-semibold">{formatMonth(active.month, lng, 'long')}</p>
                  <p className="mt-1 flex justify-between gap-4">
                    <span>{t('reports.engagement.submitted')}</span>
                    <span className="tabular-nums">{active.submitted}</span>
                  </p>
                  <p className="flex justify-between gap-4 text-muted-foreground">
                    <span>{t('reports.engagement.implemented')}</span>
                    <span className="tabular-nums">{active.implemented}</span>
                  </p>
                  <p className="flex justify-between gap-4 text-muted-foreground">
                    <span>{t('reports.engagement.participants')}</span>
                    <span className="tabular-nums">{active.participants}</span>
                  </p>
                </div>
              )}
            </div>
            <div className="h-px bg-border" />
            <div className="mt-1 flex gap-0.5 text-[0.7rem] text-muted-foreground">
              {months.map((m, i) => (
                <span key={m.month} className="min-w-0 flex-1 truncate text-center">
                  {i % every === 0 ? label(m.month, i) : ''}
                </span>
              ))}
            </div>
          </div>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-medium underline-offset-4 hover:underline">
              {t('reports.engagement.asTable')}
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left">
                <caption className="sr-only">{t('reports.engagement.monthly')}</caption>
                <thead className="text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-4 font-medium">
                      {t('reports.engagement.month')}
                    </th>
                    <th scope="col" className="py-1 pr-4 text-right font-medium">
                      {t('reports.engagement.submitted')}
                    </th>
                    <th scope="col" className="py-1 pr-4 text-right font-medium">
                      {t('reports.engagement.implemented')}
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      {t('reports.engagement.participants')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month} className="border-t">
                      <th scope="row" className="py-1 pr-4 font-normal">
                        {formatMonth(m.month, lng, 'long')}
                      </th>
                      <td className="py-1 pr-4 text-right tabular-nums">{m.submitted}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">{m.implemented}</td>
                      <td className="py-1 text-right tabular-nums">{m.participants}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
