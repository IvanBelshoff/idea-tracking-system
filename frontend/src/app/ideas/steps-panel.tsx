import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Download, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import { Field } from '@/components/form/field';
import { RichTextEditor } from '@/components/form/rich-text-editor';
import { MediaViewer, mediaItems } from '@/components/media-viewer';
import { RichText } from '@/components/rich-text';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { docOf, isEmptyDoc, type RichDoc, richPayload } from '@/lib/rich';
import { FormError } from '../auth/auth-layout';
import { usePublicSettings } from '../session';
import { useDates } from '../use-dates';
import { downloadUrl } from './idea-attachments';
import { PersonPicker } from './person-picker';
import { type IdeaDetail, ideaKeys } from './queries';
import { StandardFields } from './results-ui';

type StepView = IdeaDetail['steps'][number];

/** Selo de atraso: cor + ícone + texto (nunca só cor). */
export function LateBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--st-late)_12%,transparent)] px-2 py-0.5 text-xs font-medium text-(--st-late)">
      <Clock aria-hidden="true" className="size-3.5" />
      {t('ideas.steps.late')}
    </span>
  );
}

/** Ainda Enviada depois da previsão de retorno (RN-54). */
export function TriageLateBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--st-late)_12%,transparent)] px-2 py-0.5 text-xs font-medium text-(--st-late)">
      <Clock aria-hidden="true" className="size-3.5" />
      {t('ideas.queue.triageLate')}
    </span>
  );
}

function useRefreshIdea(code: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ideaKeys.detail(code) });
    void qc.invalidateQueries({ queryKey: ideaKeys.timeline(code) });
    // Concluir ou excluir etapa muda o que se pode fazer com os anexos dela.
    void qc.invalidateQueries({ queryKey: ['ideas', 'attachments', code] });
    void qc.invalidateQueries({ queryKey: ['ideas', 'list'] });
    void qc.invalidateQueries({ queryKey: ['ideas', 'mine'] });
  };
}

