import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HealthSection, useOpsHealth } from './ops/health-section';
import { HistorySection } from './ops/history-section';
import { TrafficSection } from './ops/traffic-section';
import { UsageSection } from './ops/usage-section';
import { AdminPage } from './shared';

/**
 * Observabilidade (M12, RN-92 a RN-94): saúde da instalação, o tráfego agora, o histórico por hora
 * e o uso. Só quem tem a permissão `ops.view` chega aqui; a API também confere.
 */
export function OpsPage() {
  const { t } = useTranslation();
  const health = useOpsHealth();
  return (
    <AdminPage title={t('admin.ops.pageTitle')} intro={t('admin.ops.intro')} help="adminOps">
      <div className="space-y-6">
        <HealthSection />
        {health.data?.metricsEnabled === false && (
          <p role="status" className="flex items-start gap-2 rounded-md border border-(--st-late)/40 p-3 text-sm">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-late)" />
            {t('admin.ops.metricsOff')}
          </p>
        )}
        <TrafficSection />
        <HistorySection />
        <UsageSection />
      </div>
    </AdminPage>
  );
}
