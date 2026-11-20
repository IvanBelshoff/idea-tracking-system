import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Coins, Gift, Package } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { AdminPage, Pagination } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { useDates } from '../use-dates';
import {
  type CatalogItem,
  itemPhotoUrl,
  type LedgerLine,
  type OrderStatus,
  type StoreAccount,
  type StoreOrder,
  storeKeys,
  useCatalog,
  useMyLedger,
  useMyOrders,
} from './queries';

export function usePoints() {
  const { i18n } = useTranslation();
  const nf = new Intl.NumberFormat(i18n.language);
  return (n: number) => nf.format(n);
}

export function useMoney(currency: string) {
  const { i18n } = useTranslation();
  const nf = new Intl.NumberFormat(i18n.language, { style: 'currency', currency });
  return (n: number) => nf.format(n);
}

/** Situação do pedido com texto (nunca só cor). */
export function OrderStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone =
    status === 'delivered' || status === 'paid'
      ? 'border-(--st-done) text-(--st-done)'
      : status === 'rejected' || status === 'cancelled'
        ? 'border-(--st-rejected) text-(--st-rejected)'
        : status === 'approved'
          ? 'border-primary text-primary'
          : '';
  return (
    <Badge variant="outline" className={tone}>
      {t(`store.status.${status as OrderStatus}`)}
    </Badge>
  );
}

/** A foto do item ou um ícone (produto ou bonificação), sempre quadrada. */
export function ItemThumb({
  item,
  size = 'md',
}: {
  item: { id: string; photoVersion: string | null; kind: string };
  size?: 'sm' | 'md';
}) {
  const cls = size === 'sm' ? 'size-10' : 'aspect-square w-full';
  if (item.photoVersion) {
    return (
      <img
        src={itemPhotoUrl(item.id, item.photoVersion)}
        alt=""
        className={`${cls} rounded-md border bg-muted object-cover`}
        loading="lazy"
      />
    );
  }
  const Icon = item.kind === 'bonus' ? Gift : Package;
  return (
    <span
      aria-hidden="true"
      className={`${cls} grid place-items-center rounded-md border bg-muted text-muted-foreground`}
    >
      <Icon className={size === 'sm' ? 'size-5' : 'size-10'} />
    </span>
  );
}

/** O saldo (RN-160 a RN-162, RN-169): saldo, reservado, pontos ganhos e o que vai vencer. */
export function BalancePanel({ account }: { account: StoreAccount }) {
  const { t } = useTranslation();
  const dates = useDates();
  const pts = usePoints();
  return (
    <section aria-labelledby="saldo-titulo" className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border bg-card p-4">
        <h2 id="saldo-titulo" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Coins aria-hidden="true" className="size-4" />
          {t('store.balance')}
        </h2>
        <p className={`mt-1 text-3xl font-bold tabular-nums ${account.balance < 0 ? 'text-(--st-rejected)' : ''}`}>
          {pts(account.balance)}
        </p>
        <p className="text-xs text-muted-foreground">{t('store.balanceHint')}</p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm font-medium text-muted-foreground">{t('store.reserved')}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{pts(account.reserved)}</p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm font-medium text-muted-foreground">{t('store.earned')}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{pts(account.earnedPoints)}</p>
        <p className="text-xs text-muted-foreground">{t('store.earnedHint')}</p>
      </div>
      <div className="text-sm sm:col-span-3">
        {account.balance < 0 && <p className="font-medium text-(--st-rejected)">{t('store.negative')}</p>}
        {account.expiring ? (
          <p className="text-(--st-late)">
            {t('store.expiring', { amount: pts(account.expiring.amount), date: dates.day(account.expiring.on) })}
          </p>
        ) : (
          <p className="text-muted-foreground">
            {account.expiryMonths > 0 ? t('store.expiryMonths', { count: account.expiryMonths }) : t('store.noExpiry')}
          </p>
        )}
      </div>
    </section>
  );
}

