import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorBody, apiError, parseInput } from '../common/api-error.js';
import {
  AccessPolicyRequest,
  AccessPolicySchema,
  AccessView,
  ProvisioningRequest,
  ProvisioningSchema,
  SsoModeRequest,
  SsoModeSchema,
  SsoPhotoRequest,
  SsoPhotoSchema,
  SsoProviderRequest,
  SsoProviderSchema,
  SsoTestAddressResult,
} from './access-admin.dto.js';
import { AccessAdminService } from './access-admin.service.js';
import type { AuthContext } from './auth-context.js';
import { CurrentAuth, RequirePermission, requestMeta } from './auth-context.js';
import { isSsoProvider, type SsoProviderId } from './entities/sso-provider.entity.js';

const provider = (raw: string): SsoProviderId => {
  if (!isSsoProvider(raw)) throw apiError(404, 'not_found', 'Provedor desconhecido.');
  return raw;
};

/** Acesso corporativo (M13, RN-95 a RN-98): só para quem tem `sso.manage` (por padrão, o Administrador). */
@ApiTags('access')
@ApiCookieAuth()
@ApiForbiddenResponse({
  type: ApiErrorBody,
  description: 'Sem a permissão sso.manage (por padrão, só o Administrador).',
})
@Controller('admin/access')
@RequirePermission('sso.manage')
export class AccessAdminController {
  constructor(private readonly access: AccessAdminService) {}

  @Get()
  @ApiOkResponse({ type: AccessView })
  view(@CurrentAuth() auth: AuthContext): Promise<AccessView> {
    return this.access.view(auth.user.id);
  }

  @Put('policy')
  @ApiBody({ type: AccessPolicyRequest })
  @ApiOkResponse({ type: AccessView })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Esvaziaria os domínios com o SSO em uso.' })
  updatePolicy(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<AccessView> {
    return this.access.updatePolicy(
      { userId: auth.user.id, meta: requestMeta(req) },
      parseInput(AccessPolicySchema, body),
    );
  }

  @Put('providers/:provider')
  @ApiBody({ type: SsoProviderRequest })
  @ApiOkResponse({ type: AccessView, description: 'O segredo nunca é devolvido; só se está definido.' })
  saveProvider(
    @CurrentAuth() auth: AuthContext,
    @Param('provider') raw: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<AccessView> {
    return this.access.saveProvider(
      { userId: auth.user.id, meta: requestMeta(req) },
      provider(raw),
      parseInput(SsoProviderSchema, body),
    );
  }

  @Post('providers/:provider/test-address')
  @HttpCode(200)
  @ApiOkResponse({ type: SsoTestAddressResult, description: 'Confere o alcance de rede e o endereço do provedor.' })
  testAddress(@Param('provider') raw: string): Promise<SsoTestAddressResult> {
    return this.access.testAddress(provider(raw));
  }

  @Post('providers/:provider/enable')
  @HttpCode(200)
  @ApiOkResponse({ type: AccessView })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Falta algo para ligar (`details.blockers`).' })
  enable(@CurrentAuth() auth: AuthContext, @Param('provider') raw: string, @Req() req: Request): Promise<AccessView> {
    return this.access.setEnabled({ userId: auth.user.id, meta: requestMeta(req) }, provider(raw), true);
  }

  @Post('providers/:provider/disable')
  @HttpCode(200)
  @ApiOkResponse({ type: AccessView })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'É o último provedor ligado e o modo é "Só SSO".' })
  disable(@CurrentAuth() auth: AuthContext, @Param('provider') raw: string, @Req() req: Request): Promise<AccessView> {
    return this.access.setEnabled({ userId: auth.user.id, meta: requestMeta(req) }, provider(raw), false);
  }

  @Put('providers/:provider/photo')
  @ApiOkResponse({ type: AccessView })
  @ApiBody({ type: SsoPhotoRequest })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Provedor ainda não configurado.' })
  setPhoto(
    @CurrentAuth() auth: AuthContext,
    @Param('provider') raw: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<AccessView> {
    const input = parseInput(SsoPhotoSchema, body);
    return this.access.setPhoto({ userId: auth.user.id, meta: requestMeta(req) }, provider(raw), input.enabled);
  }

  @Put('mode')
  @ApiBody({ type: SsoModeRequest })
  @ApiOkResponse({ type: AccessView })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Falta algo para o modo (`details.blockers`).' })
  setMode(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<AccessView> {
    const { mode } = parseInput(SsoModeSchema, body);
    return this.access.setMode({ userId: auth.user.id, meta: requestMeta(req) }, mode);
  }

  @Put('provisioning')
  @ApiBody({ type: ProvisioningRequest })
  @ApiOkResponse({ type: AccessView })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description: 'Perfil administrativo, ou perfil/entidade ausentes.',
  })
  setProvisioning(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<AccessView> {
    return this.access.setProvisioning(
      { userId: auth.user.id, meta: requestMeta(req) },
      parseInput(ProvisioningSchema, body),
    );
  }
}
