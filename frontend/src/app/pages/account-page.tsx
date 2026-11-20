import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { PasswordInput, PasswordPolicyHints } from '@/components/form/password';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { i18n, isLanguage, LANGUAGES } from '@/i18n';
import { DEFAULT_POLICY, meetsPolicy } from '@/lib/password-policy';
import { FormError } from '../auth/auth-layout';
import { NotificationPreferencesForm } from '../notifications/preferences-section';
import { usePageTitle } from '../page-title';
import { useMe, usePublicSettings, useUpdatePreferences } from '../session';
import { type ThemeMode, useThemeMode } from '../theme';
import { useMyFields } from '../user-fields/queries';
import { MyFieldsSection } from '../user-fields/sections';
import { AppearanceSection } from './appearance-section';
import { PhotoSection } from './photo-section';

function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-lg border bg-card p-5 sm:p-6">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function AccountPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: settings } = usePublicSettings();
  const { mode, setMode } = useThemeMode();
  const updatePreferences = useUpdatePreferences();
  const myFields = useMyFields();
  const policy = settings?.passwordPolicy ?? DEFAULT_POLICY;
  usePageTitle(t('account.pageTitle'), settings?.organizationName);

  const schema = z
    .object({
      current: z.string().min(1, t('validation.required')),
      password: z.string().refine((p) => meetsPolicy(p, policy), t('errors.weak_password')),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: t('validation.passwordMismatch') });
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { current: '', password: '', confirm: '' },
  });
  const { errors } = form.formState;

  const change = useMutation({
    meta: { success: t('feedback.account.passwordChanged') },
    mutationFn: (v: FormValues) =>
      unwrap(api.POST('/api/auth/password', { body: { currentPassword: v.current, newPassword: v.password } })),
    onSuccess: () => form.reset(),
  });

  if (!me) return null;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-[1.75rem] leading-tight font-bold">{t('account.title')}</h1>

      <Section id="perfil" title={t('account.profileSection')}>
        <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">{t('account.name')}</dt>
          <dd className="font-medium">{me.name}</dd>
          <dt className="text-muted-foreground">{t('account.email')}</dt>
          <dd className="font-medium break-all">{me.email}</dd>
        </dl>
      </Section>

      {(myFields.data?.fields.length ?? 0) > 0 && (
        <Section
          id="meus-dados"
          title={t('userFields.values.accountSection')}
          hint={t('userFields.values.accountIntro')}
        >
          <MyFieldsSection />
        </Section>
      )}

      <Section id="foto" title={t('account.photo.section')}>
        <PhotoSection />
      </Section>

      {me?.appearance.allowed && (
        <Section id="aparencia" title={t('account.appearance.section')} hint={t('account.appearance.hint')}>
          <AppearanceSection />
        </Section>
      )}

      <Section id="preferencias" title={t('account.preferencesSection')} hint={t('account.preferencesHint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.language')}>
            <NativeSelect
              value={isLanguage(i18n.language) ? i18n.language : 'pt-BR'}
              onChange={(e) => isLanguage(e.target.value) && updatePreferences({ locale: e.target.value })}
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {t(`common.languages.${l}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('common.theme')}>
            <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as ThemeMode)}>
              {(['system', 'light', 'dark'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`common.themes.${m}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div className="mt-4 flex items-start gap-2 text-sm">
          <Checkbox
            id="ocultar-nome"
            checked={me?.hideName ?? false}
            onCheckedChange={(v) => updatePreferences({ hideName: v === true })}
          />
          <label htmlFor="ocultar-nome">
            {t('account.hideName')}
            <span className="block text-xs text-muted-foreground">{t('account.hideNameHint')}</span>
          </label>
        </div>
      </Section>

      <Section id="notificacoes" title={t('account.notificationsSection')} hint={t('account.notificationsHint')}>
        <NotificationPreferencesForm />
      </Section>

      <Section id="senha" title={t('account.passwordSection')}>
        <form noValidate onSubmit={form.handleSubmit((v) => change.mutate(v))} className="max-w-sm space-y-4">
          <Field label={t('account.currentPassword')} error={errors.current?.message}>
            <PasswordInput autoComplete="current-password" {...form.register('current')} />
          </Field>
          <Field label={t('account.newPassword')} error={errors.password?.message}>
            <PasswordInput autoComplete="new-password" {...form.register('password')} />
          </Field>
          <PasswordPolicyHints password={form.watch('password')} policy={policy} />
          <Field label={t('account.confirmPassword')} error={errors.confirm?.message}>
            <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <FormError message={change.isError ? errorText(t, change.error) : null} />
          {change.isSuccess && (
            <p role="status" className="flex items-start gap-2 text-sm">
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-done)" />
              {t('account.passwordChanged')}
            </p>
          )}
          <Button type="submit" disabled={change.isPending}>
            {change.isPending ? t('account.submitting') : t('account.submit')}
          </Button>
        </form>
      </Section>
    </div>
  );
}
