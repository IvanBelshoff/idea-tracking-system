import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDates } from '../../use-dates';
import { Section } from '../shared';
import { Chart } from './chart';
import { LoadFailure } from './load-failure';
import { formatCompact, formatMs, formatNumber } from './ops-format';
import { useTraffic } from './queries';

function Stat({ label, value, alert }: { label: string; value: ReactNode; alert?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-xl font-semibold tabular-nums ${alert ? 'text-(--st-rejected)' : ''}`}>{value}</dd>
    </div>
  );
}

/** O tráfego desde que a API subiu e o minuto a minuto da última hora (RN-92). */
export function TrafficSection() {
  const { t, i18n } = useTranslation();
  const dates = useDates();
  const lng = i18n.language;
  const traffic = useTraffic();
  const data = traffic.data;
  const n = (value: number) => formatNumber(value, lng);

  return (
    <Section
      title={t('admin.ops.traffic.title')}
      intro={data ? t('admin.ops.traffic.intro', { since: dates.dateTime(data.since) }) : undefined}
    >
      {traffic.isError ? (
        <LoadFailure
          message={t('admin.ops.traffic.loadError')}
          error={traffic.error}
          retrying={traffic.isFetching}
          onRetry={() => void traffic.refetch()}
        />
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Stat label={t('admin.ops.traffic.stats.requests')} value={n(data.requests)} />
            <Stat label={t('admin.ops.traffic.stats.errors5xx')} value={n(data.errors5xx)} alert={data.errors5xx > 0} />
            <Stat label={t('admin.ops.traffic.stats.errors4xx')} value={n(data.errors4xx)} />
            <Stat label={t('admin.ops.traffic.stats.rateLimited')} value={n(data.rateLimited)} />
            <Stat label={t('admin.ops.traffic.stats.p50')} value={formatMs(data.p50Ms, lng)} />
            <Stat label={t('admin.ops.traffic.stats.p95')} value={formatMs(data.p95Ms, lng)} />
            <Stat label={t('admin.ops.traffic.stats.loginsOk')} value={n(data.loginsOk)} />
            <Stat label={t('admin.ops.traffic.stats.loginsFailed')} value={n(data.loginsFailed)} />
          </dl>
          <Chart
            title={t('admin.ops.traffic.chartTitle')}
            summary={t('admin.ops.traffic.chartSummary', {
              requests: n(data.minutes.reduce((sum, minute) => sum + minute.requests, 0)),
              errors: n(data.minutes.reduce((sum, minute) => sum + minute.errors5xx, 0)),
            })}
            shape="columns"
            tone="primary"
            format={(value) => n(value)}
            axisFormat={(value) => formatCompact(value, lng)}
            points={data.minutes.map((minute) => ({
              key: minute.minute,
              label: dates.hourMinute(minute.minute),
              value: minute.requests,
              extras:
                minute.errors5xx > 0 ? [t('admin.ops.traffic.tipErrors', { count: minute.errors5xx })] : undefined,
            }))}
          />
        </div>
      )}
    </Section>
  );
}
