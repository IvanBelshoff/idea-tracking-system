import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiError, errorText, unwrap } from '@/api/errors';
import { RichTextEditor } from '@/components/form/rich-text-editor';
import { PersonAvatar } from '@/components/person-avatar';
import { RichText } from '@/components/rich-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { isEmptyDoc, type RichDoc, richPayload } from '@/lib/rich';
import { ApprovalCard, ApprovalHeaderBadge } from '../approvals/approval-card';
import { FormError } from '../auth/auth-layout';
import { HelpLink } from '../help';
import { MuralIdeaCard } from '../mural/mural-manage';
import { usePageTitle } from '../page-title';
import { NotFoundPage } from '../pages/status-pages';
import { usePublicSettings } from '../session';
import { useDates } from '../use-dates';
import { ConvergedBanner, ConvergedIdeasCard, ParticipantsCard } from './convergence-ui';
import { IdeaActions } from './idea-actions';
import { IdeaAttachmentsCard } from './idea-attachments';
import { PdfCard, PriorityCard, PublicLookupCard } from './idea-extras';
import { type IdeaDetail, ideaKeys, useComments, useIdea, useTimeline } from './queries';
import { ResultsCard } from './results-ui';
import { LateBadge, StepsPanel, TriageLateBadge } from './steps-panel';
import { CategoryTag, IdCode, type IdeaStatus, IdeaStatusBadge } from './ui';

/** Bloco de texto da ideia: com `rich`/`plain` mostra o texto formatado (RN-136); senão, o texto simples dos filhos. */
function Block({
  title,
  children,
  rich,
  plain,
}: {
  title: string;
  children?: React.ReactNode;
  rich?: unknown;
  plain?: string | null;
}) {
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 text-sm">
        {plain !== undefined ? (
          <RichText rich={rich} plain={plain} />
        ) : (
          <p className="whitespace-pre-wrap">{children}</p>
        )}
      </div>
    </section>
  );
}

