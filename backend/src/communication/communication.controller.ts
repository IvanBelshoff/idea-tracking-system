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
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorBody, parseInput } from '../common/api-error.js';
import { type AuthContext, CurrentAuth, RequirePermission, requestMeta } from '../identity-access/auth-context.js';
import {
  EmailLogPage,
  EmailLogQuerySchema,
  NotificationPage,
  NotificationPreferencesRequest,
  NotificationPreferencesView,
  NotificationQuerySchema,
  PreferencesUpdateSchema,
  ProviderRequest,
  ProviderSchema,
  ProviderView,
  TemplateRequest,
  TemplateSchema,
  TemplateView,
  TestEmailRequest,
  TestEmailResult,
  TestEmailSchema,
  UnreadCountView,
} from './communication.dto.js';
import { EmailAdminService } from './email-admin.service.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@ApiCookieAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiQuery({ name: 'unread', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: NotificationPage })
  list(@CurrentAuth() auth: AuthContext, @Query() query: unknown): Promise<NotificationPage> {
    return this.notifications.list(auth.user.id, parseInput(NotificationQuerySchema, query));
  }

  @Get('unread-count')
  @ApiOkResponse({ type: UnreadCountView })
  async unreadCount(@CurrentAuth() auth: AuthContext): Promise<UnreadCountView> {
    return { count: await this.notifications.unreadCount(auth.user.id) };
  }

  @Post('read-all')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Todas marcadas como lidas.' })
  markAllRead(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.notifications.markAllRead(auth.user.id);
  }

  @Post(':id/read')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Marcada como lida.' })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Não existe ou é de outra pessoa.' })
  markRead(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.notifications.markRead(auth.user.id, id);
  }

  @Get('preferences')
  @ApiOkResponse({ type: NotificationPreferencesView })
  preferences(@CurrentAuth() auth: AuthContext): Promise<NotificationPreferencesView> {
    return this.notifications.preferences(auth.user.id);
  }

  @Put('preferences')
  @ApiBody({ type: NotificationPreferencesRequest })
  @ApiOkResponse({ type: NotificationPreferencesView })
  updatePreferences(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<NotificationPreferencesView> {
    return this.notifications.updatePreferences(auth.user.id, parseInput(PreferencesUpdateSchema, body));
  }
}

@ApiTags('email')
@ApiCookieAuth()
@ApiForbiddenResponse({
  type: ApiErrorBody,
  description: 'Sem a permissão email.manage (por padrão, só o Administrador).',
})
@Controller('admin/email')
@RequirePermission('email.manage')
export class EmailAdminController {
  constructor(private readonly email: EmailAdminService) {}

  @Get('provider')
  @ApiOkResponse({ type: ProviderView, description: 'Configuração atual, sem a senha (CA-RN-90.3).' })
  provider(): Promise<ProviderView> {
    return this.email.provider();
  }

  @Put('provider')
  @ApiBody({ type: ProviderRequest })
  @ApiOkResponse({ type: ProviderView, description: 'Gravado; o envio fica desligado até um novo teste.' })
  @ApiServiceUnavailableResponse({ type: ApiErrorBody, description: 'APP_SECRET_KEY não definida no servidor.' })
  saveProvider(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<ProviderView> {
    return this.email.saveProvider({ userId: auth.user.id, meta: requestMeta(req) }, parseInput(ProviderSchema, body));
  }

  @Post('provider/test')
  @HttpCode(200)
  @ApiBody({ type: TestEmailRequest })
  @ApiOkResponse({ type: TestEmailResult, description: 'Resultado do envio; a falha traz o motivo, sem a senha.' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Provedor ainda não cadastrado.' })
  test(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<TestEmailResult> {
    const { to } = parseInput(TestEmailSchema, body);
    return this.email.sendTest({ userId: auth.user.id, meta: requestMeta(req) }, to);
  }

  @Post('provider/activate')
  @HttpCode(200)
  @ApiOkResponse({ type: ProviderView })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Sem teste bem-sucedido ou sem o endereço do sistema.' })
  activate(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<ProviderView> {
    return this.email.activate({ userId: auth.user.id, meta: requestMeta(req) });
  }

  @Post('provider/deactivate')
  @HttpCode(200)
  @ApiOkResponse({ type: ProviderView })
  deactivate(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<ProviderView> {
    return this.email.deactivate({ userId: auth.user.id, meta: requestMeta(req) });
  }

  @Get('templates')
  @ApiOkResponse({ type: [TemplateView] })
  templates(): Promise<TemplateView[]> {
    return this.email.templates();
  }

  @Put('templates/:key/:locale')
  @ApiBody({ type: TemplateRequest })
  @ApiOkResponse({ type: [TemplateView] })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Variável que o modelo não conhece.' })
  saveTemplate(
    @CurrentAuth() auth: AuthContext,
    @Param('key') key: string,
    @Param('locale') locale: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<TemplateView[]> {
    return this.email.saveTemplate(
      { userId: auth.user.id, meta: requestMeta(req) },
      key,
      locale,
      parseInput(TemplateSchema, body, 422),
    );
  }

  @Delete('templates/:key/:locale')
  @ApiOkResponse({ type: [TemplateView], description: 'Voltou ao texto de fábrica.' })
  resetTemplate(
    @CurrentAuth() auth: AuthContext,
    @Param('key') key: string,
    @Param('locale') locale: string,
    @Req() req: Request,
  ): Promise<TemplateView[]> {
    return this.email.resetTemplate({ userId: auth.user.id, meta: requestMeta(req) }, key, locale);
  }

  @Get('log')
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'sent', 'failed'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: EmailLogPage })
  log(@Query() query: unknown): Promise<EmailLogPage> {
    return this.email.log(parseInput(EmailLogQuerySchema, query));
  }

  @Post('log/:id/retry')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Voltou para a fila de envio.' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'O envio não está com falha.' })
  retry(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request): Promise<void> {
    return this.email.retry({ userId: auth.user.id, meta: requestMeta(req) }, id);
  }
}
