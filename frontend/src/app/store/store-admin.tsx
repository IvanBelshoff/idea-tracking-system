import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { lazy, Suspense, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useEntities } from '../admin/queries';
import { AdminPage, entityOptionLabel, orderTree, Pagination } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { ReasonDialog } from '../mural/mural-pages';
import { useMe, usePublicSettings } from '../session';
import { useDates } from '../use-dates';
import {
  type OrderStatus,
  type StoreItem,
  type StoreOrder,
  storeKeys,
  useAccounts,
  useBonuses,
  useLedgerOf,
  useOrderQueue,
  useStoreItems,
} from './queries';
import { ItemThumb, LedgerTable, OrderSummary } from './store-pages';

const PhotoCropDialog = lazy(() =>
  import('@/components/form/photo-crop-dialog').then((m) => ({ default: m.PhotoCropDialog })),
);

const STATUSES: OrderStatus[] = ['pending', 'approved', 'delivered', 'paid', 'rejected', 'cancelled'];
type Action = 'approve' | 'reject' | 'deliver' | 'pay' | 'cancel';

/** As ações de quem gerencia num pedido (RN-166, RN-167). O próprio pedido não tem ações. */
function OrderActions({ order, onDone }: { order: StoreOrder; onDone: () => void }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const dates = useDates();
  const [open, setOpen] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [paidOn, setPaidOn] = useState(dates.dayFromToday(0));
  const [reference, setReference] = useState('');
  const run = useMutation({
    meta: { success: (_d, v: { action: 'approve' | 'deliver' | 'pay' }) => t(`feedback.store.${v.action}`) },
    mutationFn: async (input: { action: Action; body?: Record<string, unknown> }) => {
      const params = { params: { path: { id: order.id } } };
      switch (input.action) {
        case 'approve':
          return unwrap(api.POST('/api/store/orders/{id}/approve', params));
        case 'deliver':
          return unwrap(api.POST('/api/store/orders/{id}/deliver', { ...params, body: { note: note.trim() || null } }));
        case 'pay':
          return unwrap(api.POST('/api/store/orders/{id}/pay', { ...params, body: { paidOn, reference } }));
        default:
          throw new Error('ação sem diálogo de motivo');
      }
    },
    onSuccess: () => {
      setOpen(null);
      onDone();
    },
  });
  if (me && order.person?.userId === me.id) return null;
  const isBonus = order.kind === 'bonus';
  const sendReason = (action: 'reject' | 'cancel') => (reason: string) =>
    unwrap(
      action === 'reject'
        ? api.POST('/api/store/orders/{id}/reject', { params: { path: { id: order.id } }, body: { reason } })
        : api.POST('/api/store/orders/{id}/cancel', { params: { path: { id: order.id } }, body: { reason } }),
    ).then(onDone);
  return (
    <div className="flex flex-wrap gap-2">
      {order.status === 'pending' && (
        <>
          <Button size="sm" disabled={run.isPending} onClick={() => run.mutate({ action: 'approve' })}>
            {t('store.manage.approve')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen('reject')}>
            {t('store.manage.reject')}
          </Button>
        </>
      )}
      {order.status === 'approved' && !isBonus && (
        <Button size="sm" onClick={() => setOpen('deliver')}>
          {t('store.manage.deliver')}
        </Button>
      )}
      {order.status === 'approved' && isBonus && (
        <Button size="sm" onClick={() => setOpen('pay')}>
          {t('store.manage.pay')}
        </Button>
      )}
      {(order.status === 'pending' || order.status === 'approved') && (
        <Button size="sm" variant="ghost" onClick={() => setOpen('cancel')}>
          {t('store.manage.cancelOrder')}
        </Button>
      )}
      <FormError message={run.isError && open === null ? errorText(t, run.error) : null} />
      {(open === 'reject' || open === 'cancel') && (
        <ReasonDialog
          title={open === 'reject' ? t('store.manage.rejectTitle') : t('store.manage.cancelTitle')}
          label={t('store.manage.reasonLabel')}
          hint={t('store.manage.reasonHint')}
          confirm={open === 'reject' ? t('store.manage.reject') : t('store.manage.cancelOrder')}
          success={open === 'reject' ? t('feedback.store.reject') : t('feedback.store.cancel')}
          onClose={() => setOpen(null)}
          onSend={sendReason(open)}
        />
      )}
      {(open === 'deliver' || open === 'pay') && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent closeLabel={t('admin.common.close')}>
            <DialogHeader>
              <DialogTitle>
                {open === 'deliver' ? t('store.manage.deliverTitle') : t('store.manage.payTitle')}
              </DialogTitle>
              {open === 'pay' && <DialogDescription>{t('store.manage.payHint')}</DialogDescription>}
            </DialogHeader>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                run.mutate({ action: open });
              }}
              className="space-y-4"
            >
              {open === 'deliver' ? (
                <Field label={t('store.manage.deliverNote')}>
                  <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              ) : (
                <>
                  <Field label={t('store.manage.paidOn')}>
                    <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                  </Field>
                  <Field label={t('store.manage.reference')}>
                    <Input maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
                  </Field>
                </>
              )}
              <FormError message={run.isError ? errorText(t, run.error) : null} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(null)}>
                  {t('mural.cancel')}
                </Button>
                <Button type="submit" disabled={run.isPending || (open === 'pay' && (!paidOn || !reference.trim()))}>
                  {open === 'deliver' ? t('store.manage.deliver') : t('store.manage.pay')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function OrdersTab({ currency }: { currency: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<OrderStatus | ''>('pending');
  const [page, setPage] = useState(1);
  const queue = useOrderQueue(status, page);
  const d = queue.data;
  return (
    <div className="grid gap-4">
      <Field label={t('store.manage.filterStatus')} className="max-w-xs">
        <NativeSelect
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as OrderStatus | '');
            setPage(1);
          }}
        >
          <option value="">{t('store.manage.allStatus')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`store.status.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <FormError message={queue.isError ? errorText(t, queue.error) : null} />
      {d && d.items.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t('store.manage.noOrders')}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {d?.items.map((o) => (
            <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <OrderSummary order={o} currency={currency} />
              <OrderActions order={o} onDone={() => void qc.invalidateQueries({ queryKey: storeKeys.all })} />
            </li>
          ))}
        </ul>
      )}
      {d && d.meta.total > d.meta.pageSize && (
        <Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={setPage} />
      )}
    </div>
  );
}

interface ItemForm {
  name: string;
  description: string;
  kind: 'product' | 'bonus';
  cost: string;
  bonusValue: string;
  active: boolean;
  stock: string;
  limitQty: string;
  limitPeriod: '' | 'month' | 'quarter' | 'semester' | 'year';
  entityIds: string[];
}

const toForm = (i: StoreItem | null): ItemForm => ({
  name: i?.name ?? '',
  description: i?.description ?? '',
  kind: (i?.kind as 'product' | 'bonus') ?? 'product',
  cost: i ? String(i.cost) : '',
  bonusValue: i?.bonusValue === null || i?.bonusValue === undefined ? '' : String(i.bonusValue),
  active: i?.active ?? true,
  stock: i?.stock === null || i?.stock === undefined ? '' : String(i.stock),
  limitQty: i?.limitQty === null || i?.limitQty === undefined ? '' : String(i.limitQty),
  limitPeriod: (i?.limitPeriod as ItemForm['limitPeriod']) ?? '',
  entityIds: i?.entities.map((e) => e.id) ?? [],
});

/** Cadastro do item (RN-163), com a foto pelo recorte quadrado (RN-143) depois de criado. */
function ItemDialog({ item, currency, onClose }: { item: StoreItem | null; currency: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const entities = useEntities();
  const [current, setCurrent] = useState<StoreItem | null>(item);
  const [form, setForm] = useState<ItemForm>(toForm(item));
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const groupId = useId();
  const set = (patch: Partial<ItemForm>) => setForm((f) => ({ ...f, ...patch }));
  const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
  const save = useMutation({
    meta: { success: current ? t('feedback.store.itemUpdated') : t('feedback.store.itemCreated') },
    mutationFn: () => {
      const body = {
        name: form.name,
        description: form.description.trim() || null,
        kind: form.kind,
        cost: Number(form.cost),
        bonusValue: form.kind === 'bonus' ? Number(form.bonusValue.replace(',', '.')) : null,
        active: form.active,
        stock: intOrNull(form.stock),
        limitQty: form.limitPeriod ? intOrNull(form.limitQty) : null,
        limitPeriod: form.limitPeriod || null,
        entityIds: form.entityIds,
      };
      return current
        ? unwrap(api.PATCH('/api/store/items/{id}', { params: { path: { id: current.id } }, body }))
        : unwrap(api.POST('/api/store/items', { body }));
    },
    onSuccess: (data) => {
      setCurrent(data);
      void qc.invalidateQueries({ queryKey: storeKeys.all });
      if (item) onClose();
    },
  });
  const photo = useMutation({
    meta: { success: t('feedback.store.photoSaved') },
    mutationFn: (blob: Blob) =>
      unwrap(
        api.PUT('/api/store/items/{id}/photo', {
          params: { path: { id: current?.id ?? '' } },
          body: { file: blob as unknown as string },
          bodySerializer: () => {
            const data = new FormData();
            data.append('file', blob, 'item.webp');
            return data;
          },
        }),
      ),
    onSuccess: (data) => {
      setFile(null);
      setCurrent((c) => (c ? { ...c, photoVersion: data.version } : c));
      void qc.invalidateQueries({ queryKey: storeKeys.all });
    },
  });
  const removePhoto = useMutation({
    meta: { success: t('feedback.store.photoRemoved') },
    mutationFn: () =>
      unwrap(api.DELETE('/api/store/items/{id}/photo', { params: { path: { id: current?.id ?? '' } } })),
    onSuccess: () => {
      setCurrent((c) => (c ? { ...c, photoVersion: null } : c));
      void qc.invalidateQueries({ queryKey: storeKeys.all });
    },
  });
  const errs = fieldErrors(save.error);
  const deactivating = !!current?.active && !form.active && current.openOrders > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{current ? t('store.manage.editItem') : t('store.manage.newItem')}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="grid gap-4"
        >
          <Field label={t('store.manage.fields.name')} error={errs.name}>
            <Input maxLength={120} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label={t('store.manage.fields.description')} error={errs.description}>
            <Textarea
              rows={3}
              maxLength={2000}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('store.manage.fields.kind')}</legend>
            {(['product', 'bonus'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={groupId}
                  checked={form.kind === k}
                  disabled={current !== null && current.totalOrders > 0 && current.kind !== k}
                  onChange={() => set({ kind: k })}
                />
                {t(`store.manage.fields.kinds.${k}`)}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('store.manage.fields.cost')} error={errs.cost}>
              <Input
                inputMode="numeric"
                value={form.cost}
                onChange={(e) => set({ cost: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            {form.kind === 'bonus' && (
              <Field
                label={t('store.manage.fields.bonusValue', { currency })}
                hint={t('store.manage.fields.bonusHint')}
                error={errs.bonusValue}
              >
                <Input
                  inputMode="decimal"
                  value={form.bonusValue}
                  onChange={(e) => set({ bonusValue: e.target.value })}
                />
              </Field>
            )}
            <Field label={t('store.manage.fields.stock')} hint={t('store.manage.fields.stockHint')} error={errs.stock}>
              <Input
                inputMode="numeric"
                value={form.stock}
                onChange={(e) => set({ stock: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label={t('store.manage.fields.limitPeriod')}>
              <NativeSelect
                value={form.limitPeriod}
                onChange={(e) => set({ limitPeriod: e.target.value as ItemForm['limitPeriod'] })}
              >
                <option value="">{t('store.manage.fields.noLimit')}</option>
                {(['month', 'quarter', 'semester', 'year'] as const).map((p) => (
                  <option key={p} value={p}>
                    {t(`store.periodNames.${p}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {form.limitPeriod && (
              <Field label={t('store.manage.fields.limitQty')} error={errs.limitQty}>
                <Input
                  inputMode="numeric"
                  value={form.limitQty}
                  onChange={(e) => set({ limitQty: e.target.value.replace(/\D/g, '') })}
                />
              </Field>
            )}
          </div>
          <fieldset className="grid gap-1">
            <legend className="text-sm font-medium">{t('store.manage.fields.entities')}</legend>
            <p className="text-xs text-muted-foreground">{t('store.manage.fields.entitiesHint')}</p>
            <div className="mt-1 grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2">
              {orderTree(entities.data ?? []).map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-sm whitespace-pre">
                  <Checkbox
                    id={`${groupId}-ent-${e.id}`}
                    checked={form.entityIds.includes(e.id)}
                    onCheckedChange={(v) =>
                      set({
                        entityIds: v === true ? [...form.entityIds, e.id] : form.entityIds.filter((x) => x !== e.id),
                      })
                    }
                  />
                  <label htmlFor={`${groupId}-ent-${e.id}`}>{entityOptionLabel(e)}</label>
                </div>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${groupId}-active`}
              checked={form.active}
              onCheckedChange={(v) => set({ active: v === true })}
            />
            <label htmlFor={`${groupId}-active`}>{t('store.manage.fields.active')}</label>
          </div>
          {deactivating && (
            <p className="rounded-md border border-(--st-late) bg-(--st-late)/10 p-3 text-sm">
              {t('store.manage.deactivateWarning', { count: current.openOrders })}
            </p>
          )}
          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('admin.common.close')}
            </Button>
            <Button type="submit" disabled={save.isPending || !form.name.trim() || !form.cost}>
              {t('store.manage.save')}
            </Button>
          </DialogFooter>
        </form>
        {current && (
          <section aria-labelledby="foto-item" className="mt-2 border-t pt-4">
            <h3 id="foto-item" className="text-sm font-medium">
              {t('store.manage.photo')}
            </h3>
            <div className="mt-2 flex items-center gap-3">
              <span className="w-24">
                <ItemThumb item={current} />
              </span>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                  e.target.value = '';
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
                <Camera aria-hidden="true" />
                {current.photoVersion ? t('store.manage.changePhoto') : t('store.manage.addPhoto')}
              </Button>
              {current.photoVersion && (
                <Button type="button" variant="ghost" size="sm" onClick={() => removePhoto.mutate()}>
                  <Trash2 aria-hidden="true" />
                  {t('store.manage.removePhoto')}
                </Button>
              )}
            </div>
          </section>
        )}
        {file && (
          <Suspense fallback={null}>
            <PhotoCropDialog
              file={file}
              saving={photo.isPending}
              error={photo.isError ? errorText(t, photo.error) : null}
              onCancel={() => setFile(null)}
              onConfirm={(blob) => photo.mutate(blob)}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemsTab({ currency }: { currency: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const items = useStoreItems();
  const [editing, setEditing] = useState<StoreItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<StoreItem | null>(null);
  const remove = useMutation({
    meta: { success: t('feedback.store.itemRemoved') },
    mutationFn: (id: string) => unwrap(api.DELETE('/api/store/items/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: storeKeys.all });
    },
  });
  return (
    <div className="grid gap-4">
      <div>
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" />
          {t('store.manage.newItem')}
        </Button>
      </div>
      <FormError message={items.isError ? errorText(t, items.error) : null} />
      {items.data && items.data.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t('store.manage.noItems')}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.data?.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <ItemThumb item={i} size="sm" />
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {i.name}
                    {i.kind === 'bonus' && <Badge variant="secondary">{t('store.bonusBadge')}</Badge>}
                    {!i.active && <Badge variant="outline">{t('store.manage.inactive')}</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('store.points', { count: i.cost })} ·{' '}
                    {i.stock === null ? t('store.unlimited') : t('store.stockLeft', { count: i.stock })}
                    {i.openOrders > 0 && ` · ${t('store.manage.openOrders', { count: i.openOrders })}`}
                    {i.totalOrders > 0 && ` · ${t('store.redemptions', { count: i.totalOrders })}`}
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                  <Pencil aria-hidden="true" />
                  {t('admin.common.edit')}
                </Button>
                {i.totalOrders === 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(i)}>
                    <Trash2 aria-hidden="true" />
                    {t('store.manage.delete')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ItemDialog item={editing === 'new' ? null : editing} currency={currency} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('store.manage.deleteTitle')}
        description={t('store.manage.deleteText')}
        confirmLabel={t('store.manage.delete')}
        cancelLabel={t('mural.cancel')}
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      >
        <FormError message={remove.isError ? errorText(t, remove.error) : null} />
      </ConfirmDialog>
    </div>
  );
}

function BonusesTab({ currency }: { currency: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'approved' | 'paid' | 'all'>('approved');
  const bonuses = useBonuses(status);
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('store.manage.bonusesIntro')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('store.manage.filterStatus')} className="w-48">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {(['approved', 'paid', 'all'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`store.manage.bonusFilter.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button variant="outline" asChild>
          <a href={`/api/store/bonuses/export?status=${status}`} download>
            <Download aria-hidden="true" />
            {t('store.manage.exportCsv')}
          </a>
        </Button>
      </div>
      <FormError message={bonuses.isError ? errorText(t, bonuses.error) : null} />
      {bonuses.data && bonuses.data.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t('store.manage.noBonuses')}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {bonuses.data?.map((o) => (
            <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <OrderSummary order={o} currency={currency} />
              <OrderActions order={o} onDone={() => void qc.invalidateQueries({ queryKey: storeKeys.all })} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const accounts = useAccounts(search.trim(), page);
  const [adjusting, setAdjusting] = useState<{ userId: string; name: string } | null>(null);
  const [viewing, setViewing] = useState<{ userId: string; name: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [ledgerPage, setLedgerPage] = useState(1);
  const ledger = useLedgerOf(viewing?.userId ?? null, ledgerPage);
  const adjust = useMutation({
    meta: { success: t('store.manage.adjusted') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/store/adjustments', {
          body: { userId: adjusting?.userId ?? '', amount: Number(amount), reason: reason.trim() },
        }),
      ),
    onSuccess: () => {
      setAdjusting(null);
      setAmount('');
      setReason('');
      void qc.invalidateQueries({ queryKey: storeKeys.all });
    },
  });
  const d = accounts.data;
  const amountValid = /^-?\d+$/.test(amount.trim()) && Number(amount) !== 0;
  return (
    <div className="grid gap-4">
      <Field label={t('store.manage.searchPerson')} className="max-w-sm">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      <FormError message={accounts.isError ? errorText(t, accounts.error) : null} />
      {d && d.items.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t('store.manage.noAccounts')}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {d?.items.map((a) => (
            <li key={a.userId} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <span className="font-medium">{a.name}</span>
              <span className="flex flex-wrap items-center gap-3">
                <span className={`tabular-nums ${a.balance < 0 ? 'text-(--st-rejected)' : ''}`}>
                  {t('store.points', { count: a.balance })}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setViewing({ userId: a.userId, name: a.name })}>
                  {t('store.manage.viewLedger')}
                </Button>
                {a.userId !== me?.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      adjust.reset();
                      setAdjusting({ userId: a.userId, name: a.name });
                    }}
                  >
                    {t('store.manage.adjust')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {d && d.meta.total > d.meta.pageSize && (
        <Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={setPage} />
      )}
      {adjusting && (
        <Dialog open onOpenChange={(o) => !o && setAdjusting(null)}>
          <DialogContent closeLabel={t('admin.common.close')}>
            <DialogHeader>
              <DialogTitle>{t('store.manage.adjustTitle', { name: adjusting.name })}</DialogTitle>
              <DialogDescription>{t('store.manage.adjustHint')}</DialogDescription>
            </DialogHeader>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (amountValid && reason.trim()) adjust.mutate();
              }}
              className="space-y-4"
            >
              <Field label={t('store.manage.amount')}>
                <Input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ''))}
                />
              </Field>
              <Field label={t('store.manage.adjustReason')}>
                <Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <FormError message={adjust.isError ? errorText(t, adjust.error) : null} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAdjusting(null)}>
                  {t('mural.cancel')}
                </Button>
                <Button type="submit" disabled={adjust.isPending || !amountValid || !reason.trim()}>
                  {t('store.manage.adjust')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {viewing && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setViewing(null);
              setLedgerPage(1);
            }
          }}
        >
          <DialogContent closeLabel={t('admin.common.close')} className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{t('store.manage.ledgerOf', { name: viewing.name })}</DialogTitle>
            </DialogHeader>
            <FormError message={ledger.isError ? errorText(t, ledger.error) : null} />
            {ledger.data && <LedgerTable lines={ledger.data.items} />}
            {ledger.data && ledger.data.meta.total > ledger.data.meta.pageSize && (
              <Pagination
                page={ledger.data.meta.page}
                pageSize={ledger.data.meta.pageSize}
                total={ledger.data.meta.total}
                onPage={setLedgerPage}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Gerenciar loja (RN-166 a RN-168): pedidos, itens, bonificações e saldos. */
export function StoreAdminPage() {
  const { t } = useTranslation();
  const { data: settings } = usePublicSettings();
  const currency = settings?.currency ?? 'BRL';
  return (
    <AdminPage title={t('store.manage.title')} intro={t('store.manage.intro')} help="storeManage">
      <Tabs defaultValue="pedidos">
        <TabsList>
          <TabsTrigger value="pedidos">{t('store.manage.tabs.orders')}</TabsTrigger>
          <TabsTrigger value="itens">{t('store.manage.tabs.items')}</TabsTrigger>
          <TabsTrigger value="bonificacoes">{t('store.manage.tabs.bonuses')}</TabsTrigger>
          <TabsTrigger value="saldos">{t('store.manage.tabs.accounts')}</TabsTrigger>
        </TabsList>
        <TabsContent value="pedidos" className="mt-4">
          <OrdersTab currency={currency} />
        </TabsContent>
        <TabsContent value="itens" className="mt-4">
          <ItemsTab currency={currency} />
        </TabsContent>
        <TabsContent value="bonificacoes" className="mt-4">
          <BonusesTab currency={currency} />
        </TabsContent>
        <TabsContent value="saldos" className="mt-4">
          <AccountsTab />
        </TabsContent>
      </Tabs>
    </AdminPage>
  );
}
