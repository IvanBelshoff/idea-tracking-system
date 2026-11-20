import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { EyeOff, Megaphone, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { AdminPage } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { IdCode } from '../ideas/ui';
import { usePageTitle } from '../page-title';
import { useMe, usePublicSettings } from '../session';
import { useDates } from '../use-dates';
import { ReasonDialog } from './mural-pages';
import { PersonLine } from './mural-parts';
import { type MuralPublication, muralKeys, useMuralPublication, useMuralReports } from './queries';

/**
 * O mural na página da ideia (RN-149, RN-151): a equipe publica e retira; o participante decide se
 * o nome aparece. Some com o módulo desligado.
 */
export function MuralIdeaCard({ code }: { code: string }) {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  const { data: me } = useMe();
  const enabled = settings?.mural.enabled === true;
  const pub = useMuralPublication(code, enabled);
  const [confirming, setConfirming] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const set = (data: MuralPublication) => {
    qc.setQueryData(muralKeys.publication(code), data);
    void qc.invalidateQueries({ queryKey: ['mural', 'feed'] });
    void qc.invalidateQueries({ queryKey: ['ideas'] });
  };
  const publish = useMutation({
    meta: { success: t('feedback.mural.published') },
    mutationFn: () => unwrap(api.POST('/api/mural/ideas/{ref}/publish', { params: { path: { ref: code } } })),
    onSuccess: (data) => {
      set(data);
      setConfirming(false);
    },
  });
  const consent = useMutation({
    meta: {
      success: (_d, accept: boolean) => (accept ? t('feedback.mural.consentYes') : t('feedback.mural.consentNo')),
    },
    mutationFn: (accept: boolean) =>
      unwrap(api.PUT('/api/mural/ideas/{ref}/consent', { params: { path: { ref: code } }, body: { accept } })),
    onSuccess: set,
  });
  if (!enabled || !pub.data) return null;
  const p = pub.data;
  if (!p.canManage && p.myConsent === null && p.status !== 'published') return null;

  const statusText =
    p.status === 'published'
      ? t('mural.manage.published', { date: dates.date(p.publishedAt) })
      : p.status === 'withdrawn'
        ? t('mural.manage.withdrawn', { date: dates.date(p.withdrawnAt) })
        : t('mural.manage.notPublished');
  const autoText = p.withdrawnAutomatically
    ? p.withdrawnReason === 'idea_archived'
      ? t('mural.manage.autoArchived')
      : t('mural.manage.autoRejected')
    : null;

  return (
    <section aria-labelledby="mural-ideia" className="rounded-lg border bg-card p-5">
      <h2 id="mural-ideia" className="flex items-center gap-2 font-semibold">
        <Megaphone aria-hidden="true" className="size-4" />
        {t('mural.manage.title')}
      </h2>
      <p className="mt-2 text-sm">{statusText}</p>
      {autoText && <p className="mt-1 text-sm text-muted-foreground">{autoText}</p>}
      {p.status === 'withdrawn' && !p.withdrawnAutomatically && p.withdrawnReason && p.canManage && (
        <p className="mt-1 text-sm text-muted-foreground">
          {t('mural.manage.withdrawnReason', { reason: p.withdrawnReason })}
        </p>
      )}
      {p.status === 'published' && (
        <p className="mt-2">
          <Link to="/mural/$ref" params={{ ref: code }} className="text-sm underline underline-offset-4">
            {t('mural.open')}
          </Link>
        </p>
      )}
      {p.canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          {p.status !== 'published' &&
            (p.publishable ? (
              <Button size="sm" onClick={() => setConfirming(true)}>
                <Megaphone aria-hidden="true" />
                {p.status === 'withdrawn' ? t('mural.manage.republish') : t('mural.manage.publish')}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">{t('mural.manage.notPublishable')}</p>
            ))}
          {p.status === 'published' && (
            <Button size="sm" variant="outline" onClick={() => setWithdrawing(true)}>
              <Undo2 aria-hidden="true" />
              {t('mural.manage.withdraw')}
            </Button>
          )}
        </div>
      )}
      {p.myConsent === 'pending' && (
        <div className="mt-4 rounded-md border border-primary/50 bg-primary/5 p-3 text-sm">
          <p>{t('mural.consent.question')}</p>
          {me?.hideName && <p className="mt-1 text-xs text-muted-foreground">{t('mural.consent.hideNameNote')}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={consent.isPending} onClick={() => consent.mutate(true)}>
              {t('mural.consent.accept')}
            </Button>
            <Button size="sm" variant="outline" disabled={consent.isPending} onClick={() => consent.mutate(false)}>
              <EyeOff aria-hidden="true" />
              {t('mural.consent.decline')}
            </Button>
          </div>
        </div>
      )}
      {(p.myConsent === 'accepted' || p.myConsent === 'declined') && (
        <p className="mt-3 text-xs text-muted-foreground">
          {p.myConsent === 'accepted' ? t('mural.consent.accepted') : t('mural.consent.declined')}{' '}
          <button
            type="button"
            className="underline underline-offset-4"
            disabled={consent.isPending}
            onClick={() => consent.mutate(p.myConsent !== 'accepted')}
          >
            {t('mural.consent.change')}
          </button>
        </p>
      )}
      <FormError message={consent.isError ? errorText(t, consent.error) : null} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('mural.manage.publishTitle')}
        description={t('mural.manage.publishText')}
        confirmLabel={t('mural.manage.publishConfirm')}
        cancelLabel={t('mural.cancel')}
        pending={publish.isPending}
        onConfirm={() => publish.mutate()}
      >
        <p className="rounded-md border border-(--st-late) bg-(--st-late)/10 p-3 text-sm">
          {t('mural.manage.secrecy')}
        </p>
        <FormError message={publish.isError ? errorText(t, publish.error) : null} />
      </ConfirmDialog>
      {withdrawing && (
        <ReasonDialog
          title={t('mural.manage.withdrawTitle')}
          label={t('mural.manage.withdrawReason')}
          hint={t('mural.manage.withdrawHint')}
          confirm={t('mural.manage.withdrawConfirm')}
          success={t('feedback.mural.withdrawn')}
          onClose={() => setWithdrawing(false)}
          onSend={(reason) =>
            unwrap(
              api.POST('/api/mural/ideas/{ref}/withdraw', { params: { path: { ref: code } }, body: { reason } }),
            ).then(set)
          }
        />
      )}
    </section>
  );
}

