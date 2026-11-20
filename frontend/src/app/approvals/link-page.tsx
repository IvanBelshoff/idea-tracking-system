import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiError, errorText, unwrap } from '@/api/errors';
import { tokenFromHash } from '@/lib/approvals';
import { notify } from '@/lib/toast';
import { AuthLayout, FormError } from '../auth/auth-layout';
import { DecisionForm, SnapshotView } from './approval-parts';
import { type ApprovalLinkView, downloadWithToken } from './queries';

/** Pede ao navegador e aos buscadores que não indexem a página do link (RN-184). */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.append(meta);
    return () => meta.remove();
  }, []);
}

/**
 * Página do link de uso único (RN-184, RN-185), sem login. O link vem depois do `#`: essa parte nunca
 * vai ao servidor no endereço; vai só no corpo das chamadas. A página mostra só o que o pedido congelou.
 */
export function ApprovalLinkPage() {
  const { t } = useTranslation();
  useNoIndex();
  const [token] = useState(() => tokenFromHash(window.location.hash));
  const [answered, setAnswered] = useState<ApprovalLinkView | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const view = useQuery({
    queryKey: ['approvals', 'link', token],
    queryFn: () => unwrap(api.POST('/api/approvals/link/view', { body: { token: token ?? '' } })),
    enabled: token !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const sendCode = useMutation({
    meta: { success: t('approvals.feedback.codeSent') },
    mutationFn: () => unwrap(api.POST('/api/approvals/link/code', { body: { token: token ?? '' } })),
    onSuccess: () => setCodeSent(true),
  });
  const decide = useMutation({
    // A própria página troca para "Resposta registrada": o aviso na tela seria repetido.
    meta: { silent: true },
    mutationFn: (v: { decision: 'approved' | 'rejected'; comment: string; name: string; code: string }) =>
      unwrap(
        api.POST('/api/approvals/link/decide', {
          body: {
            token: token ?? '',
            decision: v.decision,
            comment: v.comment,
            name: v.name,
            ...(view.data?.codeRequired ? { code: v.code } : {}),
          },
        }),
      ),
    onSuccess: (data) => {
      // O link usado não vale mais: tira-o do endereço e do histórico do navegador.
      window.history.replaceState(null, '', window.location.pathname);
      setAnswered(data);
    },
  });
  const download = (file: { id: string; originalName: string }) => {
    if (!token) return;
    downloadWithToken(token, file.id, file.originalName).catch((e: unknown) => notify.error(errorText(t, e)));
  };

  const shell = (title: string, body: React.ReactNode, intro?: string) => (
    <AuthLayout wide help="approve" pageTitle={t('approvals.link.pageTitle')} title={title} intro={intro}>
      {body}
    </AuthLayout>
  );

  if (token === null) return shell(t('approvals.link.title'), <FormError message={t('approvals.link.missing')} />);
  if (view.isPending) return shell(t('approvals.link.title'), <p className="text-sm">{t('common.loading')}</p>);
  if (view.isError) {
    const gone = view.error instanceof ApiError && view.error.status === 404;
    return shell(
      t('approvals.link.title'),
      <FormError message={gone ? t('approvals.link.notFound') : errorText(t, view.error)} />,
    );
  }

  const current = answered ?? view.data;
  if (current.state !== 'open' || !current.request) {
    const state = current.state === 'open' ? 'closed' : current.state;
    const text =
      state === 'decided'
        ? current.decision === 'approved'
          ? t('approvals.link.texts.approved')
          : current.decision === 'rejected'
            ? t('approvals.link.texts.rejected')
            : t('approvals.link.texts.decided')
        : t(`approvals.link.texts.${state}`);
    const Icon = state !== 'decided' ? Clock : current.decision === 'rejected' ? CircleX : CircleCheck;
    return shell(
      t(`approvals.link.states.${state}`),
      <p className="flex items-start gap-2 text-sm" role="status">
        <Icon
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 ${state === 'decided' ? (current.decision === 'rejected' ? 'text-(--st-rejected)' : 'text-(--st-done)') : 'text-muted-foreground'}`}
        />
        {text}
      </p>,
    );
  }

  const request = current.request;
  return shell(
    t('approvals.link.title'),
    <div className="grid gap-6">
      <SnapshotView snapshot={request} onDownload={download} />
      <hr className="border-border" />
      <DecisionForm
        askName
        defaultName={request.name}
        code={
          current.codeRequired
            ? { onSend: () => sendCode.mutate(), sending: sendCode.isPending, sent: codeSent }
            : undefined
        }
        pending={decide.isPending}
        error={decide.isError ? errorText(t, decide.error) : null}
        onSubmit={(v) => decide.mutate(v)}
      />
    </div>,
    t('approvals.link.intro', { name: request.name }),
  );
}
