import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { SensitiveInput } from '@/components/form/sensitive';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormError } from '../../../auth/auth-layout';
import { useDates } from '../../../use-dates';
import { eventKey } from './helpers';
import { type WebhookSubscriptionView, type WebhooksView, webhookKeys } from './queries';

/** Cria ou altera uma assinatura (RN-118). Na criação também se escolhe a validade do segredo (RN-120). */
export function SubscriptionForm({
  view,
  subscription,
  onClose,
  onCreated,
}: {
  view: WebhooksView;
  /** Nulo = criar. */
  subscription: WebhookSubscriptionView | null;
  onClose: () => void;
  /** Só na criação: o segredo vem aqui, uma única vez. */
  onCreated: (secret: string, created: WebhookSubscriptionView) => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const uid = useId();
  const [integrationId, setIntegrationId] = useState(subscription?.integrationId ?? view.integrations[0]?.id ?? '');
  const [name, setName] = useState(subscription?.name ?? '');
  const [url, setUrl] = useState(subscription?.url ?? '');
  const [events, setEvents] = useState<string[]>(subscription?.events ?? []);
  const [days, setDays] = useState(String(view.limits.suggestedSecretDays));

  const integration = view.integrations.find((i) => i.id === integrationId);
  // Só os eventos de módulos que a integração tem (RN-118).
  const available = view.events.filter((e) => integration?.modules.includes(e.module));
  const daysNumber = Number(days);
  const daysValid = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= view.limits.maxSecretDays;
  const chosen = available.map((a) => a.type).filter((type) => events.includes(type));

  const save = useMutation({
    meta: {
      success: (d: { secret: string | null }) =>
        d.secret ? t('feedback.webhooks.created') : t('feedback.webhooks.updated'),
    },
    mutationFn: async (): Promise<{ secret: string | null; subscription: WebhookSubscriptionView }> => {
      const body = { name: name.trim(), url: url.trim(), events: chosen };
      if (subscription) {
        const updated = await unwrap(
          api.PUT('/api/admin/webhooks/{id}', { params: { path: { id: subscription.id } }, body }),
        );
        return { secret: null, subscription: updated };
      }
      const created = await unwrap(
        api.POST('/api/admin/webhooks', {
          body: { ...body, integrationId, expiresAt: dates.dayStartIso(dates.dayFromToday(daysNumber)) ?? '' },
        }),
      );
      return { secret: created.secret, subscription: created.subscription };
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: webhookKeys.view });
      if (data.secret) onCreated(data.secret, data.subscription);
      onClose();
    },
  });

  const errors = fieldErrors(save.error);
  const canSave =
    name.trim() !== '' &&
    url.trim() !== '' &&
    chosen.length > 0 &&
    (subscription !== null || (daysValid && integrationId !== '')) &&
    !save.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {subscription
              ? t('admin.integrations.webhooks.form.editTitle')
              : t('admin.integrations.webhooks.form.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.integrations.webhooks.form.integration')}>
              <NativeSelect
                value={integrationId}
                disabled={subscription !== null}
                onChange={(e) => setIntegrationId(e.target.value)}
              >
                {view.integrations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t('admin.integrations.webhooks.form.name')} error={errors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
          </div>
          <Field
            label={t('admin.integrations.webhooks.form.url')}
            hint={t('admin.integrations.webhooks.form.urlHint')}
            error={errors.url}
          >
            <SensitiveInput
              fieldLabel={t('admin.integrations.webhooks.form.url')}
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://erp.empresa.local/its/webhook"
              className="font-mono text-xs"
            />
          </Field>

          <fieldset>
            <legend className="text-sm font-medium">{t('admin.integrations.webhooks.form.events')}</legend>
            <p className="mt-1 text-xs text-muted-foreground">{t('admin.integrations.webhooks.form.eventsHint')}</p>
            {available.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('admin.integrations.webhooks.form.eventsNone')}</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {available.map((e) => (
                  <label key={e.type} htmlFor={`${uid}-${e.type}`} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      id={`${uid}-${e.type}`}
                      checked={chosen.includes(e.type)}
                      onCheckedChange={(v) =>
                        setEvents((list) => (v === true ? [...list, e.type] : list.filter((x) => x !== e.type)))
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block font-mono text-xs">{e.type}</span>
                      <span className="block text-muted-foreground">
                        {t(`admin.integrations.webhooks.events.${eventKey(e.type)}` as never)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {!subscription && (
            <Field
              label={t('admin.integrations.webhooks.form.days')}
              hint={t('admin.integrations.webhooks.form.daysHint', { max: view.limits.maxSecretDays })}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={view.limits.maxSecretDays}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
          )}

          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {save.isPending
                ? t('admin.integrations.webhooks.form.saving')
                : t('admin.integrations.webhooks.form.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
