import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
import { EyeButton, useReveal } from '@/components/form/sensitive';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { hasSensitive, MASK, maskAuditData } from '@/lib/sensitive';
import { FormError } from '../auth/auth-layout';
import { useDates } from '../use-dates';
import { adminKeys } from './queries';
import { AdminPage, Pagination } from './shared';

type AuditEntry = components['schemas']['AuditEntryView'];

/**
 * Os detalhes de um registro (RN-135): o IP de origem e os e-mails abrem mascarados e o valor nem
 * existe na página; o olho de cada linha os revela e, em 60 segundos, volta a ocultar.
 */
function AuditDetails({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useReveal(true, entry.id);
  const data = entry.data ?? {};
  const hasData = Object.keys(data).length > 0;
  if (!hasData && !entry.ip) return null;
  const sensitive = Boolean(entry.ip) || hasSensitive(data);
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {t('admin.audit.details')}
      </summary>
      {entry.ip && (
        <p className="mt-1 flex items-center gap-1 text-muted-foreground">
          {t('admin.audit.ip')}: <span className="font-mono">{visible ? entry.ip : MASK}</span>
        </p>
      )}
      {hasData && (
        <pre className="mt-1 max-w-[36rem] overflow-x-auto rounded-md bg-muted p-2 font-mono text-[0.7rem] whitespace-pre-wrap">
          {JSON.stringify(visible ? data : maskAuditData(data), null, 2)}
        </pre>
      )}
      {sensitive && (
        <EyeButton
          visible={visible}
          onToggle={() => setVisible((v) => !v)}
          field={t('admin.audit.sensitiveField')}
          className="mt-1 size-6"
        />
      )}
    </details>
  );
}

const PAGE_SIZE = 25;

export function AuditPage() {
  const { t } = useTranslation();
  const dates = useDates();
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const query = {
    action: action || undefined,
    from: dates.dayStartIso(from),
    to: dates.dayStartIso(to, 1),
    page,
    pageSize: PAGE_SIZE,
  };

  const actions = useQuery({ queryKey: adminKeys.auditActions, queryFn: () => unwrap(api.GET('/api/audit/actions')) });
  const audit = useQuery({
    queryKey: adminKeys.audit(query),
    queryFn: () => unwrap(api.GET('/api/audit', { params: { query } })),
    placeholderData: keepPreviousData,
  });
  const actionLabel = (code: string) => {
    const text = t(`auditActions.${code}` as never) as string;
    return text === `auditActions.${code}` ? code : text;
  };
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <AdminPage title={t('admin.audit.pageTitle')} intro={t('admin.audit.intro')} help="adminAudit">
      <div className="mb-4 grid items-end gap-3 sm:grid-cols-[1fr_10rem_10rem_auto]">
        <Field label={t('admin.audit.action')}>
          <NativeSelect value={action} onChange={(e) => reset(() => setAction(e.target.value))}>
            <option value="">{t('admin.audit.allActions')}</option>
            {actions.data?.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('admin.audit.from')}>
          <Input type="date" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
        </Field>
        <Field label={t('admin.audit.to')}>
          <Input type="date" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
        </Field>
        <Button
          variant="ghost"
          disabled={!action && !from && !to}
          onClick={() =>
            reset(() => {
              setAction('');
              setFrom('');
              setTo('');
            })
          }
        >
          {t('admin.audit.clear')}
        </Button>
      </div>

      {audit.isError && <FormError message={errorText(t, audit.error)} />}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">{t('admin.audit.columns.when')}</TableHead>
              <TableHead>{t('admin.audit.columns.action')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('admin.audit.columns.who')}</TableHead>
              <TableHead className="hidden lg:table-cell">{t('admin.audit.columns.target')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.data?.items.map((a) => {
              return (
                <TableRow key={a.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {dates.dateTime(a.at)}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{actionLabel(a.action)}</span>
                    <span className="block font-mono text-[0.7rem] text-muted-foreground">{a.action}</span>
                    <span className="block text-xs text-muted-foreground md:hidden">
                      {a.actor?.name ?? t('admin.audit.system')}
                    </span>
                    <AuditDetails entry={a} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{a.actor?.name ?? t('admin.audit.system')}</TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                    {a.targetType}
                    {a.targetId ? ` · ${a.targetId}` : ''}
                  </TableCell>
                </TableRow>
              );
            })}
            {audit.data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {t('admin.common.empty')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {audit.data && <Pagination page={page} pageSize={PAGE_SIZE} total={audit.data.meta.total} onPage={setPage} />}
    </AdminPage>
  );
}
