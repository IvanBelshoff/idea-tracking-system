import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ApiErrorBody, parseInput } from '../../../common/api-error.js';
import type { AuthContext } from '../../../identity-access/auth-context.js';
import { CurrentAuth, RequirePermission, requestMeta } from '../../../identity-access/auth-context.js';
import {
  DestinationsRequest,
  DestinationsSchema,
  SecretRotateRequest,
  SecretRotateSchema,
  SubscriptionCreateRequest,
  SubscriptionCreateSchema,
  SubscriptionUpdateRequest,
  SubscriptionUpdateSchema,
  WebhookDeliveryView,
  WebhookPingResult,
  WebhookSubscriptionView,
  WebhooksEnabledRequest,
  WebhooksEnabledSchema,
  WebhooksView,
  WebhookWithSecret,
} from './webhooks-admin.dto.js';
import { WebhooksAdminService } from './webhooks-admin.service.js';

const DeliveriesQuery = z.object({
  state: z.enum(['pending', 'delivered', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Webhooks de saída (M17, RN-117 a RN-125): só para quem tem `integration.manage` (por padrão, o Administrador). */
@ApiTags('webhooks-admin')
@ApiCookieAuth()
@ApiForbiddenResponse({
  type: ApiErrorBody,
  description: 'Sem a permissão integration.manage (por padrão, só o Administrador).',
})
@Controller('admin/webhooks')
@RequirePermission('integration.manage')
export class WebhooksAdminController {
  constructor(private readonly webhooks: WebhooksAdminService) {}

  private actor(auth: AuthContext, req: Request) {
    return { userId: auth.user.id, meta: requestMeta(req) };
  }

  @Get()
  @ApiOkResponse({ type: WebhooksView })
  view(): Promise<WebhooksView> {
    return this.webhooks.view();
  }

  @Put('enabled')
  @ApiBody({ type: WebhooksEnabledRequest })
  @ApiOkResponse({ type: WebhooksView })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description: 'A chave geral da API de integração está desligada.',
  })
  setEnabled(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<WebhooksView> {
    const { enabled } = parseInput(WebhooksEnabledSchema, body, 422);
    return this.webhooks.setEnabled(this.actor(auth, req), enabled);
  }

  @Put('destinations')
  @ApiBody({ type: DestinationsRequest })
  @ApiOkResponse({ type: WebhooksView })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Destino inválido ou mais de 50.' })
  setDestinations(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<WebhooksView> {
    const { destinations } = parseInput(DestinationsSchema, body, 422);
    return this.webhooks.setDestinations(this.actor(auth, req), destinations);
  }

  @Post()
  @ApiBody({ type: SubscriptionCreateRequest })
  @ApiOkResponse({ type: WebhookWithSecret, description: 'O segredo vem aqui, uma única vez.' })
  @ApiConflictResponse({
    type: ApiErrorBody,
    description: 'Nome repetido ou integração revogada.',
  })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description:
      'Endereço fora da lista ou bloqueado, evento de módulo que a integração não tem, ou validade fora do limite.',
  })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<WebhookWithSecret> {
    return this.webhooks.create(this.actor(auth, req), parseInput(SubscriptionCreateSchema, body, 422));
  }

  @Put(':id')
  @ApiBody({ type: SubscriptionUpdateRequest })
  @ApiOkResponse({ type: WebhookSubscriptionView })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Nome repetido ou integração revogada.' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<WebhookSubscriptionView> {
    return this.webhooks.update(this.actor(auth, req), id, parseInput(SubscriptionUpdateSchema, body, 422));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Assinatura removida, com o registro de entregas.' })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request): Promise<void> {
    return this.webhooks.remove(this.actor(auth, req), id);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOkResponse({ type: WebhookSubscriptionView })
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<WebhookSubscriptionView> {
    return this.webhooks.suspend(this.actor(auth, req), id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOkResponse({
    type: WebhookSubscriptionView,
    description: 'Reativa também a suspensa por falhas (zera a contagem).',
  })
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<WebhookSubscriptionView> {
    return this.webhooks.reactivate(this.actor(auth, req), id);
  }

  @Post(':id/secrets')
  @HttpCode(200)
  @ApiBody({ type: SecretRotateRequest })
  @ApiOkResponse({ type: WebhookWithSecret, description: 'O segredo novo vem aqui, uma única vez.' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'A assinatura já tem 2 segredos ativos.' })
  rotateSecret(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<WebhookWithSecret> {
    return this.webhooks.rotateSecret(this.actor(auth, req), id, parseInput(SecretRotateSchema, body, 422));
  }

  @Post(':id/secrets/:secretId/revoke')
  @HttpCode(200)
  @ApiOkResponse({ type: WebhookSubscriptionView })
  revokeSecret(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('secretId', ParseUUIDPipe) secretId: string,
    @Req() req: Request,
  ): Promise<WebhookSubscriptionView> {
    return this.webhooks.revokeSecret(this.actor(auth, req), id, secretId);
  }

  @Get(':id/deliveries')
  @ApiQuery({ name: 'state', required: false, enum: ['pending', 'delivered', 'failed'] })
  @ApiQuery({ name: 'limit', required: false, description: '1 a 200; padrão 50' })
  @ApiOkResponse({ type: [WebhookDeliveryView] })
  deliveries(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<WebhookDeliveryView[]> {
    const { state, limit } = parseInput(DeliveriesQuery, query, 422);
    return this.webhooks.deliveries(id, state, limit);
  }

  @Post(':id/deliveries/:deliveryId/resend')
  @HttpCode(200)
  @ApiOkResponse({ type: WebhookDeliveryView, description: 'A entrega volta para pendente.' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Só uma entrega com falha pode ser reenviada.' })
  resend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
    @Req() req: Request,
  ): Promise<WebhookDeliveryView> {
    return this.webhooks.resend(this.actor(auth, req), id, deliveryId);
  }

  @Post(':id/ping')
  @HttpCode(200)
  @ApiOkResponse({ type: WebhookPingResult, description: 'Envia o evento de teste agora e mostra o resultado.' })
  ping(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<WebhookPingResult> {
    return this.webhooks.ping(this.actor(auth, req), id);
  }
}
