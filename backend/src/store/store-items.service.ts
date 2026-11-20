import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, In } from 'typeorm';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import { todayInZone } from '../common/dates.js';
import type { Access } from '../identity-access/access.js';
import { AccessService } from '../identity-access/access.service.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import { SettingsService } from '../organization/settings.service.js';
import { subtreeIds } from '../organization/tree.js';
import { StoreItem, StoreItemEntity, StoreOrder } from './entities.js';
import type { CatalogItem, CatalogView, ItemSchema, ItemUpdateSchema, StoreItemView } from './store.dto.js';
import { StoreService } from './store.service.js';
import { StorePhotoStorage } from './store-photo.js';
import { type LimitPeriod, periodStart } from './store-rules.js';

const itemNotFound = () => apiError(404, 'not_found', 'Item não encontrado.');
const num = (v: string | number | null) => (v === null ? null : Number(v));

/** Disponibilidade e limite de um item para uma pessoa (RN-163 a RN-165). */
export interface Availability {
  available: boolean;
  stockLeft: number | null;
  used: number;
  blocked: 'insufficient_balance' | 'out_of_stock' | 'limit_reached' | null;
}

/**
 * Itens da loja (RN-163) e a vitrine (RN-164). Quem gerencia (`store.manage`) cadastra; todos os
 * logados veem os itens ativos que valem para alguma entidade em que têm perfil.
 */
