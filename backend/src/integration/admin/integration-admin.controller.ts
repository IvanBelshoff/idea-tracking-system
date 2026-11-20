import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ApiErrorBody, parseInput } from '../../common/api-error.js';
import type { AuthContext } from '../../identity-access/auth-context.js';
import { CurrentAuth, RequirePermission, requestMeta } from '../../identity-access/auth-context.js';
import {
  IntegrationCreateRequest,
  IntegrationCreateSchema,
  IntegrationEnabledRequest,
  IntegrationEnabledSchema,
  IntegrationModulesRequest,
  IntegrationModulesSchema,
  IntegrationsView,
  IntegrationUpdateRequest,
  IntegrationUpdateSchema,
  IntegrationUsageView,
  IntegrationView,
  IntegrationWithToken,
  TokenRotateRequest,
  TokenRotateSchema,
} from './integration-admin.dto.js';
import { IntegrationAdminService } from './integration-admin.service.js';
import { IntegrationDocsService } from './integration-docs.service.js';

const UsageQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

/** Integrações (M16, RN-102 a RN-116): só para quem tem `integration.manage` (por padrão, o Administrador). */
@ApiTags('integrations-admin')
@ApiCookieAuth()
@ApiForbiddenResponse({
  type: ApiErrorBody,
  description: 'Sem a permissão integration.manage (por padrão, só o Administrador).',
})
@Controller('admin/integrations')
@RequirePermission('integration.manage')
export class IntegrationAdminController {
  constructor(
    private readonly integrations: IntegrationAdminService,
    private readonly docs: IntegrationDocsService,
  ) {}

  private actor(auth: AuthContext, req: Request) {
    return { userId: auth.user.id, meta: requestMeta(req) };
  }

  @Get()
  @ApiOkResponse({ type: IntegrationsView })
  view(): Promise<IntegrationsView> {
    return this.integrations.view();
  }

  @Get('openapi')
  @ApiQuery({ name: 'integration', required: false, description: 'Mostra só os módulos desta integração' })
  @ApiOkResponse({ description: 'O contrato da API de integração (OpenAPI), só dos módulos ligados.' })
  openapi(@Query('integration') integration?: string): Promise<object> {
    return this.docs.contract(integration);
  }

  @Put('enabled')
  @ApiBody({ type: IntegrationEnabledRequest })
  @ApiOkResponse({ type: IntegrationsView })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Falta o endereço do sistema em HTTPS.' })
  setEnabled(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<IntegrationsView> {
    const { enabled } = parseInput(IntegrationEnabledSchema, body, 422);
    return this.integrations.setEnabled(this.actor(auth, req), enabled);
  }

  @Put('modules')
  @ApiBody({ type: IntegrationModulesRequest })
  @ApiOkResponse({ type: IntegrationsView })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Módulo desconhecido.' })
  setModules(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<IntegrationsView> {
    const { modules } = parseInput(IntegrationModulesSchema, body, 422);
    return this.integrations.setModules(this.actor(auth, req), modules);
  }

  @Post()
  @ApiBody({ type: IntegrationCreateRequest })
  @ApiOkResponse({ type: IntegrationWithToken, description: 'O token vem aqui, uma única vez.' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Já existe uma integração com este nome.' })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description: 'Dado inválido, módulo desligado ou validade fora do limite.',
  })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<IntegrationWithToken> {
    return this.integrations.create(this.actor(auth, req), parseInput(IntegrationCreateSchema, body, 422));
  }

  @Put(':id')
  @ApiBody({ type: IntegrationUpdateRequest })
  @ApiOkResponse({ type: IntegrationView })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Nome repetido ou integração revogada.' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<IntegrationView> {
    return this.integrations.update(this.actor(auth, req), id, parseInput(IntegrationUpdateSchema, body, 422));
  }

  @Get(':id/usage')
  @ApiQuery({ name: 'days', required: false, description: 'Quantos dias de histórico (1 a 90; padrão 7)' })
  @ApiOkResponse({ type: IntegrationUsageView })
  usage(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<IntegrationUsageView> {
    return this.integrations.usageOf(id, parseInput(UsageQuery, query, 422).days);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOkResponse({ type: IntegrationView })
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<IntegrationView> {
    return this.integrations.suspend(this.actor(auth, req), id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOkResponse({ type: IntegrationView })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Integração revogada não volta.' })
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<IntegrationView> {
    return this.integrations.reactivate(this.actor(auth, req), id);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOkResponse({ type: IntegrationView, description: 'Definitivo: os tokens morrem.' })
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<IntegrationView> {
    return this.integrations.revoke(this.actor(auth, req), id);
  }

  @Post(':id/tokens')
  @HttpCode(200)
  @ApiBody({ type: TokenRotateRequest })
  @ApiOkResponse({ type: IntegrationWithToken, description: 'O token novo vem aqui, uma única vez.' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'A integração já tem 2 tokens ativos.' })
  rotate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<IntegrationWithToken> {
    return this.integrations.rotate(this.actor(auth, req), id, parseInput(TokenRotateSchema, body, 422));
  }

  @Post(':id/tokens/:tokenId/revoke')
  @HttpCode(200)
  @ApiOkResponse({ type: IntegrationView })
  revokeToken(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @Req() req: Request,
  ): Promise<IntegrationView> {
    return this.integrations.revokeToken(this.actor(auth, req), id, tokenId);
  }
}
