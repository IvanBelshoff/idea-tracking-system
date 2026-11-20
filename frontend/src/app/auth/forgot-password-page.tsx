import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthLayout, FormError } from './auth-layout';

/**
 * "Esqueci minha senha" (RN-42). A resposta é a mesma, exista ou não a conta: a tela nunca diz se o
 * e-mail está cadastrado. O link chega por e-mail (só com o envio ligado na instalação).
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const schema = z.object({
    email: z
      .string()
      .trim()
      .pipe(z.email(t('validation.email'))),
  });
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '' } });
  const request = useMutation({
    meta: { silent: true },
    mutationFn: (body: FormValues) => unwrap(api.POST('/api/auth/password-reset/request', { body })),
  });

  return (
    <AuthLayout access pageTitle={t('forgot.pageTitle')} title={t('forgot.title')}>
      {request.isSuccess ? (
        <div role="status" className="space-y-4">
          <p className="flex items-start gap-2 text-sm">
            <MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-done)" />
            {t('forgot.sent')}
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/entrar">{t('forgot.backToLogin')}</Link>
          </Button>
        </div>
      ) : (
        <form noValidate onSubmit={form.handleSubmit((v) => request.mutate(v))} className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('forgot.intro')}</p>
          <Field label={t('login.email')} error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="username" inputMode="email" autoFocus {...form.register('email')} />
          </Field>
          <FormError message={request.isError ? errorText(t, request.error) : null} />
          <Button type="submit" className="w-full" disabled={request.isPending}>
            {request.isPending ? t('forgot.submitting') : t('forgot.submit')}
          </Button>
          <p className="text-sm">
            <Link to="/entrar" className="text-primary underline-offset-4 hover:underline">
              {t('forgot.backToLogin')}
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
