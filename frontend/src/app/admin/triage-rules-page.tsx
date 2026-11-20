import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormError } from '../auth/auth-layout';
import { PersonPicker } from '../ideas/person-picker';
import { useActiveCategories } from '../ideas/queries';
import { CategoryTag } from '../ideas/ui';
import { useEntities } from './queries';
import { AdminPage, entityOptionLabel, orderTree } from './shared';

type Rule = components['schemas']['TriageRuleView'];
const KEY = ['admin', 'triage-rules'] as const;

function RuleDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const entities = useEntities();
  const categories = useActiveCategories();
  const [entityId, setEntityId] = useState(rule?.entity?.id ?? '');
  const [categoryId, setCategoryId] = useState(rule?.category?.id ?? '');
  const [assigneeId, setAssigneeId] = useState(rule?.assignee.id ?? '');
  const [priority, setPriority] = useState(String(rule?.priority ?? 0));
  const [active, setActive] = useState(rule?.active ?? true);
  const save = useMutation({
    meta: { success: rule ? t('feedback.triage.updated') : t('feedback.triage.created') },
    mutationFn: () => {
      const body = {
        entityId: entityId || null,
        categoryId: categoryId || null,
        assigneeId,
        priority: Number(priority) || 0,
        active,
      };
      return unwrap(
        rule
          ? api.PUT('/api/triage-rules/{id}', { params: { path: { id: rule.id } }, body })
          : api.POST('/api/triage-rules', { body }),
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
  });
  const server = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{rule ? t('admin.triageRules.editTitle') : t('admin.triageRules.newTitle')}</DialogTitle>
          <DialogDescription>{t('admin.triageRules.dialogIntro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('admin.triageRules.entity')} hint={t('admin.triageRules.entityHint')} error={server.entityId}>
            <NativeSelect value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">{t('admin.triageRules.anyEntity')}</option>
              {orderTree(entities.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {entityOptionLabel(e)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('admin.triageRules.category')} error={server.categoryId}>
            <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('admin.triageRules.anyCategory')}</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <PersonPicker
            label={t('admin.triageRules.assignee')}
            searchLabel={t('ideas.actions.assigneeSearch')}
            value={assigneeId}
            onChange={setAssigneeId}
            error={server.assigneeId}
          />
          <Field
            label={t('admin.triageRules.priority')}
            hint={t('admin.triageRules.priorityHint')}
            error={server.priority}
          >
            <Input
              inputMode="numeric"
              value={priority}
              onChange={(e) => setPriority(e.target.value.replace(/[^\d-]/g, ''))}
              className="max-w-28"
            />
          </Field>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="regra-ativa" checked={active} onCheckedChange={(v) => setActive(v === true)} />
            <label htmlFor="regra-ativa">{t('admin.triageRules.active')}</label>
          </div>
          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || !assigneeId}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Regras de atribuição automática da triagem (RN-55). */
export function TriageRulesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: KEY, queryFn: () => unwrap(api.GET('/api/triage-rules')) });
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const remove = useMutation({
    meta: { success: t('feedback.triage.removed') },
    mutationFn: (id: string) => unwrap(api.DELETE('/api/triage-rules/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });

  return (
    <AdminPage
      title={t('admin.triageRules.pageTitle')}
      intro={t('admin.triageRules.intro')}
      help="adminTriageRules"
      actions={
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" />
          {t('admin.triageRules.add')}
        </Button>
      }
    >
      <FormError message={rules.isError ? errorText(t, rules.error) : null} />
      {rules.data && rules.data.length === 0 && (
        <p className="rounded-lg border bg-card px-6 py-10 text-center text-muted-foreground">
          {t('admin.triageRules.empty')}
        </p>
      )}
      {rules.data && rules.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.triageRules.entity')}</TableHead>
                <TableHead>{t('admin.triageRules.category')}</TableHead>
                <TableHead>{t('admin.triageRules.assignee')}</TableHead>
                <TableHead>{t('admin.triageRules.priority')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('admin.triageRules.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.data.map((r) => (
                <TableRow key={r.id} className={r.active ? '' : 'opacity-60'}>
                  <TableCell>{r.entity?.name ?? t('admin.triageRules.anyEntity')}</TableCell>
                  <TableCell>
                    {r.category ? <CategoryTag category={r.category} /> : t('admin.triageRules.anyCategory')}
                  </TableCell>
                  <TableCell>
                    {r.assignee.name}
                    {!r.active && (
                      <Badge variant="secondary" className="ml-2">
                        {t('admin.triageRules.inactive')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.priority}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('admin.triageRules.editFor', { name: r.assignee.name })}
                      onClick={() => setEditing(r)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('admin.triageRules.removeFor', { name: r.assignee.name })}
                      onClick={() => setRemoving(r)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <RuleDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('admin.triageRules.removeTitle')}
        description={t('admin.triageRules.removeText')}
        confirmLabel={t('admin.triageRules.remove')}
        cancelLabel={t('common.cancel')}
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </AdminPage>
  );
}
