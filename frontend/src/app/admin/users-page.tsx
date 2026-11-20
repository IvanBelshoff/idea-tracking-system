import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, UserRoundX } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LANGUAGES } from '@/i18n';
import { fieldLabel } from '@/lib/user-fields';
import { FormError } from '../auth/auth-layout';
import { usePublicSettings } from '../session';
import { useDates } from '../use-dates';
import { useUserFields } from '../user-fields/queries';
import { PasswordLinkDialog } from './password-link-dialog';
import { adminKeys } from './queries';
import { AdminPage, Pagination } from './shared';

type UserStatus = components['schemas']['UserSummary']['status'];
const STATUSES: UserStatus[] = ['active', 'disabled', 'anonymized'];
const PAGE_SIZE = 20;

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const { t } = useTranslation();
  const variant = status === 'active' ? 'secondary' : status === 'disabled' ? 'destructive' : 'outline';
  return <Badge variant={variant}>{t(`admin.users.status.${status}`)}</Badge>;
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [link, setLink] = useState<{ token: string; expiresAt: string; userId: string } | null>(null);
  const { data: settings } = usePublicSettings();

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
    defaultValues: { name: '', email: '', locale: settings?.defaultLocale === 'en' ? 'en' : 'pt-BR' },
  });
  const create = useMutation({
    meta: { success: t('feedback.users.created') },
    mutationFn: (body: FormValues) => unwrap(api.POST('/api/users', { body })),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      onOpenChange(false);
      form.reset();
      // No modo "Só SSO" a pessoa entra pela conta corporativa e não há link de senha.
      if (res.passwordLink) setLink({ ...res.passwordLink, userId: res.user.id });
    },
  });
  const { errors } = form.formState;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent closeLabel={t('admin.common.close')}>
          <DialogHeader>
            <DialogTitle>{t('admin.users.createTitle')}</DialogTitle>
            <DialogDescription>{t('admin.users.createIntro')}</DialogDescription>
          </DialogHeader>
          <form noValidate onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-4">
            <Field label={t('admin.users.name')} error={errors.name?.message}>
              <Input autoComplete="off" {...form.register('name')} />
            </Field>
            <Field label={t('admin.users.email')} error={errors.email?.message}>
              <Input type="email" autoComplete="off" {...form.register('email')} />
            </Field>
            <Field label={t('admin.users.language')}>
              <NativeSelect {...form.register('locale')}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`common.languages.${l}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <FormError message={create.isError ? errorText(t, create.error) : null} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {t('admin.users.createSubmit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <PasswordLinkDialog
        link={link}
        onClose={() => {
          const id = link?.userId;
          setLink(null);
          if (id) void navigate({ to: '/admin/usuarios/$id', params: { id } });
        }}
      />
    </>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const dates = useDates();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const { i18n } = useTranslation();
  const fields = useUserFields().data ?? [];
  const closed = fields.filter((f) => f.active && f.kind === 'choice');
  const anyRequired = fields.some((f) => f.active && f.required);
  const options = Object.values(chosen).filter(Boolean);
  const query = {
    search: search.trim() || undefined,
    status: status || undefined,
    incomplete: incomplete ? ('true' as const) : undefined,
    options: options.length > 0 ? options : undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const users = useQuery({
    queryKey: adminKeys.users(query),
    queryFn: () => unwrap(api.GET('/api/users', { params: { query } })),
    placeholderData: keepPreviousData,
  });

  return (
    <AdminPage
      title={t('admin.users.pageTitle')}
      intro={t('admin.users.intro')}
      help="adminUsers"
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          {t('admin.users.new')}
        </Button>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_repeat(auto-fit,minmax(10rem,12rem))]">
        <Field label={t('admin.users.searchLabel')}>
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label={t('admin.users.statusFilter')}>
          <NativeSelect
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as UserStatus | '');
              setPage(1);
            }}
          >
            <option value="">{t('admin.common.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.users.status.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {closed.map((f) => (
          <Field key={f.id} label={fieldLabel(f, i18n.language)}>
            <NativeSelect
              value={chosen[f.id] ?? ''}
              onChange={(e) => {
                setChosen((c) => ({ ...c, [f.id]: e.target.value }));
                setPage(1);
              }}
            >
              <option value="">{t('userFields.users.allOptions')}</option>
              {f.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.active ? o.label : t('userFields.values.inactiveOption', { label: o.label })}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ))}
      </div>
      {anyRequired && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <Checkbox
            id="so-incompletos"
            checked={incomplete}
            onCheckedChange={(v) => {
              setIncomplete(v === true);
              setPage(1);
            }}
          />
          <label htmlFor="so-incompletos">
            {t('userFields.users.onlyIncomplete', { count: users.data?.incompleteTotal ?? 0 })}
          </label>
        </div>
      )}

      {users.isError && <FormError message={errorText(t, users.error)} />}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.users.columns.name')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('admin.users.columns.email')}</TableHead>
              <TableHead>{t('admin.users.columns.status')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('admin.users.columns.lastLogin')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data?.items.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2.5">
                    <PersonAvatar person={u} size="sm" />
                    <div className="min-w-0">
                      <Link to="/admin/usuarios/$id" params={{ id: u.id }} className="hover:underline">
                        {u.name}
                      </Link>
                      <span className="block text-xs font-normal text-muted-foreground md:hidden">{u.email}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{u.email}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1">
                    <UserStatusBadge status={u.status} />
                    {u.incomplete && (
                      <Badge variant="outline" className="border-(--st-late)/50 text-(--st-late)">
                        <UserRoundX aria-hidden="true" />
                        {t('userFields.users.incomplete')}
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {u.lastLoginAt ? dates.dateTime(u.lastLoginAt) : t('admin.users.neverLoggedIn')}
                </TableCell>
              </TableRow>
            ))}
            {users.data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {t('admin.common.empty')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {users.data && <Pagination page={page} pageSize={PAGE_SIZE} total={users.data.meta.total} onPage={setPage} />}
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
    </AdminPage>
  );
}
