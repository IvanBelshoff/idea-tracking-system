import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, type LucideIcon, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormError } from '../../auth/auth-layout';
import { useDates } from '../../use-dates';
import { adminKeys } from '../queries';
import { Section } from '../shared';

type HealthState = components['schemas']['HealthState'];
type HealthItem = components['schemas']['HealthItemView'];

/** A saúde é conferida pela API a cada minuto; a tela acompanha no mesmo ritmo. */
const REFRESH_MS = 60_000;

/** Cor, ícone e texto juntos: o estado nunca depende só da cor (docs/DESIGN.md). */
const STATE_STYLE: Record<HealthState, { Icon: LucideIcon; text: string; badge: string }> = {
  ok: { Icon: CircleCheck, text: 'text-(--st-done)', badge: 'bg-(--st-done-fill) text-(--st-done-on)' },
  warning: { Icon: TriangleAlert, text: 'text-(--st-late)', badge: 'bg-(--st-late-fill) text-(--st-late-on)' },
  failed: { Icon: CircleX, text: 'text-(--st-rejected)', badge: 'bg-(--st-rejected-fill) text-(--st-rejected-on)' },
};

export function useOpsHealth() {
  return useQuery({
    queryKey: adminKeys.opsHealth,
    queryFn: () => unwrap(api.GET('/api/ops/health')),
    refetchInterval: REFRESH_MS,
  });
}

/** O resumo de um item: pelo código que a API devolve; código que a tela não conhece vira o texto genérico. */
function useItemText() {
  const { t } = useTranslation();
  return (item: HealthItem) => {
    if (item.code === 'unavailable') return t('admin.ops.health.unavailable');
    const path = `admin.ops.health.items.${item.key}.${item.code}`;
    const text = t(path as never, { value: item.value ?? 0 }) as string;
    return text === path ? item.code : text;
  };
}

export function HealthSection() {
  const { t } = useTranslation();
  const dates = useDates();
  const itemText = useItemText();
  const health = useOpsHealth();
  const report = health.data;

  return (
    <Section title={t('admin.ops.health.title')} intro={t('admin.ops.health.intro')}>
      {health.isError ? (
        <div className="space-y-3">
          <FormError message={`${t('admin.ops.health.loadError')} ${errorText(t, health.error)}`} />
          <Button variant="outline" onClick={() => void health.refetch()} disabled={health.isFetching}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !report ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('admin.ops.health.meta', {
              version: report.version,
              environment: report.environment,
              since: dates.dateTime(report.apiStartedAt),
              ago: dates.relative(report.apiStartedAt),
            })}
          </p>
          <OverallState state={report.state} />
          <ul className="divide-y overflow-hidden rounded-lg border">
            {report.items.map((item) => {
              const style = STATE_STYLE[item.state];
              return (
                <li
                  key={item.key}
                  className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[1.25rem_12rem_minmax(0,1fr)_auto] sm:items-center sm:gap-x-4"
                >
                  <style.Icon aria-hidden="true" className={`size-5 ${style.text}`} />
                  <span className="font-medium">{t(`admin.ops.health.items.${item.key}.title`)}</span>
                  <span className="col-start-2 text-sm text-muted-foreground sm:col-start-auto">{itemText(item)}</span>
                  <span className="col-start-2 justify-self-start sm:col-start-auto sm:justify-self-end">
                    <Badge className={style.badge}>{t(`admin.ops.health.states.${item.state}`)}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Section>
  );
}

function OverallState({ state }: { state: HealthState }) {
  const { t } = useTranslation();
  const style = STATE_STYLE[state];
  return (
    <p role="status" className="flex items-center gap-2 font-medium">
      <style.Icon aria-hidden="true" className={`size-5 ${style.text}`} />
      {t(`admin.ops.health.summary.${state}`)}
    </p>
  );
}
