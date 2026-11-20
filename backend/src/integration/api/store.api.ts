import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { apiError } from '../../common/api-error.js';
import { getSetting } from '../../organization/settings.service.js';
import { CurrentIntegration, type IntegrationPrincipal } from '../principal.js';
import { bi } from './bilingual.js';
import { IntegrationApi, PageQueryDocs } from './decorators.js';
import { ISO_MICRO_SQL, type KeyRow, pagePredicates, parsePage, SqlParams, sliceRows } from './page.js';

// --- Contrato -----------------------------------------------------------------------------------

export class StoreOrderItemRef {
  @ApiProperty({ format: 'uuid', ...bi('Identifier.', 'Identificador.') }) id!: string;
  @ApiProperty({ example: 'Vale-cultura', ...bi('Item name.', 'Nome do item.') }) name!: string;
  @ApiProperty({
    enum: ['product', 'bonus'],
    ...bi(
      'Product or service, or bonus (informative value).',
      'Produto ou serviço, ou bonificação (valor informativo).',
    ),
  })
  kind!: string;
}

export class StoreOrderPerson {
  @ApiProperty({ format: 'uuid', ...bi('Identifier.', 'Identificador.') }) id!: string;
  @ApiProperty({
    example: 'Maria Souza',
    ...bi('Display name; "Ex-colaborador" when anonymized.', 'Nome de exibição; "Ex-colaborador" quando anonimizada.'),
  })
  name!: string;
  @ApiProperty({
    type: String,
    required: false,
    example: 'maria.souza@empresa.com.br',
    ...bi(
      'E-mail. Present ONLY when the integration has "include e-mail" turned on.',
      'E-mail. Só existe quando a integração tem "incluir e-mail" ligado.',
    ),
  })
  email?: string;
}

export class StoreOrderItem {
  @ApiProperty({ format: 'uuid', ...bi('Order identifier.', 'Identificador do pedido.') }) id!: string;
  @ApiProperty({ type: StoreOrderItemRef, ...bi('The item ordered.', 'O item pedido.') }) item!: StoreOrderItemRef;
  @ApiProperty({ type: StoreOrderPerson, ...bi('Who ordered.', 'Quem pediu.') }) person!: StoreOrderPerson;
  @ApiProperty({
    enum: ['pending', 'approved', 'delivered', 'paid', 'rejected', 'cancelled'],
    ...bi('Order status.', 'Situação do pedido.'),
  })
  status!: string;
  @ApiProperty({
    example: 120,
    ...bi('Cost in points, frozen at order time.', 'Custo em pontos, congelado no pedido.'),
  })
  cost!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 150,
    ...bi(
      'Bonus only: informative value in the installation currency. ITS never pays it.',
      'Só na bonificação: valor informativo na moeda da instalação. O ITS nunca paga.',
    ),
  })
  bonus_value!: number | null;
  @ApiProperty({ example: 'BRL', ...bi('Installation currency.', 'Moeda da instalação.') }) currency!: string;
  @ApiProperty({ type: String, format: 'date-time', ...bi('When it was ordered.', 'Quando foi pedido.') })
  created_at!: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    ...bi('When it was approved.', 'Quando foi aprovado.'),
  })
  approved_at!: string | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    ...bi('When it reached a final status.', 'Quando chegou a uma situação final.'),
  })
  closed_at!: string | null;
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    ...bi('Bonus paid on (informed by HR).', 'Bonificação paga em (informado pelo RH).'),
  })
  paid_on!: string | null;
  @ApiProperty({ type: String, nullable: true, ...bi('Payment reference.', 'Referência do pagamento.') })
  paid_reference!: string | null;
  @ApiProperty({ type: String, format: 'date-time', ...bi('Last change.', 'Última alteração.') }) updated_at!: string;
}

export class StoreOrderPage {
  @ApiProperty({ type: [StoreOrderItem], ...bi('The items of this page.', 'Os itens desta página.') })
  data!: StoreOrderItem[];
  @ApiProperty({
    type: String,
    nullable: true,
    ...bi('Cursor of the next page; null on the last page.', 'Cursor da próxima página; nulo na última.'),
  })
  next_cursor!: string | null;
}

// --- Leitura ------------------------------------------------------------------------------------

