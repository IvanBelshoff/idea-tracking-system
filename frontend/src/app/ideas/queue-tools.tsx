import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
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
import { ideaKeys, useActiveCategories } from './queries';

type BatchResult = components['schemas']['BatchResult'];
export type FilterDefinition = components['schemas']['FilterDefinition'];
type Action = 'assign' | 'category' | 'reject';

/**
 * Ações em lote (RN-59): cada ideia passa ou falha sozinha, e o resultado mostra qual falhou e por
 * quê (CA-RN-59.1). Recusar exige a justificativa, que vale para todas (CA-RN-59.2).
 */
export function BatchBar({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const categories = useActiveCategories();
  const [action, setAction] = useState<Action | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<BatchResult | null>(null);
  const run = useMutation({
    meta: { success: t('feedback.ideas.batchDone') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/batch', {
          body: {
            action: action ?? 'assign',
            refs: codes,
            ...(action === 'assign' ? { assigneeId: assigneeId || null } : {}),
            ...(action === 'category' ? { categoryId: categoryId || null } : {}),
            ...(action === 'reject' ? { reason } : {}),
          },
        }),
      ),
    onSuccess: (data) => {
      setResult(data);
      setAction(null);
      void qc.invalidateQueries({ queryKey: ideaKeys.all });
      onDone();
    },
  });
  const open = (a: Action) => {
    run.reset();
    setResult(null);
    setAction(a);
  };
  const ready = action === 'assign' || (action === 'category' && categoryId) || (action === 'reject' && reason.trim());

  return (
    <div className="mb-3">
      {codes.length > 0 && (
        <div
          role="toolbar"
          aria-label={t('ideas.batch.toolbar')}
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2"
        >
          <span className="mr-2 text-sm font-medium">{t('ideas.batch.selected', { count: codes.length })}</span>
          <Button size="sm" variant="outline" onClick={() => open('assign')}>
            {t('ideas.batch.assign')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => open('category')}>
            {t('ideas.batch.category')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => open('reject')}>
            {t('ideas.batch.reject')}
          </Button>
        </div>
      )}
      {result && (
        <div role="status" className="mt-2 rounded-lg border bg-card px-4 py-3 text-sm">
          <p className="font-medium">{t('ideas.batch.summary', { ok: result.succeeded, failed: result.failed })}</p>
          {result.failed > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {result.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.ref}>
                    <span className="font-mono">{r.ref}</span>: {r.message ?? r.error}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {action && (
        <Dialog open onOpenChange={(o) => !o && setAction(null)}>
          <DialogContent closeLabel={t('admin.common.close')}>
            <DialogHeader>
              <DialogTitle>{t(`ideas.batch.${action}Title`, { count: codes.length })}</DialogTitle>
              <DialogDescription>{t('ideas.batch.intro')}</DialogDescription>
            </DialogHeader>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (ready) run.mutate();
              }}
              className="space-y-4"
            >
              {action === 'assign' && (
                <PersonPicker
                  label={t('ideas.actions.assignee')}
                  searchLabel={t('ideas.actions.assigneeSearch')}
                  value={assigneeId}
                  onChange={setAssigneeId}
                  allowEmpty
                  emptyLabel={t('ideas.actions.generalQueue')}
                />
              )}
              {action === 'category' && (
                <Field label={t('ideas.fields.category')}>
                  <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">—</option>
                    {categories.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
              {action === 'reject' && (
                <Field label={t('ideas.actions.reason')} hint={t('ideas.batch.reasonHint')}>
                  <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={5000} />
                </Field>
              )}
              <FormError message={run.isError ? errorText(t, run.error) : null} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAction(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  variant={action === 'reject' ? 'destructive' : 'default'}
                  disabled={!ready || run.isPending}
                >
                  {t('ideas.batch.apply', { count: codes.length })}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

const FILTERS_KEY = ['saved-filters'] as const;

/** Filtros salvos (RN-59): privados de cada pessoa; aplicar só preenche os filtros da tela. */
export function SavedFilters({
  current,
  onApply,
}: {
  current: FilterDefinition;
  onApply: (d: FilterDefinition) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const filters = useQuery({ queryKey: FILTERS_KEY, queryFn: () => unwrap(api.GET('/api/saved-filters')) });
  const [selected, setSelected] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const save = useMutation({
    meta: { success: t('feedback.ideas.filterSaved') },
    mutationFn: () => unwrap(api.POST('/api/saved-filters', { body: { name: name.trim(), definition: current } })),
    onSuccess: (f) => {
      setNaming(false);
      setName('');
      setSelected(f.id);
      void qc.invalidateQueries({ queryKey: FILTERS_KEY });
    },
  });
  const remove = useMutation({
    meta: { success: t('feedback.ideas.filterRemoved') },
    mutationFn: (id: string) => unwrap(api.DELETE('/api/saved-filters/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      setSelected('');
      void qc.invalidateQueries({ queryKey: FILTERS_KEY });
    },
  });

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t('ideas.savedFilters.label')} className="min-w-48">
        <NativeSelect
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            const f = filters.data?.find((x) => x.id === e.target.value);
            if (f) onApply(f.definition);
          }}
        >
          <option value="">{t('ideas.savedFilters.none')}</option>
          {filters.data?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="button" variant="outline" size="sm" className="mb-0.5" onClick={() => setNaming(true)}>
        <Bookmark aria-hidden="true" />
        {t('ideas.savedFilters.save')}
      </Button>
      {selected && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-0.5"
          disabled={remove.isPending}
          onClick={() => remove.mutate(selected)}
        >
          <Trash2 aria-hidden="true" />
          {t('ideas.savedFilters.remove')}
        </Button>
      )}
      {naming && (
        <Dialog open onOpenChange={(o) => !o && setNaming(false)}>
          <DialogContent closeLabel={t('admin.common.close')}>
            <DialogHeader>
              <DialogTitle>{t('ideas.savedFilters.saveTitle')}</DialogTitle>
              <DialogDescription>{t('ideas.savedFilters.saveIntro')}</DialogDescription>
            </DialogHeader>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) save.mutate();
              }}
              className="space-y-4"
            >
              <Field label={t('ideas.savedFilters.name')}>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
              </Field>
              <FormError message={save.isError ? errorText(t, save.error) : null} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setNaming(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={!name.trim() || save.isPending}>
                  {t('common.save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
