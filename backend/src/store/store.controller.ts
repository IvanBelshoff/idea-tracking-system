import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorBody, parseInput } from '../common/api-error.js';
import { PageQuerySchema } from '../common/pagination.js';
import { AccessService } from '../identity-access/access.service.js';
import { type RequestWithAuth, requestMeta } from '../identity-access/auth-context.js';
import {
  AccountListPage,
  AccountsQuerySchema,
  AdjustmentRequest,
  AdjustmentSchema,
  LedgerPage,
  StoreAccountView,
} from './store.dto.js';
import { StoreService } from './store.service.js';

const UNPROCESSABLE = 422;
const PAGE = [
  { name: 'page', required: false, type: Number },
  { name: 'pageSize', required: false, type: Number },
] as const;

/** Loja (M22, RN-159 a RN-173). Com a loja desligada, tudo responde 404. */
@ApiTags('store')
@ApiCookieAuth()
@Controller('store')
export class StoreController {
  constructor(
    private readonly store: StoreService,
    private readonly access: AccessService,
  ) {}

  @Get('me')
  @ApiOkResponse({ type: StoreAccountView, description: 'O próprio saldo (RN-160).' })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Loja desligada.' })
  async me(@Req() req: RequestWithAuth): Promise<StoreAccountView> {
    return this.store.me(await this.access.forRequest(req));
  }

  @Get('me/ledger')
  @ApiQuery(PAGE[0])
  @ApiQuery(PAGE[1])
  @ApiOkResponse({ type: LedgerPage, description: 'O próprio extrato, do mais novo para o mais antigo.' })
  async myLedger(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<LedgerPage> {
    return this.store.myLedger(await this.access.forRequest(req), parseInput(PageQuerySchema, query));
  }

  @Get('accounts')
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery(PAGE[0])
  @ApiQuery(PAGE[1])
  @ApiOkResponse({ type: AccountListPage, description: 'Pessoas e saldos (store.manage).' })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  async accounts(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<AccountListPage> {
    return this.store.accounts(await this.access.forRequest(req), parseInput(AccountsQuerySchema, query));
  }

  @Get('accounts/:userId')
  @ApiOkResponse({ type: StoreAccountView })
  async accountOf(
    @Req() req: RequestWithAuth,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<StoreAccountView> {
    return this.store.accountOf(await this.access.forRequest(req), userId);
  }

  @Get('accounts/:userId/ledger')
  @ApiQuery(PAGE[0])
  @ApiQuery(PAGE[1])
  @ApiOkResponse({ type: LedgerPage })
  async ledgerOf(
    @Req() req: RequestWithAuth,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: unknown,
  ): Promise<LedgerPage> {
    return this.store.ledgerOf(await this.access.forRequest(req), userId, parseInput(PageQuerySchema, query));
  }

  @Post('adjustments')
  @HttpCode(200)
  @ApiBody({ type: AdjustmentRequest })
  @ApiOkResponse({ type: StoreAccountView, description: 'O saldo da pessoa depois do ajuste (RN-168).' })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Sem store.manage ou o próprio saldo (`own_account`).' })
  async adjust(@Req() req: RequestWithAuth, @Body() body: unknown): Promise<StoreAccountView> {
    return this.store.adjust(
      await this.access.forRequest(req),
      parseInput(AdjustmentSchema, body, UNPROCESSABLE),
      requestMeta(req),
    );
  }
}
