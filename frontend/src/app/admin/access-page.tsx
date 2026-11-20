import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { DomainsSection } from './access/domains-section';
import { ModeSection } from './access/mode-section';
import { ProvidersSection, ssoReason } from './access/provider-section';
import { ProvisioningSection } from './access/provisioning-section';
import { useAccess } from './access/queries';
import { LoadFailure } from './ops/load-failure';
import { AdminPage } from './shared';

/** Resultado do teste de entrada, que o servidor devolve na URL (`?teste=ok|erro&provedor=…`). */
function TestBanner() {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const result = search.teste;
  if (result !== 'ok' && result !== 'erro') return null;
  const provider = t(`admin.access.providers.${search.provedor === 'google' ? 'google' : 'microsoft'}`);
  if (result === 'ok') {
    const linked = String(search.vinculado) === '1';
    return (
      <p role="status" className="rounded-md border border-(--st-done)/40 p-3 text-sm">
        {t('admin.access.testBanner.ok', { provider })}{' '}
        {linked ? t('admin.access.testBanner.okLinked') : t('admin.access.testBanner.okNotLinked')}
      </p>
    );
  }
  const reason = ssoReason(t, typeof search.motivo === 'string' ? search.motivo : null);
  return (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      {t('admin.access.testBanner.fail', { provider, reason })}
    </p>
  );
}

/**
 * Acesso corporativo (M13, RN-95 a RN-98): domínios de e-mail, provedores Microsoft e Google, modo
 * de login e criação automática de conta. Só quem tem a permissão `sso.manage` chega aqui; a API
 * também confere.
 */
export function AccessPage() {
  const { t } = useTranslation();
  const access = useAccess();
  return (
    <AdminPage title={t('admin.access.pageTitle')} intro={t('admin.access.intro')} help="adminAccess" narrow>
      <div className="space-y-6">
        <TestBanner />
        {access.isError && (
          <LoadFailure
            message={t('admin.access.loadFailed')}
            error={access.error}
            retrying={access.isFetching}
            onRetry={() => void access.refetch()}
          />
        )}
        {access.data && (
          <>
            <DomainsSection access={access.data} />
            <ProvidersSection sso={access.data.sso} />
            <ModeSection sso={access.data.sso} />
            <ProvisioningSection sso={access.data.sso} />
          </>
        )}
      </div>
    </AdminPage>
  );
}
