import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { PasswordInput, PasswordPolicyHints } from '@/components/form/password';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { applyLanguage, isLanguage, LANGUAGES } from '@/i18n';
import { browserTimeZone } from '@/lib/dates';
import { DEFAULT_POLICY, meetsPolicy } from '@/lib/password-policy';
import { usePublicSettings, useSetSession } from '../session';
import { AuthLayout, FormError } from './auth-layout';

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['America/Sao_Paulo', 'UTC'];
  }
}

/** Assistente de instalação (RN-43): aparece só com o banco vazio. Cria organização e admin. */
export function InstallPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSession = useSetSession();
  const { data: settings } = usePublicSettings();
  const policy = settings?.passwordPolicy ?? DEFAULT_POLICY;
  const zones = useMemo(timeZones, []);
  const browserZone = browserTimeZone();

  const schema = z
    .object({
      organizationName: z.string().trim().min(1, t('validation.required')).max(200),
      timezone: z.string().min(1),
      locale: z.enum(LANGUAGES),
      adminName: z.string().trim().min(1, t('validation.required')).max(200),
      adminEmail: z
        .string()
        .trim()
        .pipe(z.email(t('validation.email'))),
      password: z.string().refine((p) => meetsPolicy(p, policy), t('errors.weak_password')),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: t('validation.passwordMismatch') });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      organizationName: '',
      timezone: zones.includes(browserZone) ? browserZone : 'America/Sao_Paulo',
      locale: 'pt-BR',
      adminName: '',
      adminEmail: '',
      password: '',
      confirm: '',
    },
  });
  const { errors } = form.formState;
  // O idioma padrão da instalação é o português; a tela do assistente começa nele.
  useEffect(() => applyLanguage('pt-BR', false), []);

  const install = useMutation({
    meta: { success: t('feedback.install.done') },
    mutationFn: ({ confirm: _c, ...body }: FormValues) => unwrap(api.POST('/api/install', { body })),
    onSuccess: (me) => {
      setSession(me);
      void navigate({ to: '/', replace: true });
    },
  });

  return (
    <AuthLayout pageTitle={t('install.pageTitle')} title={t('install.title')} intro={t('install.intro')} wide>
      <form noValidate onSubmit={form.handleSubmit((v) => install.mutate(v))} className="space-y-8">
        <fieldset className="space-y-4">
          <legend className="mb-1 w-full border-b pb-2 text-sm font-semibold">
            {t('install.organizationSection')}
          </legend>
          <Field
            label={t('install.organizationName')}
            hint={t('install.organizationNameHint')}
            error={errors.organizationName?.message}
          >
            <Input autoComplete="organization" {...form.register('organizationName')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('install.timezone')} hint={t('install.timezoneHint')}>
              <NativeSelect {...form.register('timezone')}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll('_', ' ')}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t('install.defaultLanguage')}>
              <NativeSelect
                {...form.register('locale', {
                  onChange: (e) => isLanguage(e.target.value) && applyLanguage(e.target.value),
                })}
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`common.languages.${l}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-1 w-full border-b pb-2 text-sm font-semibold">{t('install.adminSection')}</legend>
          <Field label={t('install.adminName')} error={errors.adminName?.message}>
            <Input autoComplete="name" {...form.register('adminName')} />
          </Field>
          <Field label={t('install.adminEmail')} hint={t('install.adminEmailHint')} error={errors.adminEmail?.message}>
            <Input type="email" autoComplete="username" inputMode="email" {...form.register('adminEmail')} />
          </Field>
          <Field label={t('install.password')} error={errors.password?.message}>
            <PasswordInput autoComplete="new-password" {...form.register('password')} />
          </Field>
          <PasswordPolicyHints password={form.watch('password')} policy={policy} />
          <Field label={t('install.confirmPassword')} error={errors.confirm?.message}>
            <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
          </Field>
        </fieldset>

        <FormError message={install.isError ? errorText(t, install.error) : null} />
        <Button type="submit" className="w-full" disabled={install.isPending}>
          {install.isPending ? t('install.submitting') : t('install.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