function CatalogCard({
  item,
  balance,
  currency,
  onOrder,
}: {
  item: CatalogItem;
  balance: number;
  currency: string;
  onOrder: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoney(currency);
  const headingId = `item-${item.id}`;
  return (
    <article aria-labelledby={headingId} className="flex h-full flex-col rounded-lg border bg-card p-4">
      <ItemThumb item={item} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="font-semibold leading-snug">
          {item.name}
        </h3>
        {item.kind === 'bonus' && <Badge variant="secondary">{t('store.bonusBadge')}</Badge>}
      </div>
      {item.description && <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{item.description}</p>}
      {item.bonusValue !== null && (
        <p className="mt-1 text-sm">{t('store.bonusValue', { value: money(item.bonusValue) })}</p>
      )}
      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        <li>{item.stockLeft === null ? t('store.unlimited') : t('store.stockLeft', { count: item.stockLeft })}</li>
        {item.limit && (
          <li>
            {t('store.limit', {
              qty: item.limit.qty,
              period: t(`store.periods.${item.limit.period as 'month'}`),
              used: item.limit.used,
            })}
          </li>
        )}
        <li>{t('store.redemptions', { count: item.redemptions })}</li>
      </ul>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <span className="text-lg font-bold tabular-nums">{t('store.points', { count: item.cost })}</span>
        <Button size="sm" disabled={!item.canOrder} onClick={onOrder}>
          {t('store.order')}
        </Button>
      </div>
      {item.blockedReason && (
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          {t(`store.blocked.${item.blockedReason as 'out_of_stock'}`)}
          {item.blockedReason === 'insufficient_balance' &&
            balance >= 0 &&
            ` · ${t('store.missing', { count: item.cost - balance })}`}
        </p>
      )}
    </article>
  );
}

function CatalogTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const catalog = useCatalog();
  const [ordering, setOrdering] = useState<CatalogItem | null>(null);
  const [note, setNote] = useState('');
  const place = useMutation({
    meta: { success: t('store.ordered') },
    mutationFn: (item: CatalogItem) =>
      unwrap(api.POST('/api/store/orders', { body: { itemId: item.id, note: note.trim() || null } })),
    onSuccess: () => {
      setOrdering(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: storeKeys.all });
    },
  });
  const d = catalog.data;
  return (
    <div className="grid gap-6">
      <FormError message={catalog.isError ? errorText(t, catalog.error) : null} />
      {d && <BalancePanel account={d.account} />}
      {d && d.items.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t('store.empty')}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {d?.items.map((item) => (
            <li key={item.id}>
              <CatalogCard
                item={item}
                balance={d.account.balance}
                currency={d.currency}
                onOrder={() => {
                  place.reset();
                  setOrdering(item);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={ordering !== null}
        onOpenChange={(o) => !o && setOrdering(null)}
        title={t('store.orderTitle', { name: ordering?.name ?? '' })}
        description={t('store.orderText', { cost: ordering?.cost ?? 0 })}
        confirmLabel={t('store.orderConfirm')}
        cancelLabel={t('store.keep')}
        pending={place.isPending}
        onConfirm={() => ordering && place.mutate(ordering)}
      >
        <Field label={t('store.orderNote')}>
          <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError message={place.isError ? errorText(t, place.error) : null} />
      </ConfirmDialog>
    </div>
  );
}

/** Uma linha de pedido, para a própria pessoa ou para quem gerencia. */
export function OrderSummary({ order, currency }: { order: StoreOrder; currency: string }) {
  const { t } = useTranslation();
  const dates = useDates();
  const money = useMoney(currency);
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <ItemThumb item={{ id: order.item.id, photoVersion: order.item.photoVersion, kind: order.kind }} size="sm" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{order.item.name}</span>
          <OrderStatusBadge status={order.status} />
        </p>
        <p className="text-xs text-muted-foreground">
          {order.person && `${order.person.name} · `}
          {t('store.orderedOn', { date: dates.dateTime(order.createdAt) })} · {t('store.points', { count: order.cost })}
          {order.bonusValue !== null && ` · ${money(order.bonusValue)}`}
        </p>
        {order.note && <p className="mt-1 text-xs whitespace-pre-wrap">“{order.note}”</p>}
        {order.reason && <p className="mt-1 text-xs">{t('store.reason', { reason: order.reason })}</p>}
        {order.deliveryNote && <p className="mt-1 text-xs">{t('store.deliveryNote', { note: order.deliveryNote })}</p>}
        {order.paidOn && (
          <p className="mt-1 text-xs">
            {t('store.paidOn', { date: dates.day(order.paidOn), reference: order.paidReference ?? '' })}
          </p>
        )}
      </div>
    </div>
  );
}

function MyOrdersTab({ currency }: { currency: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const orders = useMyOrders(page);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const cancel = useMutation({
    meta: { success: t('feedback.store.myCancelled') },
    mutationFn: (id: string) => unwrap(api.POST('/api/store/me/orders/{id}/cancel', { params: { path: { id } } })),
    onSuccess: () => {
      setCancelling(null);
      void qc.invalidateQueries({ queryKey: storeKeys.all });
    },
  });
  const d = orders.data;
  return (
    <div>
      <FormError message={orders.isError ? errorText(t, orders.error) : null} />
      {d && d.items.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t('store.noOrders')}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {d?.items.map((o) => (
            <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <OrderSummary order={o} currency={currency} />
              {o.status === 'pending' && (
                <Button size="sm" variant="outline" onClick={() => setCancelling(o.id)}>
                  {t('store.cancel')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {d && d.meta.total > d.meta.pageSize && (
        <Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={setPage} />
      )}
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={t('store.cancelTitle')}
        description={t('store.cancelText')}
        confirmLabel={t('store.cancel')}
        cancelLabel={t('store.keep')}
        destructive
        pending={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling)}
      >
        <FormError message={cancel.isError ? errorText(t, cancel.error) : null} />
      </ConfirmDialog>
    </div>
  );
}

/** O extrato (RN-160): cada linha com o tipo, o detalhe e o valor com sinal. */
export function LedgerTable({ lines }: { lines: LedgerLine[] }) {
  const { t } = useTranslation();
  const dates = useDates();
  const pts = usePoints();
  if (lines.length === 0) {
    return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t('store.noLedger')}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('store.ledgerColumns.date')}</TableHead>
            <TableHead>{t('store.ledgerColumns.kind')}</TableHead>
            <TableHead>{t('store.ledgerColumns.detail')}</TableHead>
            <TableHead className="text-right">{t('store.ledgerColumns.amount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="whitespace-nowrap">{dates.dateTime(l.createdAt)}</TableCell>
              <TableCell>{t(`store.ledgerKinds.${l.kind as 'earned'}`)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {[
                  l.idea ? `${l.idea.code} · ${l.idea.title}` : null,
                  l.reason,
                  l.actor ? t('store.by', { name: l.actor }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </TableCell>
              <TableCell
                className={`text-right font-medium tabular-nums ${l.amount < 0 ? 'text-(--st-rejected)' : 'text-(--st-done)'}`}
              >
                {l.amount > 0 ? '+' : '−'}
                {pts(Math.abs(l.amount))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MyLedgerTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const ledger = useMyLedger(page);
  const d = ledger.data;
  return (
    <div>
      <FormError message={ledger.isError ? errorText(t, ledger.error) : null} />
      {d && <LedgerTable lines={d.items} />}
      {d && d.meta.total > d.meta.pageSize && (
        <Pagination page={d.meta.page} pageSize={d.meta.pageSize} total={d.meta.total} onPage={setPage} />
      )}
    </div>
  );
}

/** A loja de quem troca (RN-164, RN-165): vitrine com o saldo, Meus pedidos e Meu extrato. */
export function StorePage() {
  const { t } = useTranslation();
  const catalog = useCatalog();
  return (
    <AdminPage title={t('store.title')} intro={t('store.intro')} help="store">
      <Tabs defaultValue="vitrine">
        <TabsList>
          <TabsTrigger value="vitrine">{t('store.tabs.catalog')}</TabsTrigger>
          <TabsTrigger value="pedidos">{t('store.tabs.orders')}</TabsTrigger>
          <TabsTrigger value="extrato">{t('store.tabs.ledger')}</TabsTrigger>
        </TabsList>
        <TabsContent value="vitrine" className="mt-4">
          <CatalogTab />
        </TabsContent>
        <TabsContent value="pedidos" className="mt-4">
          <MyOrdersTab currency={catalog.data?.currency ?? 'BRL'} />
        </TabsContent>
        <TabsContent value="extrato" className="mt-4">
          <MyLedgerTab />
        </TabsContent>
      </Tabs>
    </AdminPage>
  );
}
