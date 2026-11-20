import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { LANGUAGES } from '@/i18n';
import { FormError } from '../auth/auth-layout';
import { keys } from '../session';
import { adminKeys } from './queries';
import { AdminPage, Section } from './shared';

type Values = Record<string, string>;

const SECURITY = [
  'auth.password_min_length',
  'auth.password_min_classes',
  'auth.max_failed_attempts',
  'auth.lockout_minutes',
  'auth.session_hours',
  'auth.sso_session_hours',
  'auth.reset_link_minutes',
] as const;
const NUMERIC = new Set<string>([
  ...SECURITY,
  'attachments.max_mb',
  'notifications.deadline_alert_days',
  'profile.photo_max_mb',
  'triage.sla_days',
  'results.sustainment_days',
  'recognition.points_submitted',
  'recognition.points_approved',
  'recognition.points_implemented',
  'recognition.points_highlighted',
  'recognition.author_share',
  'hall.suggest_min_gain',
  'hall.suggest_min_likes',
  'ops.retention_days',
  'store.expiry_months',
  'approval.default_days',
]);
const LIST = new Set<string>(['attachments.allowed_extensions']);
const BOOLEAN = new Set<string>([
  'ideas.category_required',
  'ideas.triage_shortcut',
  'public.lookup_enabled',
  'triage.business_days',
  'ideas.similar_show_titles',
  'recognition.enabled',
  'recognition.converged_coauthorship',
  'recognition.individual_ranking',
  'hall.likes_enabled',
  'hall.show_gain',
  'hall.allow_in_progress',
  'hall.auto_entry',
  'mural.enabled',
  'store.enabled',
  'approval.email_code',
  'approval.allow_outside_domains',
]);

/** Converte o texto do formulário no tipo de cada chave (números são números). */
function toApiValue(key: string, raw: string): unknown {
  if (BOOLEAN.has(key)) return raw === 'true';
  if (LIST.has(key))
    return raw
      .split(',')
      .map((x) => x.trim().replace(/^\./, ''))
      .filter(Boolean);
  return NUMERIC.has(key) ? (raw.trim() === '' ? raw : Number(raw)) : raw;
}

