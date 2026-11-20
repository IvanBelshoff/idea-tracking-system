import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Paperclip, Plus, Trash2, TriangleAlert, UserRound, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import { Field } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AREA_MAX,
  COMMENT_MAX,
  DAYS_MAX,
  DAYS_MIN,
  decisionReady,
  type Hold,
  isOutsideDomain,
  MAX_ATTACHMENTS,
  MAX_EVIDENCE,
  MAX_RECIPIENTS,
  NAME_MAX,
  REASON_MAX,
  type RecipientRow,
  recipientProblems,
  recipientsBody,
  SUMMARY_MAX,
} from '@/lib/approvals';
import { FormError } from '../auth/auth-layout';
import { ideaAttachmentsKey } from '../ideas/idea-attachments';
import { PersonPicker } from '../ideas/person-picker';
import { ideaKeys } from '../ideas/queries';
import { usePublicSettings } from '../session';
import { useDates } from '../use-dates';
import { type ApprovalRecipient, type ApprovalsView, approvalKeys, recordDecision } from './queries';

type FormInfo = NonNullable<ApprovalsView['form']>;

function useRefresh(code: string) {
  const qc = useQueryClient();
  return (data?: ApprovalsView) => {
    if (data) qc.setQueryData(approvalKeys.idea(code), data);
    else void qc.invalidateQueries({ queryKey: approvalKeys.idea(code) });
    void qc.invalidateQueries({ queryKey: ideaKeys.timeline(code) });
    void qc.invalidateQueries({ queryKey: ideaAttachmentsKey(code) });
  };
}

type Row = RecipientRow & { key: number };

