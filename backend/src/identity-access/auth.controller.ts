import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import { ApiErrorBody, apiError, parseInput } from '../common/api-error.js';
import { hoursToMs } from '../common/dates.js';
import { ForgotPasswordRequest, ForgotPasswordSchema } from '../communication/communication.dto.js';
import { deriveBrand } from '../organization/brand-color.js';
import { BRAND_FONTS, type BrandFont } from '../organization/settings.js';
import { SettingsService } from '../organization/settings.service.js';
import { USER_THEME_COLORS, userBrand } from '../organization/user-theme.js';
import { missingRequired } from '../user-fields/profile.js';
import { AccessService } from './access.service.js';
import { AuthService } from './auth.service.js';
import {
  AllowBeforeInstall,
  AllowIncompleteProfile,
  type AuthContext,
  CurrentAuth,
  Public,
  requestMeta,
} from './auth-context.js';
import { AvatarService } from './avatar.service.js';
import {
  type AppearanceView,
  ChangePasswordRequest,
  ChangePasswordSchema,
  InstallRequest,
  InstallSchema,
  InstallStatusResponse,
  LoginRequest,
  LoginSchema,
  MeResponse,
  NO_APPEARANCE,
  PreferencesRequest,
  PreferencesSchema,
  RedeemResetRequest,
  RedeemResetSchema,
} from './dto.js';
import type { User } from './entities/user.entity.js';
import { InstallService } from './install.service.js';
import { ALL_PERMISSIONS } from './permissions.js';
import { clearSessionCookie, setSessionCookie } from './session-cookie.js';

@ApiTags('install')
@Controller('install')
@Public()
@AllowBeforeInstall()
export class InstallController {
  constructor(private readonly install: InstallService) {}

  @Get('status')
  @ApiOkResponse({ type: InstallStatusResponse, description: 'Se o assistente de instalação já foi concluído.' })
  async status(): Promise<InstallStatusResponse> {
    return { installed: await this.install.isInstalled() };
  }

  @Post()
  @ApiBody({ type: InstallRequest })
  @ApiOkResponse({ type: MeResponse, description: 'Instalado; o administrador já fica com a sessão aberta.' })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Já instalado: o assistente não existe mais (RN-43).' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Senha fora da política.' })
  @HttpCode(200)
  async run(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const input = parseInput(InstallSchema, body);
    const { token, user, hours } = await this.install.install(input, requestMeta(req));
    setSessionCookie(req, res, token, hoursToMs(hours));
    return MeResponse.from(user, ALL_PERMISSIONS); // o primeiro usuário é Administrador na raiz
  }
}

@ApiTags('auth')
@Controller('auth')
@AllowIncompleteProfile()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly avatars: AvatarService,
    private readonly settings: SettingsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Cor e fonte da própria tela (RN-145): valem só com a chave da organização ligada. */
  private async appearance(user: User): Promise<AppearanceView> {
    if (!(await this.settings.get('branding.user_theme'))) return NO_APPEARANCE;
    const brand = userBrand(user.uiColor);
    return {
      allowed: true,
      color: brand ? user.uiColor : null,
      font: user.uiFont && (BRAND_FONTS as readonly string[]).includes(user.uiFont) ? (user.uiFont as BrandFont) : null,
      branding: brand,
      palette: USER_THEME_COLORS.map((c) => {
        const d = deriveBrand(c.hex);
        return { key: c.key, light: d.light, dark: d.dark };
      }),
    };
  }

  private async meOf(user: User): Promise<MeResponse> {
    return MeResponse.from(
      user,
      (await this.access.load(user.id)).permissions(),
      await this.avatars.versionOf(user.id),
      await this.appearance(user),
      (await missingRequired(this.dataSource.manager, user.id)).length,
    );
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiBody({ type: LoginRequest })
  @ApiOkResponse({ type: MeResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorBody, description: 'Credenciais inválidas (mensagem única, CA-RN-42.2).' })
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const { email, password } = parseInput(LoginSchema, body);
    const { token, user, hours } = await this.auth.login(email, password, requestMeta(req));
    setSessionCookie(req, res, token, hoursToMs(hours));
    return this.meOf(user);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiNoContentResponse({ description: 'Sessão encerrada.' })
  async logout(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(auth.user.id, auth.sessionId, requestMeta(req));
    clearSessionCookie(req, res);
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOkResponse({ type: MeResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorBody })
  async me(@CurrentAuth() auth: AuthContext): Promise<MeResponse> {
    return this.meOf(auth.user);
  }

  /** Preferências de interface da própria conta: idioma, tema e menu recolhido. */
  @Patch('me/preferences')
  @ApiCookieAuth()
  @ApiBody({ type: PreferencesRequest })
  @ApiOkResponse({ type: MeResponse })
  @ApiBadRequestResponse({ type: ApiErrorBody })
  async preferences(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<MeResponse> {
    const prefs = parseInput(PreferencesSchema, body);
    if (
      (prefs.uiColor !== undefined || prefs.uiFont !== undefined) &&
      !(await this.settings.get('branding.user_theme'))
    ) {
      throw apiError(403, 'user_theme_disabled', 'A organização não liberou a escolha de cor e fonte.');
    }
    return this.meOf(await this.auth.updatePreferences(auth.user.id, prefs));
  }

  @Post('password')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiBody({ type: ChangePasswordRequest })
  @ApiNoContentResponse({ description: 'Senha trocada; as outras sessões foram encerradas.' })
  @ApiBadRequestResponse({ type: ApiErrorBody })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  async changePassword(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request) {
    const { currentPassword, newPassword } = parseInput(ChangePasswordSchema, body);
    await this.auth.changePassword(auth.user.id, auth.sessionId, currentPassword, newPassword, requestMeta(req));
  }

  @Post('password-reset/request')
  @Public()
  @HttpCode(202)
  @ApiBody({ type: ForgotPasswordRequest })
  @ApiAcceptedResponse({
    description: 'Sempre a mesma resposta. Se a conta existir e o e-mail estiver ligado, o link segue por e-mail.',
  })
  async requestReset(@Body() body: unknown, @Req() req: Request): Promise<void> {
    const { email } = parseInput(ForgotPasswordSchema, body);
    await this.auth.requestPasswordResetByEmail(email, requestMeta(req));
  }

  @Post('password-reset/redeem')
  @Public()
  @HttpCode(204)
  @ApiBody({ type: RedeemResetRequest })
  @ApiNoContentResponse({ description: 'Nova senha definida; todas as sessões foram encerradas.' })
  @ApiBadRequestResponse({ type: ApiErrorBody, description: 'Link inválido, já usado ou expirado.' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  async redeemReset(@Body() body: unknown, @Req() req: Request) {
    const { token, newPassword } = parseInput(RedeemResetSchema, body);
    await this.auth.redeemPasswordReset(token, newPassword, requestMeta(req));
  }
}
