import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '@/api/client';
import { ApiError, errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { LANGUAGES } from '@/i18n';
import { FormError } from '../auth/auth-layout';
import { PhotoSection } from '../pages/photo-section';
import { NotFoundPage } from '../pages/status-pages';
import { keys, useMe } from '../session';
import { UserFieldsSection } from '../user-fields/sections';
import { PasswordLinkDialog } from './password-link-dialog';
import { adminKeys, useEntities, useRoles } from './queries';
import { AdminPage, entityOptionLabel, orderTree, Section } from './shared';
import { UserAccessSection } from './user-access-section';
import { UserStatusBadge } from './users-page';

type UserDetail = components['schemas']['UserDetail'];
interface ScopeRow {
  key: string;
  roleId: string;
  entityId: string;
  includeChildren: boolean;
}

function ProfileForm({ user }: { user: UserDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const schema = z.object({
    name: z.string().trim().min(1, t('validation.required')).max(200),
    email: z
      .string()
      .trim()
      .pipe(z.email(t('validation.email'))),
    locale: z.enum(LANGUAGES),
  });
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: { name: user.name, email: user.email, locale: user.locale === 'en' ? 'en' : 'pt-BR' },
  });
  const save = useMutation({
    meta: { success: t('feedback.users.saved') },
    mutationFn: (body: FormValues) => unwrap(api.PATCH('/api/users/{id}', { params: { path: { id: user.id } }, body })),
    onSuccess: (u) => {
      qc.setQueryData(adminKeys.user(user.id), u);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
  const locked = user.status === 'anonymized';
  const { errors } = form.formState;
  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2">
      <Field label={t('admin.users.name')} error={errors.name?.message}>
        <Input disabled={locked} {...form.register('name')} />
      </Field>
      <Field label={t('admin.users.email')} error={errors.email?.message}>
        <Input type="email" disabled={locked} {...form.register('email')} />
      </Field>
      <Field label={t('admin.users.language')}>
        <NativeSelect disabled={locked} {...form.register('locale')}>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {t(`common.languages.${l}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="flex flex-col justify-end gap-2 sm:col-span-2">
        <FormError message={save.isError ? errorText(t, save.error) : null} />
        <div>
          <Button type="submit" disabled={locked || save.isPending}>
            {t('admin.users.saveProfile')}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ScopesEditor({ user }: { user: UserDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roles = useRoles();
  const entities = useEntities();
  const [rows, setRows] = useState<ScopeRow[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setRows(
      user.scopes.map((s) => ({
        key: s.id,
        roleId: s.role.id,
        entityId: s.entity.id,
        includeChildren: s.includeChildren,
      })),
    );
    setDirty(false);
  }, [user]);

  const save = useMutation({
    meta: { success: t('feedback.users.scopesSaved') },
    mutationFn: () =>
      unwrap(
        api.PUT('/api/users/{id}/scopes', {
          params: { path: { id: user.id } },
          body: {
            scopes: rows.map(({ roleId, entityId, includeChildren }) => ({ roleId, entityId, includeChildren })),
          },
        }),
      ),
    onSuccess: (u) => {
      qc.setQueryData(adminKeys.user(user.id), u);
      void qc.invalidateQueries({ queryKey: adminKeys.roles });
      void qc.invalidateQueries({ queryKey: keys.me }); // se a pessoa editou os próprios perfis
    },
  });

  const update = (key: string, patch: Partial<ScopeRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const ordered = orderTree(entities.data ?? []);
  const firstRole = roles.data?.find((r) => r.systemKey === 'collaborator') ?? roles.data?.[0];
  const firstEntity = ordered[0];
  const locked = user.status === 'anonymized';

  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('admin.users.noScopes')}</p>}
      {rows.map((r) => (
        <fieldset key={r.key} className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
          <legend className="sr-only">{t('admin.users.role')}</legend>
          <Field label={t('admin.users.role')}>
            <NativeSelect
              value={r.roleId}
              disabled={locked}
              onChange={(e) => update(r.key, { roleId: e.target.value })}
            >
              {roles.data?.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('admin.users.entity')}>
            <NativeSelect
              value={r.entityId}
              disabled={locked}
              onChange={(e) => update(r.key, { entityId: e.target.value })}
            >
              {ordered.map((e) => (
                <option key={e.id} value={e.id}>
                  {entityOptionLabel(e)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex h-8 items-center gap-2 text-sm">
            <Checkbox
              id={`inc-${r.key}`}
              checked={r.includeChildren}
              disabled={locked}
              onCheckedChange={(v) => update(r.key, { includeChildren: v === true })}
            />
            <label htmlFor={`inc-${r.key}`}>{t('admin.users.includeChildren')}</label>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={locked}
            aria-label={t('admin.users.removeScope')}
            onClick={() => {
              setRows((rs) => rs.filter((x) => x.key !== r.key));
              setDirty(true);
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </fieldset>
      ))}
      <FormError message={save.isError ? errorText(t, save.error) : null} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={locked || !firstRole || !firstEntity}
          onClick={() => {
            if (!firstRole || !firstEntity) return;
            setRows((rs) => [
              ...rs,
              { key: crypto.randomUUID(), roleId: firstRole.id, entityId: firstEntity.id, includeChildren: true },
            ]);
            setDirty(true);
          }}
        >
          <Plus aria-hidden="true" />
          {t('admin.users.addScope')}
        </Button>
        <Button
          type="button"
          disabled={locked || !dirty || save.isPending}
          onClick={() => {
            save.reset();
            save.mutate(undefined, { onSuccess: () => setDirty(false) });
          }}
        >
          {t('admin.users.saveScopes')}
        </Button>
      </div>
    </div>
  );
}

function AccountActions({ user }: { user: UserDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [confirm, setConfirm] = useState<'disable' | 'anonymize' | null>(null);
  const [link, setLink] = useState<{ token: string; expiresAt: string } | null>(null);
  const path = { params: { path: { id: user.id } } };

  const done = (u: UserDetail) => {
    qc.setQueryData(adminKeys.user(user.id), u);
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    setConfirm(null);
  };
  const disable = useMutation({
    meta: { success: t('feedback.users.disabled') },
    mutationFn: () => unwrap(api.POST('/api/users/{id}/disable', path)),
    onSuccess: done,
  });
  const enable = useMutation({
    meta: { success: t('feedback.users.enabled') },
    mutationFn: () => unwrap(api.POST('/api/users/{id}/enable', path)),
    onSuccess: done,
  });
  const anonymize = useMutation({
    meta: { success: t('feedback.users.anonymized') },
    mutationFn: () => unwrap(api.POST('/api/users/{id}/anonymize', path)),
    onSuccess: done,
  });
  const newLink = useMutation({
    meta: { success: t('feedback.users.linkCreated') },
    mutationFn: () => unwrap(api.POST('/api/users/{id}/password-link', path)),
    onSuccess: setLink,
  });
  const error = [disable, enable, anonymize, newLink].find((m) => m.isError)?.error;
  const isSelf = me?.id === user.id;

  return (
    <div className="space-y-4">
      {user.status === 'active' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-[55ch] text-sm text-muted-foreground">
              {user.canUsePassword ? t('admin.users.newLinkHint') : t('admin.users.access.noLink')}
            </p>
            {user.canUsePassword && (
              <Button variant="outline" disabled={newLink.isPending} onClick={() => newLink.mutate()}>
                <KeyRound aria-hidden="true" />
                {t('admin.users.newLink')}
              </Button>
            )}
          </div>
          {!isSelf && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="max-w-[55ch] text-sm text-muted-foreground">{t('admin.users.disableHint')}</p>
              <Button variant="destructive" onClick={() => setConfirm('disable')}>
                {t('admin.users.disable')}
              </Button>
            </div>
          )}
        </>
      )}
      {user.status === 'disabled' && (
        <>
          <div className="flex justify-end">
            <Button variant="outline" disabled={enable.isPending} onClick={() => enable.mutate()}>
              {t('admin.users.enable')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="max-w-[55ch] text-sm text-muted-foreground">{t('admin.users.anonymizeHint')}</p>
            <Button variant="destructive" onClick={() => setConfirm('anonymize')}>
              {t('admin.users.anonymize')}
            </Button>
          </div>
        </>
      )}
      <FormError message={error ? errorText(t, error) : null} />

      <ConfirmDialog
        open={confirm === 'disable'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('admin.users.disableTitle', { name: user.name })}
        description={user.identities.length > 0 ? t('admin.users.disableSsoText') : t('admin.users.disableText')}
        confirmLabel={t('admin.users.disable')}
        cancelLabel={t('common.cancel')}
        destructive
        pending={disable.isPending}
        onConfirm={() => disable.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'anonymize'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('admin.users.anonymizeTitle', { name: user.name })}
        description={t('admin.users.anonymizeText')}
        confirmLabel={t('admin.users.anonymize')}
        cancelLabel={t('common.cancel')}
        destructive
        pending={anonymize.isPending}
        onConfirm={() => anonymize.mutate()}
      />
      <PasswordLinkDialog link={link} onClose={() => setLink(null)} />
    </div>
  );
}

export function UserDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams({ from: '/instalacao/sessao/admin/usuarios/$id' });
  const qc = useQueryClient();
  const { data: me } = useMe();
  const user = useQuery({
    queryKey: adminKeys.user(id),
    queryFn: () => unwrap(api.GET('/api/users/{id}', { params: { path: { id } } })),
  });

  if (user.error instanceof ApiError && user.error.status === 404) return <NotFoundPage />;
  if (!user.data) return user.isError ? <FormError message={errorText(t, user.error)} /> : null;
  const u = user.data;

  return (
    <AdminPage title={u.name} intro={u.email}>
      <Link
        to="/admin/usuarios"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('admin.users.backToList')}
      </Link>
      <div className="mb-4">
        <UserStatusBadge status={u.status} />
      </div>
      <div className="grid gap-6">
        <Section title={t('admin.users.profileSection')}>
          <ProfileForm user={u} />
        </Section>
        {u.status !== 'anonymized' && (
          <Section title={t('account.photo.section')}>
            <PhotoSection
              person={u}
              onChanged={(photoVersion) => {
                qc.setQueryData(adminKeys.user(u.id), { ...u, photoVersion });
                void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
                if (me?.id === u.id) void qc.invalidateQueries({ queryKey: keys.me });
              }}
            />
          </Section>
        )}
        {u.status !== 'anonymized' && (
          <Section title={t('userFields.values.section')} intro={t('userFields.values.sectionIntro')}>
            <UserFieldsSection userId={u.id} />
          </Section>
        )}
        <Section title={t('admin.users.scopesSection')} intro={t('admin.users.scopesIntro')}>
          <ScopesEditor user={u} />
        </Section>
        {u.status !== 'anonymized' && (u.identities.length > 0 || !u.canUsePassword) && (
          <Section title={t('admin.users.access.title')} intro={t('admin.users.access.intro')}>
            <UserAccessSection user={u} />
          </Section>
        )}
        {u.status !== 'anonymized' && (
          <Section title={t('admin.users.actionsSection')}>
            <AccountActions user={u} />
          </Section>
        )}
      </div>
    </AdminPage>
  );
}
