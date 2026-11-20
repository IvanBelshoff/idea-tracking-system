import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiError, errorText, fieldErrors, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { RichTextEditor } from '@/components/form/rich-text-editor';
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
import { Textarea } from '@/components/ui/textarea';
import { docOf, isEmptyDoc, type RichDoc, richPayload } from '@/lib/rich';
import { FormError } from '../auth/auth-layout';
import { HighlightDialog } from '../hall/hall-ui';
import { useDates } from '../use-dates';
import { ConvergeDialog, SupportDialog, UnconvergeDialog } from './convergence-ui';
import { PersonPicker } from './person-picker';
import { type IdeaDetail, ideaKeys, useActiveCategories } from './queries';

type Dialogs =
  | 'edit'
  | 'approve'
  | 'reject'
  | 'interrupt'
  | 'reopen'
  | 'archive'
  | 'delete'
  | 'assign'
  | 'converge'
  | 'unconverge'
  | 'support'
  | 'highlight'
  | null;

/**
 * Ações da ideia conforme o que a API diz que a pessoa pode (`can`) e a situação atual. Toda ação
 * manda o estado que a tela mostrava; se outra pessoa agiu antes, a API responde 409 `stale_state`,
 * a tela recarrega e explica (CA-T.2).
 */
export function IdeaActions({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Dialogs>(null);
  const [stale, setStale] = useState(false);
  const path = { params: { path: { ref: idea.code } } };
  const expectedStatus = idea.status;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ideaKeys.all });
  };
  const onDone = () => {
    setOpen(null);
    setStale(false);
    refresh();
  };
  const onError = (e: unknown) => {
    if (e instanceof ApiError && (e.code === 'stale_state' || e.code === 'invalid_transition')) {
      setOpen(null);
      setStale(true);
      refresh();
    }
  };

  const startReview = useMutation({
    meta: { success: t('feedback.ideas.reviewStarted') },
    mutationFn: () => unwrap(api.POST('/api/ideas/{ref}/start-review', { ...path, body: { expectedStatus } as never })),
    onSuccess: onDone,
    onError,
  });
  const archive = useMutation({
    meta: { success: t('feedback.ideas.archived') },
    mutationFn: () => unwrap(api.POST('/api/ideas/{ref}/archive', { ...path, body: { expectedStatus } as never })),
    onSuccess: onDone,
    onError,
  });
  const purge = useMutation({
    meta: { success: t('feedback.ideas.purged') },
    mutationFn: () => unwrap(api.DELETE('/api/ideas/{ref}', path)),
    onSuccess: () => {
      refresh();
      void navigate({ to: '/ideias' });
    },
  });

  const s = idea.status;
  const closed = s === 'implemented' || s === 'rejected';
  const buttons: {
    key: string;
    label: string;
    onClick: () => void;
    variant?: 'outline' | 'destructive' | 'default';
  }[] = [];
  if (idea.can.triage && s === 'submitted')
    buttons.push({
      key: 'start',
      label: t('ideas.actions.startReview'),
      onClick: () => startReview.mutate(),
      variant: 'default',
    });
  if (idea.can.triage && (s === 'submitted' || s === 'in_review'))
    buttons.push({
      key: 'approve',
      label: t('ideas.actions.approve'),
      onClick: () => setOpen('approve'),
      variant: s === 'in_review' ? 'default' : 'outline',
    });
  if (idea.can.triage && (s === 'submitted' || s === 'in_review'))
    buttons.push({
      key: 'reject',
      label: t('ideas.actions.reject'),
      onClick: () => setOpen('reject'),
      variant: 'outline',
    });
  if (idea.can.triage && s === 'in_progress')
    buttons.push({
      key: 'interrupt',
      label: t('ideas.actions.interrupt'),
      onClick: () => setOpen('interrupt'),
      variant: 'outline',
    });
  if (idea.can.triage && !closed)
    buttons.push({
      key: 'assign',
      label: idea.assignedTo ? t('ideas.actions.reassign') : t('ideas.actions.assign'),
      onClick: () => setOpen('assign'),
      variant: 'outline',
    });
  if (idea.can.highlight)
    buttons.push({
      key: 'highlight',
      label: t('hall.highlightIdea'),
      onClick: () => setOpen('highlight'),
      variant: 'outline',
    });
  if (idea.can.support)
    buttons.push({
      key: 'support',
      label: t('ideas.similar.supportThis'),
      onClick: () => setOpen('support'),
      variant: 'outline',
    });
  if (idea.can.converge)
    buttons.push({
      key: 'converge',
      label: t('ideas.convergence.converge'),
      onClick: () => setOpen('converge'),
      variant: 'outline',
    });
  if (idea.can.unconverge)
    buttons.push({
      key: 'unconverge',
      label: t('ideas.convergence.undo'),
      onClick: () => setOpen('unconverge'),
      variant: 'outline',
    });
  if (idea.can.reopen && closed)
    buttons.push({
      key: 'reopen',
      label: t('ideas.actions.reopen'),
      onClick: () => setOpen('reopen'),
      variant: 'outline',
    });
  if (idea.can.edit)
    buttons.push({ key: 'edit', label: t('ideas.actions.edit'), onClick: () => setOpen('edit'), variant: 'outline' });
  if (idea.can.archive && !idea.archivedAt)
    buttons.push({
      key: 'archive',
      label: t('ideas.actions.archive'),
      onClick: () => setOpen('archive'),
      variant: 'outline',
    });
  if (idea.can.delete)
    buttons.push({
      key: 'delete',
      label: t('ideas.actions.delete'),
      onClick: () => setOpen('delete'),
      variant: 'destructive',
    });

  const quickError = [startReview, archive].find(
    (m) => m.isError && !(m.error instanceof ApiError && m.error.code === 'stale_state'),
  )?.error;
  if (buttons.length === 0 && !stale) return null;

  return (
    <section aria-labelledby="acoes" className="rounded-lg border bg-card p-5">
      <h2 id="acoes" className="font-semibold">
        {t('ideas.detail.actions')}
      </h2>
      {stale && (
        <p role="alert" className="mt-3 rounded-md border border-(--st-late) bg-(--st-late-fill)/40 px-3 py-2 text-sm">
          {t('ideas.actions.stale')}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {buttons.map((b) => (
          <Button key={b.key} variant={b.variant ?? 'outline'} onClick={b.onClick} disabled={startReview.isPending}>
            {b.label}
          </Button>
        ))}
      </div>
      <div className="mt-2">
        <FormError message={quickError ? errorText(t, quickError) : null} />
      </div>

      {open === 'edit' && <EditDialog idea={idea} onClose={() => setOpen(null)} onDone={onDone} />}
      {open === 'approve' && (
        <ApproveDialog idea={idea} onClose={() => setOpen(null)} onDone={onDone} onError={onError} />
      )}
      {open === 'converge' && (
        <ConvergeDialog
          idea={idea}
          onClose={() => setOpen(null)}
          onDone={(code) => {
            onDone();
            if (code !== idea.code) void navigate({ to: '/ideias/$ref', params: { ref: code } });
          }}
        />
      )}
      {open === 'highlight' && <HighlightDialog ideaRef={idea.code} onClose={() => setOpen(null)} />}
      {open === 'unconverge' && <UnconvergeDialog idea={idea} onClose={() => setOpen(null)} onDone={onDone} />}
      {open === 'support' && <SupportDialog code={idea.code} onClose={() => setOpen(null)} onDone={onDone} />}
      {open === 'assign' && (
        <AssignDialog idea={idea} onClose={() => setOpen(null)} onDone={onDone} onError={onError} />
      )}
      {(open === 'reject' || open === 'interrupt' || open === 'reopen') && (
        <ReasonDialog kind={open} idea={idea} onClose={() => setOpen(null)} onDone={onDone} onError={onError} />
      )}
      <ConfirmDialog
        open={open === 'archive'}
        onOpenChange={(o) => !o && setOpen(null)}
        title={t('ideas.actions.archiveTitle', { code: idea.code })}
        description={t('ideas.actions.archiveText')}
        confirmLabel={t('ideas.actions.archive')}
        cancelLabel={t('common.cancel')}
        pending={archive.isPending}
        onConfirm={() => archive.mutate()}
      />
      <ConfirmDialog
        open={open === 'delete'}
        onOpenChange={(o) => !o && setOpen(null)}
        title={t('ideas.actions.deleteTitle', { code: idea.code })}
        description={t('ideas.actions.deleteText')}
        confirmLabel={t('ideas.actions.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        pending={purge.isPending}
        onConfirm={() => purge.mutate()}
      >
        <FormError message={purge.isError ? errorText(t, purge.error) : null} />
      </ConfirmDialog>
    </section>
  );
}

function ReasonDialog({
  kind,
  idea,
  onClose,
  onDone,
  onError,
}: {
  kind: 'reject' | 'interrupt' | 'reopen';
  idea: IdeaDetail;
  onClose: () => void;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const route = {
    reject: '/api/ideas/{ref}/reject',
    interrupt: '/api/ideas/{ref}/interrupt',
    reopen: '/api/ideas/{ref}/reopen',
  } as const;
  const send = useMutation({
    meta: { success: t(`feedback.ideas.${kind}`) },
    mutationFn: () =>
      unwrap(
        api.POST(route[kind], { params: { path: { ref: idea.code } }, body: { reason, expectedStatus: idea.status } }),
      ),
    onSuccess: onDone,
    onError,
  });
  const texts = {
    reject: [
      t('ideas.actions.rejectTitle'),
      t('ideas.actions.rejectIntro'),
      t('ideas.actions.reason'),
      t('ideas.actions.reject'),
    ],
    interrupt: [
      t('ideas.actions.interruptTitle'),
      t('ideas.actions.interruptIntro'),
      t('ideas.actions.reason'),
      t('ideas.actions.interrupt'),
    ],
    reopen: [
      t('ideas.actions.reopenTitle'),
      t('ideas.actions.reopenIntro'),
      t('ideas.actions.reopenReason'),
      t('ideas.actions.reopen'),
    ],
  }[kind];
  const missing = touched && !reason.trim();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{texts[0]}</DialogTitle>
          <DialogDescription>{texts[1]}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (reason.trim()) send.mutate();
          }}
          className="space-y-4"
        >
          <Field label={texts[2] ?? ''} error={missing ? t('validation.required') : undefined}>
            <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={5000} autoFocus />
          </Field>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant={kind === 'reopen' ? 'default' : 'destructive'} disabled={send.isPending}>
              {texts[3]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Atribuir ou reatribuir a triagem (CA-RN-55.3); vazio devolve à fila geral. */
function AssignDialog({
  idea,
  onClose,
  onDone,
  onError,
}: {
  idea: IdeaDetail;
  onClose: () => void;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const [assigneeId, setAssigneeId] = useState(idea.assignedTo?.id ?? '');
  const send = useMutation({
    meta: { success: t('feedback.ideas.assigned') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/{ref}/assign', {
          params: { path: { ref: idea.code } },
          body: { assigneeId: assigneeId || null, expectedStatus: idea.status },
        }),
      ),
    onSuccess: onDone,
    onError,
  });
  const server = fieldErrors(send.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('ideas.actions.assignTitle')}</DialogTitle>
          <DialogDescription>{t('ideas.actions.assignIntro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
          className="space-y-4"
        >
          <PersonPicker
            label={t('ideas.actions.assignee')}
            searchLabel={t('ideas.actions.assigneeSearch')}
            value={assigneeId}
            onChange={setAssigneeId}
            allowEmpty
            emptyLabel={t('ideas.actions.generalQueue')}
            error={server.assigneeId}
          />
          <FormError message={send.isError && !server.assigneeId ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApproveDialog({
  idea,
  onClose,
  onDone,
  onError,
}: {
  idea: IdeaDetail;
  onClose: () => void;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const [stepName, setStepName] = useState<string>(t('ideas.actions.stepNameDefault'));
  const [stepModel, setStepModel] = useState<'free' | 'pdca'>('free');
  const [stepDescription, setStepDescription] = useState<RichDoc | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState(dates.dayFromToday(14));
  const [touched, setTouched] = useState(false);
  const send = useMutation({
    meta: { success: t('feedback.ideas.approved') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/{ref}/approve', {
          params: { path: { ref: idea.code } },
          body: {
            stepName,
            stepDescription: richPayload(stepDescription).text || null,
            stepDescriptionRich: richPayload(stepDescription).rich,
            assigneeId,
            dueDate,
            stepModel,
            expectedStatus: idea.status,
          },
        }),
      ),
    onSuccess: onDone,
    onError,
  });
  const server = fieldErrors(send.error);
  const req = (v: string) => (touched && !v.trim() ? t('validation.required') : undefined);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('ideas.actions.approveTitle')}</DialogTitle>
          <DialogDescription>{t('ideas.actions.approveIntro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (stepName.trim() && assigneeId && dueDate) send.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('ideas.actions.stepModel')} hint={t('ideas.actions.stepModelHint')}>
            <NativeSelect
              value={stepModel}
              onChange={(e) => {
                const next = e.target.value as 'free' | 'pdca';
                setStepModel(next);
                // Troca o nome sugerido só se a pessoa ainda não escreveu outro.
                const defaults: string[] = [t('ideas.actions.stepNameDefault'), t('ideas.steps.pdca.plan')];
                if (defaults.includes(stepName)) {
                  setStepName(next === 'pdca' ? t('ideas.steps.pdca.plan') : t('ideas.actions.stepNameDefault'));
                }
              }}
            >
              <option value="free">{t('ideas.actions.stepModelFree')}</option>
              <option value="pdca">{t('ideas.actions.stepModelPdca')}</option>
            </NativeSelect>
          </Field>
          <Field label={t('ideas.actions.stepName')} error={req(stepName) ?? server.stepName}>
            <Input value={stepName} onChange={(e) => setStepName(e.target.value)} maxLength={200} />
          </Field>
          <Field label={t('ideas.actions.stepDescription')} optionalLabel={t('common.optional')}>
            <RichTextEditor rows={2} max={5000} value={stepDescription} onChange={setStepDescription} />
          </Field>
          <PersonPicker
            label={t('ideas.actions.assignee')}
            searchLabel={t('ideas.actions.assigneeSearch')}
            value={assigneeId}
            onChange={setAssigneeId}
            error={req(assigneeId) ?? server.assigneeId}
          />
          <Field label={t('ideas.actions.dueDate')} error={req(dueDate) ?? server.dueDate}>
            <Input
              type="date"
              min={dates.dayFromToday(0)}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending}>
              {t('ideas.actions.approve')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ idea, onClose, onDone }: { idea: IdeaDetail; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const categories = useActiveCategories();
  const [title, setTitle] = useState(idea.title);
  const [description, setDescription] = useState<RichDoc | null>(docOf(idea.descriptionRich, idea.description));
  const [proposedSolution, setProposedSolution] = useState<RichDoc | null>(
    docOf(idea.proposedSolutionRich, idea.proposedSolution),
  );
  const [expectedGain, setExpectedGain] = useState(idea.expectedGain ?? '');
  const [externalRef, setExternalRef] = useState(idea.externalRef ?? '');
  const [categoryId, setCategoryId] = useState(idea.category?.id ?? '');
  const send = useMutation({
    meta: { success: t('feedback.ideas.edited') },
    mutationFn: () =>
      unwrap(
        api.PATCH('/api/ideas/{ref}', {
          params: { path: { ref: idea.code } },
          body: {
            title,
            description: richPayload(description).text,
            descriptionRich: richPayload(description).rich,
            proposedSolution: richPayload(proposedSolution).text || null,
            proposedSolutionRich: richPayload(proposedSolution).rich,
            expectedGain: expectedGain || null,
            externalRef: externalRef || null,
            categoryId: categoryId || null,
          },
        }),
      ),
    onSuccess: onDone,
  });
  const server = fieldErrors(send.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('ideas.actions.editTitle')}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && !isEmptyDoc(description)) send.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('ideas.fields.title')} error={server.title}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </Field>
          <Field label={t('ideas.fields.description')} error={server.description}>
            <RichTextEditor rows={5} max={10_000} value={description} onChange={setDescription} />
          </Field>
          <Field label={t('ideas.fields.category')} error={server.categoryId}>
            <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">—</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('ideas.fields.proposedSolution')} optionalLabel={t('common.optional')}>
            <RichTextEditor rows={3} max={10_000} value={proposedSolution} onChange={setProposedSolution} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('ideas.fields.expectedGain')} optionalLabel={t('common.optional')}>
              <Input value={expectedGain} onChange={(e) => setExpectedGain(e.target.value)} maxLength={5000} />
            </Field>
            <Field
              label={t('ideas.fields.externalRef')}
              optionalLabel={t('common.optional')}
              error={server.externalRef}
            >
              <Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} maxLength={100} />
            </Field>
          </div>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending || !title.trim() || isEmptyDoc(description)}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
