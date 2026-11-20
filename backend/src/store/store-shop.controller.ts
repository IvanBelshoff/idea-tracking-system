import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorBody, apiError, parseInput } from '../common/api-error.js';
import { PageQuerySchema } from '../common/pagination.js';
import { AccessService } from '../identity-access/access.service.js';
import { type RequestWithAuth, requestMeta } from '../identity-access/auth-context.js';
import {
  BonusQuerySchema,
  CatalogView,
  DeliverRequest,
  DeliverSchema,
  ItemRequest,
  ItemSchema,
  ItemUpdateSchema,
  OrderPage,
  OrderRequest,
  OrderSchema,
  OrdersQuerySchema,
  PayRequest,
  PaySchema,
  PhotoVersionView,
  ReasonSchema,
  StoreItemView,
  StoreOrderView,
  StoreReasonRequest,
} from './store.dto.js';
import { StoreItemsService } from './store-items.service.js';
import { StoreOrdersService } from './store-orders.service.js';
import { ITEM_PHOTO_MAX_BYTES } from './store-photo.js';
import { ORDER_STATUSES } from './store-rules.js';

const UNPROCESSABLE = 422;
const PAGE = [
  { name: 'page', required: false, type: Number },
  { name: 'pageSize', required: false, type: Number },
] as const;

/** Itens, vitrine e pedidos da loja (M22, RN-163 a RN-167). */
@ApiTags('store')
@ApiCookieAuth()
@Controller('store')
export class StoreShopController {
  constructor(
    private readonly items: StoreItemsService,
    private readonly orders: StoreOrdersService,
    private readonly access: AccessService,
  ) {}

  // --- Vitrine e pedidos de quem troca (RN-164, RN-165) -------------------------------------------

  @Get('catalog')
  @ApiOkResponse({ type: CatalogView, description: 'O saldo e os itens que a pessoa pode ver (RN-164).' })
  async catalog(@Req() req: RequestWithAuth): Promise<CatalogView> {
    return this.items.catalog(await this.access.forRequest(req));
  }