export function SettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: () => unwrap(api.GET('/api/settings')) });
  const original = useMemo<Values>(
    () =>
      Object.fromEntries(
        (settings.data ?? []).map((s) => [s.key, Array.isArray(s.value) ? s.value.join(', ') : String(s.value ?? '')]),
      ),
    [settings.data],
  );
  const [values, setValues] = useState<Values>({});
  useEffect(() => setValues(original), [original]);
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return [values['organization.timezone'] ?? 'UTC'];
    }
  }, [values]);

  const changed = Object.keys(values).filter((k) => values[k] !== original[k]);
  const save = useMutation({
    meta: { success: t('feedback.saved') },
    mutationFn: () =>
      unwrap(
        api.PATCH('/api/settings', {
          body: { values: Object.fromEntries(changed.map((k) => [k, toApiValue(k, values[k] ?? '')])) },
        }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(adminKeys.settings, data);
      void qc.invalidateQueries({ queryKey: keys.publicSettings });
      void qc.invalidateQueries({ queryKey: adminKeys.entities });
    },
  });
  const perField = fieldErrors(save.error);
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const label = (key: string) => t(`admin.settings.keys.${key}` as never) as string;
  const hint = (key: string) => {
    const h = key.split('.')[1] ?? '';
    const text = t(`admin.settings.hints.${h}` as never) as string;
    return text.startsWith('admin.') ? undefined : text;
  };

  if (!settings.data) return settings.isError ? <FormError message={errorText(t, settings.error)} /> : null;

  return (
    <AdminPage title={t('admin.settings.pageTitle')} intro={t('admin.settings.intro')} help="adminSettings">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (changed.length > 0) save.mutate();
        }}
        className="grid gap-6"
      >
        <Section title={t('admin.settings.groups.organization')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={label('organization.name')} error={perField['organization.name']} className="sm:col-span-2">
              <Input
                value={values['organization.name'] ?? ''}
                onChange={(e) => set('organization.name', e.target.value)}
                maxLength={200}
              />
            </Field>
            <Field label={label('organization.timezone')} error={perField['organization.timezone']}>
              <NativeSelect
                value={values['organization.timezone'] ?? ''}
                onChange={(e) => set('organization.timezone', e.target.value)}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll('_', ' ')}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={label('organization.default_locale')} hint={hint('organization.default_locale')}>
              <NativeSelect
                value={values['organization.default_locale'] ?? 'pt-BR'}
                onChange={(e) => set('organization.default_locale', e.target.value)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`common.languages.${l}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label={label('help.docs_url')}
              hint={hint('help.docs_url')}
              error={perField['help.docs_url']}
              className="sm:col-span-2"
            >
              <Input
                inputMode="url"
                placeholder="/ajuda/"
                maxLength={300}
                value={values['help.docs_url'] ?? ''}
                onChange={(e) => set('help.docs_url', e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title={t('admin.settings.groups.ideas')}>
          <div className="grid gap-4">
            <Field
              label={label('ideas.code_prefix')}
              hint={hint('ideas.code_prefix')}
              error={perField['ideas.code_prefix']}
              className="max-w-xs"
            >
              <Input
                value={values['ideas.code_prefix'] ?? ''}
                onChange={(e) => set('ideas.code_prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                maxLength={8}
                className="font-mono"
              />
            </Field>
            <Field
              label={label('triage.sla_days')}
              hint={hint('triage.sla_days')}
              error={perField['triage.sla_days']}
              className="max-w-xs"
            >
              <Input
                inputMode="numeric"
                value={values['triage.sla_days'] ?? ''}
                onChange={(e) => set('triage.sla_days', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field
              label={label('results.sustainment_days')}
              hint={hint('results.sustainment_days')}
              error={perField['results.sustainment_days']}
              className="max-w-xs"
            >
              <Input
                inputMode="numeric"
                value={values['results.sustainment_days'] ?? ''}
                onChange={(e) => set('results.sustainment_days', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field
              label={label('results.currency')}
              hint={hint('results.currency')}
              error={perField['results.currency']}
              className="max-w-xs"
            >
              <Input
                value={values['results.currency'] ?? ''}
                onChange={(e) => set('results.currency', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                maxLength={3}
                className="font-mono"
              />
            </Field>
            {(
              [
                'ideas.category_required',
                'ideas.triage_shortcut',
                'triage.business_days',
                'ideas.similar_show_titles',
              ] as const
            ).map((key) => (
              <div key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  id={key}
                  checked={values[key] === 'true'}
                  onCheckedChange={(v) => set(key, v === true ? 'true' : 'false')}
                />
                <label htmlFor={key}>{label(key)}</label>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t('admin.settings.groups.recognition')}>
          <div className="grid gap-4">
            {(
              ['recognition.enabled', 'recognition.individual_ranking', 'recognition.converged_coauthorship'] as const
            ).map((key) => (
              <div key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  id={`s-${key}`}
                  checked={values[key] === 'true'}
                  onCheckedChange={(v) => set(key, v === true ? 'true' : 'false')}
                />
                <label htmlFor={`s-${key}`}>{label(key)}</label>
              </div>
            ))}
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  'recognition.points_submitted',
                  'recognition.points_approved',
                  'recognition.points_implemented',
                  'recognition.points_highlighted',
                  'recognition.author_share',
                ] as const
              ).map((key) => (
                <Field key={key} label={label(key)} hint={hint(key)} error={perField[key]}>
                  <Input
                    inputMode="numeric"
                    value={values[key] ?? ''}
                    onChange={(e) => set(key, e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
              ))}
            </div>
          </div>
        </Section>

        <Section title={t('admin.settings.groups.hall')}>
          <div className="grid gap-4">
            {(['hall.likes_enabled', 'hall.show_gain', 'hall.allow_in_progress', 'hall.auto_entry'] as const).map(
              (key) => (
                <div key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`s-${key}`}
                    checked={values[key] === 'true'}
                    onCheckedChange={(v) => set(key, v === true ? 'true' : 'false')}
                  />
                  <label htmlFor={`s-${key}`}>{label(key)}</label>
                </div>
              ),
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {(['hall.suggest_min_gain', 'hall.suggest_min_likes'] as const).map((key) => (
                <Field key={key} label={label(key)} hint={hint(key)} error={perField[key]}>
                  <Input
                    inputMode="numeric"
                    value={values[key] ?? ''}
                    onChange={(e) => set(key, e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
              ))}
            </div>
          </div>
        </Section>

        <Section title={t('admin.settings.groups.mural')} intro={t('admin.settings.muralHint')}>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id="s-mural.enabled"
              checked={values['mural.enabled'] === 'true'}
              onCheckedChange={(v) => set('mural.enabled', v === true ? 'true' : 'false')}
            />
            <label htmlFor="s-mural.enabled">{label('mural.enabled')}</label>
          </div>
        </Section>

        <Section title={t('admin.settings.groups.store')} intro={t('admin.settings.storeHint')}>
          <div className="grid gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="s-store.enabled"
                checked={values['store.enabled'] === 'true'}
                onCheckedChange={(v) => set('store.enabled', v === true ? 'true' : 'false')}
              />
              <label htmlFor="s-store.enabled">{label('store.enabled')}</label>
            </div>
            <Field
              label={label('store.expiry_months')}
              hint={t('admin.settings.expiryHint')}
              error={perField['store.expiry_months']}
              className="sm:max-w-xs"
            >
              <Input
                inputMode="numeric"
                value={values['store.expiry_months'] ?? ''}
                onChange={(e) => set('store.expiry_months', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>
        </Section>

        <Section title={t('admin.settings.groups.approvals')} intro={t('admin.settings.approvalsHint')}>
          <div className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{label('approval.on_reject')}</legend>
              {(['return', 'block'] as const).map((mode) => (
                <label key={mode} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                  <input
                    type="radio"
                    name="s-approval.on_reject"
                    checked={values['approval.on_reject'] === mode}
                    onChange={() => set('approval.on_reject', mode)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  {t(`admin.settings.onRejectModes.${mode}`)}
                </label>
              ))}
            </fieldset>
            <Field
              label={label('approval.default_days')}
              hint={t('admin.settings.approvalDaysHint')}
              error={perField['approval.default_days']}
              className="max-w-xs"
            >
              <Input
                inputMode="numeric"
                value={values['approval.default_days'] ?? ''}
                onChange={(e) => set('approval.default_days', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="s-approval.email_code"
                checked={values['approval.email_code'] === 'true'}
                onCheckedChange={(v) => set('approval.email_code', v === true ? 'true' : 'false')}
              />
              <label htmlFor="s-approval.email_code">{label('approval.email_code')}</label>
            </div>
            <div className="grid gap-1">
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="s-approval.allow_outside_domains"
                  checked={values['approval.allow_outside_domains'] === 'true'}
                  onCheckedChange={(v) => set('approval.allow_outside_domains', v === true ? 'true' : 'false')}
                />
                <label htmlFor="s-approval.allow_outside_domains">{label('approval.allow_outside_domains')}</label>
              </div>
              <p className="pl-6 text-xs text-muted-foreground">{t('admin.settings.approvalDomainsHint')}</p>
            </div>
          </div>
        </Section>

        <Section title={t('admin.settings.groups.steps')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={label('steps.progress_mode')}>
              <NativeSelect
                value={values['steps.progress_mode'] ?? 'steps'}
                onChange={(e) => set('steps.progress_mode', e.target.value)}
              >
                <option value="steps">{t('admin.settings.progressModes.steps')}</option>
                <option value="time">{t('admin.settings.progressModes.time')}</option>
              </NativeSelect>
            </Field>
            <Field
              label={label('attachments.max_mb')}
              hint={hint('attachments.max_mb')}
              error={perField['attachments.max_mb']}
            >
              <Input
                inputMode="numeric"
                value={values['attachments.max_mb'] ?? ''}
                onChange={(e) => set('attachments.max_mb', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field
              label={label('attachments.allowed_extensions')}
              hint={hint('attachments.allowed_extensions')}
              error={perField['attachments.allowed_extensions']}
              className="sm:col-span-2"
            >
              <Input
                value={values['attachments.allowed_extensions'] ?? ''}
                onChange={(e) => set('attachments.allowed_extensions', e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title={t('admin.settings.groups.publicAndProfile')}>
          <div className="grid gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="public.lookup_enabled"
                  checked={values['public.lookup_enabled'] === 'true'}
                  onCheckedChange={(v) => set('public.lookup_enabled', v === true ? 'true' : 'false')}
                />
                <label htmlFor="public.lookup_enabled">{label('public.lookup_enabled')}</label>
              </div>
              <p className="mt-1 ml-6 text-xs text-muted-foreground">{hint('lookup_enabled')}</p>
            </div>
            <Field
              label={label('profile.photo_max_mb')}
              hint={hint('photo_max_mb')}
              error={perField['profile.photo_max_mb']}
              className="max-w-xs"
            >
              <Input
                inputMode="numeric"
                value={values['profile.photo_max_mb'] ?? ''}
                onChange={(e) => set('profile.photo_max_mb', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>
        </Section>

        <Section title={t('admin.settings.groups.notifications')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={label('notifications.deadline_alert_days')}
              hint={hint('notifications.deadline_alert_days')}
              error={perField['notifications.deadline_alert_days']}
            >
              <Input
                inputMode="numeric"
                value={values['notifications.deadline_alert_days'] ?? ''}
                onChange={(e) => set('notifications.deadline_alert_days', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field
              label={label('email.digest_time')}
              hint={hint('email.digest_time')}
              error={perField['email.digest_time']}
            >
              <Input
                type="time"
                value={values['email.digest_time'] ?? ''}
                onChange={(e) => set('email.digest_time', e.target.value)}
              />
            </Field>
            <Field
              label={label('email.app_url')}
              hint={hint('email.app_url')}
              error={perField['email.app_url']}
              className="sm:col-span-2"
            >
              <Input
                type="url"
                inputMode="url"
                placeholder="https://ideias.example.com"
                value={values['email.app_url'] ?? ''}
                onChange={(e) => set('email.app_url', e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title={t('admin.settings.groups.security')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {SECURITY.map((key) => (
              <Field key={key} label={label(key)} hint={hint(key)} error={perField[key]}>
                <Input
                  inputMode="numeric"
                  value={values[key] ?? ''}
                  onChange={(e) => set(key, e.target.value.replace(/\D/g, ''))}
                />
              </Field>
            ))}
          </div>
        </Section>

        <Section title={t('admin.settings.groups.operation')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={label('ops.retention_days')}
              hint={hint('ops.retention_days')}
              error={perField['ops.retention_days']}
            >
              <Input
                inputMode="numeric"
                value={values['ops.retention_days'] ?? ''}
                onChange={(e) => set('ops.retention_days', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>
        </Section>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.isPending || changed.length === 0}>
            {t('admin.settings.save')}
          </Button>
          {changed.length === 0 && !save.isSuccess && (
            <span className="text-sm text-muted-foreground">{t('admin.settings.nothingChanged')}</span>
          )}
        </div>
        <FormError message={save.isError ? errorText(t, save.error) : null} />
      </form>
    </AdminPage>
  );
}