/** Pedir a aprovação (RN-183): aprovadores, resumo, o que mostrar, o que segura e o prazo. */
export function RequestDialog({
  code,
  holds,
  form,
  onClose,
}: {
  code: string;
  holds: Hold[];
  form: FormInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const refresh = useRefresh(code);
  const holdGroup = useId();
  const nextKey = useRef(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState('');
  const [hold, setHold] = useState<Hold>(holds[0] ?? 'implement');
  const [days, setDays] = useState(String(form.defaultDays));
  const [showGain, setShowGain] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const attachments = useQuery({
    queryKey: ideaAttachmentsKey(code),
    queryFn: () => unwrap(api.GET('/api/ideas/{ref}/attachments', { params: { path: { ref: code } } })),
  });
  const send = useMutation({
    meta: { success: t('approvals.feedback.requested') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/{ref}/approvals', {
          params: { path: { ref: code } },
          body: {
            holds: hold,
            summary: summary.trim(),
            days: Number(days),
            showGain,
            attachmentIds: chosen,
            recipients: recipientsBody(rows),
          },
        }),
      ),
    onSuccess: (data) => {
      refresh(data);
      onClose();
    },
  });
  const server = fieldErrors(send.error);
  const problems = recipientProblems(rows, form.emailDomains, form.allowOutsideDomains);
  const daysNumber = Number(days);
  const daysOk = Number.isInteger(daysNumber) && daysNumber >= DAYS_MIN && daysNumber <= DAYS_MAX;
  const summaryOk = summary.trim().length > 0 && summary.length <= SUMMARY_MAX;
  const valid = rows.length > 0 && problems.size === 0 && daysOk && summaryOk;
  const add = (kind: 'user' | 'external') => {
    const key = nextKey.current++;
    setRows((r) => [
      ...r,
      kind === 'user' ? { key, kind, userId: '', area: '' } : { key, kind, name: '', email: '', area: '' },
    ]);
  };
  const update = (key: number, patch: Partial<RecipientRow>) =>
    setRows((r) => r.map((row) => (row.key === key ? ({ ...row, ...patch } as Row) : row)));
  const rowError = (index: number, field: string) => {
    const list = problems.get(index) ?? [];
    const own = list.find((p) => p === field || (field === 'email' && (p === 'outside' || p === 'duplicate')));
    if (tried && own) return t(`approvals.form.problems.${own}` as never) as string;
    if (field === 'user' && tried && list.includes('duplicate')) return t('approvals.form.problems.duplicate');
    return server[`recipients.${index}.${field}`] ?? undefined;
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('approvals.form.title')}</DialogTitle>
          <DialogDescription>{t('approvals.form.intro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (valid) send.mutate();
          }}
          className="grid gap-5"
        >
          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium">{t('approvals.form.recipients')}</legend>
            <p className="-mt-1 text-xs text-muted-foreground">{t('approvals.form.recipientsHint')}</p>
            {!form.emailActive && (
              <p className="flex items-start gap-2 rounded-md border border-(--st-late)/40 bg-(--st-late)/5 px-3 py-2 text-sm">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-late)" />
                {t('approvals.card.emailOff')}
              </p>
            )}
            {rows.map((row, index) => (
              <div key={row.key} className="grid gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <UserRound aria-hidden="true" className="size-4 text-muted-foreground" />
                    {t('approvals.form.row', { n: index + 1 })}
                    <span className="font-normal text-muted-foreground">· {t(`approvals.card.kind.${row.kind}`)}</span>
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('approvals.form.remove', { n: index + 1 })}
                    onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                {row.kind === 'user' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <PersonPicker
                      label={t('approvals.form.person')}
                      searchLabel={t('approvals.form.personSearch')}
                      value={row.userId}
                      onChange={(id) => update(row.key, { userId: id })}
                      error={rowError(index, 'user')}
                    />
                    <Field label={t('approvals.form.areaOptional')} error={rowError(index, 'area')}>
                      <Input
                        value={row.area}
                        maxLength={AREA_MAX}
                        placeholder={t('approvals.form.areaPlaceholder')}
                        onChange={(e) => update(row.key, { area: e.target.value })}
                      />
                    </Field>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label={t('approvals.form.name')} error={rowError(index, 'name')}>
                      <Input
                        value={row.name}
                        maxLength={NAME_MAX}
                        autoComplete="off"
                        onChange={(e) => update(row.key, { name: e.target.value })}
                      />
                    </Field>
                    <Field
                      label={t('approvals.form.email')}
                      error={rowError(index, 'email')}
                      hint={
                        form.allowOutsideDomains && isOutsideDomain(row.email, form.emailDomains)
                          ? t('approvals.form.outsideWarning')
                          : undefined
                      }
                    >
                      <Input
                        type="email"
                        value={row.email}
                        autoComplete="off"
                        onChange={(e) => update(row.key, { email: e.target.value })}
                      />
                    </Field>
                    <Field label={t('approvals.form.area')} error={rowError(index, 'area')}>
                      <Input
                        value={row.area}
                        maxLength={AREA_MAX}
                        placeholder={t('approvals.form.areaPlaceholder')}
                        onChange={(e) => update(row.key, { area: e.target.value })}
                      />
                    </Field>
                  </div>
                )}
                {server[`recipients.${index}`] && (
                  <p className="text-xs font-medium text-destructive">{server[`recipients.${index}`]}</p>
                )}
              </div>
            ))}
            {tried && rows.length === 0 && (
              <p className="text-xs font-medium text-destructive">{t('approvals.form.problems.user')}</p>
            )}
            {rows.length < MAX_RECIPIENTS && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => add('user')}>
                  <Plus aria-hidden="true" />
                  {t('approvals.form.addUser')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => add('external')}>
                  <Plus aria-hidden="true" />
                  {t('approvals.form.addExternal')}
                </Button>
              </div>
            )}
          </fieldset>

          <Field
            label={t('approvals.form.summary')}
            hint={`${t('approvals.form.summaryHint')} ${t('richText.counter', { count: summary.length, max: SUMMARY_MAX })}`}
            error={tried && !summaryOk ? t('validation.required') : server.summary}
          >
            <Textarea rows={5} maxLength={SUMMARY_MAX} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('approvals.form.holds')}</legend>
            {holds.map((h) => (
              <label key={h} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <input
                  type="radio"
                  name={holdGroup}
                  checked={hold === h}
                  onChange={() => setHold(h)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">
                    {h === 'approve' ? t('approvals.form.holdApprove') : t('approvals.form.holdImplement')}
                  </span>
                  <span className="block text-muted-foreground">
                    {h === 'approve' ? t('approvals.form.holdApproveHint') : t('approvals.form.holdImplementHint')}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <Field
            label={t('approvals.form.days')}
            hint={t('approvals.form.daysHint')}
            error={tried && !daysOk ? t('approvals.form.daysHint') : server.days}
            className="max-w-[12rem]"
          >
            <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
          </Field>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('approvals.form.show')}</legend>
            <div className="flex items-center gap-2 text-sm">
              <Checkbox id={`${holdGroup}-gain`} checked={showGain} onCheckedChange={(v) => setShowGain(v === true)} />
              <label htmlFor={`${holdGroup}-gain`}>{t('approvals.form.showGain')}</label>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t('approvals.form.attachments')}</p>
            {attachments.data?.items.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('approvals.form.noAttachments')}</p>
            )}
            {attachments.data?.items.map((a) => {
              const checked = chosen.includes(a.id);
              return (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`${holdGroup}-${a.id}`}
                    checked={checked}
                    disabled={!checked && chosen.length >= MAX_ATTACHMENTS}
                    onCheckedChange={(v) =>
                      setChosen((c) => (v === true ? [...c, a.id] : c.filter((id) => id !== a.id)))
                    }
                  />
                  <Paperclip aria-hidden="true" className="size-4 text-muted-foreground" />
                  <label htmlFor={`${holdGroup}-${a.id}`} className="min-w-0 truncate">
                    {a.originalName}
                  </label>
                </div>
              );
            })}
            {server.attachmentIds && <p className="text-xs font-medium text-destructive">{server.attachmentIds}</p>}
          </fieldset>

          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? t('approvals.form.sending') : t('approvals.form.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Registrar a decisão de um aprovador (RN-187), com pelo menos um arquivo de evidência. */
export function RecordDialog({
  code,
  requestId,
  recipient,
  onClose,
}: {
  code: string;
  requestId: string;
  recipient: ApprovalRecipient;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const refresh = useRefresh(code);
  const { data: settings } = usePublicSettings();
  const group = useId();
  const input = useRef<HTMLInputElement>(null);
  const today = dates.dayFromToday(0);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  const [name, setName] = useState(recipient.name);
  const [on, setOn] = useState(today);
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const accept = settings?.attachments.allowedExtensions.map((e) => `.${e}`).join(',');
  const send = useMutation({
    meta: { success: t('approvals.feedback.recorded') },
    mutationFn: () =>
      recordDecision(
        code,
        requestId,
        recipient.id,
        { decision: decision ?? 'approved', decidedName: name.trim(), decidedOn: on, comment: comment.trim() },
        files,
      ),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const ready =
    decisionReady(decision, comment) &&
    name.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(on) &&
    on <= today &&
    files.length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('approvals.card.recordFor', { name: recipient.name })}</DialogTitle>
          <DialogDescription>{t('approvals.record.hint')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) send.mutate();
          }}
          className="grid gap-4"
        >
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('approvals.decide.legend')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['approved', 'rejected'] as const).map((value) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50 ${decision === value ? 'border-primary bg-primary/5' : ''}`}
                >
                  <input
                    type="radio"
                    name={group}
                    checked={decision === value}
                    onChange={() => setDecision(value)}
                    className="size-4 accent-primary"
                  />
                  {value === 'approved' ? (
                    <CircleCheck aria-hidden="true" className="size-4 text-(--st-done)" />
                  ) : (
                    <CircleX aria-hidden="true" className="size-4 text-(--st-rejected)" />
                  )}
                  {t(`approvals.card.decision.${value}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('approvals.record.decidedName')}>
              <Input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('approvals.record.decidedOn')}>
              <Input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} />
            </Field>
          </div>
          <Field
            label={decision === 'rejected' ? t('approvals.decide.commentRequired') : t('approvals.decide.comment')}
          >
            <Textarea rows={3} maxLength={COMMENT_MAX} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="grid gap-2">
            <p className="text-sm font-medium">{t('approvals.record.evidence')}</p>
            <input
              ref={input}
              type="file"
              multiple
              accept={accept}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setFiles((f) => [...f, ...picked].slice(0, MAX_EVIDENCE));
                e.target.value = '';
              }}
            />
            {files.length > 0 && (
              <ul className="grid gap-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${f.size}-${f.lastModified}`} className="flex items-center gap-2 text-sm">
                    <Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('approvals.record.removeFile', { name: f.name })}
                      onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {files.length < MAX_EVIDENCE && (
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
                  <Paperclip aria-hidden="true" />
                  {t('approvals.record.chooseFiles')}
                </Button>
              </div>
            )}
          </div>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending || !ready}>
              {t('approvals.record.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Cancelar o pedido ou seguir sem a aprovação: as duas pedem um motivo (RN-183, RN-188). */
export function ApprovalReasonDialog({
  code,
  requestId,
  kind,
  onClose,
}: {
  code: string;
  requestId: string;
  kind: 'cancel' | 'override';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const refresh = useRefresh(code);
  const [reason, setReason] = useState('');
  const send = useMutation({
    meta: { success: kind === 'cancel' ? t('approvals.feedback.cancelled') : t('approvals.feedback.overridden') },
    mutationFn: () =>
      unwrap(
        kind === 'cancel'
          ? api.POST('/api/ideas/{ref}/approvals/{requestId}/cancel', {
              params: { path: { ref: code, requestId } },
              body: { reason: reason.trim() },
            })
          : api.POST('/api/ideas/{ref}/approvals/{requestId}/override', {
              params: { path: { ref: code, requestId } },
              body: { reason: reason.trim() },
            }),
      ),
    onSuccess: (data) => {
      refresh(data);
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t(`approvals.${kind}.title`)}</DialogTitle>
          <DialogDescription>{t(`approvals.${kind}.hint`)}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) send.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t(`approvals.${kind}.reason`)}>
            <Textarea rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.back')}
            </Button>
            <Button
              type="submit"
              variant={kind === 'cancel' ? 'destructive' : 'default'}
              disabled={send.isPending || !reason.trim()}
            >
              {t(`approvals.${kind}.confirm`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