/** Criar ou editar etapa (só a última aberta é editável; RN-13). */
function StepDialog({ idea, step, onClose }: { idea: IdeaDetail; step: StepView | null; onClose: () => void }) {
  const { t } = useTranslation();
  const dates = useDates();
  const refresh = useRefreshIdea(idea.code);
  const [name, setName] = useState(
    step?.name ?? (idea.nextPdcaPhase ? t(`ideas.steps.pdca.${idea.nextPdcaPhase}` as never) : ''),
  );
  const [description, setDescription] = useState<RichDoc | null>(docOf(step?.descriptionRich, step?.description));
  const [assigneeId, setAssigneeId] = useState(step?.assignee.id ?? '');
  const [startDate, setStartDate] = useState(step?.startDate ?? dates.dayFromToday(0));
  const [dueDate, setDueDate] = useState(step?.dueDate ?? dates.dayFromToday(14));
  const [touched, setTouched] = useState(false);
  const save = useMutation({
    meta: { success: step ? t('feedback.steps.updated') : t('feedback.steps.created') },
    mutationFn: () => {
      const { text, rich } = richPayload(description);
      const body = {
        name,
        description: text || null,
        descriptionRich: rich,
        assigneeId,
        startDate,
        dueDate,
      };
      return step
        ? unwrap(
            api.PATCH('/api/ideas/{ref}/steps/{stepId}', {
              params: { path: { ref: idea.code, stepId: step.id } },
              body,
            }),
          )
        : unwrap(api.POST('/api/ideas/{ref}/steps', { params: { path: { ref: idea.code } }, body }));
    },
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const server = fieldErrors(save.error);
  const req = (v: string) => (touched && !v.trim() ? t('validation.required') : undefined);
  const datesInvalid = touched && dueDate < startDate;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>
            {step ? t('ideas.steps.editTitle', { position: step.position }) : t('ideas.steps.addTitle')}
          </DialogTitle>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (name.trim() && assigneeId && dueDate && startDate && dueDate >= startDate) save.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('ideas.steps.name')} error={req(name) ?? server.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
          </Field>
          <Field label={t('ideas.steps.description')} optionalLabel={t('common.optional')}>
            <RichTextEditor rows={2} max={5000} value={description} onChange={setDescription} />
          </Field>
          <PersonPicker
            label={t('ideas.steps.assignee')}
            searchLabel={t('ideas.steps.assigneeSearch')}
            value={assigneeId}
            onChange={setAssigneeId}
            error={req(assigneeId) ?? server.assigneeId}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('ideas.steps.startDate')} error={server.startDate}>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field
              label={t('ideas.steps.dueDate')}
              error={req(dueDate) ?? (datesInvalid ? t('errors.validation_failed') : undefined) ?? server.dueDate}
            >
              <Input type="date" min={startDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Implementar (RN-07): exige o resultado em texto. */
function ImplementDialog({ idea, onClose }: { idea: IdeaDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshIdea(idea.code);
  const [resultText, setResultText] = useState<RichDoc | null>(null);
  const [standard, setStandard] = useState<RichDoc | null>(null);
  const [replicable, setReplicable] = useState(false);
  const [touched, setTouched] = useState(false);
  const send = useMutation({
    meta: { success: t('feedback.steps.implemented') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/{ref}/implement', {
          params: { path: { ref: idea.code } },
          body: {
            resultText: richPayload(resultText).text,
            resultTextRich: richPayload(resultText).rich,
            standardAdopted: richPayload(standard).text || null,
            standardAdoptedRich: richPayload(standard).rich,
            isReplicable: replicable,
            expectedStatus: idea.status,
          },
        }),
      ),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('ideas.steps.implementTitle')}</DialogTitle>
          <DialogDescription>{t('ideas.steps.implementIntro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!isEmptyDoc(resultText)) send.mutate();
          }}
          className="space-y-4"
        >
          <Field
            label={t('ideas.steps.result')}
            error={touched && isEmptyDoc(resultText) ? t('validation.required') : undefined}
          >
            <RichTextEditor rows={4} max={10_000} value={resultText} onChange={setResultText} autoFocus />
          </Field>
          <StandardFields
            standard={standard}
            setStandard={setStandard}
            replicable={replicable}
            setReplicable={setReplicable}
          />
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending}>
              {t('ideas.steps.implement')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Anexos de uma etapa (RN-21): lista, envio (etapa aberta), download (com escopo) e remoção. */
function StepAttachments({ idea, step, canUpload }: { idea: IdeaDetail; step: StepView; canUpload: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const refresh = useRefreshIdea(idea.code);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const { data: settings } = usePublicSettings();
  const [removing, setRemoving] = useState<{ id: string; originalName: string } | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const key = ['ideas', 'attachments', idea.code, step.id];
  const list = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(
        api.GET('/api/ideas/{ref}/steps/{stepId}/attachments', {
          params: { path: { ref: idea.code, stepId: step.id } },
        }),
      ),
  });
  const done = () => {
    void qc.invalidateQueries({ queryKey: key });
    refresh();
  };
  const upload = useMutation({
    meta: { success: t('feedback.steps.attachmentAdded') },
    mutationFn: (file: File) =>
      unwrap(
        api.POST('/api/ideas/{ref}/steps/{stepId}/attachments', {
          params: { path: { ref: idea.code, stepId: step.id } },
          body: { file } as never,
          bodySerializer: () => {
            const form = new FormData();
            form.append('file', file);
            return form;
          },
        }),
      ),
    onSuccess: done,
  });
  const remove = useMutation({
    meta: { success: t('feedback.steps.attachmentRemoved') },
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/ideas/{ref}/attachments/{attachmentId}', {
          params: { path: { ref: idea.code, attachmentId: id } },
        }),
      ),
    onSuccess: () => {
      setRemoving(null);
      done();
    },
  });
  const accept = settings?.attachments.allowedExtensions.map((e) => `.${e}`).join(',');
  const media = mediaItems(idea.code, list.data ?? []);

  return (
    <div className="mt-3 border-t pt-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('ideas.attachments.title')}
      </p>
      {list.data?.length === 0 && <p className="mt-1 text-sm text-muted-foreground">{t('ideas.attachments.empty')}</p>}
      <ul className="mt-2 space-y-1.5">
        {list.data?.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-sm">
            <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            {a.viewable ? (
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left hover:underline"
                aria-label={t('media.open', { name: a.originalName })}
                onClick={() => setViewing(media.indexOf(a.id))}
              >
                {a.originalName}
              </button>
            ) : (
              <a href={downloadUrl(idea.code, a.id)} className="min-w-0 flex-1 truncate hover:underline">
                {a.originalName}
              </a>
            )}
            <span className="shrink-0 text-xs text-muted-foreground">{formatSize(a.sizeBytes)}</span>
            <a
              href={`/api/ideas/${encodeURIComponent(idea.code)}/attachments/${a.id}/download`}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t('ideas.attachments.download', { name: a.originalName })}
            >
              <Download aria-hidden="true" className="size-3.5" />
            </a>
            {a.deletable && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('ideas.attachments.remove', { name: a.originalName })}
                onClick={() => setRemoving(a)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canUpload && (
        <div className="mt-2">
          <input
            ref={input}
            id={inputId}
            aria-label={t('ideas.attachments.upload')}
            tabIndex={-1}
            type="file"
            accept={accept}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
          <Button variant="outline" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
            <Paperclip aria-hidden="true" />
            {upload.isPending ? t('ideas.attachments.uploading') : t('ideas.attachments.upload')}
          </Button>
          {settings && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('ideas.attachments.limits', {
                mb: settings.attachments.maxMb,
                types: settings.attachments.allowedExtensions.join(', '),
              })}
            </p>
          )}
          <FormError message={upload.isError ? errorText(t, upload.error) : null} />
        </div>
      )}
      <MediaViewer items={media.items} index={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('ideas.attachments.removeTitle', { name: removing?.originalName ?? '' })}
        description={t('ideas.attachments.removeText')}
        confirmLabel={t('admin.common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      >
        <FormError message={remove.isError ? errorText(t, remove.error) : null} />
      </ConfirmDialog>
    </div>
  );
}

