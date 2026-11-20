import type { EntityManager } from 'typeorm';
import { todayInZone } from '../common/dates.js';
import { Notification } from '../communication/entities.js';
import type { NotificationType } from '../communication/notification-rules.js';
import { dispatchNotifications } from '../communication/notify.js';
import { usersWithPermission } from '../identity-access/permission-holders.js';
import { getSetting } from '../organization/settings.service.js';

/**
 * Avisos da loja (M22, RN-171), gravados na transação da ação. Com a loja desligada, nenhum aviso.
 * As decisões sobre o próprio pedido são obrigatórias (MANDATORY_TYPES); nenhum aviso gera pontos.
 */

type StoreType = Extract<
  NotificationType,
  | 'store_order_approved'
  | 'store_order_rejected'
  | 'store_order_delivered'
  | 'store_order_cancelled'
  | 'store_bonus_paid'
  | 'store_balance_adjusted'
  | 'store_points_expiring'
  | 'store_points_expired'
>;

/** Um aviso à própria pessoa (decisão sobre o pedido, ajuste, vencimento). */
export async function notifyPerson(
  m: EntityManager,
  userId: string,
  type: StoreType,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!(await getSetting(m, 'store.enabled'))) return;
  await dispatchNotifications(m, [{ userId, type, ideaId: null, payload }]);
}

/**
 * Pedido novo: um aviso por dia (no fuso da instalação) a cada pessoa com `store.manage`, com a
 * contagem atualizada em vez de um aviso por pedido (CA-RN-171.2). Quem pediu não avisa a si mesmo.
 */
export async function bumpNewOrders(m: EntityManager, ordererId: string): Promise<void> {
  if (!(await getSetting(m, 'store.enabled'))) return;
  const day = todayInZone(new Date(), await getSetting(m, 'organization.timezone'));
  const repo = m.getRepository(Notification);
  for (const userId of await usersWithPermission(m, 'store.manage')) {
    if (userId === ordererId) continue;
    await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`store_orders_new:${userId}:${day}`]);
    const existing = await repo
      .createQueryBuilder('n')
      .where(`n.user_id = :user AND n.type = 'store_orders_new' AND n.idea_id IS NULL`, { user: userId })
      .andWhere(`n.payload ->> 'day' = :day`, { day })
      .getOne();
    if (existing) {
      const payload = { ...existing.payload, orders: (Number(existing.payload.orders) || 0) + 1 };
      await repo
        .createQueryBuilder()
        .update()
        .set({ payload: () => ':payload::jsonb', readAt: null, createdAt: () => 'now()' })
        .where('id = :id', { id: existing.id })
        .setParameter('payload', JSON.stringify(payload))
        .execute();
    } else {
      await dispatchNotifications(m, [{ userId, type: 'store_orders_new', ideaId: null, payload: { day, orders: 1 } }]);
    }
  }
}