function Meta({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  const dates = useDates();
  const rows: [string, React.ReactNode][] = [
    [t('ideas.fields.entity'), idea.entity.name],
    [t('ideas.fields.category'), <CategoryTag key="c" category={idea.category} />],
    [t('ideas.fields.author'), idea.author?.name ?? '—'],
    [t('ideas.fields.submittedAt'), dates.date(idea.submittedAt)],
  ];
  if (idea.status === 'submitted') rows.push([t('ideas.fields.triageDue'), dates.day(idea.triageDue)]);
  if (idea.tags.length) rows.splice(2, 0, [t('ideas.fields.tags'), idea.tags.map((x) => x.name).join(', ')]);
  if (idea.registeredBy) rows.push([t('ideas.fields.registeredBy'), idea.registeredBy.name]);
  if (idea.viaIntegration) rows.push([t('ideas.fields.viaIntegration'), idea.viaIntegration]);
  if (idea.assignedTo) rows.push([t('ideas.fields.assignedTo'), idea.assignedTo.name]);
  if (idea.externalRef) rows.push([t('ideas.fields.externalRef'), idea.externalRef]);
  if (idea.campaign) rows.push([t('ideas.fields.campaign'), idea.campaign.name]);
  if (idea.highlightId)
    rows.push([
      t('ideas.fields.hall'),
      <Link key="h" to="/hall/$id" params={{ id: idea.highlightId }} className="underline underline-offset-4">
        {t('ideas.fields.hallLink')}
      </Link>,
    ]);
  return (
    <dl className="grid gap-x-6 gap-y-3 rounded-lg border bg-card p-5 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Linha do tempo: cada mudança com quem fez e quando; o autor não vê o que é interno (RN-58). */
function Timeline({ ideaRef }: { ideaRef: string }) {
  const { t } = useTranslation();
  const dates = useDates();
  const events = useTimeline(ideaRef);
  const label = (e: NonNullable<typeof events.data>[number]) => {
    const to = e.data.to as IdeaStatus | undefined;
    const status = to ? t(`ideas.status.${to}`) : '';
    switch (e.type) {
      case 'external_ref_changed':
        return t('ideas.timeline.external_ref_changed', {
          from: String(e.data.from ?? '—'),
          to: String(e.data.to ?? '—'),
        });
      case 'created':
        if (e.data.origin) return t('ideas.timeline.createdReplica', { code: String(e.data.origin) });
        return e.data.onBehalfOf ? t('ideas.timeline.createdOnBehalf') : t('ideas.timeline.created');
      case 'measurement_updated':
        return t('ideas.timeline.measurementUpdated', { indicator: String(e.data.indicator ?? '') });
      case 'measurement_removed':
        return t('ideas.timeline.measurementRemoved');
      case 'gain_updated':
        return t('ideas.timeline.gainUpdated');
      case 'gain_validated':
        return t('ideas.timeline.gainValidated');
      case 'gain_unvalidated':
        return t('ideas.timeline.gainUnvalidated');
      case 'standard_updated':
        return t('ideas.timeline.standardUpdated');
      case 'replicated':
        return t('ideas.timeline.replicated', { code: String(e.data.code ?? '') });
      case 'highlighted':
        return t(
          e.data.scope === 'organization' ? 'ideas.timeline.highlightedOrg' : 'ideas.timeline.highlightedEntity',
        );
      case 'highlight_revoked':
        return t('ideas.timeline.highlightRevoked');
      case 'mural_published':
        return t('ideas.timeline.muralPublished');
      case 'approval_requested':
        return t('ideas.timeline.approvalRequested');
      case 'approval_decided': {
        const who = { name: String(e.data.name ?? ''), area: String(e.data.area ?? '') };
        return e.data.decision === 'rejected'
          ? t('ideas.timeline.approvalDecidedRejected', who)
          : t('ideas.timeline.approvalDecidedApproved', who);
      }
      case 'approval_completed':
        return e.data.outcome === 'rejected'
          ? t('ideas.timeline.approvalCompletedRejected')
          : t('ideas.timeline.approvalCompletedApproved');
      case 'approval_expired':
        return t('ideas.timeline.approvalExpired');
      case 'approval_cancelled':
        return e.data.automatic === true
          ? t('ideas.timeline.approvalCancelledAuto')
          : t('ideas.timeline.approvalCancelled');
      case 'approval_overridden':
        return t('ideas.timeline.approvalOverridden');
      case 'mural_withdrawn':
        // Retirada automática (RN-149): o motivo é um código, traduzido aqui em vez de aparecer cru.
        if (e.data.automatic === true) {
          return e.reason === 'idea_archived'
            ? t('ideas.timeline.muralWithdrawnArchived')
            : t('ideas.timeline.muralWithdrawnRejected');
        }
        return t('ideas.timeline.muralWithdrawn');
      case 'sustainment_reviewed':
        return e.data.decision === 'confirmed'
          ? t('ideas.timeline.sustainmentConfirmed')
          : t('ideas.timeline.sustainmentContested');
      case 'status_changed':
        return t('ideas.timeline.status_changed', { status });
      case 'reopened':
        return t('ideas.timeline.reopened', { status });
      case 'step_added':
        return t('ideas.timeline.step_added', { position: e.data.position as number, name: e.data.name as string });
      case 'updated':
        return t('ideas.timeline.updated');
      case 'comment_added':
        return t('ideas.timeline.comment_added');
      case 'archived':
        return t('ideas.timeline.archived');
      case 'converged':
        return t('ideas.timeline.converged', { code: String(e.data.into ?? '') });
      case 'convergence_received':
        return t('ideas.timeline.convergenceReceived', { code: String(e.data.from ?? '') });
      case 'convergence_undone':
        return t('ideas.timeline.convergenceUndone');
      case 'supported':
        return t('ideas.timeline.supported');
      case 'participant_added':
        return t('ideas.timeline.participantAdded', { name: String(e.data.name ?? '') });
      case 'participant_removed':
        return t('ideas.timeline.participantRemoved', { name: String(e.data.name ?? '') });
      case 'prioritized':
        return t('ideas.timeline.prioritized', {
          impact: String(e.data.impact ?? '—'),
          effort: String(e.data.effort ?? '—'),
        });
      case 'assigned':
        return e.data.to ? t('ideas.timeline.assigned') : t('ideas.timeline.unassigned');
      case 'step_updated':
        return t('ideas.timeline.step_updated', { position: e.data.position as number });
      case 'step_removed':
        return t('ideas.timeline.step_removed', { position: e.data.position as number, name: e.data.name as string });
      case 'step_completed':
        return t('ideas.timeline.step_completed', { position: e.data.position as number, name: e.data.name as string });
      case 'all_steps_completed':
        return t('ideas.timeline.all_steps_completed');
      case 'deadline_changed':
        return t('ideas.timeline.deadline_changed', {
          from: e.data.from ? dates.day(e.data.from as string) : '—',
          to: e.data.to ? dates.day(e.data.to as string) : '—',
        });
      case 'attachment_added':
        if (e.data.position === null || e.data.position === undefined) {
          return t('ideas.timeline.attachment_added_idea', { name: e.data.name as string });
        }
        return t('ideas.timeline.attachment_added', {
          position: e.data.position as number,
          name: e.data.name as string,
        });
      case 'attachment_removed':
        return t('ideas.timeline.attachment_removed', { name: e.data.name as string });
      default:
        return e.type;
    }
  };
  return (
    <section aria-labelledby="linha-do-tempo" className="rounded-lg border bg-card p-5">
      <h2 id="linha-do-tempo" className="font-semibold">
        {t('ideas.detail.timeline')}
      </h2>
      <ol className="mt-3 space-y-0">
        {events.data?.map((e, i) => (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < (events.data?.length ?? 0) - 1 && (
              <span aria-hidden="true" className="absolute top-3 left-[0.3rem] h-full w-px bg-border" />
            )}
            <span aria-hidden="true" className="relative mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                {label(e)}
                {e.visibility === 'internal' && (
                  <Badge variant="outline" className="ml-2 align-middle">
                    <Lock aria-hidden="true" />
                    {t('ideas.timeline.internal')}
                  </Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {dates.dateTime(e.at)} ·{' '}
                {e.actor
                  ? t('ideas.timeline.by', { name: e.actor.name })
                  : typeof e.data.integrationName === 'string'
                    ? null
                    : t('ideas.timeline.system')}
                {typeof e.data.integrationName === 'string' &&
                  `${e.actor ? ' · ' : ''}${t('ideas.timeline.viaIntegration', { name: e.data.integrationName })}`}
              </p>
              {e.reason && e.data.automatic !== true && (
                <p className="mt-1 rounded-md bg-muted px-3 py-2 whitespace-pre-wrap">{e.reason}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Comentários públicos e internos (RN-28). O autor só vê e escreve públicos. */
function Comments({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const comments = useComments(idea.code);
  const [body, setBody] = useState<RichDoc | null>(null);
  // O editor não é controlado: trocar a chave o esvazia depois de enviar.
  const [editorKey, setEditorKey] = useState(0);
  const [internal, setInternal] = useState(false);
  const send = useMutation({
    meta: { success: t('feedback.ideas.commented') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/{ref}/comments', {
          params: { path: { ref: idea.code } },
          body: {
            body: richPayload(body).text,
            bodyRich: richPayload(body).rich,
            visibility: internal ? 'internal' : 'public',
          },
        }),
      ),
    onSuccess: () => {
      setBody(null);
      setEditorKey((k) => k + 1);
      setInternal(false);
      void qc.invalidateQueries({ queryKey: ideaKeys.comments(idea.code) });
      void qc.invalidateQueries({ queryKey: ideaKeys.timeline(idea.code) });
    },
  });
  return (
    <section aria-labelledby="comentarios" className="rounded-lg border bg-card p-5">
      <h2 id="comentarios" className="font-semibold">
        {t('ideas.detail.comments')}
      </h2>
      {comments.data?.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t('ideas.comments.empty')}</p>}
      <ul className="mt-3 space-y-3">
        {comments.data?.map((c) => (
          <li
            key={c.id}
            className={`rounded-md border p-3 text-sm ${c.visibility === 'internal' ? 'border-dashed bg-muted/40' : ''}`}
          >
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {c.author && <PersonAvatar person={c.author} size="sm" />}
              <span className="font-medium text-foreground">
                {c.author?.name ?? t('ideas.comments.viaIntegration', { name: c.viaIntegration ?? '' })}
              </span>{' '}
              · {dates.dateTime(c.createdAt)}
              {c.visibility === 'internal' && (
                <Badge variant="outline" className="ml-2 align-middle">
                  <Lock aria-hidden="true" />
                  {t('ideas.comments.internal')}
                </Badge>
              )}
            </p>
            <RichText rich={c.bodyRich} plain={c.body} className="mt-1" />
          </li>
        ))}
      </ul>
      {idea.can.comment && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!isEmptyDoc(body)) send.mutate();
          }}
          className="mt-4 space-y-3"
        >
          <Label id="novo-comentario-label" htmlFor="novo-comentario">
            {t('ideas.comments.label')}
          </Label>
          <RichTextEditor key={editorKey} id="novo-comentario" rows={3} max={5000} value={null} onChange={setBody} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            {idea.can.commentInternal ? (
              <div className="flex items-center gap-2 text-sm">
                <Checkbox id="comentario-interno" checked={internal} onCheckedChange={(v) => setInternal(v === true)} />
                <label htmlFor="comentario-interno">{t('ideas.comments.internalOption')}</label>
              </div>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={send.isPending || isEmptyDoc(body)}>
              {t('ideas.comments.send')}
            </Button>
          </div>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
        </form>
      )}
    </section>
  );
}

/** Detalhe da ideia por código (/ideias/ITS-2026-0042). Fora do escopo, a API responde 404. */
export function IdeaPage() {
  const { t } = useTranslation();
  const { ref } = useParams({ from: '/instalacao/sessao/ideias/$ref' });
  const { data: settings } = usePublicSettings();
  const idea = useIdea(ref);
  usePageTitle(idea.data ? `${idea.data.code} · ${idea.data.title}` : ref, settings?.organizationName);

  if (idea.error instanceof ApiError && idea.error.status === 404) return <NotFoundPage />;
  if (!idea.data) return idea.isError ? <FormError message={errorText(t, idea.error)} /> : null;
  const i = idea.data;

  return (
    <div className="mx-auto max-w-[72rem]">
      <button
        type="button"
        onClick={() => window.history.back()}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('ideas.detail.back')}
      </button>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <IdCode code={i.code} size="lg" />
          <IdeaStatusBadge status={i.status} size="lg" />
          {i.late && <LateBadge />}
          {i.triageOverdue && <TriageLateBadge />}
          <ApprovalHeaderBadge code={i.code} />
          {i.archivedAt && <Badge variant="outline">{t('ideas.detail.archived')}</Badge>}
        </div>
        <div className="mt-2 flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-[1.75rem] leading-tight font-bold break-words">{i.title}</h1>
          <span className="pt-1">
            <HelpLink topic="ideaDetail" />
          </span>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="grid min-w-0 content-start gap-6">
          <ConvergedBanner idea={i} />
          {i.status === 'rejected' && i.rejectionReason && (
            <Block title={t('ideas.detail.rejectionTitle')}>{i.rejectionReason}</Block>
          )}
          {i.status === 'implemented' && i.resultText && (
            <Block title={t('ideas.detail.resultTitle')} rich={i.resultTextRich} plain={i.resultText} />
          )}
          <Block title={t('ideas.detail.descriptionSection')} rich={i.descriptionRich} plain={i.description} />
          {i.proposedSolution && (
            <Block title={t('ideas.detail.solutionSection')} rich={i.proposedSolutionRich} plain={i.proposedSolution} />
          )}
          {i.expectedGain && <Block title={t('ideas.detail.gainSection')}>{i.expectedGain}</Block>}
          <ApprovalCard idea={i} />
          <IdeaAttachmentsCard code={i.code} />
          <StepsPanel idea={i} />
          <ResultsCard idea={i} />
          <Comments idea={i} />
        </div>
        <aside aria-label={t('ideas.detail.actions')} className="grid min-w-0 content-start gap-6">
          <IdeaActions idea={i} />
          <PriorityCard idea={i} />
          {/* Mural (M21): publicar, retirar e o consentimento do nome; some com o módulo desligado. */}
          {!i.convergedInto && <MuralIdeaCard code={i.code} />}
          {/* A convergida não tem consulta pública própria (responde como inexistente). */}
          {!i.convergedInto && <PublicLookupCard idea={i} />}
          <PdfCard idea={i} />
          <ParticipantsCard idea={i} />
          <ConvergedIdeasCard idea={i} />
          <Meta idea={i} />
          <Timeline ideaRef={i.code} />
        </aside>
      </div>
    </div>
  );
}
