import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { metricsEnabled } from './config.js';
import type { HttpMetricsStore } from './http-metrics.store.js';

/** Rotas que não entram na conta: o healthcheck (bate a cada poucos segundos) e as próprias métricas. */
const IGNORED_PREFIXES = ['/api/health', '/api/ops/'];

/** A rota molde (`/api/ideas/:id`): nunca a URL de verdade, nem a query string (CA-RN-92.1, CA-T.11). */
export function routeTemplate(req: Pick<Request, 'baseUrl' | 'route'>): string | null {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  // Rota com curinga (`/api*path`) é o tratador de 404 do Nest, não uma rota de verdade.
  return typeof path === 'string' && !path.includes('*') ? `${req.baseUrl ?? ''}${path}` : null;
}

export const isIgnoredRoute = (template: string): boolean =>
  IGNORED_PREFIXES.some((prefix) => template === prefix.replace(/\/$/, '') || template.startsWith(prefix));

/**
 * Mede cada requisição quando a resposta sai, com o status de verdade (inclui 401 e 403 dos guards
 * e os 429). Rota que não existe vira "(sem rota)". `getStore` é preguiçoso: a coleta só pede o
 * armazém na primeira requisição (o modo de prévia do OpenAPI nunca atende requisição).
 */
export function createHttpMetricsMiddleware(getStore: () => HttpMetricsStore): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!metricsEnabled()) {
      next();
      return;
    }
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const template = routeTemplate(req);
      if (template && isIgnoredRoute(template)) return;
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      getStore().record(`${req.method} ${template ?? '(sem rota)'}`, res.statusCode, ms);
    });
    next();
  };
}
