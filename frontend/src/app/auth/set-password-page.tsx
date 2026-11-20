import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field } from '@/components/form/field';
import { PasswordInput, PasswordPolicyHints } from '@/components/form/password';
import { Button, buttonVariants } from '@/components/ui/button';
import { DEFAULT_POLICY, meetsPolicy } from '@/lib/password-policy';
import { usePublicSettings } from '../session';
import { AuthLayout, FormError } from './auth-layout';

/**
 * "Definir senha" pelo link de uso único (usuário novo ou recuperação). O token vem depois do
 * `#` no endereço: essa parte nunca é enviada ao servidor, então não aparece em log de acesso.
 */
export function SetPasswordPage() {
  const { t } = useTranslation();
  const [token] = useState(() => window.location.hash.slice(1));
  const [done, setDone] = useState(false);
  const { data: settings } = usePublicSettings();
  const policy = settings?.passwordPolicy ?? DEFAULT_POLICY;

  const schema = z
    .object({
      password: z.string().refine((p) => meetsPolicy(p, policy), t('errors.weak_password')),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: t('validation.passwordMismatch') });
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const { errors } = form.formState;

  const redeem = useMutation({
    meta: { silent: true },
    mutationFn: ({ password }: FormValues) =>
      unwrap(api.POST('/api/auth/password-reset/redeem', { body: { token, newPassword: password } })),
    onSuccess: () => {
      // Tira o token do endereço e do histórico do navegador.
      window.history.replaceState(null, '', window.location.pathname);
      setDone(true);
    },
  });

  if (done) {
    return (
      <AuthLayout access pageTitle={t('setPassword.pageTitle')} title={t('setPassword.doneTitle')}>
        <p className="flex items-start gap-2 text-sm" role="status">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-done)" />
          {t('setPassword.doneText')}
        </p>
        <Link to="/entrar" className={`${buttonVariants()} mt-6 w-full`}>
          {t('setPassword.goToLogin')}
        </Link>
      </AuthLayout>
    );
  }

  if (token.length < 20) {
    return (
      <AuthLayout access pageTitle={t('setPassword.pageTitle')} title={t('setPassword.title')}>
        <FormError message={t('setPassword.missingToken')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      access
      pageTitle={t('setPassword.pageTitle')}
      title={t('setPassword.title')}
      intro={t('setPassword.intro')}
    >
      <form noValidate onSubmit={form.handleSubmit((v) => redeem.mutate(v))} className="space-y-4">
        <Field label={t('setPassword.newPassword')} error={errors.password?.message}>
          <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
        </Field>
        <PasswordPolicyHints password={form.watch('password')} policy={policy} />
        <Field label={t('setPassword.confirmPassword')} error={errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <FormError message={redeem.isError ? errorText(t, redeem.error) : null} />
        <Button type="submit" className="w-full" disabled={redeem.isPending}>
          {redeem.isPending ? t('setPassword.submitting') : t('setPassword.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
