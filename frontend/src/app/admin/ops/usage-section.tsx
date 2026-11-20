import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Section } from '../shared';
import { LoadFailure } from './load-failure';
import { formatBytes, formatNumber } from './ops-format';
import { useUsage } from './queries';

/** Uso e segurança (RN-92): só contagens, ninguém é identificado. */
export function UsageSection() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const usage = useUsage();
  const data = usage.data;
  const count = (value: number | null) =>
    value === null ? t('admin.ops.usage.unavailable') : formatNumber(value, lng);

  return (
    <Section title={t('admin.ops.usage.title')} intro={t('admin.ops.usage.intro')}>
      {usage.isError ? (
        <LoadFailure
          message={t('admin.ops.usage.loadError')}
          error={usage.error}
          retrying={usage.isFetching}
          onRetry={() => void usage.refetch()}
        />
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {(
              [
                ['activeUsers', count(data.activeUsers)],
                ['activeSessions', count(data.activeSessions)],
                ['logins', count(data.loginsLast24h)],
                ['loginsFailed', count(data.loginsFailedLast24h)],
                ['lockouts', count(data.lockoutsLast24h)],
                [
                  'database',
                  data.databaseBytes === null ? t('admin.ops.usage.unavailable') : formatBytes(data.databaseBytes, lng),
                ],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm text-muted-foreground">{t(`admin.ops.usage.stats.${key}`)}</dt>
                <dd className="text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <h3 className="text-sm font-medium">{t('admin.ops.usage.tables.title')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('admin.ops.usage.tables.intro')}</p>
            <Table className="mt-3">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.ops.usage.tables.columns.table')}</TableHead>
                  <TableHead className="text-right">{t('admin.ops.usage.tables.columns.rows')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tables.map((table) => (
                  <TableRow key={table.name}>
                    <TableCell>
                      {t(`admin.ops.usage.tables.names.${table.name}` as never, { defaultValue: table.name })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(table.rows, lng)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Section>
  );
}
