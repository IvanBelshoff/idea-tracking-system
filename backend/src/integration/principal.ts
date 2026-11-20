import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { IntegrationModuleId } from './modules.js';

/** Quem está chamando a API de integração: preenchido pelo `IntegrationGuard` (RN-104). */
export interface IntegrationPrincipal {
  id: string;
  name: string;
  /** Módulos que a integração pode usar (já interseccionados com os ligados na checagem de cada rota). */
  modules: IntegrationModuleId[];
  includeEmail: boolean;
  ratePerMinute: number;
  tokenId: string;
  /** Entidades do escopo, já expandidas com as subentidades (RN-103). Vazio = não enxerga nada. */
  scopeEntityIds: string[];
}

export interface RequestWithIntegration extends Request {
  integration?: IntegrationPrincipal;
}

/** O módulo (RN-102) a que a rota pertence; o guard confere se está ligado e se é da integração. */
export const INTEGRATION_MODULE_KEY = 'its:integration-module';
export const IntegrationRoute = (module: IntegrationModuleId) => SetMetadata(INTEGRATION_MODULE_KEY, module);

/** Injeta a integração que fez a chamada. Só use em rotas sob o `IntegrationGuard`. */
export const CurrentIntegration = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): IntegrationPrincipal => {
    const principal = ctx.switchToHttp().getRequest<RequestWithIntegration>().integration;
    if (!principal) throw new Error('CurrentIntegration usado numa rota sem o IntegrationGuard.');
    return principal;
  },
);
