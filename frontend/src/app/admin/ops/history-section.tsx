import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDates } from '../../use-dates';
import { Section } from '../shared';
import { Chart } from './chart';
import { LoadFailure } from './load-failure';
import {
  buildSlices,
  buildWorkerSlices,
  failingRoutes,
  formatCompact,
  formatMegabytes,
  formatMs,
  formatNumber,
  PERIODS,
  type Period,
  type RouteView,
  routesOfPeriod,
  sliceEnd,
  slowestRoutes,
} from './ops-format';
import { useHistory } from './queries';

const PERIOD_KEYS = Object.keys(PERIODS) as Period[];

/** O histórico por hora, por período (24 horas, 7 dias ou 30 dias), com tabela e rotas (RN-92). */
export function HistorySection() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>('24h');
  return (
    <Section title={t('admin.ops.history.title')} intro={t('admin.ops.history.intro')}>
      <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)}>
        <TabsList aria-label={t('admin.ops.history.title')}>
          {PERIOD_KEYS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`admin.ops.history.periods.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={period} className="mt-4">
          <HistoryPanel period={period} />
        </TabsContent>
      </Tabs>
    </Section>
  );
}

function HistoryPanel({ period }: { period: Period }) {
  const { t, i18n } = useTranslation();
  const dates = useDates();
  const lng = i18n.language;
  const offset = dates.offsetMinutes();
  const history = useHistory(period, offset);
  const data = history.data;
  const at = history.dataUpdatedAt;

  const slices = useMemo(() => (data ? buildSlices(data.hours, period, at, offset) : []), [data, period, at, offset]);
  const workerSlices = useMemo(
    () => (data ? buildWorkerSlices(data.workerHours, period, at, offset) : []),
    [data, period, at, offset],
  );
  const routes = useMemo(() => (data ? routesOfPeriod(data.hours) : []), [data]);

  if (history.isError && !data) {
    return (
      <LoadFailure
        message={t('admin.ops.history.loadError')}
        error={history.error}
        retrying={history.isFetching}
        onRetry={() => void history.refetch()}
      />
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (data.hours.length === 0 && data.workerHours.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('admin.ops.history.empty')}</p>;
  }

  const step = t(`admin.ops.history.steps.${period}`);
  const periodName = t(`admin.ops.history.periods.${period}`);
  const n = (value: number) => formatNumber(value, lng);
  const axis = (value: number) => formatCompact(value, lng);
  const ms = (value: number) => formatMs(value, lng);
  const mb = (value: number) => formatMegabytes(value, lng);

  const label = (start: number) =>
    period === '24h' ? dates.hour(start) : period === '30d' ? dates.dayMonth(start) : dates.dayMonthHour(start);
  const tip = (start: number) =>
    period === '30d' ? dates.dayMonth(start) : `${dates.dayMonthHour(start)} – ${dates.hour(sliceEnd(start, period))}`;
  const pointsOf = (pick: (slice: (typeof slices)[number]) => number | null) =>
    slices.map((slice) => ({ key: slice.start, label: label(slice.start), tip: tip(slice.start), value: pick(slice) }));

  const requestsTotal = slices.reduce((sum, slice) => sum + slice.requests, 0);
  const requestsPeak = Math.max(0, ...slices.map((slice) => slice.requests));
  const errorsTotal = slices.reduce((sum, slice) => sum + slice.errors5xx, 0);
  const p95s = slices.flatMap((slice) => (slice.p95Ms === null ? [] : [slice.p95Ms]));
  const memories = slices.flatMap((slice) => (slice.memoryMb === null ? [] : [slice.memoryMb]));
  const dash = t('admin.ops.history.table.none');

  return (
    <div className={`space-y-8 ${history.isPlaceholderData ? 'opacity-60' : ''}`}>
      <div className="grid gap-6 lg:grid-cols-2">
        <Chart
          title={t('admin.ops.history.charts.requests')}
          summary={t('admin.ops.history.summaries.requests', { total: n(requestsTotal), peak: n(requestsPeak), step })}
          shape="columns"
          tone="primary"
          format={n}
          axisFormat={axis}
          points={pointsOf((slice) => slice.requests)}
        />
        <Chart
          title={t('admin.ops.history.charts.errors')}
          summary={t('admin.ops.history.summaries.errors', { total: n(errorsTotal) })}
          shape="columns"
          tone="danger"
          format={n}
          axisFormat={axis}
          points={pointsOf((slice) => slice.errors5xx)}
        />
        <Chart
          title={t('admin.ops.history.charts.p95')}
          summary={t('admin.ops.history.summaries.p95', {
            min: p95s.length > 0 ? ms(Math.min(...p95s)) : dash,
            max: p95s.length > 0 ? ms(Math.max(...p95s)) : dash,
          })}
          shape="line"
          tone="primary"
          format={ms}
          points={pointsOf((slice) => slice.p95Ms)}
        />
        <Chart
          title={t('admin.ops.history.charts.memory')}
          summary={t('admin.ops.history.summaries.memory', {
            max: memories.length > 0 ? mb(Math.max(...memories)) : dash,
          })}
          shape="line"
          tone="primary"
          format={mb}
          points={pointsOf((slice) => slice.memoryMb)}
        />
      </div>

      <details>
        <summary className="cursor-pointer text-sm font-medium">{t('admin.ops.history.table.show')}</summary>
        <div className="mt-3">
          <Table scrollLabel={t('admin.ops.history.table.caption', { period: periodName, step })}>
            <caption className="sr-only">{t('admin.ops.history.table.caption', { period: periodName, step })}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.ops.history.table.columns.period')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.table.columns.requests')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.table.columns.errors5xx')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.table.columns.errors4xx')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.table.columns.p95')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.table.columns.memory')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...slices].reverse().map((slice) => (
                <TableRow key={slice.start}>
                  <TableCell>{tip(slice.start)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(slice.requests)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(slice.errors5xx)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(slice.errors4xx)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {slice.p95Ms === null ? dash : ms(slice.p95Ms)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {slice.memoryMb === null ? dash : mb(slice.memoryMb)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>

      <div className="grid gap-8 lg:grid-cols-2">
        <RoutesTable title={t('admin.ops.history.routes.slowest')} routes={slowestRoutes(routes)} ms={ms} n={n} />
        <RoutesTable
          title={t('admin.ops.history.routes.failing')}
          routes={failingRoutes(routes)}
          empty={t('admin.ops.history.routes.noneFailing')}
          ms={ms}
          n={n}
        />
      </div>

      <WorkerBlock slices={workerSlices} tip={tip} period={periodName} step={step} ms={ms} n={n} />
    </div>
  );
}

function RoutesTable({
  title,
  routes,
  empty,
  ms,
  n,
}: {
  title: string;
  routes: RouteView[];
  empty?: string;
  ms: (value: number) => string;
  n: (value: number) => string;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {routes.length === 0 && empty ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-2">
          <Table scrollLabel={title}>
            <caption className="sr-only">{title}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.ops.history.routes.columns.route')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.routes.columns.requests')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.routes.columns.errors')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.routes.columns.p95')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routes.map((route) => (
                <TableRow key={route.route}>
                  <TableCell className="font-mono text-xs break-all">{route.route}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(route.requests)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(route.errors)}</TableCell>
                  <TableCell className="text-right tabular-nums">{ms(route.p95Ms)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function WorkerBlock({
  slices,
  tip,
  period,
  step,
  ms,
  n,
}: {
  slices: ReturnType<typeof buildWorkerSlices>;
  tip: (start: number) => string;
  period: string;
  step: string;
  ms: (value: number) => string;
  n: (value: number) => string;
}) {
  const { t } = useTranslation();
  const active = slices.filter(
    (slice) => slice.ticks > 0 || slice.emailsSent + slice.emailsFailed + slice.emailsRetried > 0,
  );
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-medium">{t('admin.ops.history.worker.title')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('admin.ops.history.worker.intro')}</p>
      {active.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('admin.ops.history.worker.empty')}</p>
      ) : (
        <div className="mt-2">
          <Table scrollLabel={t('admin.ops.history.worker.caption', { period, step })}>
            <caption className="sr-only">{t('admin.ops.history.worker.caption', { period, step })}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.ops.history.worker.columns.period')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.worker.columns.ticks')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.worker.columns.tickFailures')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.worker.columns.p95')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.worker.columns.sent')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.worker.columns.retried')}</TableHead>
                <TableHead className="text-right">{t('admin.ops.history.worker.columns.failed')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...active].reverse().map((slice) => (
                <TableRow key={slice.start}>
                  <TableCell>{tip(slice.start)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(slice.ticks)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(slice.tickFailures)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {slice.tickP95Ms === null ? '—' : ms(slice.tickP95Ms)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{n(slice.emailsSent)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(slice.emailsRetried)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(slice.emailsFailed)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
