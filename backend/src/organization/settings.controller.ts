import { Body, Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorBody, parseInput } from '../common/api-error.js';
import {
  AllowBeforeInstall,
  type AuthContext,
  CurrentAuth,
  Public,
  RequirePermission,
  requestMeta,
} from '../identity-access/auth-context.js';
import { deriveBrand } from './brand-color.js';
import {
  BrandingView,
  BrandPreviewRequest,
  BrandPreviewSchema,
  PublicSettingsView,
  SettingItemView,
  UpdateSettingsRequest,
  UpdateSettingsSchema,
} from './settings.dto.js';
import { SettingsAdminService } from './settings-admin.service.js';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsAdminService) {}

  /** Nome da organização, idioma, fuso e política de senha: telas de login, assistente e nova senha. */
  @Get('public')
  @Public()
  @AllowBeforeInstall()
  @ApiOkResponse({ type: PublicSettingsView })
  publicSettings(): Promise<PublicSettingsView> {
    return this.settings.publicSettings();
  }

  @Get()
  @RequirePermission('setting.manage')
  @ApiCookieAuth()
  @ApiOkResponse({ type: [SettingItemView] })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  list(): Promise<SettingItemView[]> {
    return this.settings.list();
  }

  @Patch()
  @RequirePermission('setting.manage')
  @ApiCookieAuth()
  @ApiBody({ type: UpdateSettingsRequest })
  @ApiOkResponse({ type: [SettingItemView] })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description: 'Chave desconhecida ou valor fora da regra (nada é salvo).',
  })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  update(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<SettingItemView[]> {
    return this.settings.update(auth.user.id, requestMeta(req), parseInput(UpdateSettingsSchema, body).values);
  }

  /** Pré-visualização da cor da marca: o mesmo cálculo que vale ao salvar (contraste garantido). */
  @Post('branding/preview')
  @HttpCode(200)
  @RequirePermission('setting.manage')
  @ApiCookieAuth()
  @ApiBody({ type: BrandPreviewRequest })
  @ApiOkResponse({ type: BrandingView })
  preview(@Body() body: unknown): BrandingView {
    const { color, colorDark } = parseInput(BrandPreviewSchema, body);
    return deriveBrand(color?.toLowerCase() ?? null, colorDark?.toLowerCase() ?? null);
  }
}
