import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormError } from '../../auth/auth-layout';
import { useDates } from '../../use-dates';
import {
  type IntegrationsView,
  type IntegrationTokenView,
  type IntegrationView,
  integrationKeys,
  useIntegrationUsage,
} from './queries';

/** Cor do estado do token: valendo, aposentando, e o que já não vale. */
export function tokenBadge(state: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (state === 'active') return 'default';
  if (state === 'retiring') return 'secondary';
  if (state === 'expired' || state === 'revoked') return 'destructive';
  return 'outline';
}

function Usage({ id }: { id: string }) {
  const { t } = useTranslation();
  const usage = useIntegrationUsage(id);
  return (
    <section>
      <h3 className="font-semibold">{t('admin.integrations.detail.usage')}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t('admin.integrations.detail.usageIntro')}</p>
      {usage.isError && <FormError message={errorText(t, usage.error)} />}
      {usage.data && usage.data.byModule.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">{t('admin.integrations.detail.usageEmpty')}</p>
      )}
      {usage.data && usage.data.byModule.length > 0 && (
        <Table className="mt-2" scrollLabel={t('admin.integrations.detail.usage')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.integrations.detail.module')}</TableHead>
              <TableHead className="text-right">{t('admin.integrations.detail.requests')}</TableHead>
              <TableHead className="text-right">{t('admin.integrations.detail.errors4xx')}</TableHead>
              <TableHead className="text-right">{t('admin.integrations.detail.errors5xx')}</TableHead>
              <TableHead className="text-right">{t('admin.integrations.detail.rateLimited')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.data.byModule.map((m) => (
              <TableRow key={m.module}>
                <TableCell>{t(`admin.integrations.modules.names.${m.module}` as never)}</TableCell>
                <TableCell className="text-right tabular-nums">{m.requests}</TableCell>
                <TableCell className="text-right tabular-nums">{m.errors4xx}</TableCell>
                <TableCell className="text-right tabular-nums">{m.errors5xx}</TableCell>
                <TableCell className="text-right tabular-nums">{m.rateLimited}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** Uma integração em detalhe (RN-115): dados, tokens (girar e revogar), consumo e as ações de estado. */
export function IntegrationDetail({
  view,
  id,
  onClose,
  onEdit,
  onToken,
}: {
  view: IntegrationsView;
  id: string;
  onClose: () => void;
  onEdit: (integration: IntegrationView) => void;
  /** O token novo da rotação: aparece uma única vez. */
  onToken: (token: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const integration = view.integrations.find((i) => i.id === id);
  const [confirm, setConfirm] = useState<'revoke' | { token: IntegrationTokenView } | null>(null);
  const [days, setDays] = useState(String(view.limits.suggestedTokenDays));
  const [overlap, setOverlap] = useState(String(view.limits.defaultOverlapHours));

  const refresh = (data: unknown) => {
    void qc.invalidateQueries({ queryKey: integrationKeys.view });
    return data;
  };
  const state = useMutation({
    meta: { success: (_d, action: 'suspend' | 'reactivate' | 'revoke') => t(`feedback.integrations.${action}`) },
    mutationFn: (action: 'suspend' | 'reactivate' | 'revoke') =>
      unwrap(api.POST(`/api/admin/integrations/{id}/${action}`, { params: { path: { id } } })),
    onSuccess: (data) => {
      refresh(data);
      setConfirm(null);
    },
  });
  const rotate = useMutation({
    meta: { success: t('feedback.integrations.tokenCreated') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/admin/integrations/{id}/tokens', {
          params: { path: { id } },
          body: {
            expiresAt: dates.dayStartIso(dates.dayFromToday(Number(days))) ?? '',
            overlapHours: Number(overlap),
          },
        }),
      ),
    onSuccess: (data) => {
      refresh(data);
      onToken(data.token, data.integration.name);
    },
  });
  const revokeToken = useMutation({
    meta: { success: t('feedback.integrations.tokenRevoked') },
    mutationFn: (tokenId: string) =>
      unwrap(api.POST('/api/admin/integrations/{id}/tokens/{tokenId}/revoke', { params: { path: { id, tokenId } } })),
    onSuccess: (data) => {
      refresh(data);
      setConfirm(null);
    },
  });

  if (!integration) return null;
  const revoked = integration.status === 'revoked';
  const daysValid = Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= view.limits.maxTokenDays;
  const overlapValid =
    Number.isInteger(Number(overlap)) && Number(overlap) >= 0 && Number(overlap) <= view.limits.maxOverlapHours;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {integration.name}
            <Badge variant={revoked ? 'destructive' : integration.status === 'suspended' ? 'secondary' : 'default'}>
              {t(
                `admin.integrations.status.${integration.status === 'suspended' ? 'suspended' : integration.status === 'revoked' ? 'revoked' : 'active'}`,
              )}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('admin.integrations.form.owner')}</dt>
              <dd>{integration.owner || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('admin.integrations.form.rate')}</dt>
              <dd>{integration.ratePerMinute}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('admin.integrations.form.modules')}</dt>
              <dd>
                {integration.modules.length === 0
                  ? '—'
                  : integration.modules.map((m) => t(`admin.integrations.modules.names.${m}` as never)).join(', ')}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('admin.integrations.form.ips')}</dt>
              <dd className="font-mono text-xs">
                {integration.ipAllowlist.length === 0
                  ? t('admin.integrations.detail.anyIp')
                  : integration.ipAllowlist.join(', ')}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{t('admin.integrations.form.scope')}</dt>
              <dd>
                {integration.scope.length === 0 ? (
                  <span className="text-(--st-late)">{t('admin.integrations.form.scopeEmpty')}</span>
                ) : (
                  integration.scope
                    .map(
                      (s) =>
                        `${s.entityName}${s.includeChildren ? ` (${t('admin.integrations.form.includeChildren').toLowerCase()})` : ''}`,
                    )
                    .join(', ')
                )}
              </dd>
            </div>
            {integration.includeEmail && (
              <div className="sm:col-span-2">
                <Badge variant="destructive">{t('admin.integrations.detail.emailOn')}</Badge>
              </div>
            )}
          </dl>

          {!revoked && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => onEdit(integration)}>
                {t('admin.common.edit')}
              </Button>
              {integration.status === 'active' ? (
                <Button variant="outline" disabled={state.isPending} onClick={() => state.mutate('suspend')}>
                  {t('admin.integrations.detail.suspend')}
                </Button>
              ) : (
                <Button variant="outline" disabled={state.isPending} onClick={() => state.mutate('reactivate')}>
                  {t('admin.integrations.detail.reactivate')}
                </Button>
              )}
              <Button variant="destructive" onClick={() => setConfirm('revoke')}>
                {t('admin.integrations.detail.revoke')}
              </Button>
            </div>
          )}
          <FormError message={state.isError ? errorText(t, state.error) : null} />

          <section>
            <h3 className="font-semibold">{t('admin.integrations.detail.tokens')}</h3>
            <Table className="mt-2" scrollLabel={t('admin.integrations.detail.tokens')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.integrations.detail.prefix')}</TableHead>
                  <TableHead>{t('admin.common.status')}</TableHead>
                  <TableHead>{t('admin.integrations.detail.expires')}</TableHead>
                  <TableHead>{t('admin.integrations.list.lastCall')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('admin.common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {integration.tokens.map((tk) => (
                  <TableRow key={tk.id}>
                    <TableCell className="font-mono text-xs">{tk.prefix}…</TableCell>
                    <TableCell>
                      <Badge variant={tokenBadge(tk.state)}>
                        {t(
                          `admin.integrations.tokenState.${tk.state === 'retiring' || tk.state === 'retired' || tk.state === 'expired' || tk.state === 'revoked' ? tk.state : 'active'}`,
                        )}
                      </Badge>
                      {tk.retireAt && tk.state === 'retiring' && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t('admin.integrations.detail.retireAt', { date: dates.dateTime(tk.retireAt) })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{dates.date(tk.expiresAt)}</TableCell>
                    <TableCell>
                      {tk.lastUsedAt ? dates.relative(tk.lastUsedAt) : t('admin.integrations.list.never')}
                    </TableCell>
                    <TableCell className="text-right">
                      {!revoked && (tk.state === 'active' || tk.state === 'retiring') && (
                        <Button variant="ghost" size="sm" onClick={() => setConfirm({ token: tk })}>
                          {t('admin.integrations.detail.revokeToken')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!revoked && (
              <div className="mt-4 rounded-md border p-4">
                <h4 className="text-sm font-medium">{t('admin.integrations.detail.rotateTitle')}</h4>
                <p className="mt-1 text-xs text-muted-foreground">{t('admin.integrations.detail.rotateIntro')}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label={t('admin.integrations.form.tokenDays')}>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={view.limits.maxTokenDays}
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                    />
                  </Field>
                  <Field
                    label={t('admin.integrations.detail.overlap')}
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
                  {t('admin.integrations.detail.rotate')}
                </Button>
              </div>
            )}
          </section>

          <Usage id={integration.id} />
        </div>

        <ConfirmDialog
          open={confirm === 'revoke'}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t('admin.integrations.detail.revokeTitle', { name: integration.name })}
          description={t('admin.integrations.detail.revokeText')}
          confirmLabel={t('admin.integrations.detail.revokeConfirm')}
          cancelLabel={t('common.cancel')}
          destructive
          pending={state.isPending}
          onConfirm={() => state.mutate('revoke')}
        />
        <ConfirmDialog
          open={typeof confirm === 'object' && confirm !== null}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t('admin.integrations.detail.revokeTokenTitle')}
          description={t('admin.integrations.detail.revokeTokenText')}
          confirmLabel={t('admin.integrations.detail.revokeToken')}
          cancelLabel={t('common.cancel')}
          destructive
          pending={revokeToken.isPending}
          onConfirm={() => typeof confirm === 'object' && confirm !== null && revokeToken.mutate(confirm.token.id)}
        >
          <FormError message={revokeToken.isError ? errorText(t, revokeToken.error) : null} />
        </ConfirmDialog>
      </DialogContent>
    </Dialog>
  );
}
