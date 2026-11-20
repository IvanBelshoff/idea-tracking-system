import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, In } from 'typeorm';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import { CSV_BOM, csvRow } from '../common/csv.js';
import { type PageQuery, pageMeta } from '../common/pagination.js';
import type { Access } from '../identity-access/access.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { emitWebhookEvent } from '../integration/webhooks/webhook-emit.js';
import { SettingsService } from '../organization/settings.service.js';
import { StoreItem, StoreOrder } from './entities.js';
import type { OrderPage, OrdersQuerySchema, PaySchema, StoreOrderView } from './store.dto.js';
import { StoreService } from './store.service.js';
import { appendLedger, balanceOf, lockBalance } from './store-core.js';
import { StoreItemsService } from './store-items.service.js';
import { bumpNewOrders, notifyPerson } from './store-notify.js';
import type { OrderStatus } from './store-rules.js';

const orderNotFound = () => apiError(404, 'not_found', 'Pedido não encontrado.');
const conflict = (message: string) => apiError(409, 'invalid_order_status', message);
const num = (v: string | null) => (v === null ? null : Number(v));

type ManagerAction = 'approve' | 'reject' | 'deliver' | 'pay' | 'cancel';

/**
 * Pedidos da loja (RN-165 a RN-167). O pedido reserva o saldo e baixa o estoque na mesma transação, com
 * trava por pessoa (saldo) e por item (estoque): dois pedidos simultâneos nunca gastam o mesmo saldo nem
 * a última unidade (CA-T.25). Recusar e cancelar estornam. Ninguém decide o próprio pedido.
 */
