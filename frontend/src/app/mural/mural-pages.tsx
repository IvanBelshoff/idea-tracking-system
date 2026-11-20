import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, EyeOff, Flag, History, Pencil, Reply, RotateCcw, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiError, errorText, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useEntities } from '../admin/queries';
import { entityOptionLabel, orderTree } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { HelpLink } from '../help';
import { useActiveCategories } from '../ideas/queries';
import { usePageTitle } from '../page-title';
import { NotFoundPage } from '../pages/status-pages';
import { usePublicSettings } from '../session';
import { useDates } from '../use-dates';
import { MuralCardView, PersonLine, patchCard } from './mural-parts';
import {
  type FeedFilters,
  type MuralComment,
  type MuralPage as MuralPageData,
  muralKeys,
  useMuralFeed,
  useMuralPage,
  useRevisions,
} from './queries';

const NO_FILTERS: FeedFilters = { sort: 'recent', status: '', categoryId: '', entityId: '' };

/** Lista do mural (RN-150) com ordem, filtros e "Carregar mais" (nunca rolagem infinita sem fim). */
export function MuralFeed() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<FeedFilters>(NO_FILTERS);
  const feed = useMuralFeed(filters);
  const categories = useActiveCategories();
  const entities = useEntities();
  const set = (patch: Partial<FeedFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = filters.status !== '' || filters.categoryId !== '' || filters.entityId !== '';
  return (
    <section aria-labelledby="mural-titulo">
      <div className="flex items-start gap-1.5">
        <h2 id="mural-titulo" className="text-xl font-semibold">
          {t('mural.title')}
        </h2>
        <span className="pt-0.5">
          <HelpLink topic="mural" />
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('mural.intro')}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('mural.sort')}>
          <NativeSelect value={filters.sort} onChange={(e) => set({ sort: e.target.value as FeedFilters['sort'] })}>
            <option value="recent">{t('mural.sorts.recent')}</option>
            <option value="reactions">{t('mural.sorts.reactions')}</option>
          </NativeSelect>
        </Field>
        <Field label={t('mural.status')}>
          <NativeSelect
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as FeedFilters['status'] })}
          >
            <option value="">{t('mural.allStatus')}</option>
            <option value="in_progress">{t('ideas.status.in_progress')}</option>
            <option value="implemented">{t('ideas.status.implemented')}</option>
          </NativeSelect>
        </Field>
        <Field label={t('mural.category')}>
          <NativeSelect value={filters.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">{t('mural.allCategories')}</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('mural.entity')}>
          <NativeSelect value={filters.entityId} onChange={(e) => set({ entityId: e.target.value })}>
            <option value="">{t('mural.allEntities')}</option>
            {orderTree(entities.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {entityOptionLabel(e)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <FormError message={feed.isError ? errorText(t, feed.error) : null} />
      {feed.data && items.length === 0 ? (
        <p className="mt-4 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          {filtered ? t('mural.emptyFiltered') : t('mural.empty')}
        </p>
      ) : (
        <ul aria-label={t('mural.listLabel')} className="mt-4 grid gap-4">
          {items.map((c) => (
            <li key={c.code}>
              <MuralCardView card={c} />
            </li>
          ))}
        </ul>
      )}
      {feed.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
            {feed.isFetchingNextPage ? t('mural.loading') : t('mural.loadMore')}
          </Button>
        </div>
      )}
    </section>
  );
}

/** A página de uma ideia no mural (/mural/ITS-2026-0042): o cartão e a conversa (RN-150, RN-153). */
export function MuralIdeaPage() {
  const { t } = useTranslation();
  const { ref } = useParams({ from: '/instalacao/sessao/mural/$ref' });
  const { data: settings } = usePublicSettings();
  const page = useMuralPage(ref);
  usePageTitle(page.data ? page.data.card.title : t('mural.pageTitle'), settings?.organizationName);
  const back = (
    <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t('mural.back')}
    </Link>
  );
  if (page.error instanceof ApiError && page.error.code === 'mural_withdrawn') {
    return (
      <div className="mx-auto max-w-3xl">
        {back}
        <p className="mt-4 rounded-lg border bg-card p-6">{t('mural.withdrawnPage')}</p>
      </div>
    );
  }
  if (page.error instanceof ApiError && page.error.status === 404) return <NotFoundPage />;
  if (!page.data) return page.isError ? <FormError message={errorText(t, page.error)} /> : null;
  const d = page.data;
  return (
    <div className="mx-auto max-w-3xl">
      {back}
      <div className="mt-3">
        <MuralCardView card={d.card} headingLevel="h1" />
      </div>
      <div className="mt-2 px-1">
        <ReactionNotice card={d.card} />
      </div>
      <Conversation page={d} />
    </div>
  );
}