/** A fila de denúncias (RN-154): comentários denunciados das entidades que a pessoa modera. */
export function MuralReportsPage() {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  usePageTitle(t('mural.reports.pageTitle'), settings?.organizationName);
  const list = useMuralReports();
  const [hiding, setHiding] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const dismiss = useMutation({
    meta: { success: t('feedback.mural.dismissed') },
    mutationFn: (id: string) => unwrap(api.POST('/api/mural/comments/{id}/dismiss', { params: { path: { id } } })),
    onSuccess: (data) => {
      qc.setQueryData(muralKeys.reports, data);
      setDismissing(null);
    },
  });
  return (
    <AdminPage title={t('mural.reports.title')} intro={t('mural.reports.intro')} help="muralModerate">
      <FormError message={list.isError ? errorText(t, list.error) : null} />
      {list.data && list.data.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t('mural.reports.empty')}</p>
      ) : (
        <ul className="grid gap-4">
          {list.data?.map((r) => (
            <li key={r.commentId}>
              <article className="rounded-lg border bg-card p-5 text-sm" aria-labelledby={`den-${r.commentId}`}>
                <h2 id={`den-${r.commentId}`} className="flex flex-wrap items-center gap-2 font-semibold">
                  {t('mural.reports.count', { count: r.count })}
                  <span className="text-xs font-normal text-muted-foreground">
                    {t('mural.reports.since', { date: dates.dateTime(r.firstReportedAt) })}
                  </span>
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  <IdCode code={r.ideaCode} /> · {r.ideaTitle}
                </p>
                <div className="mt-3 rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">
                    <PersonLine person={r.author} /> · {dates.dateTime(r.commentedAt)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap wrap-break-word">{r.body}</p>
                </div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {r.reasons.map((x) => (
                    <li key={x.reason} className="rounded-full border px-2.5 py-0.5 text-xs">
                      {t(`mural.reportReasons.${x.reason as 'other'}`)} · {x.count}
                    </li>
                  ))}
                </ul>
                {r.notes.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium">{t('mural.reports.notes')}</summary>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {r.notes.map((n, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: lista fixa vinda do servidor, sem reordenar
                        <li key={i} className="whitespace-pre-wrap">
                          {t(`mural.reportReasons.${n.reason as 'other'}`)}: {n.note}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setHiding(r.commentId)}>
                    <EyeOff aria-hidden="true" />
                    {t('mural.hide')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDismissing(r.commentId)}>
                    {t('mural.reports.dismiss')}
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/mural/$ref" params={{ ref: r.ideaCode }} hash="conversa">
                      {t('mural.reports.open')}
                    </Link>
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={dismissing !== null}
        onOpenChange={(o) => !o && setDismissing(null)}
        title={t('mural.reports.dismissTitle')}
        description={t('mural.reports.dismissText')}
        confirmLabel={t('mural.reports.dismiss')}
        cancelLabel={t('mural.cancel')}
        pending={dismiss.isPending}
        onConfirm={() => dismissing && dismiss.mutate(dismissing)}
      >
        <FormError message={dismiss.isError ? errorText(t, dismiss.error) : null} />
      </ConfirmDialog>
      {hiding && (
        <ReasonDialog
          title={t('mural.hideTitle')}
          label={t('mural.hideReason')}
          confirm={t('mural.hide')}
          success={t('feedback.mural.hidden')}
          onClose={() => setHiding(null)}
          onSend={(reason) =>
            unwrap(
              api.POST('/api/mural/comments/{id}/hide', { params: { path: { id: hiding } }, body: { reason } }),
            ).then(() => void qc.invalidateQueries({ queryKey: muralKeys.reports }))
          }
        />
      )}
    </AdminPage>
  );
}
