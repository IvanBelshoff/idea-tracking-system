import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatSeconds } from '@/lib/dates';
import { fieldLabel } from '@/lib/user-fields';
import { useEntities } from '../admin/queries';
import { entityOptionLabel, orderTree } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { HelpLink } from '../help';
import { useActiveCategories } from '../ideas/queries';
import { IDEA_STATUSES, IdeaStatusBadge } from '../ideas/ui';
import { usePageTitle } from '../page-title';
import { usePublicSettings } from '../session';
import { EngagementSection, Metric, useEngagement } from './engagement-section';
import { ResultsSection, useResultsReport } from './results-section';

type Summary = components['schemas']['ReportSummary'];

interface Filters {
  from: string;
  to: string;
  entityId: string;
  categoryId: string;
  option: string;
}
const EMPTY: Filters = { from: '', to: '', entityId: '', categoryId: '', option: '' };

function useSummary(f: Filters) {
  return useQuery({
    queryKey: ['reports', 'summary', f],
    queryFn: () =>
      unwrap(
        api.GET('/api/reports/summary', {
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

/** Linhas com barra proporcional (por categoria, por entidade). */
function Bars({
  rows,
  total,
}: {
  rows: { key: string; name: string; color?: string | null; count: number }[];
  total: number;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t('reports.empty')}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {r.color && (
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: r.color }}
                />
              )}
              <span className="truncate">{r.name}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{r.count}</span>
          </div>
          <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${total === 0 ? 0 : Math.max(2, (100 * r.count) / total)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Dashboard({ data }: { data: Summary }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const percent = (v: number | null) =>
    v === null ? null : new Intl.NumberFormat(lng, { style: 'percent', maximumFractionDigits: 0 }).format(v);
  const decimal = (v: number | null) =>
    v === null ? null : new Intl.NumberFormat(lng, { maximumFractionDigits: 1 }).format(v);
  const seconds = (v: number | null) => (v === null ? null : formatSeconds(v, lng));
  const p = data.process;
  return (
    <>
      <section aria-labelledby="situacao" className="mt-6">
        <h2 id="situacao" className="sr-only">
          {t('reports.byStatus')}
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
          <li className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t('reports.total')}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{data.total}</p>
          </li>
          {IDEA_STATUSES.map((status) => (
            <li key={status} className="rounded-lg border bg-card p-4">
              <IdeaStatusBadge status={status} />
              <p className="mt-2 text-3xl font-bold tabular-nums">
                {data.byStatus.find((s) => s.status === status)?.count ?? 0}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="processo" className="mt-8">
        <h2 id="processo" className="font-semibold">
          {t('reports.process.title')}
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label={t('reports.process.avgTriage')}
            value={seconds(p.avgTriageSeconds)}
            hint={t('reports.process.avgTriageHint')}
          />
          <Metric
            label={t('reports.process.avgExecution')}
            value={seconds(p.avgExecutionSeconds)}
            hint={t('reports.process.avgExecutionHint')}
          />
          <Metric
            label={t('reports.process.approvalRate')}
            value={percent(p.approvalRate)}
            hint={t('reports.process.approvalRateHint', { count: p.decided })}
          />
          <Metric
            label={t('reports.process.lateRate')}
            value={percent(p.lateRate)}
            hint={t('reports.process.lateRateHint', { late: p.late, total: p.inProgress })}
          />
          <Metric
            label={t('reports.process.perAuthor')}
            value={decimal(p.ideasPerAuthor)}
            hint={t('reports.process.perAuthorHint', { count: p.authors })}
          />
        </dl>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="categorias" className="rounded-lg border bg-card p-5">
          <h2 id="categorias" className="mb-4 font-semibold">
            {t('reports.byCategory')}
          </h2>
          <Bars
            total={data.total}
            rows={data.byCategory.map((c) => ({
              key: c.id ?? 'none',
              name: c.id ? c.name : t('reports.noCategory'),
              color: c.color,
              count: c.count,
            }))}
          />
        </section>
        <section aria-labelledby="entidades" className="rounded-lg border bg-card p-5">
          <h2 id="entidades" className="mb-4 font-semibold">
            {t('reports.byEntity')}
          </h2>
          <Bars total={data.total} rows={data.byEntity.map((e) => ({ key: e.id, name: e.name, count: e.count }))} />
        </section>
        {/* Campos fechados do autor, pelo valor da hora do envio (M25, RN-201). */}
        {data.byField.map((field) => (
          <section
            key={field.fieldId}
            aria-labelledby={`campo-${field.fieldId}`}
            className="rounded-lg border bg-card p-5"
          >
            <h2 id={`campo-${field.fieldId}`} className="font-semibold">
              {t('userFields.reports.byField', { field: fieldLabel(field, i18n.language) })}
            </h2>
            <p className="mb-4 text-xs text-muted-foreground">{t('userFields.reports.byFieldHint')}</p>
            <Bars
              total={data.total}
              rows={field.items.map((item) => ({
                key: item.optionId ?? 'none',
                name: item.optionId ? (item.label ?? '') : t('userFields.reports.notInformed'),
                count: item.count,
              }))}
            />
          </section>
        ))}
      </div>
    </>
  );
}

/** Indicadores (RN-44, RN-45, RN-49): por período, entidade e categoria, só do escopo de quem vê. */
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const { data: settings } = usePublicSettings();
  usePageTitle(t('reports.pageTitle'), settings?.organizationName);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const entities = useEntities();
  const categories = useActiveCategories();
  const summary = useSummary(filters);
  // As opções do filtro vêm do painel sem o filtro de campo (só as que aparecem nas ideias).
  const base = useSummary({ ...filters, option: '' });
  const fieldOptions = (base.data ?? summary.data)?.byField ?? [];
  const engagement = useEngagement(filters);
  const results = useResultsReport(filters);
  const set = (k: keyof Filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(filters) !== JSON.stringify(EMPTY);

  return (
    <div className="mx-auto max-w-[72rem]">
      <div className="flex items-start gap-1.5">
        <h1 className="text-[1.75rem] leading-tight font-bold">{t('reports.title')}</h1>
        <span className="pt-1">
          <HelpLink topic="reports" />
        </span>
      </div>
      <p className="mt-1 max-w-[70ch] text-muted-foreground">{t('reports.intro')}</p>

      <form
        noValidate
        onSubmit={(e) => e.preventDefault()}
        aria-label={t('reports.filters.label')}
        className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_1fr_1fr_1fr_auto]"
      >
        <Field label={t('reports.filters.from')}>
          <Input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => set('from')(e.target.value)}
          />
        </Field>
        <Field label={t('reports.filters.to')}>
          <Input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => set('to')(e.target.value)}
          />
        </Field>
        <Field label={t('reports.filters.entity')}>
          <NativeSelect value={filters.entityId} onChange={(e) => set('entityId')(e.target.value)}>
            <option value="">{t('reports.filters.allEntities')}</option>
            {orderTree(entities.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {entityOptionLabel(e)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('reports.filters.category')}>
          <NativeSelect value={filters.categoryId} onChange={(e) => set('categoryId')(e.target.value)}>
            <option value="">{t('reports.filters.allCategories')}</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {fieldOptions.some((f) => f.items.some((i) => i.optionId)) && (
          <Field label={t('userFields.reports.filter')}>
            <NativeSelect value={filters.option} onChange={(e) => set('option')(e.target.value)}>
              <option value="">{t('userFields.reports.all')}</option>
              {fieldOptions.map((f) => (
                <optgroup key={f.fieldId} label={fieldLabel(f, i18n.language)}>
                  {f.items
                    .filter((i) => i.optionId)
                    .map((i) => (
                      <option key={i.optionId} value={i.optionId ?? ''}>
                        {i.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </NativeSelect>
          </Field>
        )}
        <div className="flex items-end">
          <Button type="button" variant="outline" disabled={!dirty} onClick={() => setFilters(EMPTY)}>
            {t('reports.filters.clear')}
          </Button>
        </div>
      </form>

      <FormError message={summary.isError ? errorText(t, summary.error) : null} />
      <FormError message={engagement.isError && !summary.isError ? errorText(t, engagement.error) : null} />
      <div aria-live="polite" aria-busy={summary.isFetching}>
        {summary.data && <Dashboard data={summary.data} />}
        {engagement.data && <EngagementSection data={engagement.data} />}
        {results.data && <ResultsSection data={results.data} />}
      </div>
    </div>
  );
}
