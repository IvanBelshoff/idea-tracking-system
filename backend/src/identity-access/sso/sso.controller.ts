import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiFoundResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { apiError } from '../../common/api-error.js';
import { hoursToMs } from '../../common/dates.js';
import { PtBrLogger } from '../../common/pt-br-logger.js';
import { RateLimiter } from '../../common/rate-limit.js';
import { AccessService } from '../access.service.js';
import { Public, type RequestWithAuth, requestMeta } from '../auth-context.js';
import { isSsoProvider, type SsoProviderId } from '../entities/sso-provider.entity.js';
import { setSessionCookie } from '../session-cookie.js';
import { SsoService } from './sso.service.js';
import { SsoError, type SsoErrorCode } from './sso-errors.js';
import { clearFlowCookie, readFlowCookie, safeBackPath, writeFlowCookie } from './sso-state.js';

const logger = new PtBrLogger('LoginCorporativo');

/** Requisições por minuto e por IP no início e no retorno do login corporativo. */
export const SSO_RATE_LIMIT = 300;

/** Início e retorno do login corporativo (M13). Rotas públicas: quem chega ainda não tem sessão. */
@ApiTags('auth')
@Controller('auth/sso')
export class SsoController {
  /**
   * Início e retorno por IP (CA-RN-96.12). O limite é folgado de propósito: uma empresa inteira sai por
   * um IP só (NAT) e o expediente começa junto. Barra varredura e inundação, não uso normal.
   */
  private readonly limiter = new RateLimiter(SSO_RATE_LIMIT, 60_000);

  constructor(
    private readonly sso: SsoService,
    private readonly access: AccessService,
  ) {}

  private provider(raw: string): SsoProviderId {
    if (!isSsoProvider(raw)) throw apiError(404, 'not_found', 'Provedor desconhecido.');
    return raw;
  }

  private text(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  /** Volta à tela de entrada (ou à de acesso corporativo, no teste) com só o código do erro. */
  private fail(res: Response, code: SsoErrorCode, test: boolean, provider?: SsoProviderId): void {
    if (test) {
      res.redirect(302, `/admin/acesso?teste=erro&provedor=${provider ?? ''}&motivo=${code}`);
      return;
    }
    res.redirect(302, `/entrar?sso_erro=${code}`);
  }

  @Get(':provider/start')
  @Public()
  @ApiQuery({ name: 'voltar', required: false, description: 'Caminho interno para onde voltar depois de entrar.' })
  @ApiQuery({ name: 'teste', required: false, description: '1 = teste de conexão do administrador logado.' })
  @ApiFoundResponse({ description: 'Redireciona para o provedor (ou para /entrar com o erro).' })
  async start(
    @Param('provider') raw: string,
    @Query('voltar') voltar: unknown,
    @Query('teste') teste: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const id = this.provider(raw);
    this.limiter.hit(req.ip ?? 'desconhecido');
    const test = teste === '1';
    let actorId: string | null = null;
    if (test) {
      const authed = (req as RequestWithAuth).auth;
      if (!authed) throw apiError(401, 'unauthenticated', 'Sessão ausente ou expirada. Entre novamente.');
      const access = await this.access.forRequest(req as RequestWithAuth);
      if (!access.has('sso.manage')) throw apiError(403, 'forbidden', 'Você não tem permissão para esta ação.');
      actorId = authed.user.id;
    }
    try {
      const { url, flow } = await this.sso.start(id, { back: safeBackPath(voltar), test, actorId });
      writeFlowCookie(req, res, flow);
      res.redirect(302, url);
    } catch (e) {
      if (!(e instanceof SsoError)) throw e;
      // "Não configurado" é um estado esperado (provedor desligado); só o inesperado vai ao log.
      if (e.code !== 'sso_not_configured')
        logger.warn(`Início do login corporativo recusado (${id}): ${e.code}. ${e.message}`);
      this.fail(res, e.code, test, id);
    }
  }

  @Get(':provider/callback')
  @Public()
  @ApiFoundResponse({ description: 'Termina o login (cookie de sessão) e redireciona; erro volta a /entrar.' })
  async callback(
    @Param('provider') raw: string,
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Query('error') error: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const id = this.provider(raw);
    this.limiter.hit(req.ip ?? 'desconhecido');
    const flow = readFlowCookie(req, id);
    const test = flow?.test === true;
    clearFlowCookie(req, res); // uso único: um retorno repetido não vale
    try {
      const result = await this.sso.callback(
        id,
        { code: this.text(code), state: this.text(state), error: this.text(error) },
        flow,
        requestMeta(req),
        (req as RequestWithAuth).auth?.user.id ?? null,
      );
      if (result.kind === 'test') {
        const params = result.ok
          ? `teste=ok&provedor=${id}&vinculado=${result.linked ? 1 : 0}`
          : `teste=erro&provedor=${id}&motivo=${result.error}`;
        res.redirect(302, `/admin/acesso?${params}`);
        return;
      }
      setSessionCookie(req, res, result.token, hoursToMs(result.hours));
      res.redirect(302, result.back);
    } catch (e) {
      if (!(e instanceof SsoError)) throw e;
      this.fail(res, e.code, test, id);
    }
  }
}