/**
 * Etapas da ideia (RN-12 a RN-21): progresso, prazo, atraso, etapas com ações conforme a
 * permissão e anexos. Ao concluir todas, o aviso guiado: nova etapa ou implementar (RN-20).
 */
export function StepsPanel({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  const dates = useDates();
  const refresh = useRefreshIdea(idea.code);
  const [dialog, setDialog] = useState<
    { kind: 'add' } | { kind: 'edit'; step: StepView } | { kind: 'implement' } | null
  >(null);
  const [confirm, setConfirm] = useState<{ kind: 'complete' | 'remove'; step: StepView } | null>(null);
  const running = idea.status === 'in_progress';
  const hasOpen = idea.steps.some((s) => !s.completedAt);
  const doneCount = idea.steps.filter((s) => s.completedAt).length;

  const act = useMutation({
    meta: {
      success: (_d, v: { kind: 'complete' | 'remove' }) =>
        v.kind === 'complete' ? t('feedback.steps.completed') : t('feedback.steps.removed'),
    },
    mutationFn: ({ kind, step }: { kind: 'complete' | 'remove'; step: StepView }) => {
      const path = { params: { path: { ref: idea.code, stepId: step.id } } };
      return kind === 'complete'
        ? unwrap(api.POST('/api/ideas/{ref}/steps/{stepId}/complete', path))
        : unwrap(api.DELETE('/api/ideas/{ref}/steps/{stepId}', path));
    },
    onSuccess: () => {
      setConfirm(null);
      refresh();
    },
  });

  return (
    <section aria-labelledby="etapas" className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="etapas" className="font-semibold">
          {t('ideas.steps.title')}
        </h2>
        {idea.can.manageSteps && running && !hasOpen && (
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'add' })}>
            <Plus aria-hidden="true" />
            {t('ideas.steps.add')}
          </Button>
        )}
      </div>

      {idea.steps.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('ideas.detail.stepsEmpty')}</p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{t('ideas.steps.progress')}</span>
                <span className="tabular-nums">{idea.progress}%</span>
              </div>
              <Progress value={idea.progress} className="mt-1.5" aria-label={t('ideas.steps.progress')} />
              <p className="mt-1 text-xs text-muted-foreground">
                {idea.progressMode === 'steps'
                  ? t('ideas.steps.progressSteps', { done: doneCount, total: idea.steps.length })
                  : t('ideas.steps.progressTime')}
              </p>
            </div>
            {idea.deadline && (
              <div className="text-sm sm:text-right">
                <p className="text-muted-foreground">{t('ideas.steps.deadline')}</p>
                <p className="flex items-center gap-2 font-medium sm:justify-end">
                  {dates.day(idea.deadline)}
                  {idea.late && <LateBadge />}
                </p>
              </div>
            )}
          </div>

          {idea.allStepsCompleted && (
            <div
              role="status"
              className="mt-4 rounded-md border border-(--st-done) bg-[color-mix(in_oklch,var(--st-done)_8%,transparent)] p-4"
            >
              <p className="font-medium">{t('ideas.steps.allDoneTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('ideas.steps.allDoneText')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {idea.can.triage && (
                  <Button onClick={() => setDialog({ kind: 'implement' })}>{t('ideas.steps.implement')}</Button>
                )}
                {idea.can.manageSteps && (
                  <Button variant="outline" onClick={() => setDialog({ kind: 'add' })}>
                    <Plus aria-hidden="true" />
                    {t('ideas.steps.add')}
                  </Button>
                )}
              </div>
            </div>
          )}

          <ol className="mt-4 space-y-3">
            {idea.steps.map((s) => {
              // Só a etapa aberta pode atrasar; o servidor já calculou no fuso da instalação (CA-T.3).
              const isLateStep = !s.completedAt && idea.late;
              return (
                <li key={s.id} className={`rounded-md border p-3 text-sm ${s.completedAt ? '' : 'border-primary/50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {s.position}. {s.name}
                        {s.pdcaPhase && (
                          <span className="ml-2 rounded-sm border px-1.5 py-0.5 align-middle text-xs font-normal text-muted-foreground">
                            {t('ideas.steps.pdcaBadge', { phase: t(`ideas.steps.pdca.${s.pdcaPhase}` as never) })}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        {t('ideas.detail.stepAssignee', { name: s.assignee.name })} · {dates.day(s.startDate)} →{' '}
                        {dates.day(s.dueDate)}
                      </p>
                      {s.description && <RichText rich={s.descriptionRich} plain={s.description} className="mt-1" />}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {s.completedAt ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--st-done)_12%,transparent)] px-2 py-0.5 text-xs font-medium text-(--st-done)">
                          <Check aria-hidden="true" className="size-3.5" />
                          {t('ideas.detail.stepDone', { date: dates.date(s.completedAt) })}
                        </span>
                      ) : isLateStep ? (
                        <LateBadge />
                      ) : (
                        <span className="rounded-full bg-[color-mix(in_oklch,var(--st-progress)_12%,transparent)] px-2 py-0.5 text-xs font-medium text-(--st-progress)">
                          {t('ideas.steps.open')}
                        </span>
                      )}
                    </div>
                  </div>
                  {(s.canComplete || s.editable || s.deletable) && (
                    <fieldset className="mt-3 flex flex-wrap gap-2">
                      <legend className="sr-only">{t('ideas.steps.stepActions', { position: s.position })}</legend>
                      {s.canComplete && (
                        <Button size="sm" onClick={() => setConfirm({ kind: 'complete', step: s })}>
                          <Check aria-hidden="true" />
                          {t('ideas.steps.complete')}
                        </Button>
                      )}
                      {s.editable && (
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'edit', step: s })}>
                          <Pencil aria-hidden="true" />
                          {t('ideas.steps.edit')}
                        </Button>
                      )}
                      {s.deletable && (
                        <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'remove', step: s })}>
                          <Trash2 aria-hidden="true" />
                          {t('ideas.steps.remove')}
                        </Button>
                      )}
                    </fieldset>
                  )}
                  <StepAttachments
                    idea={idea}
                    step={s}
                    canUpload={running && !s.completedAt && (idea.can.manageSteps || s.canComplete)}
                  />
                </li>
              );
            })}
          </ol>
        </>
      )}

      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <StepDialog idea={idea} step={dialog.kind === 'edit' ? dialog.step : null} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'implement' && <ImplementDialog idea={idea} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            act.reset();
          }
        }}
        title={
          confirm?.kind === 'complete'
            ? t('ideas.steps.completeTitle', { position: confirm.step.position })
            : t('ideas.steps.removeTitle', { position: confirm?.step.position ?? 0 })
        }
        description={confirm?.kind === 'complete' ? t('ideas.steps.completeText') : t('ideas.steps.removeText')}
        confirmLabel={confirm?.kind === 'complete' ? t('ideas.steps.complete') : t('ideas.steps.remove')}
        cancelLabel={t('common.cancel')}
        destructive={confirm?.kind === 'remove'}
        pending={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
      >
        <FormError message={act.isError ? errorText(t, act.error) : null} />
      </ConfirmDialog>
    </section>
  );
}