/** O aviso de que o nome aparece ao reagir (RN-152), visível só na página da ideia. */
function ReactionNotice({ card }: { card: MuralPageData['card'] }) {
  const { t } = useTranslation();
  return <p className="text-xs text-muted-foreground">{card.canReact ? t('mural.nameNotice') : t('mural.ownIdea')}</p>;
}

/** Mantém a conversa e a contagem do cartão em dia com a resposta da API (que devolve a conversa inteira). */
function useSetThread(code: string) {
  const qc = useQueryClient();
  return (comments: MuralComment[]) => {
    qc.setQueryData<MuralPageData>(muralKeys.page(code), (old) => (old ? { ...old, comments } : old));
    const visible = comments.flatMap((c) => [c, ...c.replies]).filter((c) => c.state === 'visible').length;
    patchCard(qc, code, { commentCount: visible });
  };
}

/** A conversa do mural (RN-153): comentários com respostas de um nível, publicados na hora. */
function Conversation({ page }: { page: MuralPageData }) {
  const { t } = useTranslation();
  const code = page.card.code;
  const setThread = useSetThread(code);
  const [body, setBody] = useState('');
  const send = useMutation({
    meta: { success: t('feedback.mural.commented') },
    mutationFn: () =>
      unwrap(api.POST('/api/mural/ideas/{ref}/comments', { params: { path: { ref: code } }, body: { body } })),
    onSuccess: (data) => {
      setThread(data);
      setBody('');
    },
  });
  return (
    <section id="conversa" aria-labelledby="conversa-titulo" className="mt-6 rounded-lg border bg-card p-5">
      <h2 id="conversa-titulo" className="font-semibold">
        {t('mural.conversation')}
      </h2>
      {page.comments.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('mural.noComments')}</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {page.comments.map((c) => (
            <li key={c.id}>
              <CommentItem code={code} comment={c} canManage={page.card.canManage} />
              {c.replies.length > 0 && (
                <ul className="mt-2 space-y-2 border-l-2 pl-4">
                  {c.replies.map((r) => (
                    <li key={r.id}>
                      <CommentItem code={code} comment={r} canManage={page.card.canManage} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {page.canComment && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) send.mutate();
          }}
          className="mt-5 space-y-2"
        >
          <Field label={t('mural.newComment')} hint={t('mural.commentHint')}>
            <Textarea rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <Button type="submit" disabled={send.isPending || !body.trim()}>
            {t('mural.send')}
          </Button>
        </form>
      )}
    </section>
  );
}

function CommentItem({ code, comment: c, canManage }: { code: string; comment: MuralComment; canManage: boolean }) {
  const { t } = useTranslation();
  const dates = useDates();
  const setThread = useSetThread(code);
  const [mode, setMode] = useState<'view' | 'edit' | 'reply'>('view');
  const [text, setText] = useState('');
  const [dialog, setDialog] = useState<'delete' | 'report' | 'hide' | 'revisions' | null>(null);
  const fieldId = useId();
  const reply = useMutation({
    meta: { success: t('feedback.mural.replied') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/mural/ideas/{ref}/comments', {
          params: { path: { ref: code } },
          body: { body: text, parentId: c.id },
        }),
      ),
    onSuccess: (data) => {
      setThread(data);
      setMode('view');
      setText('');
    },
  });
  const edit = useMutation({
    meta: { success: t('feedback.mural.edited') },
    mutationFn: () =>
      unwrap(api.PATCH('/api/mural/comments/{id}', { params: { path: { id: c.id } }, body: { body: text } })),
    onSuccess: (data) => {
      setThread(data);
      setMode('view');
    },
  });
  const remove = useMutation({
    meta: { success: t('feedback.mural.removed') },
    mutationFn: () => unwrap(api.DELETE('/api/mural/comments/{id}', { params: { path: { id: c.id } } })),
    onSuccess: (data) => {
      setThread(data);
      setDialog(null);
    },
  });
  const restore = useMutation({
    meta: { success: t('feedback.mural.restored') },
    mutationFn: () => unwrap(api.POST('/api/mural/comments/{id}/restore', { params: { path: { id: c.id } } })),
    onSuccess: setThread,
  });

  if (c.state === 'deleted') {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground italic">{t('mural.removed')}</p>
    );
  }
  const hidden = c.state === 'hidden';
  return (
    <article className={`rounded-md border p-3 text-sm ${hidden ? 'border-dashed bg-muted/40' : ''}`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {c.author && <PersonLine person={c.author} />}
        <span>· {dates.dateTime(c.createdAt)}</span>
        {c.editedAt && <span>· {t('mural.edited')}</span>}
        {c.pendingReports > 0 && (
          <Badge variant="outline" className="border-(--st-rejected) text-(--st-rejected)">
            <Flag aria-hidden="true" />
            {t('mural.pendingReports', { count: c.pendingReports })}
          </Badge>
        )}
      </p>
      {hidden && (
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {c.hiddenReason
            ? c.mine
              ? t('mural.hiddenMine', { reason: c.hiddenReason })
              : t('mural.hiddenTeam', { reason: c.hiddenReason })
            : t('mural.hiddenOthers')}
        </p>
      )}
      {mode === 'edit' ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) edit.mutate();
          }}
          className="mt-2 space-y-2"
        >
          <Label htmlFor={fieldId} className="sr-only">
            {t('mural.editLabel')}
          </Label>
          <Textarea id={fieldId} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          <FormError message={edit.isError ? errorText(t, edit.error) : null} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={edit.isPending || !text.trim()}>
              {t('mural.save')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setMode('view')}>
              {t('mural.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        c.body !== null && <p className="mt-1 whitespace-pre-wrap wrap-break-word">{c.body}</p>
      )}
      {mode === 'view' && (
        <div className="mt-2 flex flex-wrap gap-1">
          {/* Responder a uma resposta grava no comentário de origem (um nível só; RN-153). */}
          {!hidden && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setMode('reply')}>
              <Reply aria-hidden="true" />
              {t('mural.reply')}
            </Button>
          )}
          {c.canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => {
                setText(c.body ?? '');
                setMode('edit');
              }}
            >
              <Pencil aria-hidden="true" />
              {t('mural.edit')}
            </Button>
          )}
          {c.mine && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setDialog('delete')}>
              <Trash2 aria-hidden="true" />
              {t('mural.delete')}
            </Button>
          )}
          {c.canReport && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setDialog('report')}>
              <Flag aria-hidden="true" />
              {t('mural.report')}
            </Button>
          )}
          {c.reportedByMe && (
            <span className="self-center px-2 text-xs text-muted-foreground">{t('mural.reported')}</span>
          )}
          {canManage && !hidden && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setDialog('hide')}>
              <EyeOff aria-hidden="true" />
              {t('mural.hide')}
            </Button>
          )}
          {canManage && hidden && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              disabled={restore.isPending}
              onClick={() => restore.mutate()}
            >
              <RotateCcw aria-hidden="true" />
              {t('mural.restore')}
            </Button>
          )}
          {canManage && c.editedAt && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setDialog('revisions')}>
              <History aria-hidden="true" />
              {t('mural.revisions')}
            </Button>
          )}
        </div>
      )}
      <FormError message={restore.isError ? errorText(t, restore.error) : null} />
      {mode === 'reply' && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) reply.mutate();
          }}
          className="mt-2 space-y-2"
        >
          <Label htmlFor={fieldId}>{t('mural.replyLabel')}</Label>
          <Textarea
            id={fieldId}
            rows={2}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <FormError message={reply.isError ? errorText(t, reply.error) : null} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={reply.isPending || !text.trim()}>
              {t('mural.sendReply')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setMode('view');
                setText('');
              }}
            >
              {t('mural.cancel')}
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('mural.deleteTitle')}
        description={t('mural.deleteText')}
        confirmLabel={t('mural.delete')}
        cancelLabel={t('mural.cancel')}
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        <FormError message={remove.isError ? errorText(t, remove.error) : null} />
      </ConfirmDialog>
      {dialog === 'report' && <ReportDialog id={c.id} onDone={setThread} onClose={() => setDialog(null)} />}
      {dialog === 'hide' && (
        <ReasonDialog
          title={t('mural.hideTitle')}
          label={t('mural.hideReason')}
          confirm={t('mural.hide')}
          success={t('feedback.mural.hidden')}
          onClose={() => setDialog(null)}
          onSend={(reason) =>
            unwrap(
              api.POST('/api/mural/comments/{id}/hide', { params: { path: { id: c.id } }, body: { reason } }),
            ).then(setThread)
          }
        />
      )}
      {dialog === 'revisions' && <RevisionsDialog id={c.id} onClose={() => setDialog(null)} />}
    </article>
  );
}

