import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CircleCheck,
  CircleDashed,
  MailCheck,
  MailX,
  Power,
  PowerOff,
  RotateCcw,
  Send,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiError, errorText, fieldErrors, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
import { PasswordInput } from '@/components/form/password';
import { SensitiveInput } from '@/components/form/sensitive';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { mailErrorText, type Translate } from '@/lib/server-text';
import { FormError } from '../auth/auth-layout';
import { HelpAnchor } from '../help';
import { keys, useMe } from '../session';
import { useDates } from '../use-dates';
import { TemplateBodyEditor } from './email-template-editor';
import { AdminPage, Pagination, Section } from './shared';

type Provider = components['schemas']['ProviderView'];
type Template = components['schemas']['TemplateView'];
type LogStatus = components['schemas']['EmailLogView']['status'];

const emailKeys = {
  provider: ['admin', 'email', 'provider'] as const,
  templates: ['admin', 'email', 'templates'] as const,
  log: (status: string, page: number) => ['admin', 'email', 'log', status, page] as const,
};

function useProvider() {
  return useQuery({ queryKey: emailKeys.provider, queryFn: () => unwrap(api.GET('/api/admin/email/provider')) });
}

// --- Envio: situação, provedor e teste ------------------------------------------------------------

function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  const Icon = done ? CircleCheck : CircleDashed;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon
        aria-hidden="true"
        className={`mt-0.5 size-4 shrink-0 ${done ? 'text-(--st-done)' : 'text-muted-foreground'}`}
      />
      <span>
        <span className="sr-only">{done ? '✓ ' : '○ '}</span>
        {children}
      </span>
    </li>
  );
}

function StatusSection({ provider }: { provider: Provider }) {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const toggle = useMutation({
    meta: { success: (_d, on: boolean) => (on ? t('feedback.email.on') : t('feedback.email.off')) },
    mutationFn: (on: boolean) =>
      unwrap(on ? api.POST('/api/admin/email/provider/activate') : api.POST('/api/admin/email/provider/deactivate')),
    onSuccess: (data) => {
      qc.setQueryData(emailKeys.provider, data);
      void qc.invalidateQueries({ queryKey: keys.publicSettings });
    },
  });
  const ready = provider.configured && provider.lastTestOk === true && provider.appUrl !== '';
  return (
    <Section title={t('admin.email.status.title')}>
      <div className="flex flex-wrap items-center gap-3">
        {provider.active ? (
          <Badge className="bg-(--st-done-fill) text-(--st-done-on)">
            <MailCheck aria-hidden="true" />
            {t('admin.email.status.on')}
          </Badge>
        ) : (
          <Badge variant="secondary">
            <MailX aria-hidden="true" />
            {t('admin.email.status.off')}
          </Badge>
        )}
        <p className="text-sm text-muted-foreground">
          {provider.active ? t('admin.email.status.onText') : t('admin.email.status.offText')}
        </p>
      </div>
      <ul className="mt-4 space-y-1.5">
        <Check done={provider.configured}>{t('admin.email.status.stepProvider')}</Check>
        <Check done={provider.lastTestOk === true}>
          {t('admin.email.status.stepTest')}
          {provider.lastTestAt && (
            <span className="text-muted-foreground">
              {' '}
              · {t('admin.email.status.lastTest', { when: dates.dateTime(provider.lastTestAt) })}
            </span>
          )}
        </Check>
        <Check done={provider.appUrl !== ''}>
          {t('admin.email.status.stepUrl')}{' '}
          {provider.appUrl ? (
            <span className="font-mono text-xs break-all text-muted-foreground">{provider.appUrl}</span>
          ) : (
            <Link to="/admin/configuracoes" className="text-primary underline underline-offset-4">
              {t('admin.email.status.setUrl')}
            </Link>
          )}
        </Check>
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {provider.active ? (
          <Button variant="outline" onClick={() => toggle.mutate(false)} disabled={toggle.isPending}>
            <PowerOff aria-hidden="true" />
            {t('admin.email.status.turnOff')}
          </Button>
        ) : (
          <Button onClick={() => toggle.mutate(true)} disabled={!ready || toggle.isPending}>
            <Power aria-hidden="true" />
            {t('admin.email.status.turnOn')}
          </Button>
        )}
      </div>
      <FormError message={toggle.isError ? errorText(t, toggle.error) : null} />
    </Section>
  );
}

