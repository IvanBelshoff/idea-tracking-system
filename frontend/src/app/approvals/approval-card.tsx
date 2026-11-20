import { useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Paperclip, Stamp, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SensitiveText } from '@/components/form/sensitive';
import { Button } from '@/components/ui/button';
import { approvalProgress, canOverride, holdOptions } from '@/lib/approvals';
import { HelpLink } from '../help';
import { downloadUrl } from '../ideas/idea-attachments';
import type { IdeaDetail } from '../ideas/queries';
import { useDates } from '../use-dates';
import { ApprovalReasonDialog, RecordDialog, RequestDialog } from './approval-dialogs';
import { ApprovalPill, decisionTone, requestTone, useGainText } from './approval-parts';
import {
  type ApprovalRecipient,
  type ApprovalRequest,
  type ApprovalsView,
  approvalKeys,
  evidenceUrl,
  useIdeaApprovals,
} from './queries';

const STATE_TONE = { none: 'muted', pending: 'pending', approved: 'approved', not_approved: 'rejected' } as const;

/**
 * O selo no topo da ideia (RN-188, RN-190): a equipe vê "Aguardando aprovação: 1 de 2"; o autor, só a
 * situação. Some sem pedido.
 */
export function ApprovalHeaderBadge({ code }: { code: string }) {
  const { t } = useTranslation();
  const { data } = useIdeaApprovals(code);
  if (!data || data.state === 'none') return null;
  const latest = data.requests[0];
  if (data.state === 'pending' && latest) {
    return (
      <ApprovalPill
        size="lg"
        tone="pending"
        label={t('approvals.card.progress', approvalProgress(latest.recipients))}
      />
    );
  }
  return <ApprovalPill size="lg" tone={STATE_TONE[data.state]} label={t(`approvals.card.state.${data.state}`)} />;
}