/** Denunciar (RN-154): motivo num grupo de opções nativo, detalhe opcional. */
function ReportDialog({
  id,
  onDone,
  onClose,
}: {
  id: string;
  onDone: (comments: MuralComment[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<'offensive' | 'personal_data' | 'off_topic' | 'other' | ''>('');
  const [note, setNote] = useState('');
  const groupId = useId();
  const send = useMutation({
    meta: { success: t('feedback.mural.reported') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/mural/comments/{id}/report', {
          params: { path: { id } },
          body: { reason: reason as 'offensive', note: note.trim() || null },
        }),
      ),
    onSuccess: (data) => {
      onDone(data);
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('mural.reportTitle')}</DialogTitle>
          <DialogDescription>{t('mural.reportIntro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (reason) send.mutate();
          }}
          className="space-y-4"
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('mural.reportReason')}</legend>
            {(['offensive', 'personal_data', 'off_topic', 'other'] as const).map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input type="radio" name={groupId} checked={reason === r} onChange={() => setReason(r)} />
                {t(`mural.reportReasons.${r}`)}
              </label>
            ))}
          </fieldset>
          <Field label={t('mural.reportNote')}>
            <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('mural.cancel')}
            </Button>
            <Button type="submit" disabled={!reason || send.isPending}>
              {t('mural.reportSend')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReasonDialog({
  title,
  label,
  confirm,
  hint,
  success,
  onClose,
  onSend,
}: {
  title: string;
  label: string;
  confirm: string;
  /** Texto do aviso na tela quando der certo (RN-174). */
  success: string;
  hint?: string;
  onClose: () => void;
  onSend: (reason: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const send = useMutation({ meta: { success }, mutationFn: () => onSend(reason.trim()), onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {hint && <DialogDescription>{hint}</DialogDescription>}
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) send.mutate();
          }}
          className="space-y-4"
        >
          <Field label={label}>
            <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('mural.cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending || !reason.trim()}>
              {confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevisionsDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const dates = useDates();
  const list = useRevisions(id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('mural.revisionsTitle')}</DialogTitle>
        </DialogHeader>
        <FormError message={list.isError ? errorText(t, list.error) : null} />
        {list.data && list.data.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('mural.noRevisions')}</p>
        )}
        <ol className="max-h-80 space-y-3 overflow-y-auto text-sm">
          {list.data?.map((r) => (
            <li key={r.replacedAt} className="rounded-md border p-3">
              <p className="whitespace-pre-wrap wrap-break-word">{r.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('mural.replacedAt', { date: dates.dateTime(r.replacedAt) })}
              </p>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
