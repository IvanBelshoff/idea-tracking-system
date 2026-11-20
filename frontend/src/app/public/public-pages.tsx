import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Check, Circle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiError, unwrap } from '@/api/errors';
import { Field } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthLayout, FormError } from '../auth/auth-layout';
import { LateBadge } from '../ideas/steps-panel';
import { CategoryTag, IdeaStatusBadge } from '../ideas/ui';
import { useDates } from '../use-dates';

/** Pede que buscadores ignorem as páginas de consulta (o código é um segredo de quem recebeu o link). */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.append(meta);
    return () => meta.remove();
  }, []);
}

/** Entrada da consulta pública: a pessoa cola o código de acompanhamento (RN-33, RN-34). */
export function PublicLookupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  useNoIndex();
  const clean = code.trim();
  return (
    <AuthLayout
      pageTitle={t('publicView.pageTitle')}
      title={t('publicView.lookupTitle')}
      intro={t('publicView.lookupIntro')}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) void navigate({ to: '/consulta/$code', params: { code: clean } });
        }}
        className="space-y-4"
      >
        <Field label={t('publicView.codeLabel')} hint={t('publicView.codeHint')}>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            className="font-mono"
          />
        </Field>
        <Button type="submit" className="w-full" disabled={!clean}>
          {t('publicView.lookup')}
        </Button>
      </form>
    </AuthLayout>
  );
}

/**
 * Resultado da consulta (RN-35): título, categoria, situação, etapas e prazo, e mais nada. Código
 * inexistente, consulta desativada pela ideia ou desligada na instalação mostram a MESMA mensagem.
 */
export function PublicIdeaPage() {
  const { t } = useTranslation();
  const dates = useDates();
  const { code } = useParams({ from: '/instalacao/consulta/$code' });
  useNoIndex();
  const idea = useQuery({
    queryKey: ['public', 'idea', code],
    queryFn: () => unwrap(api.GET('/api/public/ideas/{code}', { params: { path: { code } } })),
    retry: false,
  });

  if (idea.isPending) return null;
  if (idea.isError) {
    const tooMany = idea.error instanceof ApiError && idea.error.status === 429;
    return (
      <AuthLayout pageTitle={t('publicView.pageTitle')} title={t('publicView.notFoundTitle')}>
        <FormError message={tooMany ? t('publicView.tooMany') : t('publicView.notFound')} />
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link to="/consulta">{t('publicView.tryAnother')}</Link>
        </Button>
      </AuthLayout>
    );
  }

  const i = idea.data;
  return (
    <AuthLayout pageTitle={i.title} title={i.title} wide>
      <div className="flex flex-wrap items-center gap-2">
        <IdeaStatusBadge status={i.status} size="lg" />
        {i.late && <LateBadge />}
        <CategoryTag category={i.category} />
      </div>
      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t('publicView.submittedAt')}</dt>
          <dd className="font-medium">{dates.date(i.submittedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('publicView.deadline')}</dt>
          <dd className="font-medium">{i.deadline ? dates.day(i.deadline) : t('publicView.noDeadline')}</dd>
        </div>
      </dl>

      <h2 className="mt-6 font-semibold">{t('publicView.steps')}</h2>
      {i.steps.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('publicView.noSteps')}</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {i.steps.map((s) => (
            <li key={s.position} className="flex gap-3 text-sm">
              {s.completedAt ? (
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-done)" />
              ) : (
                <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span>
                <span className="font-medium">
                  {s.position}. {s.name}
                </span>
                <span className="block text-muted-foreground">
                  {s.completedAt
                    ? t('publicView.stepDone', { date: dates.date(s.completedAt) })
                    : t('publicView.stepDue', { date: dates.day(s.dueDate) })}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">{t('publicView.privacy')}</p>
    </AuthLayout>
  );
}
