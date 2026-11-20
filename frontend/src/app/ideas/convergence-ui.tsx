import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { GitMerge, HandHeart, Trash2, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '../auth/auth-layout';
import { PersonPicker } from './person-picker';
import { type IdeaDetail, ideaKeys } from './queries';
import { IdeaStatusBadge } from './ui';

// --- Sugestões de semelhantes no envio (RN-57) ----------------------------------------------------

/** Debounce simples: o valor só muda depois de `ms` sem digitação. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Enquanto a pessoa digita o título, mostra até 5 ideias abertas parecidas. Ela pode apoiar uma
 * delas (vira co-autora, sem criar ideia nova) ou enviar a sua mesmo assim (CA-RN-57.3).
 */
export function SimilarIdeas({
  title,
  entityId,
  onSupported,
}: {
  title: string;
  entityId: string;
  onSupported: (code: string) => void;
}) {
  const { t } = useTranslation();
  const q = useDebounced(title.trim(), 450);
  const [supporting, setSupporting] = useState<string | null>(null);
  const similar = useQuery({
    queryKey: ['ideas', 'similar', q, entityId],
    queryFn: () => unwrap(api.GET('/api/ideas/similar', { params: { query: { q, entityId: entityId || undefined } } })),
    enabled: q.length >= 4,
    staleTime: 30_000,
  });
  const items = q.length >= 4 ? (similar.data ?? []) : [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="parecidas" aria-live="polite" className="rounded-lg border border-dashed bg-muted/30 p-4">
      <h3 id="parecidas" className="text-sm font-semibold">
        {t('ideas.similar.title')}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('ideas.similar.intro')}</p>
      <ul className="mt-3 space-y-2">
        {items.map((s) => (
          <li key={s.code} className="flex flex-wrap items-center gap-2 rounded-md bg-card px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.title}</span>
              <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <IdeaStatusBadge status={s.status} />
                {s.own && <span>{t('ideas.similar.own')}</span>}
              </span>
            </span>
            {s.canView && (
              <Button asChild size="sm" variant="ghost">
                <Link to="/ideias/$ref" params={{ ref: s.code }} target="_blank">
                  {t('ideas.similar.view')}
                </Link>
              </Button>
            )}
            {s.canSupport && (
              <Button type="button" size="sm" variant="outline" onClick={() => setSupporting(s.code)}>
                <HandHeart aria-hidden="true" />
                {t('ideas.similar.support')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{t('ideas.similar.sendAnyway')}</p>
      {supporting && (
        <SupportDialog
          code={supporting}
          onClose={() => setSupporting(null)}
          onDone={() => {
            onSupported(supporting);
            setSupporting(null);
          }}
        />
      )}
    </section>
  );
}

/** Apoiar uma ideia (RN-85a): a pessoa entra como co-autora, com um comentário opcional para a equipe. */
export function SupportDialog({ code, onClose, onDone }: { code: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const send = useMutation({
    meta: { success: t('feedback.ideas.supported') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/{ref}/support', {
          params: { path: { ref: code } },
          body: { note: note.trim() || undefined },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ideaKeys.all });
      onDone();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('ideas.similar.supportTitle')}</DialogTitle>
          <DialogDescription>{t('ideas.similar.supportIntro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
          className="space-y-4"
        >
          <Field
            label={t('ideas.similar.note')}
            optionalLabel={t('common.optional')}
            hint={t('ideas.similar.noteHint')}
          >
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </Field>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending}>
              {t('ideas.similar.supportConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Detalhe: convergida, participantes, convergidas nesta ---------------------------------------

/** Aviso na ideia convergida: ela é acompanhada pela principal (RN-84, RN-87). */
export function ConvergedBanner({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  if (!idea.convergedInto) return null;
  return (
    <div role="note" className="rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
      <p className="flex items-start gap-2 font-medium">
        <GitMerge aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          {t('ideas.convergence.bannerPrefix')}{' '}
          <Link
            to="/ideias/$ref"
            params={{ ref: idea.convergedInto.code }}
            className="font-mono underline underline-offset-4"
          >
            {idea.convergedInto.code}
          </Link>{' '}
          · {idea.convergedInto.title}
        </span>
      </p>
      <p className="mt-1 text-muted-foreground">{t('ideas.convergence.bannerText')}</p>
      {idea.convergedReason && (
        <p className="mt-2 rounded-md bg-muted px-3 py-2 whitespace-pre-wrap">
          {t('ideas.convergence.reason', { reason: idea.convergedReason })}
        </p>
      )}
    </div>
  );
}

const ROLE_ORDER: Record<string, number> = { author: 0, co_author: 1, executor: 2 };

/** Participantes (RN-69): autor, co-autores e executores; a equipe adiciona e remove (menos o autor). */
export function ParticipantsCard({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const remove = useMutation({
    meta: { success: t('feedback.ideas.participantRemoved') },
    mutationFn: (participantId: string) =>
      unwrap(
        api.DELETE('/api/ideas/{ref}/participants/{participantId}', {
          params: { path: { ref: idea.code, participantId } },
        }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(ideaKeys.detail(idea.code), data);
      void qc.invalidateQueries({ queryKey: ideaKeys.timeline(idea.code) });
    },
  });
  if (idea.convergedInto) return null;
  const list = [...idea.participants].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));
  return (
    <section aria-labelledby="participantes" className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="participantes" className="flex items-center gap-2 font-semibold">
          <Users aria-hidden="true" className="size-4" />
          {t('ideas.participants.title')}
        </h2>
        {idea.can.manageParticipants && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden="true" />
            {t('ideas.participants.add')}
          </Button>
        )}
      </div>
      {idea.requesters > 1 && (
        <p className="mt-2 text-sm font-medium text-primary">
          {t('ideas.participants.requesters', { count: idea.requesters })}
        </p>
      )}
      <ul className="mt-3 space-y-2 text-sm">
        {list.map((p) => (
          <li key={p.id} className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{p.user.name}</span>{' '}
              <Badge variant="outline" className="ml-1 align-middle">
                {t(`ideas.participants.roles.${p.role}` as never)}
              </Badge>
              {p.origin !== 'original' && (
                <span className="ml-1 text-xs text-muted-foreground">
                  {t(`ideas.participants.origins.${p.origin}` as never)}
                  {p.sourceCode ? ` · ${p.sourceCode}` : ''}
                </span>
              )}
              {p.note && <span className="mt-0.5 block text-xs text-muted-foreground">“{p.note}”</span>}
            </span>
            {idea.can.manageParticipants && p.role !== 'author' && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('ideas.participants.remove', { name: p.user.name })}
                disabled={remove.isPending}
                onClick={() => remove.mutate(p.id)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <FormError message={remove.isError ? errorText(t, remove.error) : null} />
      {adding && <AddParticipantDialog idea={idea} onClose={() => setAdding(false)} />}
    </section>
  );
}

function AddParticipantDialog({ idea, onClose }: { idea: IdeaDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'co_author' | 'executor'>('co_author');
  const add = useMutation({
    meta: { success: t('feedback.ideas.participantAdded') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/{ref}/participants', { params: { path: { ref: idea.code } }, body: { userId, role } }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(ideaKeys.detail(idea.code), data);
      void qc.invalidateQueries({ queryKey: ideaKeys.timeline(idea.code) });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('ideas.participants.addTitle')}</DialogTitle>
          <DialogDescription>{t('ideas.participants.addIntro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (userId) add.mutate();
          }}
          className="space-y-4"
        >
          <PersonPicker
            label={t('ideas.participants.person')}
            searchLabel={t('ideas.actions.assigneeSearch')}
            value={userId}
            onChange={setUserId}
            error={fieldErrors(add.error).userId}
          />
          <Field label={t('ideas.participants.role')}>
            <NativeSelect value={role} onChange={(e) => setRole(e.target.value as 'co_author' | 'executor')}>
              <option value="co_author">{t('ideas.participants.roles.co_author')}</option>
              <option value="executor">{t('ideas.participants.roles.executor')}</option>
            </NativeSelect>
          </Field>
          <FormError message={add.isError ? errorText(t, add.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!userId || add.isPending}>
              {t('ideas.participants.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Ideias convergidas nesta, com o texto original de cada pessoa (só a equipe vê; RN-86). */
export function ConvergedIdeasCard({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  if (idea.convergedIdeas.length === 0) return null;
  return (
    <section aria-labelledby="convergidas" className="rounded-lg border bg-card p-5">
      <h2 id="convergidas" className="flex items-center gap-2 font-semibold">
        <GitMerge aria-hidden="true" className="size-4" />
        {t('ideas.convergence.listTitle', { count: idea.convergedIdeas.length })}
      </h2>
      <ul className="mt-3 space-y-3 text-sm">
        {idea.convergedIdeas.map((c) => (
          <li key={c.code} className="rounded-md border p-3">
            <p>
              <Link
                to="/ideias/$ref"
                params={{ ref: c.code }}
                className="font-mono text-xs underline underline-offset-4"
              >
                {c.code}
              </Link>{' '}
              <span className="font-medium">{c.title}</span>
              {c.author && <span className="text-muted-foreground"> · {c.author.name}</span>}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{c.description}</p>
            {c.reason && <p className="mt-1 text-xs">{t('ideas.convergence.reason', { reason: c.reason })}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Converger (RN-85b): o analista informa a outra ideia e a justificativa; a mais antiga vira a principal. */
export function ConvergeDialog({
  idea,
  onClose,
  onDone,
}: {
  idea: IdeaDetail;
  onClose: () => void;
  onDone: (code: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const send = useMutation({
    meta: { success: t('feedback.ideas.converged') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/{ref}/converge', {
          params: { path: { ref: idea.code } },
          body: { targetRef: target.trim().toUpperCase(), reason: reason.trim() },
        }),
      ),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ideaKeys.all });
      onDone(data.code);
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('ideas.convergence.convergeTitle')}</DialogTitle>
          <DialogDescription>{t('ideas.convergence.convergeIntro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (target.trim() && reason.trim()) send.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('ideas.convergence.target')} hint={t('ideas.convergence.targetHint')}>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="ITS-2026-0001"
              className="font-mono"
            />
          </Field>
          <Field label={t('ideas.actions.reason')}>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={5000} />
          </Field>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!target.trim() || !reason.trim() || send.isPending}>
              {t('ideas.convergence.converge')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Desfazer a convergência (RN-88): a ideia volta a ter fluxo próprio. */
export function UnconvergeDialog({
  idea,
  onClose,
  onDone,
}: {
  idea: IdeaDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const send = useMutation({
    meta: { success: t('feedback.ideas.unconverged') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/{ref}/unconverge', {
          params: { path: { ref: idea.code } },
          body: { reason: reason.trim() || undefined },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ideaKeys.all });
      onDone();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('ideas.convergence.undoTitle')}</DialogTitle>
          <DialogDescription>{t('ideas.convergence.undoIntro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('ideas.actions.reason')} optionalLabel={t('common.optional')}>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={5000} />
          </Field>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending}>
              {t('ideas.convergence.undo')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