@Injectable()
export class StoreOrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly store: StoreService,
    private readonly items: StoreItemsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private personName(u: User | null | undefined): string | null {
    if (!u) return null;
    return u.status === UserStatus.Anonymized ? 'Ex-colaborador' : u.name;
  }

  private async views(m: EntityManager, orders: StoreOrder[], withPerson: boolean): Promise<StoreOrderView[]> {
    if (orders.length === 0) return [];
    const userIds = [...new Set(orders.flatMap((o) => [o.userId, o.decidedById].filter((x): x is string => !!x)))];
    const [users, items] = await Promise.all([
      m.getRepository(User).find({ where: { id: In(userIds) }, select: { id: true, name: true, status: true } }),
      m.getRepository(StoreItem).find({ where: { id: In([...new Set(orders.map((o) => o.itemId))]) } }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const itemById = new Map(items.map((i) => [i.id, i]));
    return orders.map((o) => {
      const item = itemById.get(o.itemId);
      return {
        id: o.id,
        item: { id: o.itemId, name: item?.name ?? '', photoVersion: item?.photoVersion ?? null },
        person: withPerson ? { userId: o.userId, name: this.personName(userById.get(o.userId)) ?? '' } : null,
        status: o.status,
        kind: o.itemKind,
        cost: o.cost,
        bonusValue: num(o.bonusValue),
        note: o.note,
        reason: o.reason,
        decidedBy: o.decidedById ? this.personName(userById.get(o.decidedById)) : null,
        createdAt: o.createdAt.toISOString(),
        approvedAt: o.approvedAt?.toISOString() ?? null,
        closedAt: o.closedAt?.toISOString() ?? null,
        deliveryNote: o.deliveryNote,
        paidOn: o.paidOn,
        paidReference: o.paidReference,
      };
    });
  }

  private async view(m: EntityManager, id: string, withPerson: boolean): Promise<StoreOrderView> {
    const order = await m.getRepository(StoreOrder).findOneByOrFail({ id });
    return (await this.views(m, [order], withPerson))[0] as StoreOrderView;
  }

  /**
   * Pedir (RN-165): uma unidade. Confere, sob as travas: item ativo e disponível à pessoa, saldo, estoque e
   * limite do período; reserva o custo (linha de reserva) e baixa o estoque.
   */
  async place(access: Access, itemId: string, note: string | null): Promise<StoreOrderView> {
    await this.store.assertEnabled();
    return this.dataSource.transaction(async (m) => {
      await lockBalance(m, access.userId);
      const item = await m
        .getRepository(StoreItem)
        .findOne({ where: { id: itemId }, lock: { mode: 'pessimistic_write' } });
      if (!item?.active || !(await this.items.itemAvailableTo(access, item.id, m))) {
        throw apiError(404, 'not_found', 'Item não encontrado.');
      }
      const a = await this.items.availability(m, access.userId, item, await balanceOf(m, access.userId));
      if (a.blocked === 'out_of_stock') throw apiError(422, 'out_of_stock', 'O item está sem estoque.');
      if (a.blocked === 'limit_reached')
        throw apiError(422, 'limit_reached', 'Você já chegou ao limite deste item no período.');
      if (a.blocked === 'insufficient_balance')
        throw apiError(422, 'insufficient_balance', 'Seu saldo não cobre este item.');
      const repo = m.getRepository(StoreOrder);
      const order = await repo.save(
        repo.create({
          itemId: item.id,
          userId: access.userId,
          status: 'pending',
          cost: item.cost,
          itemKind: item.kind,
          bonusValue: item.kind === 'bonus' ? item.bonusValue : null,
          note: note || null,
        }),
      );
      await appendLedger(m, [{ userId: access.userId, kind: 'reserve', amount: -item.cost, orderId: order.id }]);
      if (item.stock !== null) await m.getRepository(StoreItem).update(item.id, { stock: item.stock - 1 });
      // Quem gerencia recebe um aviso agrupado por dia (RN-171).
      await bumpNewOrders(m, access.userId);
      return this.view(m, order.id, false);
    });
  }

  /** Estorno (recusa e cancelamento): devolve o custo ao saldo e a unidade ao estoque. */
  private async refund(
    m: EntityManager,
    order: StoreOrder,
    actorId: string | null,
    reason: string | null,
  ): Promise<void> {
    await lockBalance(m, order.userId);
    await appendLedger(m, [
      { userId: order.userId, kind: 'refund', amount: order.cost, orderId: order.id, actorId, reason },
    ]);
    await m.query('UPDATE store_item SET stock = stock + 1 WHERE id = $1 AND stock IS NOT NULL', [order.itemId]);
  }

  private async lockOrder(m: EntityManager, id: string): Promise<StoreOrder> {
    const order = await m.getRepository(StoreOrder).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!order) throw orderNotFound();
    return order;
  }

  /** A pessoa cancela o próprio pedido enquanto pendente (RN-165). */
  async cancelOwn(access: Access, id: string): Promise<StoreOrderView> {
    await this.store.assertEnabled();
    return this.dataSource.transaction(async (m) => {
      const order = await this.lockOrder(m, id);
      if (order.userId !== access.userId) throw orderNotFound();
      if (order.status !== 'pending') throw conflict('Só dá para cancelar o pedido enquanto ele está pendente.');
      await m.getRepository(StoreOrder).update(id, { status: 'cancelled', closedAt: new Date() });
      await this.refund(m, order, access.userId, 'Cancelado por quem pediu');
      return this.view(m, id, false);
    });
  }

  /**
   * Decisões de quem gerencia (RN-166, RN-167): aprovar e recusar o pendente; entregar o produto aprovado;
   * marcar paga a bonificação aprovada; cancelar o pendente ou o aprovado. Ninguém decide o próprio pedido.
   */
  async decide(
    access: Access,
    id: string,
    action: ManagerAction,
    input: { reason?: string; note?: string | null; pay?: z.infer<typeof PaySchema> },
    meta: RequestMeta,
  ): Promise<StoreOrderView> {
    await this.store.assertEnabled();
    this.store.assertManage(access);
    return this.dataSource.transaction(async (m) => {
      const order = await this.lockOrder(m, id);
      if (order.userId === access.userId) {
        throw apiError(403, 'own_order', 'Ninguém decide o próprio pedido.');
      }
      const repo = m.getRepository(StoreOrder);
      const now = new Date();
      const allowed: Record<ManagerAction, OrderStatus[]> = {
        approve: ['pending'],
        reject: ['pending'],
        deliver: ['approved'],
        pay: ['approved'],
        cancel: ['pending', 'approved'],
      };
      if (!allowed[action].includes(order.status)) {
        throw conflict(`O pedido está "${order.status}": esta ação não vale agora.`);
      }
      if (action === 'deliver' && order.itemKind !== 'product') {
        throw conflict('Bonificação não é entregue: marque como paga.');
      }
      if (action === 'pay' && order.itemKind !== 'bonus') {
        throw conflict('Só bonificação é marcada como paga.');
      }
      switch (action) {
        case 'approve':
          await repo.update(id, { status: 'approved', approvedAt: now, decidedById: access.userId });
          break;
        case 'reject':
          await repo.update(id, {
            status: 'rejected',
            reason: input.reason ?? null,
            decidedById: access.userId,
            closedAt: now,
          });
          await this.refund(m, order, access.userId, input.reason ?? null);
          break;
        case 'cancel':
          await repo.update(id, {
            status: 'cancelled',
            reason: input.reason ?? null,
            decidedById: access.userId,
            closedAt: now,
          });
          await this.refund(m, order, access.userId, input.reason ?? null);
          break;
        case 'deliver':
          await repo.update(id, { status: 'delivered', deliveryNote: input.note || null, closedAt: now });
          break;
        case 'pay':
          await repo.update(id, {
            status: 'paid',
            paidOn: input.pay?.paidOn ?? null,
            paidReference: input.pay?.reference ?? null,
            closedAt: now,
          });
          break;
      }
      const auditAction = {
        approve: 'store.order_approved',
        reject: 'store.order_rejected',
        deliver: 'store.order_delivered',
        pay: 'store.bonus_paid',
        cancel: 'store.order_cancelled',
      }[action];
      await this.audit.record(
        {
          action: auditAction,
          actorId: access.userId,
          targetType: 'store_order',
          targetId: id,
          data: {
            itemId: order.itemId,
            userId: order.userId,
            cost: order.cost,
            ...(input.reason ? { reason: input.reason } : {}),
            ...(input.pay ? { paidOn: input.pay.paidOn, reference: input.pay.reference } : {}),
          },
          ip: meta.ip,
        },
        m,
      );
      // Aviso à pessoa (RN-171): aprovado, recusado e cancelado são obrigatórios.
      const item = await m.getRepository(StoreItem).findOneBy({ id: order.itemId });
      const payload = { orderId: id, itemName: item?.name ?? '', ...(input.reason ? { reason: input.reason } : {}) };
      const notice = {
        approve: 'store_order_approved',
        reject: 'store_order_rejected',
        deliver: 'store_order_delivered',
        pay: 'store_bonus_paid',
        cancel: 'store_order_cancelled',
      } as const;
      await notifyPerson(m, order.userId, notice[action], payload);
      // Webhooks (RN-172): só o pedido, o item e a situação; a loja é da organização toda (sem escopo).
      const hook = {
        approve: 'store.order_approved',
        deliver: 'store.order_delivered',
        pay: 'store.bonus_paid',
      } as const;
      if (action === 'approve' || action === 'deliver' || action === 'pay') {
        const status = { approve: 'approved', deliver: 'delivered', pay: 'paid' }[action];
        await emitWebhookEvent(m, {
          type: hook[action],
          data: { order_id: id, item_id: order.itemId, status },
          entityIds: null,
        });
      }
      return this.view(m, id, true);
    });
  }

  /** Os próprios pedidos, do mais novo para o mais antigo. */
  async mine(access: Access, q: PageQuery): Promise<OrderPage> {
    await this.store.assertEnabled();
    const m = this.dataSource.manager;
    const [rows, total] = await m.getRepository(StoreOrder).findAndCount({
      where: { userId: access.userId },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { items: await this.views(m, rows, false), meta: pageMeta(q, total) };
  }

  /** A fila de quem gerencia (RN-166), por situação, item e pessoa. */
  async queue(access: Access, q: z.infer<typeof OrdersQuerySchema>): Promise<OrderPage> {
    await this.store.assertEnabled();
    this.store.assertManage(access);
    const m = this.dataSource.manager;
    const [rows, total] = await m.getRepository(StoreOrder).findAndCount({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
      },
      order: { createdAt: q.status === 'pending' ? 'ASC' : 'DESC', id: 'ASC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { items: await this.views(m, rows, true), meta: pageMeta(q, total) };
  }

  private async bonusRows(status: 'approved' | 'paid' | 'all'): Promise<StoreOrder[]> {
    return this.dataSource.getRepository(StoreOrder).find({
      where: { itemKind: 'bonus', status: status === 'all' ? In(['approved', 'paid']) : status },
      order: { approvedAt: 'ASC', id: 'ASC' },
    });
  }

  /** Bonificações a pagar (RN-167): aprovadas e ainda não pagas (ou as pagas, ou todas). */
  async bonuses(access: Access, status: 'approved' | 'paid' | 'all'): Promise<StoreOrderView[]> {
    await this.store.assertEnabled();
    this.store.assertManage(access);
    return this.views(this.dataSource.manager, await this.bonusRows(status), true);
  }

  /** Exportação CSV para o RH (RN-167): valor só informativo; fórmulas neutralizadas (CA-T.4). */
  async bonusesCsv(access: Access, status: 'approved' | 'paid' | 'all'): Promise<string> {
    const list = await this.bonuses(access, status);
    const currency = await this.settings.get('results.currency');
    const header = csvRow([
      'Pedido',
      'Pessoa',
      'Item',
      'Valor informativo',
      'Moeda',
      'Aprovado em',
      'Situação',
      'Pago em',
      'Referência',
    ]);
    const status_ = { approved: 'A pagar', paid: 'Paga' } as Record<string, string>;
    const body = list
      .map((o) =>
        csvRow([
          o.id,
          o.person?.name ?? '',
          o.item.name,
          o.bonusValue === null ? '' : o.bonusValue.toFixed(2).replace('.', ','),
          currency,
          o.approvedAt ? o.approvedAt.slice(0, 10) : '',
          status_[o.status] ?? o.status,
          o.paidOn ?? '',
          o.paidReference ?? '',
        ]),
      )
      .join('');
    return CSV_BOM + header + body;
  }
}
