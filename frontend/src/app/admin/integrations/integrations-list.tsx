import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDates } from '../../use-dates';
import { Section } from '../shared';
import { type IntegrationsView, type IntegrationView, WRITE_MODULE_IDS } from './queries';

/** O vencimento do token de maior validade, com a mesma régua da saúde (RN-113): atenção e falha com texto, não só cor. */
function Expiry({ integration }: { integration: IntegrationView }) {
  const { t } = useTranslation();
  const e = integration.expiry;
  if (integration.status === 'revoked') return <span className="text-muted-foreground">—</span>;
  if (!e || e.days === null)
    return <span className="text-muted-foreground">{t('admin.integrations.list.noToken')}</span>;
  const text =
    e.code === 'expired'
      ? t('admin.integrations.list.expired', { count: Math.abs(e.days) })
      : t('admin.integrations.list.expiresIn', { count: e.days });
  const style = e.state === 'failed' ? 'text-(--st-rejected)' : e.state === 'warning' ? 'text-(--st-late)' : '';
  return <span className={style}>{text}</span>;
}

/** A lista das integrações (RN-115): estado, módulos, escopo, vencimento do token e a última chamada. */
export function IntegrationsList({
  view,
  onOpen,
  onCreate,
}: {
  view: IntegrationsView;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  return (
    <Section title={t('admin.integrations.list.title')} intro={t('admin.integrations.list.intro')}>
      <div className="space-y-4">
        <Button onClick={onCreate} disabled={!view.enabled}>
          {t('admin.integrations.list.create')}
        </Button>
        {!view.enabled && <p className="text-sm text-muted-foreground">{t('admin.integrations.list.needsKey')}</p>}
        {view.integrations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.integrations.list.empty')}</p>
        ) : (
          <Table scrollLabel={t('admin.integrations.list.title')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.integrations.list.name')}</TableHead>
                <TableHead>{t('admin.integrations.list.modules')}</TableHead>
                <TableHead>{t('admin.integrations.list.scope')}</TableHead>
                <TableHead>{t('admin.integrations.list.token')}</TableHead>
                <TableHead>{t('admin.integrations.list.lastCall')}</TableHead>
                <TableHead>{t('admin.common.status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('admin.common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.integrations.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.name}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {i.modules.length === 0 && <span className="text-muted-foreground">—</span>}
                      {i.modules.map((m) => (
                        <Badge
                          key={m}
                          variant={
                            m === 'users' ? 'destructive' : WRITE_MODULE_IDS.includes(m) ? 'secondary' : 'outline'
                          }
                        >
                          {t(`admin.integrations.modules.names.${m}` as never)}
                        </Badge>
                      ))}
                      {i.includeEmail && <Badge variant="destructive">{t('admin.integrations.list.email')}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell>
                    {i.scope.length === 0 ? (
                      <span className="text-(--st-late)">{t('admin.integrations.list.scopeNone')}</span>
                    ) : (
                      i.scope.map((s) => s.entityName).join(', ')
                    )}
                  </TableCell>
                  <TableCell>
                    <Expiry integration={i} />
                  </TableCell>
                  <TableCell>
                    {i.lastUsedAt ? dates.relative(i.lastUsedAt) : t('admin.integrations.list.never')}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        i.status === 'revoked' ? 'destructive' : i.status === 'suspended' ? 'secondary' : 'default'
                      }
                    >
                      {t(
                        `admin.integrations.status.${i.status === 'suspended' ? 'suspended' : i.status === 'revoked' ? 'revoked' : 'active'}`,
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => onOpen(i.id)}>
                      {t('admin.integrations.list.open')}
                      <span className="sr-only"> — {i.name}</span>
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
