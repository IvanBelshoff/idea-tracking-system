import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, ListChecks, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ConfirmDialog,
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
  type FieldKind,
  HINT_MAX,
  LABEL_MAX,
  MAX_ACTIVE_FIELDS,
  type MaskPreset,
  OPEN_KINDS,
  OPTION_MAX,
  OPTIONS_MAX,
  patternExample,
  patternValid,
} from '@/lib/user-fields';
import { AdminPage, Section } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { type UserField, userFieldKeys, useUserFields } from './queries';
import { SortableList } from './sortable';

type Flag = 'required' | 'searchable' | 'sensitive' | 'adminLocked' | 'integration' | 'uniqueValues';
const FLAGS: Flag[] = ['required', 'searchable', 'sensitive', 'adminLocked', 'integration', 'uniqueValues'];
const PRESETS: MaskPreset[] = ['cpf', 'phone', 'custom'];
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: userFieldKeys.all });
  };
}

/** Criar ou editar um campo (RN-193 a RN-195). */
function FieldDialog({ field, onClose }: { field: UserField | null; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefresh();
  const id = useId();
  const [labelPt, setLabelPt] = useState(field?.labelPt ?? '');
  const [labelEn, setLabelEn] = useState(field?.labelEn ?? '');
  const [hintPt, setHintPt] = useState(field?.hintPt ?? '');
  const [hintEn, setHintEn] = useState(field?.hintEn ?? '');
  const [kind, setKind] = useState<FieldKind>(field?.kind ?? 'text');
  const [min, setMin] = useState(field?.config.min?.toString() ?? '');
  const [max, setMax] = useState(field?.config.max?.toString() ?? '');
  const [integer, setInteger] = useState(field?.config.integer ?? false);
  const [preset, setPreset] = useState<MaskPreset>(field?.config.preset ?? 'custom');
  const [pattern, setPattern] = useState(field?.config.pattern ?? '');
  const [options, setOptions] = useState('');
  const [flags, setFlags] = useState<Record<Flag, boolean | undefined>>(
    () => Object.fromEntries(FLAGS.map((f) => [f, field ? field[f] : undefined])) as Record<Flag, boolean | undefined>,
  );
  const open = OPEN_KINDS.includes(kind);
  const optionList = options
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean);
  const save = useMutation({
    meta: { success: field ? t('userFields.feedback.updated') : t('userFields.feedback.created') },
    mutationFn: () => {
      const config =
        kind === 'text'
          ? { min: num(min), max: num(max) }
          : kind === 'number'
            ? { min: num(min), max: num(max), integer }
            : kind === 'mask'
              ? { preset, pattern: preset === 'custom' ? pattern.trim() : null }
              : {};
      const chosenFlags = Object.fromEntries(
        FLAGS.filter((f) => flags[f] !== undefined).map((f) => [f, flags[f] as boolean]),
      ) as Partial<Record<Flag, boolean>>;
      if (!open) delete chosenFlags.uniqueValues;
      if (chosenFlags.sensitive) chosenFlags.integration = false;
      const body = {
        labelPt: labelPt.trim(),
        labelEn: labelEn.trim() || null,
        hintPt: hintPt.trim() || null,
        hintEn: hintEn.trim() || null,
        config,
        ...chosenFlags,
      };
      return field
        ? unwrap(api.PATCH('/api/user-fields/{id}', { params: { path: { id: field.id } }, body: { ...body, kind } }))
        : unwrap(
            api.POST('/api/user-fields', {
              body: { ...body, kind, ...(kind === 'choice' ? { options: optionList } : {}) },
            }),
          );
    },
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const server = fieldErrors(save.error);
  const patternBad = kind === 'mask' && preset === 'custom' && pattern.trim() !== '' && !patternValid(pattern.trim());
  const valid =
    labelPt.trim().length > 0 &&
    !(kind === 'mask' && preset === 'custom' && !patternValid(pattern.trim())) &&
    !(kind === 'choice' && !field && (optionList.length === 0 || optionList.length > OPTIONS_MAX));
  const flagOn = (f: Flag) =>
    flags[f] ?? (f === 'searchable' ? !flags.sensitive && (kind === 'text' || kind === 'mask') : false);
  const kindLocked = !!field && (field.inUse || field.kind === 'choice');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{field ? t('userFields.dialog.editTitle') : t('userFields.dialog.createTitle')}</DialogTitle>
          <DialogDescription>{t('userFields.admin.lgpd')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
          className="grid gap-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('userFields.dialog.labelPt')} error={server.labelPt}>
              <Input value={labelPt} maxLength={LABEL_MAX} onChange={(e) => setLabelPt(e.target.value)} autoFocus />
            </Field>
            <Field
              label={t('userFields.dialog.labelEn')}
              hint={t('userFields.dialog.labelEnHint')}
              error={server.labelEn}
            >
              <Input value={labelEn} maxLength={LABEL_MAX} onChange={(e) => setLabelEn(e.target.value)} />
            </Field>
            <Field label={t('userFields.dialog.hintPt')} error={server.hintPt}>
              <Input value={hintPt} maxLength={HINT_MAX} onChange={(e) => setHintPt(e.target.value)} />
            </Field>
            <Field label={t('userFields.dialog.hintEn')} error={server.hintEn}>
              <Input value={hintEn} maxLength={HINT_MAX} onChange={(e) => setHintEn(e.target.value)} />
            </Field>
          </div>

          <Field
            label={t('userFields.dialog.kind')}
            hint={
              kindLocked ? t('userFields.dialog.kindLocked') : field ? t('userFields.dialog.kindChoiceHint') : undefined
            }
            className="max-w-sm"
          >
            <NativeSelect value={kind} disabled={kindLocked} onChange={(e) => setKind(e.target.value as FieldKind)}>
              <optgroup label={t('userFields.admin.kindGroups.open')}>
                {OPEN_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`userFields.admin.kinds.${k}`)}
                  </option>
                ))}
              </optgroup>
              {(!field || field.kind === 'choice') && (
                <optgroup label={t('userFields.admin.kindGroups.closed')}>
                  <option value="choice">{t('userFields.admin.kinds.choice')}</option>
                </optgroup>
              )}
            </NativeSelect>
          </Field>

          {(kind === 'text' || kind === 'number') && (
            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-medium">{t('userFields.dialog.limits')}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={kind === 'text' ? t('userFields.dialog.textMin') : t('userFields.dialog.numberMin')}
                  error={server['config.min']}
                >
                  <Input
                    inputMode="decimal"
                    value={min}
                    onChange={(e) => setMin(e.target.value.replace(/[^\d.,-]/g, ''))}
                  />
                </Field>
                <Field
                  label={kind === 'text' ? t('userFields.dialog.textMax') : t('userFields.dialog.numberMax')}
                  error={server['config.max']}
                >
                  <Input
                    inputMode="decimal"
                    value={max}
                    onChange={(e) => setMax(e.target.value.replace(/[^\d.,-]/g, ''))}
                  />
                </Field>
              </div>
              {kind === 'number' && (
                <div className="flex items-center gap-2 text-sm">
                  <Checkbox id={`${id}-int`} checked={integer} onCheckedChange={(v) => setInteger(v === true)} />
                  <label htmlFor={`${id}-int`}>{t('userFields.dialog.integer')}</label>
                </div>
              )}
            </fieldset>
          )}

          {kind === 'mask' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('userFields.dialog.preset')}>
                <NativeSelect value={preset} onChange={(e) => setPreset(e.target.value as MaskPreset)}>
                  {PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {t(`userFields.dialog.presets.${p}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {preset === 'custom' && (
                <Field
                  label={t('userFields.dialog.pattern')}
                  hint={
                    patternValid(pattern.trim())
                      ? `${t('userFields.dialog.patternHint')} ${t('userFields.dialog.patternExample', { example: patternExample(pattern.trim()) })}`
                      : t('userFields.dialog.patternHint')
                  }
                  error={patternBad ? t('userFields.dialog.patternInvalid') : server['config.pattern']}
                >
                  <Input
                    value={pattern}
                    maxLength={40}
                    onChange={(e) => setPattern(e.target.value)}
                    className="font-mono"
                  />
                </Field>
              )}
            </div>
          )}

          {kind === 'choice' && (
            <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {t('userFields.dialog.entityReminder')}
            </p>
          )}
          {kind === 'choice' && !field && (
            <Field
              label={t('userFields.dialog.options')}
              hint={t('userFields.dialog.optionsHint')}
              error={server.options}
            >
              <Textarea rows={5} value={options} onChange={(e) => setOptions(e.target.value)} />
            </Field>
          )}

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">{t('userFields.dialog.behavior')}</legend>
            {FLAGS.filter((f) => f !== 'uniqueValues' || open).map((f) => {
              const disabled = f === 'integration' && flagOn('sensitive');
              return (
                <div key={f} className="grid gap-0.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`${id}-${f}`}
                      checked={disabled ? false : flagOn(f)}
                      disabled={disabled}
                      onCheckedChange={(v) => setFlags((x) => ({ ...x, [f]: v === true }))}
                    />
                    <label htmlFor={`${id}-${f}`} className="font-medium">
                      {t(`userFields.admin.flags.${f}`)}
                    </label>
                  </div>
                  <p className="pl-6 text-xs text-muted-foreground">{t(`userFields.admin.flagHints.${f}`)}</p>
                </div>
              );
            })}
          </fieldset>

          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || !valid}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** As opções de um campo fechado (RN-195): adicionar, renomear, ordenar, desativar e excluir. */
function OptionsDialog({ field, onClose }: { field: UserField; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const put = (data: UserField) =>
    qc.setQueryData<UserField[]>(userFieldKeys.admin, (list) => list?.map((f) => (f.id === data.id ? data : f)));
  const path = { id: field.id };
  const add = useMutation({
    meta: { success: t('userFields.feedback.optionAdded') },
    mutationFn: () =>
      unwrap(api.POST('/api/user-fields/{id}/options', { params: { path }, body: { label: label.trim() } })),
    onSuccess: (data) => {
      put(data);
      setLabel('');
    },
  });
  const update = useMutation({
    meta: { success: t('userFields.feedback.optionSaved') },
    mutationFn: (v: { optionId: string; label?: string; active?: boolean }) =>
      unwrap(
        api.PATCH('/api/user-fields/{id}/options/{optionId}', {
          params: { path: { id: field.id, optionId: v.optionId } },
          body: { label: v.label, active: v.active },
        }),
      ),
    onSuccess: (data) => {
      put(data);
      setRenaming(null);
    },
  });
  const remove = useMutation({
    meta: { success: t('userFields.feedback.optionDeleted') },
    mutationFn: (optionId: string) =>
      unwrap(api.DELETE('/api/user-fields/{id}/options/{optionId}', { params: { path: { id: field.id, optionId } } })),
    onSuccess: put,
  });
  const order = useMutation({
    meta: { silent: true },
    mutationFn: (ids: string[]) =>
      unwrap(api.PUT('/api/user-fields/{id}/options/order', { params: { path }, body: { ids } })),
    onSuccess: put,
  });
  const current = qc.getQueryData<UserField[]>(userFieldKeys.admin)?.find((f) => f.id === field.id) ?? field;
  const error = add.error ?? update.error ?? remove.error ?? order.error;
  const busy = add.isPending || update.isPending || remove.isPending || order.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('userFields.optionsDialog.title', { name: current.labelPt })}</DialogTitle>
          <DialogDescription>{t('userFields.optionsDialog.intro')}</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border">
          <SortableList
            items={current.options}
            nameOf={(o) => o.label}
            busy={busy}
            onOrder={(ids) => order.mutate(ids)}
            render={(o) =>
              renaming?.id === o.id ? (
                <form
                  noValidate
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (renaming.label.trim()) update.mutate({ optionId: o.id, label: renaming.label.trim() });
                  }}
                >
                  <Field
                    label={t('userFields.optionsDialog.renameLabel', { name: o.label })}
                    className="min-w-0 flex-1"
                  >
                    <Input
                      value={renaming.label}
                      maxLength={OPTION_MAX}
                      autoFocus
                      onChange={(e) => setRenaming({ id: o.id, label: e.target.value })}
                    />
                  </Field>
                  <Button type="submit" size="sm" disabled={busy}>
                    {t('common.save')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                    {t('common.cancel')}
                  </Button>
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={o.active ? 'font-medium' : 'text-muted-foreground line-through'}>{o.label}</span>
                    {!o.active && <Badge variant="outline">{t('userFields.optionsDialog.inactive')}</Badge>}
                    {o.inUse && <Badge variant="secondary">{t('userFields.optionsDialog.inUse')}</Badge>}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('userFields.optionsDialog.rename', { name: o.label })}
                      onClick={() => setRenaming({ id: o.id, label: o.label })}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => update.mutate({ optionId: o.id, active: !o.active })}
                    >
                      {o.active ? t('userFields.optionsDialog.deactivate') : t('userFields.optionsDialog.activate')}
                    </Button>
                    {!o.inUse && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={`${t('userFields.optionsDialog.delete')}: ${o.label}`}
                        onClick={() => remove.mutate(o.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </span>
                </div>
              )
            }
          />
        </div>
        <form
          noValidate
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) add.mutate();
          }}
        >
          <Field label={t('userFields.optionsDialog.newLabel')} className="min-w-0 flex-1">
            <Input value={label} maxLength={OPTION_MAX} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy || !label.trim() || current.options.length >= OPTIONS_MAX}>
            <Plus aria-hidden="true" />
            {t('userFields.optionsDialog.add')}
          </Button>
        </form>
        <FormError message={error ? errorText(t, error) : null} />
      </DialogContent>
    </Dialog>
  );
}

/** Campos do usuário (M25, RN-193): a administração dos campos personalizados. */
export function UserFieldsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const refresh = useRefresh();
  const list = useUserFields();
  const [editing, setEditing] = useState<UserField | 'new' | null>(null);
  const [options, setOptions] = useState<UserField | null>(null);
  const [deleting, setDeleting] = useState<UserField | null>(null);
  const fields = list.data ?? [];
  const activeCount = fields.filter((f) => f.active).length;

  const toggle = useMutation({
    meta: {
      success: (_d, f: UserField) =>
        f.active ? t('userFields.feedback.deactivated') : t('userFields.feedback.activated'),
    },
    mutationFn: (f: UserField) =>
      unwrap(api.PATCH('/api/user-fields/{id}', { params: { path: { id: f.id } }, body: { active: !f.active } })),
    onSuccess: refresh,
  });
  const remove = useMutation({
    meta: { success: t('userFields.feedback.deleted') },
    mutationFn: (f: UserField) => unwrap(api.DELETE('/api/user-fields/{id}', { params: { path: { id: f.id } } })),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });
  const order = useMutation({
    meta: { silent: true },
    mutationFn: (ids: string[]) => unwrap(api.PUT('/api/user-fields/order', { body: { ids } })),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: userFieldKeys.admin });
      const previous = qc.getQueryData<UserField[]>(userFieldKeys.admin);
      const byId = new Map((previous ?? []).map((f) => [f.id, f]));
      qc.setQueryData(
        userFieldKeys.admin,
        ids.map((id) => byId.get(id)).filter((f): f is UserField => f !== undefined),
      );
      return { previous };
    },
    onError: (_e, _ids, context) => {
      if (context?.previous) qc.setQueryData(userFieldKeys.admin, context.previous);
    },
    onSettled: refresh,
  });
  const error = list.error ?? toggle.error ?? order.error;
  const nameOf = (f: UserField) => (i18n.language.startsWith('en') && f.labelEn ? f.labelEn : f.labelPt);

  return (
    <AdminPage
      title={t('userFields.admin.title')}
      intro={t('userFields.admin.intro')}
      help="adminUserFields"
      actions={
        <Button onClick={() => setEditing('new')} disabled={activeCount >= MAX_ACTIVE_FIELDS}>
          <Plus aria-hidden="true" />
          {t('userFields.admin.new')}
        </Button>
      }
    >
      <div className="grid gap-4">
        <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {t('userFields.admin.lgpd')}
        </p>
        {error && <FormError message={errorText(t, error)} />}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{t('userFields.admin.orderIntro')}</span>
          <span>{t('userFields.admin.count', { count: activeCount })}</span>
        </div>
        {activeCount >= MAX_ACTIVE_FIELDS && <p className="text-sm">{t('userFields.admin.limitReached')}</p>}
        <Section title={t('userFields.admin.title')}>
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('userFields.admin.empty')}</p>
          ) : (
            <div className="-mx-2 rounded-md border">
              <SortableList
                items={fields}
                nameOf={nameOf}
                busy={order.isPending || toggle.isPending}
                onOrder={(ids) => order.mutate(ids)}
                render={(f) => (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm ${f.active ? 'font-medium' : 'text-muted-foreground'}`}>
                        {f.labelPt}
                        {f.labelEn && <span className="font-normal text-muted-foreground"> · {f.labelEn}</span>}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline">{t(`userFields.admin.kinds.${f.kind}`)}</Badge>
                        {f.kind === 'choice' && (
                          <Badge variant="outline">
                            {t('userFields.admin.optionsCount', { count: f.options.length })}
                          </Badge>
                        )}
                        {FLAGS.filter((x) => f[x] && x !== 'searchable').map((x) => (
                          <Badge key={x} variant="secondary">
                            {t(`userFields.admin.flags.${x}`)}
                          </Badge>
                        ))}
                        <Badge variant={f.active ? 'secondary' : 'destructive'}>
                          {f.active ? t('userFields.admin.active') : t('userFields.admin.inactive')}
                        </Badge>
                        {f.inUse && <Badge variant="outline">{t('userFields.admin.inUse')}</Badge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(f)}
                        aria-label={`${t('userFields.admin.edit')}: ${f.labelPt}`}
                      >
                        <Pencil aria-hidden="true" />
                        <span className="hidden sm:inline">{t('userFields.admin.edit')}</span>
                      </Button>
                      {f.kind === 'choice' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setOptions(f)}
                          aria-label={`${t('userFields.admin.options')}: ${f.labelPt}`}
                        >
                          <ListChecks aria-hidden="true" />
                          <span className="hidden sm:inline">{t('userFields.admin.options')}</span>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={toggle.isPending || (!f.active && activeCount >= MAX_ACTIVE_FIELDS)}
                        onClick={() => toggle.mutate(f)}
                      >
                        {f.active ? t('userFields.admin.deactivate') : t('userFields.admin.activate')}
                      </Button>
                      {!f.inUse && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(f)}
                          aria-label={`${t('userFields.admin.delete')}: ${f.labelPt}`}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              />
            </div>
          )}
        </Section>
      </div>
      {editing && <FieldDialog field={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {options && <OptionsDialog field={options} onClose={() => setOptions(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('userFields.admin.deleteTitle', { name: deleting?.labelPt ?? '' })}
        description={t('userFields.admin.deleteText')}
        confirmLabel={t('userFields.admin.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </AdminPage>
  );
}