function RecipientItem({
  code,
  request,
  recipient,
  onRecord,
}: {
  code: string;
  request: ApprovalRequest;
  recipient: ApprovalRecipient;
  onRecord?: () => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const when = recipient.decidedOn ? dates.day(recipient.decidedOn) : dates.dateTime(recipient.decidedAt);
  const sourceText =
    recipient.source === 'manual'
      ? t('approvals.card.source.manual', {
          by: recipient.recordedBy ?? '—',
          name: recipient.decidedName ?? '',
          date: when,
        })
      : recipient.source === 'link'
        ? t('approvals.card.source.link', { name: recipient.decidedName ?? '', date: when })
        : recipient.source === 'its'
          ? t('approvals.card.source.its', { date: when })
          : null;
  return (
    <li className="grid gap-1.5 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm">
          <span className="font-medium">{recipient.name}</span>
          {recipient.area && <span className="text-muted-foreground"> · {recipient.area}</span>}
          <span className="block text-xs text-muted-foreground">{t(`approvals.card.kind.${recipient.kind}`)}</span>
        </p>
        <ApprovalPill
          tone={decisionTone(recipient.decision)}
          label={t(`approvals.card.decision.${recipient.decision}`)}
        />
      </div>
      {/* O e-mail de quem é de fora abre oculto (RN-135, RN-190). */}
      {recipient.email && (
        <SensitiveText
          value={recipient.email}
          fieldLabel={t('approvals.card.emailField', { name: recipient.name })}
          className="text-sm text-muted-foreground"
        />
      )}
      {sourceText && <p className="text-xs text-muted-foreground">{sourceText}</p>}
      {recipient.comment && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{recipient.comment}</p>
      )}
      {recipient.evidence.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {recipient.evidence.map((f) => (
            <li key={f.id}>
              <a
                href={evidenceUrl(code, f.id)}
                className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-4 hover:underline"
              >
                <FileCheck2 aria-hidden="true" className="size-4 shrink-0" />
                <span className="sr-only">{t('approvals.card.evidence')}: </span>
                <span className="truncate">{f.originalName}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {onRecord && request.status === 'pending' && recipient.decision === 'pending' && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={onRecord}>
            {t('approvals.card.record')}
          </Button>
        </div>
      )}
    </li>
  );
}

function RequestDetails({
  code,
  request,
  onRecord,
}: {
  code: string;
  request: ApprovalRequest;
  onRecord?: (recipient: ApprovalRecipient) => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const gainText = useGainText();
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ApprovalPill tone={requestTone(request.status)} label={t(`approvals.card.status.${request.status}`)} />
        <span className="text-sm text-muted-foreground">{t(`approvals.card.holds.${request.holds}`)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('approvals.card.requestedBy', { name: request.requestedBy.name, date: dates.dateTime(request.createdAt) })}
        {' · '}
        {t('approvals.card.due', { date: dates.day(request.dueOn) })}
      </p>
      <div>
        <p className="text-sm font-medium">{t('approvals.card.summary')}</p>
        <p className="mt-1 text-sm whitespace-pre-wrap">{request.summary}</p>
      </div>
      {request.gain && (
        <p className="text-sm text-muted-foreground">
          {t('approvals.card.gainShown', { value: gainText(request.gain) })}
        </p>
      )}
      {request.attachments.length > 0 && (
        <div>
          <p className="text-sm font-medium">{t('approvals.card.attachmentsShown')}</p>
          <ul className="mt-1 grid gap-1 text-sm">
            {request.attachments.map((a) => (
              <li key={a.id}>
                <a
                  href={downloadUrl(code, a.id)}
                  className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  <Paperclip aria-hidden="true" className="size-4 shrink-0" />
                  <span className="truncate">{a.originalName}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="mb-2 text-sm font-medium">{t('approvals.card.recipients')}</p>
        <ul>
          {request.recipients.map((r) => (
            <RecipientItem
              key={r.id}
              code={code}
              request={request}
              recipient={r}
              onRecord={onRecord ? () => onRecord(r) : undefined}
            />
          ))}
        </ul>
      </div>
      {request.cancelReason && (
        <p className="text-sm text-muted-foreground">
          {t('approvals.card.cancelled', { reason: request.cancelReason })}
        </p>
      )}
      {request.overriddenAt && (
        <div className="text-sm">
          <p className="text-muted-foreground">
            {t('approvals.card.overridden', {
              name: request.overriddenBy ?? '—',
              date: dates.dateTime(request.overriddenAt),
            })}
          </p>
          {request.overrideReason && (
            <p className="mt-1 rounded-md bg-muted px-3 py-2 whitespace-pre-wrap">{request.overrideReason}</p>
          )}
        </div>
      )}
    </div>
  );
}

type Dialog =
  | { kind: 'request' }
  | { kind: 'record'; requestId: string; recipient: ApprovalRecipient }
  | { kind: 'cancel' | 'override'; requestId: string };

function FullCard({ idea, view }: { idea: IdeaDetail; view: ApprovalsView }) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [latest, ...earlier] = view.requests;
  const holds = holdOptions(idea.status);
  const canRequest =
    view.canManage && view.form !== null && holds.length > 0 && !idea.archivedAt && latest?.status !== 'pending';
  const notObtained = latest && (latest.status === 'rejected' || latest.status === 'expired') && !latest.overriddenAt;
  const manageOpen = view.canManage && latest?.status === 'pending';
  const waitingOutside =
    manageOpen &&
    view.form?.emailActive === false &&
    latest.recipients.some((r) => r.kind === 'external' && r.decision === 'pending');

  return (
    <section aria-labelledby="aprovacao" className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="aprovacao" className="flex items-center gap-2 font-semibold">
          <Stamp aria-hidden="true" className="size-4 text-muted-foreground" />
          {t('approvals.card.title')}
        </h2>
        <HelpLink topic="approvalRequest" />
      </div>
      {!latest && <p className="mt-2 text-sm text-muted-foreground">{t('approvals.card.intro')}</p>}
      {latest && (
        <div className="mt-4">
          <RequestDetails
            code={idea.code}
            request={latest}
            onRecord={
              manageOpen ? (recipient) => setDialog({ kind: 'record', requestId: latest.id, recipient }) : undefined
            }
          />
        </div>
      )}
      {waitingOutside && (
        <p className="mt-4 flex items-start gap-2 rounded-md border border-(--st-late)/40 bg-(--st-late)/5 px-3 py-2 text-sm">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-late)" />
          {t('approvals.card.emailOff')}
        </p>
      )}
      {notObtained && (
        <p className="mt-4 flex items-start gap-2 rounded-md border border-(--st-rejected)/40 bg-(--st-rejected)/5 px-3 py-2 text-sm">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-rejected)" />
          {t(`approvals.card.notObtained.${view.onReject}`)}
        </p>
      )}
      {(canRequest || manageOpen || canOverride(view)) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {canRequest && (
            <Button type="button" size="sm" onClick={() => setDialog({ kind: 'request' })}>
              {latest ? t('approvals.card.requestAgain') : t('approvals.card.request')}
            </Button>
          )}
          {canOverride(view) && latest && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialog({ kind: 'override', requestId: latest.id })}
            >
              {t('approvals.card.override')}
            </Button>
          )}
          {manageOpen && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialog({ kind: 'cancel', requestId: latest.id })}
            >
              {t('approvals.card.cancel')}
            </Button>
          )}
        </div>
      )}
      {earlier.length > 0 && (
        <details className="mt-4 rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">
            {t('approvals.card.history', { count: earlier.length })}
          </summary>
          <div className="mt-3 grid gap-5">
            {earlier.map((r) => (
              <RequestDetails key={r.id} code={idea.code} request={r} />
            ))}
          </div>
        </details>
      )}
      {dialog?.kind === 'request' && view.form && (
        <RequestDialog code={idea.code} holds={holds} form={view.form} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'record' && (
        <RecordDialog
          code={idea.code}
          requestId={dialog.requestId}
          recipient={dialog.recipient}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog?.kind === 'cancel' || dialog?.kind === 'override') && (
        <ApprovalReasonDialog
          code={idea.code}
          requestId={dialog.requestId}
          kind={dialog.kind}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

/**
 * Bloco "Aprovação" da ideia (RN-192). A equipe pede, acompanha, registra, cancela e segue sem; o gestor
 * com acesso vê tudo; o autor vê só a situação, sem nomes nem comentários (RN-190).
 */
export function ApprovalCard({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  const { data } = useIdeaApprovals(idea.code);
  // Recusar, interromper ou arquivar a ideia fecha o pedido aberto no servidor: relê ao mudar a situação.
  const qc = useQueryClient();
  const seen = useRef(`${idea.status}|${idea.archivedAt}`);
  useEffect(() => {
    const now = `${idea.status}|${idea.archivedAt}`;
    if (seen.current === now) return;
    seen.current = now;
    void qc.invalidateQueries({ queryKey: approvalKeys.idea(idea.code) });
  }, [qc, idea.code, idea.status, idea.archivedAt]);
  if (!data) return null;
  if (!data.full) {
    if (data.state === 'none') return null;
    return (
      <section aria-labelledby="aprovacao" className="rounded-lg border bg-card p-5">
        <h2 id="aprovacao" className="flex items-center gap-2 font-semibold">
          <Stamp aria-hidden="true" className="size-4 text-muted-foreground" />
          {t('approvals.card.title')}
        </h2>
        <div className="mt-3">
          <ApprovalPill tone={STATE_TONE[data.state]} label={t(`approvals.card.state.${data.state}`)} />
        </div>
      </section>
    );
  }
  const holds = holdOptions(idea.status);
  // Sem pedido e sem poder pedir (ideia encerrada, ou quem só vê): nada a mostrar.
  if (data.requests.length === 0 && !(data.canManage && holds.length > 0 && !idea.archivedAt)) return null;
  return <FullCard idea={idea} view={data} />;
}
