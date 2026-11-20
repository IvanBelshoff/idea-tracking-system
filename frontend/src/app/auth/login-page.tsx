import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useRouter, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field } from '@/components/form/field';
import { PasswordInput } from '@/components/form/password';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMe, usePublicSettings, useSetSession } from '../session';
import { AuthLayout, FormError } from './auth-layout';
import { SsoButtons } from './sso-buttons';

/** Só caminhos internos (evita redirecionamento aberto para outro site depois do login). */
export function safeReturnPath(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}

/** Texto do erro que o login corporativo devolve na URL (`?sso_erro=`); código desconhecido vira o genérico. */
function ssoErrorText(t: (key: never) => string, code: string): string {
  const key = `errors.${code}`;
  const text = t(key as never);
  return text === key ? t('errors.unknown' as never) : text;
}

export function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { voltar, sso_erro: ssoError } = useSearch({ from: '/instalacao/entrar' });
  const back = safeReturnPath(voltar ?? null);
  const { data: me } = useMe();
  const { data: settings } = usePublicSettings();
  const setSession = useSetSession();
  // Modo "Só SSO": o formulário de senha fica escondido, atrás do acesso de emergência.
  const [emergency, setEmergency] = useState(false);
  const sso = settings?.sso;
  const providers = sso?.providers ?? [];
  const ssoOnly = sso?.mode === 'sso' && providers.length > 0;
  const showPassword = !ssoOnly || emergency;

  const schema = z.object({
    email: z
      .string()
      .trim()
      .pipe(z.email(t('validation.email'))),
    password: z.string().min(1, t('validation.required')),
  });
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  const { errors } = form.formState;

  const login = useMutation({
    meta: { silent: true },
    mutationFn: (body: FormValues) => unwrap(api.POST('/api/auth/login', { body })),
    onSuccess: (data) => {
      setSession(data);
      // O retorno é um endereço livre (já validado como interno): vai direto pelo histórico.
      router.history.replace(back);
    },
    onError: () => form.setValue('password', ''),
  });

  // Já logado: segue para onde ia.
  useEffect(() => {
    if (me) router.history.replace(back);
  }, [me, back, router]);
  if (me) return null;

  return (
    <AuthLayout access pageTitle={t('login.pageTitle')} title={t('login.title')}>
      {ssoError && (
        <div className="mb-4">
          <FormError message={ssoErrorText(t, ssoError)} />
        </div>
      )}
      {providers.length > 0 && (
        <div className={showPassword ? 'mb-4' : ''}>
          {ssoOnly && <p className="mb-3 text-sm text-muted-foreground">{t('login.sso.only')}</p>}
          <SsoButtons providers={providers} back={back} />
          {showPassword && (
            <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              {t('login.sso.or')}
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
        </div>
      )}
      {ssoOnly && !emergency && (
        <button
          type="button"
          onClick={() => setEmergency(true)}
          className="mt-4 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t('login.sso.emergency')}
        </button>
      )}
      {showPassword && (
        <form noValidate onSubmit={form.handleSubmit((v) => login.mutate(v))} className="space-y-4">
          <Field label={t('login.email')} error={errors.email?.message}>
            <Input type="email" autoComplete="username" inputMode="email" autoFocus {...form.register('email')} />
          </Field>
          <Field label={t('login.password')} error={errors.password?.message}>
            <PasswordInput autoComplete="current-password" {...form.register('password')} />
          </Field>
          <FormError message={login.isError ? errorText(t, login.error) : null} />
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? t('login.submitting') : t('login.submit')}
          </Button>
          {settings?.emailEnabled ? (
            <p className="text-sm">
              <Link to="/esqueci-senha" className="font-medium text-primary underline-offset-4 hover:underline">
                {t('login.forgotLink')}
              </Link>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('login.forgot')}</p>
          )}
        </form>
      )}
    </AuthLayout>
  );
}
