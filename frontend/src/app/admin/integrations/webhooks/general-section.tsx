import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '../../../auth/auth-layout';
import { HelpAnchor } from '../../../help';
import { Section } from '../../shared';
import { type WebhooksView, webhookKeys } from './queries';

/** A chave dos webhooks (RN-117): desligada de fábrica; exige a chave geral da API de integração. */
export function WebhooksGeneral({ view }: { view: WebhooksView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toggle = useMutation({
    meta: { success: (_d, on: boolean) => (on ? t('feedback.webhooks.on') : t('feedback.webhooks.off')) },
    mutationFn: (enabled: boolean) => unwrap(api.PUT('/api/admin/webhooks/enabled', { body: { enabled } })),
    onSuccess: (data) => qc.setQueryData(webhookKeys.view, data),
  });
  const blocked = !view.enabled && !view.integrationEnabled;
  return (
    <Section
      title={t('admin.integrations.webhooks.general.title')}
      intro={t('admin.integrations.webhooks.general.intro')}
    >
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={view.enabled ? 'default' : 'outline'}>
            {view.enabled ? t('admin.integrations.general.on') : t('admin.integrations.general.off')}
          </Badge>
          <span className="text-muted-foreground">
            {view.enabled
              ? t('admin.integrations.webhooks.general.onText')
              : t('admin.integrations.webhooks.general.offText')}
          </span>
        </p>
        {blocked && (
          <p className="text-sm text-muted-foreground">{t('admin.integrations.webhooks.general.needsIntegration')}</p>
        )}
        <FormError message={toggle.isError ? errorText(t, toggle.error) : null} />
        <Button
          variant={view.enabled ? 'outline' : 'default'}
          disabled={toggle.isPending || blocked}
          onClick={() => toggle.mutate(!view.enabled)}
        >
          {view.enabled
            ? t('admin.integrations.webhooks.general.turnOff')
            : t('admin.integrations.webhooks.general.turnOn')}
        </Button>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <HelpAnchor topic="adminWebhooks" className="font-medium text-primary underline underline-offset-4">
            {t('admin.integrations.webhooks.general.helpAdmin')}
          </HelpAnchor>
          <HelpAnchor topic="webhooksReceive" className="font-medium text-primary underline underline-offset-4">
            {t('admin.integrations.webhooks.general.helpReceive')}
          </HelpAnchor>
        </p>
      </div>
    </Section>
  );
}

/** Os destinos permitidos (RN-117): nenhum webhook chama o que não estiver aqui, nem a rede interna. */
export function DestinationsSection({ view }: { view: WebhooksView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const saved = view.destinations.join('\n');
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const entries = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const save = useMutation({
    meta: { success: t('admin.integrations.webhooks.destinations.saved') },
    mutationFn: () => unwrap(api.PUT('/api/admin/webhooks/destinations', { body: { destinations: entries } })),
    onSuccess: (data) => qc.setQueryData(webhookKeys.view, data),
  });
  const dirty = entries.join('\n') !== saved;
  const tooMany = entries.length > view.limits.maxDestinations;
  return (
    <Section
      title={t('admin.integrations.webhooks.destinations.title')}
      intro={t('admin.integrations.webhooks.destinations.intro')}
    >
      <div className="max-w-2xl space-y-4">
        <Field
          label={t('admin.integrations.webhooks.destinations.label')}
          hint={t('admin.integrations.webhooks.destinations.hint', { max: view.limits.maxDestinations })}
        >
          <Textarea
            rows={5}
            value={text}
            onChange={(e) => {
              save.reset();
              setText(e.target.value);
            }}
            className="font-mono text-xs"
            placeholder={'erp.empresa.local\n*.empresa.com.br\n10.20.0.0/16'}
          />
        </Field>
        <FormError message={save.isError ? errorText(t, save.error) : null} />
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={save.isPending || !dirty || tooMany} onClick={() => save.mutate()}>
            {save.isPending
              ? t('admin.integrations.webhooks.destinations.saving')
              : t('admin.integrations.webhooks.destinations.save')}
          </Button>
        </div>
      </div>
    </Section>
  );
}
