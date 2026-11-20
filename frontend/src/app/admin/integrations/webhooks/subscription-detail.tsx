import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { SensitiveText } from '@/components/form/sensitive';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type Translate, webhookErrorText } from '@/lib/server-text';
import { FormError } from '../../../auth/auth-layout';
import { useDates } from '../../../use-dates';
import { tokenBadge } from '../integration-detail';
import {
  type DeliveryFilter,
  useDeliveries,
  type WebhookSecretView,
  type WebhookSubscriptionView,
  type WebhooksView,
  webhookKeys,
} from './queries';
import { StatusBadge } from './subscriptions-list';

const FILTERS: DeliveryFilter[] = ['all', 'pending', 'delivered', 'failed'];

function Deliveries({ id }: { id: string }) {
  const { t } = useTranslation();
  const tr = t as unknown as Translate;
  const dates = useDates();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<DeliveryFilter>('all');
  const deliveries = useDeliveries(id, filter);
  const resend = useMutation({
    meta: { success: t('feedback.webhooks.resent') },
    mutationFn: (deliveryId: string) =>
      unwrap(
        api.POST('/api/admin/webhooks/{id}/deliveries/{deliveryId}/resend', { params: { path: { id, deliveryId } } }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'webhooks'] });
    },
  });
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t('admin.integrations.webhooks.deliveries.title')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('admin.integrations.webhooks.deliveries.intro')}</p>
        </div>
        <div className="flex items-end gap-2">
          <Field label={t('admin.integrations.webhooks.deliveries.filter')}>
            <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value as DeliveryFilter)}>
              {FILTERS.map((f) => (
                <option key={f} value={f}>
                  {t(`admin.integrations.webhooks.deliveries.filters.${f}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button variant="outline" disabled={deliveries.isFetching} onClick={() => void deliveries.refetch()}>
            {t('admin.integrations.webhooks.deliveries.refresh')}
          </Button>
        </div>
      </div>
      {deliveries.isError && <FormError message={errorText(t, deliveries.error)} />}
      <FormError message={resend.isError ? errorText(t, resend.error) : null} />
      {deliveries.data && deliveries.data.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">{t('admin.integrations.webhooks.deliveries.empty')}</p>
      )}
      {deliveries.data && deliveries.data.length > 0 && (
        <Table className="mt-2" scrollLabel={t('admin.integrations.webhooks.deliveries.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.integrations.webhooks.deliveries.event')}</TableHead>
              <TableHead>{t('admin.common.status')}</TableHead>
              <TableHead className="text-right">{t('admin.integrations.webhooks.deliveries.attempts')}</TableHead>
              <TableHead>{t('admin.integrations.webhooks.deliveries.result')}</TableHead>
              <TableHead>{t('admin.integrations.webhooks.deliveries.when')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('admin.common.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.data.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                <TableCell>
                  <Badge
                    variant={d.state === 'delivered' ? 'default' : d.state === 'failed' ? 'destructive' : 'secondary'}
                  >
                    {t(
                      `admin.integrations.webhooks.deliveries.states.${d.state === 'delivered' || d.state === 'failed' ? d.state : 'pending'}`,
                    )}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{d.attempts}</TableCell>
                <TableCell className="font-mono text-xs">
                  {d.lastError ? webhookErrorText(tr, d.lastError) : (d.lastStatus ?? '—')}
                </TableCell>
                <TableCell>
                  {d.state === 'delivered' && d.deliveredAt
                    ? dates.dateTime(d.deliveredAt)
                    : d.state === 'pending'
                      ? t('admin.integrations.webhooks.deliveries.next', { date: dates.dateTime(d.nextAttemptAt) })
                      : dates.dateTime(d.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  {d.state === 'failed' && (
                    <Button variant="outline" size="sm" disabled={resend.isPending} onClick={() => resend.mutate(d.id)}>
                      {t('admin.integrations.webhooks.deliveries.resend')}
                      <span className="sr-only"> — {d.eventType}</span>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** Uma assinatura em detalhe (RN-125): dados, ações de estado, teste, segredos (girar e revogar) e o registro de entregas. */
export function SubscriptionDetail({
  view,
  id,
  onClose,
  onEdit,
  onSecret,
}: {
  view: WebhooksView;
  id: string;
  onClose: () => void;
  onEdit: (subscription: WebhookSubscriptionView) => void;
  /** O segredo novo da rotação: aparece uma única vez. */
  onSecret: (secret: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const tr = t as unknown as Translate;
  const dates = useDates();
  const qc = useQueryClient();
  const sub = view.subscriptions.find((s) => s.id === id);
  const [confirm, setConfirm] = useState<'remove' | { secret: WebhookSecretView } | null>(null);
  const [days, setDays] = useState(String(view.limits.suggestedSecretDays));
  const [overlap, setOverlap] = useState(String(view.limits.defaultOverlapHours));

  const refresh = () => void qc.invalidateQueries({ queryKey: webhookKeys.view });
  const state = useMutation({
    meta: { success: (_d, action: 'suspend' | 'reactivate') => t(`feedback.webhooks.${action}`) },
    mutationFn: (action: 'suspend' | 'reactivate') =>
      unwrap(api.POST(`/api/admin/webhooks/{id}/${action}`, { params: { path: { id } } })),
    onSuccess: refresh,
  });
  const ping = useMutation({
    meta: {
      success: (d: { ok: boolean; status?: number | null }) =>
        d.ok ? t('admin.integrations.webhooks.detail.pingOk', { status: d.status ?? '' }) : '',
    },
    mutationFn: () => unwrap(api.POST('/api/admin/webhooks/{id}/ping', { params: { path: { id } } })),
  });
  const remove = useMutation({
    meta: { success: t('feedback.webhooks.removed') },
    mutationFn: async () => {
      const res = await api.DELETE('/api/admin/webhooks/{id}', { params: { path: { id } } });
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const rotate = useMutation({
    meta: { success: t('feedback.webhooks.secretCreated') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/admin/webhooks/{id}/secrets', {
          params: { path: { id } },
          body: {
            expiresAt: dates.dayStartIso(dates.dayFromToday(Number(days))) ?? '',
            overlapHours: Number(overlap),
          },
        }),
      ),
    onSuccess: (data) => {
      refresh();
      onSecret(data.secret, data.subscription.name);
    },
  });
  const revokeSecret = useMutation({
    meta: { success: t('feedback.webhooks.secretRevoked') },
    mutationFn: (secretId: string) =>
      unwrap(api.POST('/api/admin/webhooks/{id}/secrets/{secretId}/revoke', { params: { path: { id, secretId } } })),
    onSuccess: () => {
      refresh();
      setConfirm(null);
    },
  });

  if (!sub) return null;
  const daysValid = Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= view.limits.maxSecretDays;
  const overlapValid =
    Number.isInteger(Number(overlap)) && Number(overlap) >= 0 && Number(overlap) <= view.limits.maxOverlapHours;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {sub.name}
            <StatusBadge sub={sub} />
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('admin.integrations.webhooks.list.integration')}</dt>
              <dd>{sub.integrationName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('admin.integrations.webhooks.detail.failures')}</dt>
              <dd>{sub.consecutiveFailures}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{t('admin.integrations.webhooks.form.url')}</dt>
              <dd>
                <SensitiveText
                  value={sub.url}
                  fieldLabel={t('admin.integrations.webhooks.form.url')}
                  className="break-all font-mono text-xs"
                />
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{t('admin.integrations.webhooks.form.events')}</dt>
              <dd className="flex flex-wrap gap-1">
                {sub.events.map((e) => (
                  <Badge key={e} variant="outline" className="font-mono">
                    {e}
                  </Badge>
                ))}
              </dd>
            </div>
          </dl>
          {sub.status === 'suspended' && sub.suspendedReason === 'failures' && (
            <p role="status" className="rounded-md border border-(--st-rejected)/40 p-3 text-sm">
              {t('admin.integrations.webhooks.detail.suspendedByFailures')}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onEdit(sub)}>
              {t('admin.common.edit')}
            </Button>
            {sub.status === 'active' ? (
              <Button variant="outline" disabled={state.isPending} onClick={() => state.mutate('suspend')}>
                {t('admin.integrations.detail.suspend')}
              </Button>
            ) : (
              <Button variant="outline" disabled={state.isPending} onClick={() => state.mutate('reactivate')}>
                {t('admin.integrations.detail.reactivate')}
              </Button>
            )}
            <Button variant="outline" disabled={ping.isPending} onClick={() => ping.mutate()}>
              {ping.isPending
                ? t('admin.integrations.webhooks.detail.pinging')
                : t('admin.integrations.webhooks.detail.ping')}
            </Button>
            <Button variant="destructive" onClick={() => setConfirm('remove')}>
              {t('admin.integrations.webhooks.detail.remove')}
            </Button>
          </div>
          <FormError message={state.isError ? errorText(t, state.error) : null} />
          <FormError message={ping.isError ? errorText(t, ping.error) : null} />
          {ping.data && (
            <p role="status" className={`text-sm ${ping.data.ok ? 'text-(--st-done)' : 'text-(--st-rejected)'}`}>
              {ping.data.ok
                ? t('admin.integrations.webhooks.detail.pingOk', { status: ping.data.status ?? '' })
                : t('admin.integrations.webhooks.detail.pingFailed', {
                    detail: ping.data.error ? webhookErrorText(tr, ping.data.error) : (ping.data.status ?? ''),
                  })}
            </p>
          )}

          <section>
            <h3 className="font-semibold">{t('admin.integrations.webhooks.detail.secrets')}</h3>
            <Table className="mt-2" scrollLabel={t('admin.integrations.webhooks.detail.secrets')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.integrations.webhooks.detail.secretPrefix')}</TableHead>
                  <TableHead>{t('admin.common.status')}</TableHead>
                  <TableHead>{t('admin.integrations.detail.expires')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('admin.common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sub.secrets.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.prefix}…</TableCell>
                    <TableCell>
                      <Badge variant={tokenBadge(s.state)}>
                        {t(
                          `admin.integrations.tokenState.${s.state === 'retiring' || s.state === 'retired' || s.state === 'expired' || s.state === 'revoked' ? s.state : 'active'}`,
                        )}
                      </Badge>
                      {s.retireAt && s.state === 'retiring' && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t('admin.integrations.detail.retireAt', { date: dates.dateTime(s.retireAt) })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{dates.date(s.expiresAt)}</TableCell>
                    <TableCell className="text-right">
                      {(s.state === 'active' || s.state === 'retiring') && (
                        <Button variant="ghost" size="sm" onClick={() => setConfirm({ secret: s })}>
                          {t('admin.integrations.webhooks.detail.revokeSecret')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 rounded-md border p-4">
              <h4 className="text-sm font-medium">{t('admin.integrations.webhooks.detail.rotateTitle')}</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('admin.integrations.webhooks.detail.rotateIntro')}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={t('admin.integrations.webhooks.form.days')}>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={view.limits.maxSecretDays}
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                  />
                </Field>
                <Field
                  label={t('admin.integrations.webhooks.detail.overlap')}
                  hint={t('admin.integrations.detail.overlapHint', { max: view.limits.maxOverlapHours })}
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={view.limits.maxOverlapHours}
                    value={overlap}
                    onChange={(e) => setOverlap(e.target.value)}
                  />
                </Field>
              </div>
              <FormError message={rotate.isError ? errorText(t, rotate.error) : null} />
              <Button
                className="mt-3"
                disabled={rotate.isPending || !daysValid || !overlapValid}
                onClick={() => rotate.mutate()}
              >
                {t('admin.integrations.webhooks.detail.rotate')}
              </Button>
            </div>
          </section>

          <Deliveries id={sub.id} />
        </div>

        <ConfirmDialog
          open={confirm === 'remove'}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t('admin.integrations.webhooks.detail.removeTitle', { name: sub.name })}
          description={t('admin.integrations.webhooks.detail.removeText')}
          confirmLabel={t('admin.integrations.webhooks.detail.remove')}
          cancelLabel={t('common.cancel')}
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
        >
          <FormError message={remove.isError ? errorText(t, remove.error) : null} />
        </ConfirmDialog>
        <ConfirmDialog
          open={typeof confirm === 'object' && confirm !== null}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t('admin.integrations.webhooks.detail.revokeSecretTitle')}
          description={t('admin.integrations.webhooks.detail.revokeSecretText')}
          confirmLabel={t('admin.integrations.webhooks.detail.revokeSecret')}
          cancelLabel={t('common.cancel')}
          destructive
          pending={revokeSecret.isPending}
          onConfirm={() => typeof confirm === 'object' && confirm !== null && revokeSecret.mutate(confirm.secret.id)}
        >
          <FormError message={revokeSecret.isError ? errorText(t, revokeSecret.error) : null} />
        </ConfirmDialog>
      </DialogContent>
    </Dialog>
  );
}
