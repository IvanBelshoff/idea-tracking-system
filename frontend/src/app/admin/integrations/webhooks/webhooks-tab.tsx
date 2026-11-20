import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadFailure } from '../../ops/load-failure';
import { DestinationsSection, WebhooksGeneral } from './general-section';
import { useWebhooks, type WebhookSubscriptionView } from './queries';
import { SecretDialog } from './secret-dialog';
import { SubscriptionDetail } from './subscription-detail';
import { SubscriptionForm } from './subscription-form';
import { SubscriptionsList } from './subscriptions-list';

/**
 * A aba Webhooks (M17, RN-117 a RN-125): chave, destinos permitidos, assinaturas, segredos e o registro de
 * entregas. Só quem tem `integration.manage` chega aqui; a API também confere.
 */
export function WebhooksTab() {
  const { t } = useTranslation();
  const webhooks = useWebhooks();
  const [form, setForm] = useState<{ subscription: WebhookSubscriptionView | null } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // O segredo novo aparece uma única vez; fechar o diálogo o apaga da memória da tela.
  const [shown, setShown] = useState<{ secret: string; name: string } | null>(null);
  const view = webhooks.data;

  return (
    <div className="grid gap-6">
      {webhooks.isError && (
        <LoadFailure
          message={t('admin.integrations.webhooks.loadFailed')}
          error={webhooks.error}
          retrying={webhooks.isFetching}
          onRetry={() => void webhooks.refetch()}
        />
      )}
      {view && (
        <>
          <WebhooksGeneral view={view} />
          <DestinationsSection view={view} />
          <SubscriptionsList view={view} onOpen={setOpenId} onCreate={() => setForm({ subscription: null })} />
          {form && (
            <SubscriptionForm
              view={view}
              subscription={form.subscription}
              onClose={() => setForm(null)}
              onCreated={(secret, created) => setShown({ secret, name: created.name })}
            />
          )}
          {openId && !form && (
            <SubscriptionDetail
              view={view}
              id={openId}
              onClose={() => setOpenId(null)}
              onEdit={(subscription) => setForm({ subscription })}
              onSecret={(secret, name) => setShown({ secret, name })}
            />
          )}
        </>
      )}
      {shown && <SecretDialog secret={shown.secret} name={shown.name} onClose={() => setShown(null)} />}
    </div>
  );
}