type ProviderType = 'smtp' | 'microsoft_graph' | 'google_workspace';
const PROVIDER_TYPES = ['smtp', 'microsoft_graph', 'google_workspace'] as const;

function ProviderSection({ provider }: { provider: Provider }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const initial = useMemo(
    () => ({
      type: (PROVIDER_TYPES as readonly string[]).includes(provider.type) ? (provider.type as ProviderType) : 'smtp',
      host: provider.host ?? '',
      port: provider.port ? String(provider.port) : '587',
      security: provider.security ?? 'starttls',
      username: provider.username ?? '',
      password: '',
      fromAddress: provider.fromAddress ?? '',
      fromName: provider.fromName ?? '',
      tenantId: provider.tenantId ?? '',
      clientId: provider.clientId ?? '',
      clientSecret: '',
      serviceAccountJson: '',
      mailboxId: provider.mailboxId ?? '',
      replyTo: provider.replyTo ?? '',
      secretExpiresOn: provider.secretExpiresOn ?? '',
    }),
    [provider],
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const graph = form.type === 'microsoft_graph';
  const google = form.type === 'google_workspace';

  const save = useMutation({
    meta: { success: t('admin.email.provider.saved') },
    mutationFn: () =>
      unwrap(
        api.PUT('/api/admin/email/provider', {
          body: google
            ? {
                type: 'google_workspace',
                ...(form.serviceAccountJson.trim() ? { serviceAccountJson: form.serviceAccountJson.trim() } : {}),
                fromAddress: form.fromAddress.trim(),
                fromName: form.fromName.trim() || null,
                replyTo: form.replyTo.trim() || null,
                // Chave nova com a data antiga: omite a data, e o servidor a apaga (era a da chave antiga; RN-100).
                ...(form.serviceAccountJson.trim() && form.secretExpiresOn === initial.secretExpiresOn
                  ? {}
                  : { secretExpiresOn: form.secretExpiresOn || null }),
              }
            : graph
              ? {
                  type: 'microsoft_graph',
                  tenantId: form.tenantId.trim(),
                  clientId: form.clientId.trim(),
                  ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
                  mailboxId: form.mailboxId.trim() || null,
                  replyTo: form.replyTo.trim() || null,
                  fromAddress: form.fromAddress.trim(),
                  // Segredo novo com a data antiga: omite a data, e o servidor a apaga (era a do segredo antigo; RN-100).
                  ...(form.clientSecret && form.secretExpiresOn === initial.secretExpiresOn
                    ? {}
                    : { secretExpiresOn: form.secretExpiresOn || null }),
                }
              : {
                  type: 'smtp',
                  host: form.host.trim(),
                  port: Number(form.port),
                  security: form.security,
                  username: form.username.trim() || null,
                  ...(form.password ? { password: form.password } : {}),
                  fromAddress: form.fromAddress.trim(),
                  fromName: form.fromName.trim() || null,
                },
        }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(emailKeys.provider, data);
      void qc.invalidateQueries({ queryKey: keys.publicSettings });
    },
  });
  const errors = fieldErrors(save.error);

  return (
    <Section
      title={t('admin.email.provider.title')}
      intro={
        google
          ? t('admin.email.provider.introGoogle')
          : graph
            ? t('admin.email.provider.introGraph')
            : t('admin.email.provider.intro')
      }
    >
      {!provider.secretKeyReady && <FormError message={t('admin.email.provider.secretMissing')} />}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="grid gap-4 sm:grid-cols-6"
      >
        <Field label={t('admin.email.provider.type')} className="sm:col-span-3">
          <NativeSelect
            value={form.type}
            onChange={(e) => {
              save.reset();
              set('type', e.target.value);
            }}
          >
            {PROVIDER_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`admin.email.provider.types.${type}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="hidden sm:col-span-3 sm:block" />

        {google ? (
          <>
            <p
              role="note"
              className="flex items-start gap-2 rounded-md border border-(--st-late)/40 p-3 text-sm sm:col-span-6"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-late)" />
              <span>
                {t('admin.email.provider.googleWarning')}{' '}
                <HelpAnchor topic="mailGoogle" className="font-medium text-primary underline underline-offset-4">
                  {t('admin.email.provider.helpGoogle')}
                </HelpAnchor>
              </span>
            </p>
            <Field
              label={t('admin.email.provider.serviceAccountJson')}
              hint={
                provider.serviceAccountKeySet
                  ? t('admin.email.provider.serviceAccountSet', { email: provider.serviceAccountEmail ?? '' })
                  : t('admin.email.provider.serviceAccountHint')
              }
              error={errors.serviceAccountJson}
              className="sm:col-span-6"
            >
              <Textarea
                rows={4}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
                value={form.serviceAccountJson}
                placeholder={
                  provider.serviceAccountKeySet
                    ? t('admin.email.provider.serviceAccountKept')
                    : t('admin.email.provider.serviceAccountEmpty')
                }
                onChange={(e) => set('serviceAccountJson', e.target.value)}
              />
            </Field>
            <div className="sm:col-span-6">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary underline underline-offset-4 focus-within:ring-2 focus-within:ring-ring">
                {t('admin.email.provider.serviceAccountFile')}
                <input
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void file.text().then((text) => set('serviceAccountJson', text));
                  }}
                />
              </label>
            </div>
            <Field
              label={t('admin.email.provider.googleMailbox')}
              hint={t('admin.email.provider.googleMailboxHint')}
              error={errors.fromAddress}
              className="sm:col-span-3"
            >
              <SensitiveInput
                fieldLabel={t('admin.email.provider.googleMailbox')}
                hideOn={save.isSuccess}
                value={form.fromAddress}
                onChange={(e) => set('fromAddress', e.target.value)}
                placeholder="nao-responder@example.com"
              />
            </Field>
            <Field
              label={t('admin.email.provider.fromName')}
              optionalLabel={t('common.optional')}
              className="sm:col-span-3"
            >
              <Input value={form.fromName} onChange={(e) => set('fromName', e.target.value)} />
            </Field>
            <Field
              label={t('admin.email.provider.replyTo')}
              optionalLabel={t('common.optional')}
              hint={t('admin.email.provider.replyToHint')}
              error={errors.replyTo}
              className="sm:col-span-3"
            >
              <Input type="email" value={form.replyTo} onChange={(e) => set('replyTo', e.target.value)} />
            </Field>
            <Field
              label={t('admin.email.provider.keyExpiresOn')}
              optionalLabel={t('common.optional')}
              hint={t('admin.email.provider.keyExpiresHint')}
              error={errors.secretExpiresOn}
              className="sm:col-span-3"
            >
              <Input
                type="date"
                value={form.secretExpiresOn}
                onChange={(e) => set('secretExpiresOn', e.target.value)}
                className="max-w-48"
              />
            </Field>
          </>
        ) : graph ? (
          <>
            <p
              role="note"
              className="flex items-start gap-2 rounded-md border border-(--st-late)/40 p-3 text-sm sm:col-span-6"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-late)" />
              <span>
                {t('admin.email.provider.graphWarning')}{' '}
                <HelpAnchor topic="mailMicrosoft" className="font-medium text-primary underline underline-offset-4">
                  {t('admin.email.provider.helpGraph')}
                </HelpAnchor>
              </span>
            </p>
            <Field
              label={t('admin.email.provider.tenantId')}
              hint={t('admin.email.provider.tenantHint')}
              error={errors.tenantId}
              className="sm:col-span-3"
            >
              <SensitiveInput
                fieldLabel={t('admin.email.provider.tenantId')}
                hideOn={save.isSuccess}
                value={form.tenantId}
                onChange={(e) => set('tenantId', e.target.value)}
              />
            </Field>
            <Field label={t('admin.email.provider.clientId')} error={errors.clientId} className="sm:col-span-3">
              <SensitiveInput
                fieldLabel={t('admin.email.provider.clientId')}
                hideOn={save.isSuccess}
                value={form.clientId}
                onChange={(e) => set('clientId', e.target.value)}
              />
            </Field>
            <Field label={t('admin.email.provider.clientSecret')} className="sm:col-span-3">
              <PasswordInput
                autoComplete="new-password"
                value={form.clientSecret}
                placeholder={
                  provider.clientSecretSet
                    ? t('admin.email.provider.clientSecretSet')
                    : t('admin.email.provider.clientSecretEmpty')
                }
                onChange={(e) => set('clientSecret', e.target.value)}
              />
            </Field>
            <Field
              label={t('admin.email.provider.secretExpiresOn')}
              hint={t('admin.email.provider.secretExpiresHint')}
              error={errors.secretExpiresOn}
              className="sm:col-span-3"
            >
              <Input
                type="date"
                value={form.secretExpiresOn}
                onChange={(e) => set('secretExpiresOn', e.target.value)}
                className="max-w-48"
              />
            </Field>
            <Field
              label={t('admin.email.provider.mailbox')}
              hint={t('admin.email.provider.mailboxHint')}
              error={errors.fromAddress}
              className="sm:col-span-3"
            >
              <SensitiveInput
                fieldLabel={t('admin.email.provider.mailbox')}
                hideOn={save.isSuccess}
                value={form.fromAddress}
                onChange={(e) => set('fromAddress', e.target.value)}
                placeholder="nao-responder@example.com"
              />
            </Field>
            <Field
              label={t('admin.email.provider.mailboxId')}
              optionalLabel={t('common.optional')}
              hint={t('admin.email.provider.mailboxIdHint')}
              className="sm:col-span-3"
            >
              <SensitiveInput
                fieldLabel={t('admin.email.provider.mailboxId')}
                hideOn={save.isSuccess}
                value={form.mailboxId}
                onChange={(e) => set('mailboxId', e.target.value)}
              />
            </Field>
            <Field
              label={t('admin.email.provider.replyTo')}
              optionalLabel={t('common.optional')}
              hint={t('admin.email.provider.replyToHint')}
              error={errors.replyTo}
              className="sm:col-span-3"
            >
              <Input type="email" value={form.replyTo} onChange={(e) => set('replyTo', e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <Field label={t('admin.email.provider.host')} error={errors.host} className="sm:col-span-3">
              <Input value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.example.com" />
            </Field>
            <Field label={t('admin.email.provider.port')} error={errors.port} className="sm:col-span-1">
              <Input
                inputMode="numeric"
                value={form.port}
                onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field label={t('admin.email.provider.security')} className="sm:col-span-2">
              <NativeSelect value={form.security} onChange={(e) => set('security', e.target.value)}>
                {(['starttls', 'tls', 'none'] as const).map((sec) => (
                  <option key={sec} value={sec}>
                    {t(`admin.email.provider.securityOptions.${sec}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {form.security === 'none' && (
              <p className="text-xs text-muted-foreground sm:col-span-6">{t('admin.email.provider.noneWarning')}</p>
            )}
            <Field
              label={t('admin.email.provider.username')}
              optionalLabel={t('common.optional')}
              error={errors.username}
              className="sm:col-span-3"
            >
              <SensitiveInput
                fieldLabel={t('admin.email.provider.username')}
                hideOn={save.isSuccess}
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
              />
            </Field>
            <Field
              label={t('admin.email.provider.password')}
              hint={provider.passwordSet ? t('admin.email.provider.passwordKeep') : undefined}
              className="sm:col-span-3"
            >
              <PasswordInput
                autoComplete="new-password"
                value={form.password}
                placeholder={provider.passwordSet ? t('admin.email.provider.passwordSet') : ''}
                onChange={(e) => set('password', e.target.value)}
              />
            </Field>
            <Field label={t('admin.email.provider.fromAddress')} error={errors.fromAddress} className="sm:col-span-3">
              <Input
                type="email"
                value={form.fromAddress}
                onChange={(e) => set('fromAddress', e.target.value)}
                placeholder="ideias@example.com"
              />
            </Field>
            <Field
              label={t('admin.email.provider.fromName')}
              optionalLabel={t('common.optional')}
              className="sm:col-span-3"
            >
              <Input value={form.fromName} onChange={(e) => set('fromName', e.target.value)} />
            </Field>
          </>
        )}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-6">
          <Button type="submit" disabled={save.isPending || !provider.secretKeyReady}>
            {save.isPending ? t('common.saving') : t('admin.email.provider.save')}
          </Button>
        </div>
        <div className="sm:col-span-6">
          <FormError message={save.isError ? errorText(t, save.error) : null} />
        </div>
      </form>
    </Section>
  );
}

function TestSection({ provider }: { provider: Provider }) {
  const { t } = useTranslation();
  const tr = t as unknown as Translate;
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [to, setTo] = useState('');
  useEffect(() => setTo((v) => v || me?.email || ''), [me]);
  const test = useMutation({
    meta: { success: (d: { ok: boolean }) => (d.ok ? t('admin.email.test.ok', { to }) : '') },
    mutationFn: () => unwrap(api.POST('/api/admin/email/provider/test', { body: { to: to.trim() } })),
    onSettled: () => qc.invalidateQueries({ queryKey: emailKeys.provider }),
  });
  return (
    <Section title={t('admin.email.test.title')} intro={t('admin.email.test.intro')}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          test.mutate();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <Field label={t('admin.email.test.to')} className="min-w-60 flex-1">
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button type="submit" variant="outline" disabled={!provider.configured || test.isPending || !to.trim()}>
          <Send aria-hidden="true" />
          {test.isPending ? t('admin.email.test.sending') : t('admin.email.test.send')}
        </Button>
      </form>
      <div className="mt-3" aria-live="polite">
        {test.data && !test.data.ok && (
          <FormError message={t('admin.email.test.failed', { error: mailErrorText(tr, test.data.error) })} />
        )}
        <FormError message={test.isError ? errorText(t, test.error) : null} />
        {!test.data && provider.lastTestOk === false && provider.lastTestError && (
          <p className="text-sm text-muted-foreground">
            {t('admin.email.test.lastError', { error: mailErrorText(tr, provider.lastTestError) })}
          </p>
        )}
      </div>
    </Section>
  );
}

// --- Modelos --------------------------------------------------------------------------------------

function TemplatesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: emailKeys.templates,
    queryFn: () => unwrap(api.GET('/api/admin/email/templates')),
  });
  const [key, setKey] = useState<Template['key']>('digest');
  const [locale, setLocale] = useState<Template['locale']>('pt-BR');
  const current = list.data?.find((x) => x.key === key && x.locale === locale);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    if (current) {
      setSubject(current.subject);
      setBody(current.body);
    }
  }, [current]);

  const path = { params: { path: { key, locale } } };
  const save = useMutation({
    meta: { success: t('feedback.email.templateSaved') },
    mutationFn: () =>
      unwrap(api.PUT('/api/admin/email/templates/{key}/{locale}', { ...path, body: { subject, body } })),
    onSuccess: (data) => qc.setQueryData(emailKeys.templates, data),
  });
  const reset = useMutation({
    meta: { success: t('feedback.email.templateReset') },
    mutationFn: () => unwrap(api.DELETE('/api/admin/email/templates/{key}/{locale}', path)),
    onSuccess: (data) => qc.setQueryData(emailKeys.templates, data),
  });
  const unknown =
    save.error instanceof ApiError && save.error.code === 'unknown_variable' && Array.isArray(save.error.details)
      ? (save.error.details as { variable: string }[]).map((d) => `{{${d.variable}}}`).join(', ')
      : null;

  if (!list.data) return list.isError ? <FormError message={errorText(t, list.error)} /> : null;
  return (
    <Section title={t('admin.email.templates.title')} intro={t('admin.email.templates.intro')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('admin.email.templates.model')}>
          <NativeSelect
            value={key}
            onChange={(e) => {
              save.reset();
              setKey(e.target.value as Template['key']);
            }}
          >
            {(['digest', 'password_reset', 'test'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`admin.email.kinds.${k}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('common.language')}>
          <NativeSelect
            value={locale}
            onChange={(e) => {
              save.reset();
              setLocale(e.target.value as Template['locale']);
            }}
          >
            {(['pt-BR', 'en'] as const).map((l) => (
              <option key={l} value={l}>
                {t(`common.languages.${l}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {current && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="mt-4 grid gap-4"
        >
          <p className="text-sm text-muted-foreground">
            {current.customized ? t('admin.email.templates.customized') : t('admin.email.templates.factory')}
          </p>
          <Field label={t('admin.email.templates.subject')}>
            <Input value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <TemplateBodyEditor value={body} onChange={setBody} variables={current.variables} />
          <FormError
            message={
              unknown
                ? t('admin.email.templates.unknown', { list: unknown })
                : save.isError
                  ? errorText(t, save.error)
                  : null
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.isPending || !subject.trim() || !body.trim()}>
              {save.isPending ? t('common.saving') : t('admin.email.templates.save')}
            </Button>
            {current.customized && (
              <Button type="button" variant="outline" onClick={() => reset.mutate()} disabled={reset.isPending}>
                <RotateCcw aria-hidden="true" />
                {t('admin.email.templates.reset')}
              </Button>
            )}
          </div>
        </form>
      )}
    </Section>
  );
}

// --- Envios ---------------------------------------------------------------------------------------

const STATUS_STYLE: Record<LogStatus, string> = {
  pending: 'bg-(--st-review-fill) text-(--st-review-on)',
  sent: 'bg-(--st-done-fill) text-(--st-done-on)',
  failed: 'bg-(--st-rejected-fill) text-(--st-rejected-on)',
};

function LogTab() {
  const { t } = useTranslation();
  const tr = t as unknown as Translate;
  const dates = useDates();
  const qc = useQueryClient();
  const [status, setStatus] = useState<LogStatus | 'all'>('failed');
  const [page, setPage] = useState(1);
  const log = useQuery({
    queryKey: emailKeys.log(status, page),
    queryFn: () =>
      unwrap(
        api.GET('/api/admin/email/log', {
          params: { query: { page, pageSize: 20, status: status === 'all' ? undefined : status } },
        }),
      ),
    placeholderData: keepPreviousData,
  });
  const retry = useMutation({
    meta: { success: t('feedback.email.retried') },
    mutationFn: (id: string) => unwrap(api.POST('/api/admin/email/log/{id}/retry', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'email', 'log'] }),
  });

  return (
    <Section title={t('admin.email.log.title')} intro={t('admin.email.log.intro')}>
      <Field label={t('admin.email.log.status')} className="max-w-xs">
        <NativeSelect
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as LogStatus | 'all');
            setPage(1);
          }}
        >
          {(['failed', 'pending', 'sent', 'all'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`admin.email.log.filters.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <FormError message={retry.isError ? errorText(t, retry.error) : null} />
      {log.data && log.data.items.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">{t('admin.email.log.empty')}</p>
      )}
      {log.data && log.data.items.length > 0 && (
        <>
          <div className="mt-4 overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.email.log.columns.when')}</TableHead>
                  <TableHead>{t('admin.email.log.columns.to')}</TableHead>
                  <TableHead>{t('admin.email.log.columns.kind')}</TableHead>
                  <TableHead>{t('admin.email.log.columns.status')}</TableHead>
                  <TableHead>{t('admin.email.log.columns.error')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('admin.email.log.columns.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.data.items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">{dates.dateTime(l.createdAt)}</TableCell>
                    <TableCell className="break-all">{l.toAddress}</TableCell>
                    <TableCell>
                      {t(`admin.email.kinds.${l.kind}` as never, { defaultValue: l.kind }) as string}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_STYLE[l.status]}>{t(`admin.email.log.statuses.${l.status}`)}</Badge>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {t('admin.email.log.attempts', { count: l.attempts })}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-80 text-sm whitespace-normal text-muted-foreground">
                      {l.lastError ? mailErrorText(tr, l.lastError) : '—'}
                    </TableCell>
                    <TableCell>
                      {l.status === 'failed' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retry.isPending}
                          onClick={() => retry.mutate(l.id)}
                          aria-label={t('admin.email.log.retryFor', { to: l.toAddress })}
                        >
                          <RotateCcw aria-hidden="true" />
                          {t('admin.email.log.retry')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={log.data.meta.page}
            pageSize={log.data.meta.pageSize}
            total={log.data.meta.total}
            onPage={setPage}
          />
        </>
      )}
    </Section>
  );
}

/** Tela "E-mail" (RN-90, RN-32, CA-RN-90.4): só com `email.manage`. */
export function EmailPage() {
  const { t } = useTranslation();
  const provider = useProvider();
  return (
    <AdminPage title={t('admin.email.pageTitle')} intro={t('admin.email.intro')} help="adminEmail">
      {!provider.data ? (
        provider.isError ? (
          <FormError message={errorText(t, provider.error)} />
        ) : null
      ) : (
        <Tabs defaultValue="envio">
          <TabsList>
            <TabsTrigger value="envio">{t('admin.email.tabs.sending')}</TabsTrigger>
            <TabsTrigger value="modelos">{t('admin.email.tabs.templates')}</TabsTrigger>
            <TabsTrigger value="envios">{t('admin.email.tabs.log')}</TabsTrigger>
          </TabsList>
          <TabsContent value="envio" className="mt-4 grid gap-6">
            <StatusSection provider={provider.data} />
            <ProviderSection provider={provider.data} />
            <TestSection provider={provider.data} />
          </TabsContent>
          <TabsContent value="modelos" className="mt-4">
            <TemplatesTab />
          </TabsContent>
          <TabsContent value="envios" className="mt-4">
            <LogTab />
          </TabsContent>
        </Tabs>
      )}
    </AdminPage>
  );
}
