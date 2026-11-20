import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DocsSection } from './integrations/docs-section';
import { GeneralSection, ModulesSection } from './integrations/general-section';
import { IntegrationDetail } from './integrations/integration-detail';
import { IntegrationForm } from './integrations/integration-form';
import { IntegrationsList } from './integrations/integrations-list';
import { type IntegrationView, useIntegrations } from './integrations/queries';
import { TokenDialog } from './integrations/token-dialog';
import { WebhooksTab } from './integrations/webhooks/webhooks-tab';
import { LoadFailure } from './ops/load-failure';
import { AdminPage } from './shared';

/**
 * Integrações (M16, RN-102 a RN-116): a API de leitura que outros sistemas usam. Chave geral,
 * módulos, integrações com tokens e a documentação do contrato. Só quem tem `integration.manage`
 * chega aqui; a API também confere.
 */
export function IntegrationsPage() {
  const { t } = useTranslation();
  const integrations = useIntegrations();
  const [form, setForm] = useState<{ integration: IntegrationView | null } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // O token novo aparece uma única vez; fechar o diálogo o apaga da memória da tela.
  const [shown, setShown] = useState<{ token: string; name: string } | null>(null);
  const view = integrations.data;

  return (
    <AdminPage title={t('admin.integrations.pageTitle')} intro={t('admin.integrations.intro')} help="adminIntegrations">
      {integrations.isError && (
        <LoadFailure
          message={t('admin.integrations.loadFailed')}
          error={integrations.error}
          retrying={integrations.isFetching}
          onRetry={() => void integrations.refetch()}
        />
      )}
      {view && (
        <Tabs defaultValue="integracoes">
          <TabsList>
            <TabsTrigger value="integracoes">{t('admin.integrations.tabs.list')}</TabsTrigger>
            <TabsTrigger value="modulos">{t('admin.integrations.tabs.modules')}</TabsTrigger>
            <TabsTrigger value="webhooks">{t('admin.integrations.tabs.webhooks')}</TabsTrigger>
            <TabsTrigger value="documentacao">{t('admin.integrations.tabs.docs')}</TabsTrigger>
          </TabsList>
          <TabsContent value="integracoes" className="mt-4 grid gap-6">
            <GeneralSection view={view} />
            <IntegrationsList view={view} onOpen={setOpenId} onCreate={() => setForm({ integration: null })} />
          </TabsContent>
          <TabsContent value="modulos" className="mt-4">
            <ModulesSection view={view} />
          </TabsContent>
          <TabsContent value="webhooks" className="mt-4">
            <WebhooksTab />
          </TabsContent>
          <TabsContent value="documentacao" className="mt-4">
            <DocsSection view={view} />
          </TabsContent>

          {form && (
            <IntegrationForm
              view={view}
              integration={form.integration}
              onClose={() => setForm(null)}
              onCreated={(token, created) => setShown({ token, name: created.name })}
            />
          )}
          {openId && !form && (
            <IntegrationDetail
              view={view}
              id={openId}
              onClose={() => setOpenId(null)}
              onEdit={(integration) => setForm({ integration })}
              onToken={(token, name) => setShown({ token, name })}
            />
          )}
        </Tabs>
      )}
      {shown && <TokenDialog token={shown.token} name={shown.name} onClose={() => setShown(null)} />}
    </AdminPage>
  );
}