  @Post('orders')
  @ApiBody({ type: OrderRequest })
  @ApiOkResponse({ type: StoreOrderView })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description: '`insufficient_balance`, `out_of_stock` ou `limit_reached`.',
  })
  async place(@Req() req: RequestWithAuth, @Body() body: unknown): Promise<StoreOrderView> {
    const input = parseInput(OrderSchema, body, UNPROCESSABLE);
    return this.orders.place(await this.access.forRequest(req), input.itemId, input.note ?? null);
  }

  @Get('me/orders')
  @ApiQuery(PAGE[0])
  @ApiQuery(PAGE[1])
  @ApiOkResponse({ type: OrderPage })
  async mine(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<OrderPage> {
    return this.orders.mine(await this.access.forRequest(req), parseInput(PageQuerySchema, query));
  }

  @Post('me/orders/:id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: StoreOrderView })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Só enquanto pendente.' })
  async cancelOwn(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<StoreOrderView> {
    return this.orders.cancelOwn(await this.access.forRequest(req), id);
  }

  // --- Itens (RN-163) ----------------------------------------------------------------------------

  @Get('items')
  @ApiOkResponse({ type: [StoreItemView], description: 'Todos os itens, para quem gerencia.' })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  async list(@Req() req: RequestWithAuth): Promise<StoreItemView[]> {
    return this.items.list(await this.access.forRequest(req));
  }

  @Post('items')
  @ApiBody({ type: ItemRequest })
  @ApiOkResponse({ type: StoreItemView })
  async create(@Req() req: RequestWithAuth, @Body() body: unknown): Promise<StoreItemView> {
    return this.items.create(
      await this.access.forRequest(req),
      parseInput(ItemSchema, body, UNPROCESSABLE),
      requestMeta(req),
    );
  }

  @Patch('items/:id')
  @ApiBody({ type: ItemRequest })
  @ApiOkResponse({ type: StoreItemView })
  async update(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<StoreItemView> {
    return this.items.update(
      await this.access.forRequest(req),
      id,
      parseInput(ItemUpdateSchema, body, UNPROCESSABLE),
      requestMeta(req),
    );
  }

  @Delete('items/:id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Excluído (só item sem pedidos).' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Item com pedidos (`item_has_orders`): desative.' })
  async remove(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.items.remove(await this.access.forRequest(req), id, requestMeta(req));
  }

  @Get('items/:id/photo')
  @ApiProduces('image/webp')
  @ApiOkResponse({ description: 'A foto do item (WebP).' })
  async photo(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const data = await this.items.photo(await this.access.forRequest(req), id);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(data);
  }

  @Put('items/:id/photo')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiOkResponse({ type: PhotoVersionView })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ITEM_PHOTO_MAX_BYTES + 1, files: 1 } }))
  async setPhoto(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ): Promise<PhotoVersionView> {
    if (!file) {
      throw apiError(422, 'validation_failed', 'Envie a imagem no campo "file".', [
        { path: 'file', message: 'Escolha uma imagem.' },
      ]);
    }
    return { version: await this.items.setPhoto(await this.access.forRequest(req), id, file.buffer) };
  }

  @Delete('items/:id/photo')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Foto removida.' })
  async removePhoto(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.items.removePhoto(await this.access.forRequest(req), id);
  }

  // --- Fila e decisões de quem gerencia (RN-166, RN-167) -----------------------------------------

  @Get('orders')
  @ApiQuery({ name: 'status', required: false, enum: ORDER_STATUSES })
  @ApiQuery({ name: 'itemId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery(PAGE[0])
  @ApiQuery(PAGE[1])
  @ApiOkResponse({ type: OrderPage })
  async queue(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<OrderPage> {
    return this.orders.queue(await this.access.forRequest(req), parseInput(OrdersQuerySchema, query, UNPROCESSABLE));
  }

  @Post('orders/:id/approve')
  @HttpCode(200)
  @ApiOkResponse({ type: StoreOrderView })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'O próprio pedido (`own_order`).' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'A situação não permite (`invalid_order_status`).' })
  async approve(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<StoreOrderView> {
    return this.orders.decide(await this.access.forRequest(req), id, 'approve', {}, requestMeta(req));
  }

  @Post('orders/:id/reject')
  @HttpCode(200)
  @ApiBody({ type: StoreReasonRequest })
  @ApiOkResponse({ type: StoreOrderView })
  async reject(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<StoreOrderView> {
    const { reason } = parseInput(ReasonSchema, body, UNPROCESSABLE);
    return this.orders.decide(await this.access.forRequest(req), id, 'reject', { reason }, requestMeta(req));
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @ApiBody({ type: StoreReasonRequest })
  @ApiOkResponse({ type: StoreOrderView })
  async cancel(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<StoreOrderView> {
    const { reason } = parseInput(ReasonSchema, body, UNPROCESSABLE);
    return this.orders.decide(await this.access.forRequest(req), id, 'cancel', { reason }, requestMeta(req));
  }

  @Post('orders/:id/deliver')
  @HttpCode(200)
  @ApiBody({ type: DeliverRequest })
  @ApiOkResponse({ type: StoreOrderView })
  async deliver(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<StoreOrderView> {
    const { note } = parseInput(DeliverSchema, body ?? {}, UNPROCESSABLE);
    return this.orders.decide(await this.access.forRequest(req), id, 'deliver', { note }, requestMeta(req));
  }

  @Post('orders/:id/pay')
  @HttpCode(200)
  @ApiBody({ type: PayRequest })
  @ApiOkResponse({ type: StoreOrderView })
  async pay(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<StoreOrderView> {
    const pay = parseInput(PaySchema, body, UNPROCESSABLE);
    return this.orders.decide(await this.access.forRequest(req), id, 'pay', { pay }, requestMeta(req));
  }

  @Get('bonuses')
  @ApiQuery({ name: 'status', required: false, enum: ['approved', 'paid', 'all'] })
  @ApiOkResponse({ type: [StoreOrderView], description: 'Bonificações a pagar (RN-167).' })
  async bonuses(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<StoreOrderView[]> {
    const { status } = parseInput(BonusQuerySchema, query, UNPROCESSABLE);
    return this.orders.bonuses(await this.access.forRequest(req), status);
  }

  @Get('bonuses/export')
  @ApiQuery({ name: 'status', required: false, enum: ['approved', 'paid', 'all'] })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'Bonificações em CSV para o RH (separador `;`).' })
  async exportBonuses(@Req() req: RequestWithAuth, @Query() query: unknown, @Res() res: Response): Promise<void> {
    const { status } = parseInput(BonusQuerySchema, query, UNPROCESSABLE);
    const csv = await this.orders.bonusesCsv(await this.access.forRequest(req), status);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bonificacoes.csv"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }
}
