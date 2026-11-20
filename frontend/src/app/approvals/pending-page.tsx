import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { buttonVariants } from '@/components/ui/button';
import { FormError } from '../auth/auth-layout';
import { HelpLink } from '../help';
import { ideaKeys } from '../ideas/queries';
import { usePageTitle } from '../page-title';
import { usePublicSettings } from '../session';
import { useDates } from '../use-dates';
import { ApprovalPill, DecisionForm, SnapshotView } from './approval-parts';
import { approvalKeys, type MyPendingApproval, myAttachmentUrl, useMyPendingApprovals } from './queries';

function PendingItem({ item }: { item: MyPendingApproval }) {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const decide = useMutation({
    meta: { success: t('approvals.feedback.decided') },
    mutationFn: (v: { decision: 'approved' | 'rejected'; comment: string }) =>
      unwrap(
        api.POST('/api/approvals/recipients/{recipientId}/decide', {
          params: { path: { recipientId: item.recipientId } },
          body: { decision: v.decision, comment: v.comment },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: approvalKeys.pending });
      void qc.invalidateQueries({ queryKey: approvalKeys.idea(item.ideaCode) });
      void qc.invalidateQueries({ queryKey: ideaKeys.timeline(item.ideaCode) });
    },
  });
  const titleId = `aprovacao-${item.recipientId}`;
  return (
    <li>
      <article aria-labelledby={titleId} className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 id={titleId} className="min-w-0 font-semibold break-words">
            {item.ideaCode} · {item.ideaTitle}
          </h2>
          <ApprovalPill tone="pending" label={t('approvals.card.due', { date: dates.day(item.dueOn) })} />
        </div>
        <div className="mt-4">
          <SnapshotView
            snapshot={item}
            onDownload={(f) => window.open(myAttachmentUrl(item.recipientId, f.id), '_blank', 'noopener')}
          />
        </div>
        {/* Abrir a ideia só para quem já podia vê-la (RN-186, CA-RN-186.3). */}
        {item.canOpenIdea && (
          <Link
            to="/ideias/$ref"
            params={{ ref: item.ideaCode }}
            className={`${buttonVariants({ variant: 'outline', size: 'sm' })} mt-4`}
          >
            {t('approvals.pending.openIdea')}
            <ArrowRight aria-hidden="true" />
          </Link>
        )}
        <hr className="my-5 border-border" />
        <DecisionForm
          pending={decide.isPending}
          error={decide.isError ? errorText(t, decide.error) : null}
          onSubmit={(v) => decide.mutate(v)}
        />
      </article>
    </li>
  );
}

/** Aprovações pendentes (RN-186): as decisões que a equipe de melhoria espera da pessoa. */
export function PendingApprovalsPage() {
  const { t } = useTranslation();
  const { data: settings } = usePublicSettings();
  usePageTitle(t('approvals.pending.pageTitle'), settings?.organizationName);
  const list = useMyPendingApprovals();
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-[1.75rem] leading-tight font-bold">{t('approvals.pending.title')}</h1>
          <span className="pt-1">
            <HelpLink topic="approve" />
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('approvals.pending.intro')}</p>
      </header>
      {list.isError && <FormError message={errorText(t, list.error)} />}
      {list.data && list.data.length === 0 && (
        <p className="flex items-center gap-2 rounded-lg border bg-card p-5 text-sm text-muted-foreground">
          <Inbox aria-hidden="true" className="size-5" />
          {t('approvals.pending.empty')}
        </p>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="grid gap-6">
          {list.data.map((item) => (
            <PendingItem key={item.recipientId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
