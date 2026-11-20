import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { PageMeta, PageQuerySchema } from '../common/pagination.js';
import { ITEM_KINDS, LEDGER_KINDS, LIMIT_PERIODS, ORDER_STATUSES } from './store-rules.js';

export const AdjustmentSchema = z.object({
  userId: z.uuid(),
  amount: z
    .number()
    .int('Use um número inteiro.')
    .min(-1_000_000)
    .max(1_000_000)
    .refine((v) => v !== 0, 'O ajuste não pode ser zero.'),
  reason: z.string().trim().min(1, 'Informe o motivo.').max(300),
});
export const AccountsQuerySchema = PageQuerySchema.extend({ search: z.string().trim().max(100).default('') });

export class AdjustmentRequest {
  @ApiProperty() userId!: string;
  @ApiProperty({ description: 'Crédito (positivo) ou débito (negativo), inteiro e diferente de zero' })
  amount!: number;
  @ApiProperty({ maxLength: 300 }) reason!: string;
}

export class ExpiringView {
  @ApiProperty({ description: 'Pontos que vencem nos próximos 30 dias' }) amount!: number;
  @ApiProperty({ format: 'date', description: 'O primeiro dia em que algo vence' }) on!: string;
}

/** O saldo de uma pessoa (RN-160 a RN-162, RN-169). */
export class StoreAccountView {
  @ApiProperty() userId!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Nulo para a própria pessoa' }) name!: string | null;
  @ApiProperty({ description: 'Saldo: a soma do extrato; pode ser negativo (RN-169)' }) balance!: number;
  @ApiProperty({ description: 'Reservado em pedidos pendentes ou aprovados (já descontado do saldo)' })
  reserved!: number;
  @ApiProperty({ description: 'Pontos ganhos (RN-66): não diminuem com resgates' }) earnedPoints!: number;
  @ApiProperty({ type: ExpiringView, nullable: true }) expiring!: ExpiringView | null;
  @ApiProperty({ description: 'Validade do saldo em meses; 0 = não expira' }) expiryMonths!: number;
}

export class LedgerIdeaRef {
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
}

/** Uma linha do extrato (RN-160). */
export class LedgerLineView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: LEDGER_KINDS }) kind!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Quem lançou (nulo = o sistema)' }) actor!: string | null;
  @ApiProperty({ type: LedgerIdeaRef, nullable: true }) idea!: LedgerIdeaRef | null;
  @ApiProperty({ type: String, nullable: true }) orderId!: string | null;
}

export class LedgerPage {
  @ApiProperty({ type: [LedgerLineView] }) items!: LedgerLineView[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}

export class AccountListItem {
  @ApiProperty() userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() balance!: number;
}

export class AccountListPage {
  @ApiProperty({ type: [AccountListItem] }) items!: AccountListItem[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}

// --- Itens, vitrine e pedidos (RN-163 a RN-167) ------------------------------------------------

const money = z
  .number()
  .min(0, 'O valor não pode ser negativo.')
  .max(1_000_000_000)
  .refine((v) => Math.round(v * 100) === v * 100, 'No máximo 2 casas decimais.');

const itemFields = {
  name: z.string().trim().min(1, 'Informe o nome.').max(120),
  description: z.string().trim().max(2000).nullish(),
  kind: z.enum(ITEM_KINDS),
  cost: z.number().int('Use um número inteiro.').min(1, 'O custo mínimo é 1 ponto.').max(1_000_000),
  bonusValue: money.nullish(),
  active: z.boolean(),
  stock: z.number().int().min(0).max(1_000_000).nullish(),
  limitQty: z.number().int().min(1).max(1000).nullish(),
  limitPeriod: z.enum(LIMIT_PERIODS).nullish(),
  entityIds: z.array(z.uuid()).max(50),
};

/** Bonificação exige o valor; quantidade e período do limite andam juntos (RN-163). */
function itemRules(
  v: { kind?: string; bonusValue?: number | null; limitQty?: number | null; limitPeriod?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (v.kind === 'bonus' && (v.bonusValue === undefined || v.bonusValue === null)) {
    ctx.addIssue({ code: 'custom', path: ['bonusValue'], message: 'A bonificação precisa do valor informativo.' });
  }
  const hasQty = v.limitQty !== undefined && v.limitQty !== null;
  const hasPeriod = v.limitPeriod !== undefined && v.limitPeriod !== null;
  if (hasQty !== hasPeriod) {
    ctx.addIssue({ code: 'custom', path: ['limitQty'], message: 'Informe a quantidade e o período do limite juntos.' });
  }
}

export const ItemSchema = z
  .object({ ...itemFields, active: itemFields.active.default(true), entityIds: itemFields.entityIds.default([]) })
  .superRefine(itemRules);
export const ItemUpdateSchema = z
  .object(itemFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo.');

export const OrderSchema = z.object({ itemId: z.uuid(), note: z.string().trim().max(300).nullish() });
export const ReasonSchema = z.object({ reason: z.string().trim().min(1, 'Informe o motivo.').max(500) });
export const DeliverSchema = z.object({ note: z.string().trim().max(300).nullish() });
export const PaySchema = z.object({
  paidOn: z.iso.date('Informe a data do pagamento.'),
  reference: z.string().trim().min(1, 'Informe a referência.').max(100),
});
export const OrdersQuerySchema = PageQuerySchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  itemId: z.uuid().optional(),
  userId: z.uuid().optional(),
});
export const BonusQuerySchema = z.object({ status: z.enum(['approved', 'paid', 'all']).default('approved') });

export class ItemRequest {
  @ApiProperty({ maxLength: 120 }) name!: string;
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: 2000 }) description?: string | null;
  @ApiProperty({ enum: ITEM_KINDS, enumName: 'StoreItemKind' }) kind!: string;
  @ApiProperty({ minimum: 1 }) cost!: number;
  @ApiProperty({ type: Number, required: false, nullable: true, description: 'Só na bonificação (informativo)' })
  bonusValue?: number | null;
  @ApiProperty({ required: false, default: true }) active?: boolean;
  @ApiProperty({ type: Number, required: false, nullable: true, description: 'Vazio = ilimitado' })
  stock?: number | null;
  @ApiProperty({ type: Number, required: false, nullable: true }) limitQty?: number | null;
  @ApiProperty({ enum: LIMIT_PERIODS, enumName: 'StoreLimitPeriod', required: false, nullable: true })
  limitPeriod?: string | null;
  @ApiProperty({ type: [String], required: false, description: 'Vazio = a organização toda' }) entityIds?: string[];
}
export class OrderRequest {
  @ApiProperty() itemId!: string;
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: 300 }) note?: string | null;
}
export class StoreReasonRequest {
  @ApiProperty({ maxLength: 500 }) reason!: string;
}
export class DeliverRequest {
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: 300 }) note?: string | null;
}
export class PayRequest {
  @ApiProperty({ format: 'date' }) paidOn!: string;
  @ApiProperty({ maxLength: 100 }) reference!: string;
}