@Injectable()
export class StoreItemsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly store: StoreService,
    private readonly settings: SettingsService,
    private readonly accessService: AccessService,
    private readonly audit: AuditService,
    private readonly photos: StorePhotoStorage,
  ) {}

  // --- Disponibilidade ---------------------------------------------------------------------------

  /** Entidades que a pessoa alcança (onde tem algum perfil, com as sub-entidades). */
  private reach(access: Access): Set<string> {
    const out = new Set<string>();
    for (const p of access.permissions()) for (const e of access.entities(p)) out.add(e);
    return out;
  }

  /** O item vale para a pessoa: sem entidades (a organização toda) ou alguma entidade alcançada no ramo. */
  async itemAvailableTo(access: Access, itemId: string, m: EntityManager = this.dataSource.manager): Promise<boolean> {
    const links = await m.getRepository(StoreItemEntity).findBy({ itemId });
    if (links.length === 0) return true;
    const tree = await this.accessService.tree();
    const reach = this.reach(access);
    return links.some((l) => subtreeIds(l.entityId, tree).some((id) => reach.has(id)));
  }

  /** Quantos pedidos da pessoa contam para o limite no período atual (não recusados nem cancelados). */
  async usedInPeriod(m: EntityManager, userId: string, itemId: string, period: LimitPeriod): Promise<number> {
    const zone = await this.settings.get('organization.timezone');
    const start = periodStart(todayInZone(new Date(), zone), period);
    const [row]: { n: string }[] = await m.query(
      `SELECT count(*) AS n FROM store_order
        WHERE user_id = $1 AND item_id = $2 AND status NOT IN ('rejected', 'cancelled')
          AND (created_at AT TIME ZONE $3)::date >= $4::date`,
      [userId, itemId, zone, start],
    );
    return Number(row?.n ?? 0);
  }

  /** O que impede (ou não) a pessoa de pedir: saldo, estoque e limite (RN-165, RN-169). */
  async availability(m: EntityManager, userId: string, item: StoreItem, balance: number): Promise<Availability> {
    const used = item.limitPeriod ? await this.usedInPeriod(m, userId, item.id, item.limitPeriod) : 0;
    const blocked =
      item.stock !== null && item.stock <= 0
        ? ('out_of_stock' as const)
        : item.limitQty !== null && used >= item.limitQty
          ? ('limit_reached' as const)
          : balance < item.cost
            ? ('insufficient_balance' as const)
            : null;
    return { available: blocked === null, stockLeft: item.stock, used, blocked };
  }

  // --- Vitrine (RN-164) --------------------------------------------------------------------------

  async catalog(access: Access): Promise<CatalogView> {
    await this.store.assertEnabled();
    const m = this.dataSource.manager;
    const account = await this.store.summary(m, access.userId, null);
    const items = await m
      .getRepository(StoreItem)
      .find({ where: { active: true }, order: { cost: 'ASC', name: 'ASC' } });
    const links = items.length
      ? await m.getRepository(StoreItemEntity).findBy({ itemId: In(items.map((i) => i.id)) })
      : [];
    const tree = await this.accessService.tree();
    const reach = this.reach(access);
    const visible = items.filter((i) => {
      const mine = links.filter((l) => l.itemId === i.id);
      return mine.length === 0 || mine.some((l) => subtreeIds(l.entityId, tree).some((id) => reach.has(id)));
    });
    const counts: { item_id: string; n: string }[] = visible.length
      ? await m.query(
          `SELECT item_id, count(*) AS n FROM store_order WHERE item_id = ANY($1) AND status NOT IN ('rejected', 'cancelled')
            GROUP BY item_id`,
          [visible.map((i) => i.id)],
        )
      : [];
    const out: CatalogItem[] = [];
    for (const i of visible) {
      const a = await this.availability(m, access.userId, i, account.balance);
      out.push({
        id: i.id,
        name: i.name,
        description: i.description,
        kind: i.kind,
        cost: i.cost,
        bonusValue: num(i.bonusValue),
        photoVersion: i.photoVersion,
        stockLeft: i.stock,
        limit: i.limitQty !== null && i.limitPeriod ? { qty: i.limitQty, period: i.limitPeriod, used: a.used } : null,
        redemptions: Number(counts.find((c) => c.item_id === i.id)?.n ?? 0),
        canOrder: a.available,
        blockedReason: a.blocked,
      });
    }
    return { account, items: out, currency: await this.settings.get('results.currency') };
  }

  // --- Cadastro (RN-163) -------------------------------------------------------------------------

  private async views(m: EntityManager, items: StoreItem[]): Promise<StoreItemView[]> {
    if (items.length === 0) return [];
    const ids = items.map((i) => i.id);
    const [links, counts]: [StoreItemEntity[], { item_id: string; open: string; total: string }[]] = await Promise.all([
      m.getRepository(StoreItemEntity).find({ where: { itemId: In(ids) }, relations: { entity: true } }),
      m.query(
        `SELECT item_id, count(*) FILTER (WHERE status IN ('pending', 'approved')) AS open, count(*) AS total
           FROM store_order WHERE item_id = ANY($1) GROUP BY item_id`,
        [ids],
      ),
    ]);
    return items.map((i) => {
      const c = counts.find((x) => x.item_id === i.id);
      return {
        id: i.id,
        name: i.name,
        description: i.description,
        kind: i.kind,
        cost: i.cost,
        bonusValue: num(i.bonusValue),
        active: i.active,
        stock: i.stock,
        limitQty: i.limitQty,
        limitPeriod: i.limitPeriod,
        entities: links
          .filter((l) => l.itemId === i.id)
          .map((l) => ({ id: l.entity.id, name: l.entity.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        photoVersion: i.photoVersion,
        openOrders: Number(c?.open ?? 0),
        totalOrders: Number(c?.total ?? 0),
        updatedAt: i.updatedAt.toISOString(),
      };
    });
  }

  async list(access: Access): Promise<StoreItemView[]> {
    await this.store.assertEnabled();
    this.store.assertManage(access);
    const m = this.dataSource.manager;
    return this.views(m, await m.getRepository(StoreItem).find({ order: { active: 'DESC', name: 'ASC' } }));
  }

  private async one(m: EntityManager, id: string): Promise<StoreItemView> {
    const item = await m.getRepository(StoreItem).findOneBy({ id });
    if (!item) throw itemNotFound();
    return (await this.views(m, [item]))[0] as StoreItemView;
  }

  private async checkEntities(m: EntityManager, entityIds: readonly string[]): Promise<void> {
    if (entityIds.length === 0) return;
    const found = await m.getRepository(OrgEntity).countBy({ id: In([...new Set(entityIds)]) });
    if (found !== new Set(entityIds).size) {
      throw apiError(422, 'validation_failed', 'Entidade inexistente.', [
        { path: 'entityIds', message: 'Entidade inexistente.' },
      ]);
    }
  }

  private snapshot(i: StoreItem): Record<string, unknown> {
    return {
      name: i.name,
      kind: i.kind,
      cost: i.cost,
      bonusValue: num(i.bonusValue),
      active: i.active,
      stock: i.stock,
      limitQty: i.limitQty,
      limitPeriod: i.limitPeriod,
    };
  }

  async create(access: Access, input: z.infer<typeof ItemSchema>, meta: RequestMeta): Promise<StoreItemView> {
    await this.store.assertEnabled();
    this.store.assertManage(access);
    return this.dataSource.transaction(async (m) => {
      await this.checkEntities(m, input.entityIds);
      const repo = m.getRepository(StoreItem);
      const item = await repo.save(
        repo.create({
          name: input.name,
          description: input.description || null,
          kind: input.kind,
          cost: input.cost,
          bonusValue: input.kind === 'bonus' ? String(input.bonusValue) : null,
          active: input.active,
          stock: input.stock ?? null,
          limitQty: input.limitQty ?? null,
          limitPeriod: input.limitPeriod ?? null,
          createdById: access.userId,
        }),
      );
      if (input.entityIds.length) {
        await m
          .getRepository(StoreItemEntity)
          .insert([...new Set(input.entityIds)].map((entityId) => ({ itemId: item.id, entityId })));
      }
      await this.audit.record(
        {
          action: 'store.item_created',
          actorId: access.userId,
          targetType: 'store_item',
          targetId: item.id,
          data: this.snapshot(item),
          ip: meta.ip,
        },
        m,
      );
      return this.one(m, item.id);
    });
  }

  /**
   * Alterar (RN-163): o custo novo não muda pedidos feitos (o pedido guarda o da hora). Desativar tira
   * da vitrine e os pedidos pendentes seguem; reativar devolve. O tipo não muda com pedidos existentes.
   */
  async update(
    access: Access,
    id: string,
    input: z.infer<typeof ItemUpdateSchema>,
    meta: RequestMeta,
  ): Promise<StoreItemView> {
    await this.store.assertEnabled();
    this.store.assertManage(access);
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(StoreItem);
      const item = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!item) throw itemNotFound();
      const before = this.snapshot(item);
      const kind = input.kind ?? item.kind;
      if (kind !== item.kind && (await m.query('SELECT 1 FROM store_order WHERE item_id = $1 LIMIT 1', [id])).length) {
        throw apiError(409, 'item_has_orders', 'O item já tem pedidos: o tipo não muda.');
      }
      const bonusValue =
        kind === 'bonus' ? (input.bonusValue !== undefined ? input.bonusValue : num(item.bonusValue)) : null;
      if (kind === 'bonus' && (bonusValue === null || bonusValue === undefined)) {
        throw apiError(422, 'validation_failed', 'A bonificação precisa do valor informativo.', [
          { path: 'bonusValue', message: 'A bonificação precisa do valor informativo.' },
        ]);
      }
      const limitQty = input.limitQty !== undefined ? input.limitQty : item.limitQty;
      const limitPeriod = input.limitPeriod !== undefined ? input.limitPeriod : item.limitPeriod;
      if (((limitQty ?? null) === null) !== ((limitPeriod ?? null) === null)) {
        throw apiError(422, 'validation_failed', 'Informe a quantidade e o período do limite juntos.', [
          { path: 'limitQty', message: 'Informe a quantidade e o período do limite juntos.' },
        ]);
      }
      await repo.update(id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.cost !== undefined ? { cost: input.cost } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.stock !== undefined ? { stock: input.stock } : {}),
        kind,
        bonusValue: bonusValue === null ? null : String(bonusValue),
        limitQty: limitQty ?? null,
        limitPeriod: limitPeriod ?? null,
      });
      if (input.entityIds !== undefined) {
        await this.checkEntities(m, input.entityIds);
        await m.getRepository(StoreItemEntity).delete({ itemId: id });
        if (input.entityIds.length) {
          await m
            .getRepository(StoreItemEntity)
            .insert([...new Set(input.entityIds)].map((entityId) => ({ itemId: id, entityId })));
        }
      }
      const after = this.snapshot((await repo.findOneByOrFail({ id })) as StoreItem);
      const action =
        before.active === true && after.active === false
          ? 'store.item_deactivated'
          : before.active === false && after.active === true
            ? 'store.item_reactivated'
            : 'store.item_updated';
      await this.audit.record(
        {
          action,
          actorId: access.userId,
          targetType: 'store_item',
          targetId: id,
          data: { before, after, ...(input.entityIds !== undefined ? { entityIds: input.entityIds } : {}) },
          ip: meta.ip,
        },
        m,
      );
      return this.one(m, id);
    });
  }

  /** Excluir (RN-163): só sem pedidos; com pedidos, desativa-se. */
  async remove(access: Access, id: string, meta: RequestMeta): Promise<void> {
    await this.store.assertEnabled();
    this.store.assertManage(access);
    const photo = await this.dataSource.transaction(async (m) => {
      const item = await m.getRepository(StoreItem).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!item) throw itemNotFound();
      if ((await m.query('SELECT 1 FROM store_order WHERE item_id = $1 LIMIT 1', [id])).length) {
        throw apiError(409, 'item_has_orders', 'O item já tem pedidos: desative em vez de excluir.');
      }
      await m.getRepository(StoreItem).delete(id);
      await this.audit.record(
        {
          action: 'store.item_deleted',
          actorId: access.userId,
          targetType: 'store_item',
          targetId: id,
          data: this.snapshot(item),
          ip: meta.ip,
        },
        m,
      );
      return item.photoStoredName;
    });
    await this.photos.remove(photo);
  }

  // --- Foto (RN-163) -----------------------------------------------------------------------------

  async setPhoto(access: Access, id: string, buffer: Buffer): Promise<string> {
    await this.store.assertEnabled();
    this.store.assertManage(access);
    if (!(await this.dataSource.getRepository(StoreItem).existsBy({ id }))) throw itemNotFound();
    const storedName = await this.photos.save(buffer);
    const version = Date.now().toString(36);
    let previous: string | null = null;
    try {
      await this.dataSource.transaction(async (m) => {
        const item = await m.getRepository(StoreItem).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!item) throw itemNotFound();
        previous = item.photoStoredName;
        await m.getRepository(StoreItem).update(id, { photoStoredName: storedName, photoVersion: version });
      });
    } catch (error) {
      await this.photos.remove(storedName);
      throw error;
    }
    await this.photos.remove(previous);
    return version;
  }

  async removePhoto(access: Access, id: string): Promise<void> {
    await this.store.assertEnabled();
    this.store.assertManage(access);
    const item = await this.dataSource.getRepository(StoreItem).findOneBy({ id });
    if (!item) throw itemNotFound();
    await this.dataSource.getRepository(StoreItem).update(id, { photoStoredName: null, photoVersion: null });
    await this.photos.remove(item.photoStoredName);
  }

  /** A foto, para quem vê o item: na vitrine (ativo e disponível) ou quem gerencia. */
  async photo(access: Access, id: string): Promise<Buffer> {
    await this.store.assertEnabled();
    const item = await this.dataSource.getRepository(StoreItem).findOneBy({ id });
    const sees =
      item &&
      (access.has('store.manage') ||
        (await this.itemAvailableTo(access, id)) ||
        (await this.dataSource.getRepository(StoreOrder).existsBy({ itemId: id, userId: access.userId })));
    if (!item?.photoStoredName || !sees) throw apiError(404, 'not_found', 'Sem foto.');
    return this.photos.read(item.photoStoredName);
  }
}
