import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { apiError } from '../common/api-error.js';
import { RateLimiter } from '../common/rate-limit.js';
import { SettingsService } from '../organization/settings.service.js';
import { IntegrationAuthService } from './integration-auth.service.js';
import { IntegrationUsageService } from './integration-usage.service.js';
import { INTEGRATION_LIMITS, type IntegrationModuleId } from './modules.js';
import { INTEGRATION_MODULE_KEY, type RequestWithIntegration } from './principal.js';
import { WindowCounter } from './rate-window.js';
import { parseBearer } from './token-rules.js';

const notFound = () => apiError(404, 'not_found', 'Recurso não encontrado.');
/** O MESMO 401 para qualquer falha de autenticação (RN-104): nunca se diz o motivo. */
const unauthenticated = () => apiError(401, 'unauthenticated', 'Token ausente ou inválido.');

/**
 * Porta da API de integração (RN-102 a RN-105), nesta ordem:
 * limite de tentativas inválidas por IP → chave geral → token (pelo hash) → limite da integração
 * → módulo ligado (404) → módulo da integração (403) → escopo. As rotas são `@Public()` para o
 * `SessionGuard` global (feito para pessoas, com cookie); o cookie nunca vale aqui.
 */
@Injectable()
export class IntegrationGuard implements CanActivate {
  /** Tentativas com token inválido por IP (RN-105): só as que falham contam. */
  private readonly invalidByIp = new RateLimiter(INTEGRATION_LIMITS.invalidPerIpPerMinute, 60_000);
  private readonly perIntegration = new WindowCounter();
  /** Só as chamadas de escrita, por integração: fixo em 30 por minuto (M18, RN-134). */
  private readonly writes = new WindowCounter();

  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
    private readonly auth: IntegrationAuthService,
    private readonly usage: IntegrationUsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithIntegration>();
    const res = http.getResponse<Response>();
    const ip = req.ip ?? 'desconhecido';

    try {
      this.invalidByIp.check(ip);
    } catch (error) {
      this.retryAfter(res, error);
      throw error;
    }

    const cfg = await this.settings.getMany(['integration.enabled', 'integration.modules']);
    if (!cfg['integration.enabled']) throw notFound();

    const now = new Date();
    const token = parseBearer(req.get('authorization'));
    const found = token ? await this.auth.authenticate(token, req.ip, now) : null;
    if (!found) {
      this.invalidByIp.record(ip);
      res.setHeader('WWW-Authenticate', 'Bearer');
      throw unauthenticated();
    }
    const { integration, token: tokenRow } = found;

    const module = this.reflector.getAllAndOverride<IntegrationModuleId | undefined>(INTEGRATION_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Conta a resposta (qualquer status) no consumo da integração e do módulo (RN-113).
    if (module) res.once('finish', () => this.usage.record(integration.id, module, res.statusCode));

    // Limite por integração (RN-105): os cabeçalhos vão em toda resposta autenticada.
    const decision = this.perIntegration.take(integration.id, integration.ratePerMinute);
    res.setHeader('X-RateLimit-Limit', String(decision.limit));
    res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfter));
      throw apiError(429, 'too_many_requests', 'Limite de chamadas por minuto atingido.', {
        retryAfter: decision.retryAfter,
      });
    }

    if (module) {
      if (!cfg['integration.modules'].includes(module)) throw notFound();
      if (!integration.modules.includes(module)) {
        throw apiError(403, 'module_not_allowed', 'Esta integração não tem acesso a este módulo.');
      }
    }

    // A escrita tem limite próprio, além do geral (RN-134); a leitura não gasta esse limite.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const write = this.writes.take(integration.id, INTEGRATION_LIMITS.writePerMinute);
      if (!write.allowed) {
        res.setHeader('Retry-After', String(write.retryAfter));
        throw apiError(429, 'too_many_writes', 'Limite de chamadas de escrita por minuto atingido.', {
          retryAfter: write.retryAfter,
        });
      }
    }

    await this.auth.touch(tokenRow.id, now);
    req.integration = {
      id: integration.id,
      name: integration.name,
      modules: integration.modules,
      includeEmail: integration.includeEmail,
      ratePerMinute: integration.ratePerMinute,
      tokenId: tokenRow.id,
      scopeEntityIds: await this.auth.scopeEntityIds(integration.id),
    };
    return true;
  }

  private retryAfter(res: Response, error: unknown): void {
    const seconds = (error as { retryAfter?: number }).retryAfter;
    if (seconds) res.setHeader('Retry-After', String(seconds));
  }
}
