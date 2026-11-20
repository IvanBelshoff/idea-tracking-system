import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { CreatedEntity, EditableEntity } from '../database/base.entity.js';
import { User } from '../identity-access/entities/user.entity.js';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import {
  ITEM_KINDS,
  type ItemKind,
  LEDGER_KINDS,
  type LedgerKind,
  LIMIT_PERIODS,
  type LimitPeriod,
  ORDER_STATUSES,
  type OrderStatus,
} from './store-rules.js';

/**
 * Item da loja (M22, RN-163): produto ou serviço, ou bonificação (valor informativo, RN-167). Estoque
 * vazio = ilimitado; limite por pessoa e período do calendário, opcional.
 */
@Entity('store_item')
@Check('ck_store_item_cost', 'cost >= 1 AND cost <= 1000000')
@Check('ck_store_item_stock', 'stock IS NULL OR stock >= 0')
@Check('ck_store_item_bonus', `kind <> 'bonus' OR bonus_value IS NOT NULL`)
@Check('ck_store_item_limit', '(limit_qty IS NULL) = (limit_period IS NULL) AND (limit_qty IS NULL OR limit_qty >= 1)')
export class StoreItem extends EditableEntity {
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: ITEM_KINDS, enumName: 'store_item_kind', default: 'product' })
  kind!: ItemKind;

  @Column({ type: 'int' })
  cost!: number;

  /** Só na bonificação: valor em moeda apenas informativo; o ITS nunca paga (RN-167). */
  @Column({ name: 'bonus_value', type: 'numeric', precision: 14, scale: 2, nullable: true })
  bonusValue!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'int', nullable: true })
  stock!: number | null;

  @Column({ name: 'limit_qty', type: 'int', nullable: true })
  limitQty!: number | null;

  @Column({ name: 'limit_period', type: 'enum', enum: LIMIT_PERIODS, enumName: 'store_limit_period', nullable: true })
  limitPeriod!: LimitPeriod | null;

  /** Foto (recorte quadrado, RN-143), guardada no armazenamento de arquivos como os anexos. */
  @Column({ name: 'photo_stored_name', type: 'varchar', length: 60, nullable: true })
  photoStoredName!: string | null;

  @Column({ name: 'photo_version', type: 'varchar', length: 20, nullable: true })
  photoVersion!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: User | null;
}

/** Entidades em que o item vale (vazio = a organização toda; cada uma inclui as sub-entidades). */
@Entity('store_item_entity')
export class StoreItemEntity {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @PrimaryColumn({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @ManyToOne(() => StoreItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item!: StoreItem;

  @ManyToOne(() => OrgEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entity_id' })
  entity!: OrgEntity;
}

/**
 * Pedido (resgate, RN-165 a RN-167): uma unidade, com o custo (e o valor da bonificação) congelados
 * na hora do pedido. Item com pedidos não se exclui (a FK restringe).
 */
@Entity('store_order')
@Index('ix_store_order_user', ['userId', 'createdAt'])
@Index('ix_store_order_status', ['status', 'createdAt'])
@Index('ix_store_order_item', ['itemId', 'createdAt'])
export class StoreOrder extends EditableEntity {
  @Column({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @ManyToOne(() => StoreItem, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'item_id' })
  item!: StoreItem;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: ORDER_STATUSES, enumName: 'store_order_status', default: 'pending' })
  status!: OrderStatus;

  @Column({ type: 'int' })
  cost!: number;

  @Column({ name: 'item_kind', type: 'enum', enum: ITEM_KINDS, enumName: 'store_item_kind' })
  itemKind!: ItemKind;

  @Column({ name: 'bonus_value', type: 'numeric', precision: 14, scale: 2, nullable: true })
  bonusValue!: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note!: string | null;

  /** Quem aprovou, recusou ou cancelou por último, e o motivo (recusa e cancelamento). */
  @Column({ name: 'decided_by_id', type: 'uuid', nullable: true })
  decidedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decided_by_id' })
  decidedBy!: User | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'delivery_note', type: 'varchar', length: 300, nullable: true })
  deliveryNote!: string | null;

  /** Bonificação paga (RN-167): data e referência informadas pelo RH. */
  @Column({ name: 'paid_on', type: 'date', nullable: true })
  paidOn!: string | null;

  @Column({ name: 'paid_reference', type: 'varchar', length: 100, nullable: true })
  paidReference!: string | null;
}

/**
 * Extrato do saldo (RN-160): só recebe inserções (um gatilho recusa UPDATE, DELETE e TRUNCATE). O
 * saldo é a soma de `amount`; corrigir é sempre uma linha nova.
 */
@Entity('store_ledger')
@Index('ix_store_ledger_user', ['userId', 'createdAt'])
@Check('ck_store_ledger_amount', 'amount <> 0')
export class StoreLedger extends CreatedEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: LEDGER_KINDS, enumName: 'store_ledger_kind' })
  kind!: LedgerKind;

  @Column({ type: 'int' })
  amount!: number;

  /**
   * Quem causou (gestor no ajuste e nas decisões; nulo = o sistema) e a ideia do ponto. Sem chave
   * estrangeira de propósito: a linha é imutável, e um "anular ao apagar" (excluir a ideia, RN-11)
   * esbarraria no gatilho. A referência fica como histórico.
   */
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ name: 'idea_id', type: 'uuid', nullable: true })
  ideaId!: string | null;

  /** O ponto que originou o crédito (um crédito por ponto: reprocessar não credita duas vezes). */
  @Index('uq_store_ledger_point', { unique: true, where: 'point_id IS NOT NULL' })
  @Column({ name: 'point_id', type: 'uuid', nullable: true })
  pointId!: string | null;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @ManyToOne(() => StoreOrder, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'order_id' })
  order!: StoreOrder | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reason!: string | null;
}

/** Aviso de vencimento já enviado (RN-162): um por pessoa e data de vencimento. */
@Entity('store_expiry_notice')
export class StoreExpiryNotice {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ name: 'expires_on', type: 'date' })
  expiresOn!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