@Injectable()
export class StoreReader {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Pedidos da loja (RN-172), da loja inteira (a loja não é de uma entidade). Saldo e extrato nunca
   * saem. O e-mail de quem pediu só com a opção da integração. Loja desligada → 404.
   */
  async list(principal: IntegrationPrincipal, query: unknown): Promise<StoreOrderPage> {
    const m = this.dataSource.manager;
    if (!(await getSetting(m, 'store.enabled'))) throw apiError(404, 'not_found', 'A loja está desligada.');
    const page = parsePage(query);
    const p = new SqlParams();
    const predicates = pagePredicates('x', p, page);
    const rows: KeyRow[] = await m.query(
      `SELECT x.id, x.cur_at FROM (
         SELECT o.id, o.updated_at AS sync_at, ${ISO_MICRO_SQL('o.updated_at')} AS cur_at FROM store_order o
       ) x ${predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''}
       ORDER BY x.sync_at ASC, x.id ASC LIMIT ${p.add(page.limit + 1)}`,
      p.values,
    );
    const { rows: kept, next } = sliceRows(rows, page.limit);
    if (kept.length === 0) return { data: [], next_cursor: null };
    const orders: {
      id: string;
      item_id: string;
      item_name: string;
      item_kind: string;
      user_id: string;
      user_name: string;
      user_email: string;
      user_status: string;
      status: string;
      cost: number;
      bonus_value: string | null;
      created_at: Date;
      approved_at: Date | null;
      closed_at: Date | null;
      paid_on: string | null;
      paid_reference: string | null;
    }[] = await m.query(
      `SELECT o.id, o.item_id, i.name AS item_name, o.item_kind, o.user_id, u.name AS user_name, u.email AS user_email,
              u.status AS user_status, o.status, o.cost, o.bonus_value, o.created_at, o.approved_at, o.closed_at,
              to_char(o.paid_on, 'YYYY-MM-DD') AS paid_on, o.paid_reference
         FROM store_order o JOIN store_item i ON i.id = o.item_id JOIN "user" u ON u.id = o.user_id
        WHERE o.id = ANY($1::uuid[])`,
      [kept.map((r) => r.id)],
    );
    const currency = await getSetting(m, 'results.currency');
    const byId = new Map(orders.map((o) => [o.id, o]));
    const data: StoreOrderItem[] = [];
    for (const row of kept) {
      const o = byId.get(row.id);
      if (!o) continue;
      const anonymized = o.user_status === 'anonymized';
      const person: StoreOrderPerson = { id: o.user_id, name: anonymized ? 'Ex-colaborador' : o.user_name };
      if (principal.includeEmail && !anonymized) person.email = o.user_email;
      data.push({
        id: o.id,
        item: { id: o.item_id, name: o.item_name, kind: o.item_kind },
        person,
        status: o.status,
        cost: Number(o.cost),
        bonus_value: o.bonus_value === null ? null : Number(o.bonus_value),
        currency,
        created_at: new Date(o.created_at).toISOString(),
        approved_at: o.approved_at ? new Date(o.approved_at).toISOString() : null,
        closed_at: o.closed_at ? new Date(o.closed_at).toISOString() : null,
        paid_on: o.paid_on,
        paid_reference: o.paid_reference,
        updated_at: row.cur_at,
      });
    }
    return { data, next_cursor: next };
  }
}

@Controller('integration/v1/store/orders')
@IntegrationApi('store')
export class StoreApiController {
  constructor(private readonly reader: StoreReader) {}

  @Get()
  @ApiOperation({
    summary: 'List store orders (sensitive)',
    ...bi(
      'Store orders of the whole organization (the store is not tied to an entity), for HR to follow without spreadsheets. The e-mail only comes with "include e-mail". Balance and statement never leave ITS.',
      'Pedidos da loja da organização inteira (a loja não é de uma entidade), para o RH acompanhar sem planilha. O e-mail só vem com "incluir e-mail". Saldo e extrato nunca saem do ITS.',
    ),
  })
  @PageQueryDocs()
  @ApiOkResponse({ type: StoreOrderPage })
  list(@CurrentIntegration() principal: IntegrationPrincipal, @Query() query: unknown): Promise<StoreOrderPage> {
    return this.reader.list(principal, query);
  }
}