export class ItemEntityRef {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

/** Item como quem gerencia vê (RN-163). */
export class StoreItemView {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ enum: ITEM_KINDS }) kind!: string;
  @ApiProperty() cost!: number;
  @ApiProperty({ type: Number, nullable: true }) bonusValue!: number | null;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: Number, nullable: true }) stock!: number | null;
  @ApiProperty({ type: Number, nullable: true }) limitQty!: number | null;
  @ApiProperty({ enum: LIMIT_PERIODS, nullable: true }) limitPeriod!: string | null;
  @ApiProperty({ type: [ItemEntityRef] }) entities!: ItemEntityRef[];
  @ApiProperty({ type: String, nullable: true }) photoVersion!: string | null;
  @ApiProperty({ description: 'Pedidos pendentes ou aprovados' }) openOrders!: number;
  @ApiProperty() totalOrders!: number;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CatalogLimit {
  @ApiProperty() qty!: number;
  @ApiProperty({ enum: LIMIT_PERIODS }) period!: string;
  @ApiProperty({ description: 'Pedidos da pessoa no período atual' }) used!: number;
}

/** Item na vitrine (RN-164): só o preço atual; resgates sem nomes. */
export class CatalogItem {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ enum: ITEM_KINDS }) kind!: string;
  @ApiProperty() cost!: number;
  @ApiProperty({ type: Number, nullable: true }) bonusValue!: number | null;
  @ApiProperty({ type: String, nullable: true }) photoVersion!: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Nulo = ilimitado' }) stockLeft!: number | null;
  @ApiProperty({ type: CatalogLimit, nullable: true }) limit!: CatalogLimit | null;
  @ApiProperty({ description: 'Resgates (sem nomes)' }) redemptions!: number;
  @ApiProperty() canOrder!: boolean;
  @ApiProperty({ enum: ['insufficient_balance', 'out_of_stock', 'limit_reached'], nullable: true })
  blockedReason!: string | null;
}

export class CatalogView {
  @ApiProperty({ type: StoreAccountView }) account!: StoreAccountView;
  @ApiProperty({ type: [CatalogItem] }) items!: CatalogItem[];
  @ApiProperty({ description: 'Moeda da instalação, para o valor da bonificação' }) currency!: string;
}

export class OrderItemRef {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) photoVersion!: string | null;
}
export class OrderPersonRef {
  @ApiProperty() userId!: string;
  @ApiProperty() name!: string;
}

/** Pedido (RN-165 a RN-167). A pessoa só aparece para quem gerencia. */
export class StoreOrderView {
  @ApiProperty() id!: string;
  @ApiProperty({ type: OrderItemRef }) item!: OrderItemRef;
  @ApiProperty({ type: OrderPersonRef, nullable: true }) person!: OrderPersonRef | null;
  @ApiProperty({ enum: ORDER_STATUSES }) status!: string;
  @ApiProperty({ enum: ITEM_KINDS }) kind!: string;
  @ApiProperty({ description: 'Custo congelado na hora do pedido' }) cost!: number;
  @ApiProperty({ type: Number, nullable: true }) bonusValue!: number | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Motivo da recusa ou do cancelamento' })
  reason!: string | null;
  @ApiProperty({ type: String, nullable: true }) decidedBy!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) approvedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) closedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) deliveryNote!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) paidOn!: string | null;
  @ApiProperty({ type: String, nullable: true }) paidReference!: string | null;
}

export class OrderPage {
  @ApiProperty({ type: [StoreOrderView] }) items!: StoreOrderView[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}

export class PhotoVersionView {
  @ApiProperty() version!: string;
}
