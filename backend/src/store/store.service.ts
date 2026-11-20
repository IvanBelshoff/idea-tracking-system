import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import { type PageQuery, pageMeta } from '../common/pagination.js';
import type { Access } from '../identity-access/access.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { SettingsService } from '../organization/settings.service.js';
import type {
  AccountListPage,
  AccountsQuerySchema,
  AdjustmentSchema,
  LedgerPage,
  StoreAccountView,
} from './store.dto.js';
import { appendLedger, balanceOf, expiringSoon, lockBalance } from './store-core.js';
import { notifyPerson } from './store-notify.js';

/**
 * Loja (M22, RN-159 a RN-173). Esta parte: o saldo, o extrato e o ajuste manual. Com a loja
 * desligada, toda rota responde 404 (CA-RN-159.1).
 */
@Injectable()
export class StoreService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async assertEnabled(): Promise<void> {
    if (!(await this.settings.get('store.enabled'))) throw apiError(404, 'not_found', 'A loja está desligada.');
  }

  assertManage(access: Access): void {
    if (!access.has('store.manage')) throw apiError(403, 'forbidden', 'Você não gerencia a loja.');
  }

  /** O saldo, o reservado, os pontos ganhos e o que vai vencer (RN-160 a RN-162). */
  async summary(m: EntityManager, userId: string, name: string | null): Promise<StoreAccountView> {
    const [balance, reserved, earned, expiring, months] = await Promise.all([
      balanceOf(m, userId),
      m.query(
        `SELECT coalesce(sum(cost), 0) AS total FROM store_order WHERE user_id = $1 AND status IN ('pending', 'approved')`,
        [userId],
      ) as Promise<{ total: string }[]>,
      m.query('SELECT coalesce(sum(points), 0) AS total FROM point_ledger WHERE user_id = $1', [userId]) as Promise<
        { total: string }[]
      >,
      expiringSoon(m, userId),
      this.settings.get('store.expiry_months'),
    ]);
    return {
      userId,
      name,
      balance,
      reserved: Number(reserved[0]?.total ?? 0),
      earnedPoints: Number(earned[0]?.total ?? 0),
      expiring,
      expiryMonths: months,
    };
  }

  /** O próprio saldo (RN-160): só a pessoa (e quem gerencia, pela outra rota) vê. */
  async me(access: Access): Promise<StoreAccountView> {
    await this.assertEnabled();
    return this.summary(this.dataSource.manager, access.userId, null);
  }

  /** O extrato, do mais novo para o mais antigo (RN-160). */
  private async ledger(userId: string, q: PageQuery): Promise<LedgerPage> {
    const m = this.dataSource.manager;
    const [rows, count]: [
      {
        id: string;
        kind: string;
        amount: number;
        created_at: Date;
        reason: string | null;
        actor_name: string | null;
        actor_status: string | null;
        idea_code: string | null;
        idea_title: string | null;
        order_id: string | null;
      }[],
      { n: string }[],
    ] = await Promise.all([
      m.query(
        `SELECT l.id, l.kind, l.amount, l.created_at, l.reason, l.order_id,
                a.name AS actor_name, a.status AS actor_status, i.code AS idea_code, i.title AS idea_title
           FROM store_ledger l
           LEFT JOIN "user" a ON a.id = l.actor_id
           LEFT JOIN idea i ON i.id = l.idea_id
          WHERE l.user_id = $1
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT $2 OFFSET $3`,
        [userId, q.pageSize, (q.page - 1) * q.pageSize],
      ),
      m.query('SELECT count(*) AS n FROM store_ledger WHERE user_id = $1', [userId]),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        amount: Number(r.amount),
        createdAt: new Date(r.created_at).toISOString(),
        reason: r.reason,
        actor: r.actor_name ? (r.actor_status === UserStatus.Anonymized ? 'Ex-colaborador' : r.actor_name) : null,
        idea: r.idea_code && r.idea_title ? { code: r.idea_code, title: r.idea_title } : null,
        orderId: r.order_id,
      })),
      meta: pageMeta(q, Number(count[0]?.n ?? 0)),
    };
  }

  async myLedger(access: Access, q: PageQuery): Promise<LedgerPage> {
    await this.assertEnabled();
    return this.ledger(access.userId, q);
  }

  private async person(userId: string): Promise<User> {
    const user = await this.dataSource.getRepository(User).findOneBy({ id: userId });
    if (!user) throw apiError(404, 'not_found', 'Pessoa não encontrada.');
    return user;
  }

  private displayName(user: User): string {
    return user.status === UserStatus.Anonymized ? 'Ex-colaborador' : user.name;
  }

  /** O saldo de uma pessoa, para quem gerencia a loja (RN-170). */
  async accountOf(access: Access, userId: string): Promise<StoreAccountView> {
    await this.assertEnabled();
    this.assertManage(access);
    const user = await this.person(userId);
    return this.summary(this.dataSource.manager, user.id, this.displayName(user));
  }

  async ledgerOf(access: Access, userId: string, q: PageQuery): Promise<LedgerPage> {
    await this.assertEnabled();
    this.assertManage(access);
    await this.person(userId);
    return this.ledger(userId, q);
  }

  /** Pessoas e saldos, para quem gerencia escolher a quem ajustar (RN-168). */
  async accounts(access: Access, q: z.infer<typeof AccountsQuerySchema>): Promise<AccountListPage> {
    await this.assertEnabled();
    this.assertManage(access);
    const like = q.search ? `%${q.search.replace(/[%_\\]/g, '\\$&')}%` : null;
    const where = `u.status <> 'anonymized' AND ($1::text IS NULL OR u.name ILIKE $1 OR u.email ILIKE $1)`;
    const [rows, count]: [{ id: string; name: string; balance: string }[], { n: string }[]] = await Promise.all([
      this.dataSource.query(
        `SELECT u.id, u.name, coalesce((SELECT sum(amount) FROM store_ledger l WHERE l.user_id = u.id), 0) AS balance
           FROM "user" u WHERE ${where} ORDER BY u.name, u.id LIMIT $2 OFFSET $3`,
        [like, q.pageSize, (q.page - 1) * q.pageSize],
      ),
      this.dataSource.query(`SELECT count(*) AS n FROM "user" u WHERE ${where}`, [like]),
    ]);
    return {
      items: rows.map((r) => ({ userId: r.id, name: r.name, balance: Number(r.balance) })),
      meta: pageMeta(q, Number(count[0]?.n ?? 0)),
    };
  }

  /**
   * Ajuste manual (RN-168): crédito ou débito com motivo, só no saldo (nunca nos pontos ganhos); pode
   * deixar o saldo negativo (RN-169). Ninguém ajusta o próprio saldo. Vai para a auditoria.
   */
  async adjust(access: Access, input: z.infer<typeof AdjustmentSchema>, meta: RequestMeta): Promise<StoreAccountView> {
    await this.assertEnabled();
    this.assertManage(access);
    if (input.userId === access.userId) {
      throw apiError(403, 'own_account', 'Ninguém ajusta o próprio saldo.');
    }
    const user = await this.person(input.userId);
    if (user.status === UserStatus.Anonymized) {
      throw apiError(422, 'person_anonymized', 'Esta pessoa foi anonimizada.');
    }
    await this.dataSource.transaction(async (m) => {
      await lockBalance(m, user.id);
      await appendLedger(m, [
        { userId: user.id, kind: 'adjustment', amount: input.amount, actorId: access.userId, reason: input.reason },
      ]);
      await this.audit.record(
        {
          action: 'store.balance_adjusted',
          actorId: access.userId,
          targetType: 'user',
          targetId: user.id,
          data: { amount: input.amount, reason: input.reason },
          ip: meta.ip,
        },
        m,
      );
      await notifyPerson(m, user.id, 'store_balance_adjusted', { amount: input.amount, reason: input.reason });
    });
    return this.summary(this.dataSource.manager, user.id, this.displayName(user));
  }
}
