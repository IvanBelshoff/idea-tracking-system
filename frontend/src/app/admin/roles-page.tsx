import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '../auth/auth-layout';
import { keys } from '../session';
import { adminKeys, usePermissionCatalog, useRoles } from './queries';
import { AdminPage } from './shared';

type RoleView = components['schemas']['RoleView'];
type Permission = RoleView['permissions'][number];

/** Grupos de permissão na tela (só apresentação; os códigos vêm da API). */
const GROUPS: { key: 'ideas' | 'results' | 'focus' | 'admin'; prefixes: string[] }[] = [
  { key: 'ideas', prefixes: ['idea.', 'step.'] },
  { key: 'results', prefixes: ['report.', 'gain.'] },
  { key: 'focus', prefixes: ['campaign.', 'hall.'] },
  {
    key: 'admin',
    prefixes: [
      'user.',
      'role.',
      'entity.',
      'category.',
      'setting.',
      'email.',
      'audit.',
      'ops.',
      'sso.',
      'integration.',
    ],
  },
];

function RoleDialog({
  role,
  open,
  onOpenChange,
}: {
  role: RoleView | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const catalog = usePermissionCatalog();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<Permission>>(new Set(role?.permissions ?? []));
  const locked = role?.systemKey === 'admin';

  const save = useMutation({
    meta: { success: role ? t('feedback.roles.updated') : t('feedback.roles.created') },
    mutationFn: () => {
      const body = { name: name.trim(), description: description.trim() || null, permissions: [...selected] };
      return role
        ? unwrap(
            api.PATCH('/api/roles/{id}', {
              params: { path: { id: role.id } },
              body: locked ? { name: body.name, description: body.description } : body,
            }),
          )
        : unwrap(api.POST('/api/roles', { body }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.roles });
      void qc.invalidateQueries({ queryKey: keys.me });
      onOpenChange(false);
    },
  });

  const toggle = (p: Permission, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{role ? t('admin.roles.editTitle') : t('admin.roles.createTitle')}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
          className="space-y-4"
        >
          <Field
            label={t('admin.roles.name')}
            error={save.isIdle || name.trim() ? undefined : t('validation.required')}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <Field label={t('admin.roles.description')} optionalLabel={t('common.optional')}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />
          </Field>
          <fieldset>
            <legend className="text-sm font-medium">{t('admin.roles.permissions')}</legend>
            {locked && (
              <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
                <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {t('admin.roles.adminLocked')}
              </p>
            )}
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {GROUPS.map((g) => (
                <div key={g.key}>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t(`admin.roles.groups.${g.key}`)}
                  </p>
                  <div className="space-y-2">
                    {catalog.data
                      ?.filter((p) => g.prefixes.some((pre) => p.code.startsWith(pre)))
                      .map((p) => (
                        <div key={p.code} className="flex items-start gap-2 text-sm">
                          <Checkbox
                            id={`perm-${p.code}`}
                            className="mt-0.5"
                            checked={locked || selected.has(p.code)}
                            disabled={locked}
                            onCheckedChange={(v) => toggle(p.code, v === true)}
                          />
                          <label htmlFor={`perm-${p.code}`}>
                            {t(`permissions.${p.code}` as never)}
                            <span className="block font-mono text-[0.7rem] text-muted-foreground">{p.code}</span>
                          </label>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RolesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roles = useRoles();
  const [editing, setEditing] = useState<RoleView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RoleView | null>(null);

  const remove = useMutation({
    meta: { success: t('feedback.roles.removed') },
    mutationFn: (role: RoleView) => unwrap(api.DELETE('/api/roles/{id}', { params: { path: { id: role.id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.roles });
      setDeleting(null);
    },
  });

  return (
    <AdminPage
      title={t('admin.roles.pageTitle')}
      intro={t('admin.roles.intro')}
      help="adminRoles"
      actions={
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" />
          {t('admin.roles.new')}
        </Button>
      }
    >
      {roles.isError && <FormError message={errorText(t, roles.error)} />}
      <ul className="grid gap-4 md:grid-cols-2">
        {roles.data?.map((r) => (
          <li key={r.id} className="flex flex-col rounded-lg border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold">{r.name}</h2>
              {r.isSystem && <Badge variant="outline">{t('admin.roles.system')}</Badge>}
            </div>
            {r.description && <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>}
            <p className="mt-3 text-sm">
              {t('admin.roles.permissionsCount', { count: r.permissions.length })} ·{' '}
              {t('admin.roles.usersCount', { count: r.usersCount })}
            </p>
            <div className="mt-4 flex flex-1 items-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
                <Pencil aria-hidden="true" />
                {t('admin.common.edit')}
              </Button>
              {!r.isSystem && (
                <Button variant="ghost" size="sm" onClick={() => setDeleting(r)}>
                  <Trash2 aria-hidden="true" />
                  {t('admin.common.delete')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <RoleDialog
          key={editing === 'new' ? 'new' : editing.id}
          role={editing === 'new' ? null : editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) {
            setDeleting(null);
            remove.reset();
          }
        }}
        title={t('admin.roles.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('admin.roles.deleteText')}
        confirmLabel={t('admin.common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        <FormError message={remove.isError ? errorText(t, remove.error) : null} />
      </ConfirmDialog>
    </AdminPage>
  );
}
