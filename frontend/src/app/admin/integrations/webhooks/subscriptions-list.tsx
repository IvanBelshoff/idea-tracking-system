import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Section } from '../../shared';
import { hostOf, statusKey } from './helpers';
import type { WebhookSubscriptionView, WebhooksView } from './queries';

export function StatusBadge({ sub }: { sub: Pick<WebhookSubscriptionView, 'status' | 'suspendedReason'> }) {
  const { t } = useTranslation();
  const key = statusKey(sub);
  return (
    <Badge variant={key === 'active' ? 'default' : key === 'failures' ? 'destructive' : 'secondary'}>
      {t(`admin.integrations.webhooks.status.${key}`)}
    </Badge>
  );
}

/** A lista das assinaturas (RN-118): só o servidor do endereço aparece aqui; o endereço inteiro, só no detalhe. */
export function SubscriptionsList({
  view,
  onOpen,
  onCreate,
}: {
  view: WebhooksView;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const canCreate = view.integrationEnabled && view.integrations.length > 0;
  return (
    <Section title={t('admin.integrations.webhooks.list.title')} intro={t('admin.integrations.webhooks.list.intro')}>
      <div className="space-y-4">
        <Button onClick={onCreate} disabled={!canCreate}>
          {t('admin.integrations.webhooks.list.create')}
        </Button>
        {!canCreate && (
          <p className="text-sm text-muted-foreground">{t('admin.integrations.webhooks.list.needsIntegration')}</p>
        )}
        {view.subscriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.integrations.webhooks.list.empty')}</p>
        ) : (
          <Table scrollLabel={t('admin.integrations.webhooks.list.title')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.integrations.webhooks.list.name')}</TableHead>
                <TableHead>{t('admin.integrations.webhooks.list.integration')}</TableHead>
                <TableHead>{t('admin.integrations.webhooks.list.destination')}</TableHead>
                <TableHead className="text-right">{t('admin.integrations.webhooks.list.events')}</TableHead>
                <TableHead className="text-right">{t('admin.integrations.webhooks.list.pending')}</TableHead>
                <TableHead className="text-right">{t('admin.integrations.webhooks.list.failed')}</TableHead>
                <TableHead>{t('admin.common.status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('admin.common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.subscriptions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.integrationName}</TableCell>
                  <TableCell className="font-mono text-xs">{hostOf(s.url)}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.events.length}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.pending}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.failed}</TableCell>
                  <TableCell>
                    <StatusBadge sub={s} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => onOpen(s.id)}>
                      {t('admin.integrations.list.open')}
                      <span className="sr-only"> — {s.name}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Section>
  );
}
