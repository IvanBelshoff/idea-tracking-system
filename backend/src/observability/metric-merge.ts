import { addBuckets, type Buckets, emptyBuckets } from './latency.js';

/** Uma rota molde numa hora: quantas vezes, quantos erros 5xx e as faixas de tempo. */
export interface RouteStats {
  route: string;
  requests: number;
  errors: number;
  latencyBuckets: Buckets;
}

/** O que se mede do tráfego numa hora (ou num pedaço dela). Só números: nada de dado pessoal (CA-T.11). */
export interface MetricRow {
  requests: number;
  errors4xx: number;
  errors5xx: number;
  rateLimited: number;
  loginsOk: number;
  loginsFailed: number;
  latencyBuckets: Buckets;
  memoryMb: number;
  routes: RouteStats[];
}

/** Quantas rotas uma hora guarda: as mais pedidas e, além delas, as que tiveram erro 5xx. */
export const TOP_ROUTES = 20;
export const MAX_ROUTES = 40;

export const emptyMetricRow = (): MetricRow => ({
  requests: 0,
  errors4xx: 0,
  errors5xx: 0,
  rateLimited: 0,
  loginsOk: 0,
  loginsFailed: 0,
  latencyBuckets: emptyBuckets(),
  memoryMb: 0,
  routes: [],
});

/** As rotas mais pedidas mais as que tiveram erro, no máximo `MAX_ROUTES` (as de erro têm preferência). */
export function trimRoutes(routes: readonly RouteStats[]): RouteStats[] {
  const byRequests = [...routes].sort((a, b) => b.requests - a.requests || a.route.localeCompare(b.route));
  const top = byRequests.slice(0, TOP_ROUTES);
  const failing = byRequests.filter((entry) => entry.errors > 0 && !top.includes(entry));
  return [...top, ...failing].slice(0, MAX_ROUTES);
}

/** Soma duas listas de rotas pelo nome da rota. */
export function mergeRoutes(a: readonly RouteStats[], b: readonly RouteStats[]): RouteStats[] {
  const merged = new Map<string, RouteStats>();
  for (const entry of [...a, ...b]) {
    const found = merged.get(entry.route);
    merged.set(
      entry.route,
      found
        ? {
            route: entry.route,
            requests: found.requests + entry.requests,
            errors: found.errors + entry.errors,
            latencyBuckets: addBuckets(found.latencyBuckets, entry.latencyBuckets),
          }
        : { ...entry, latencyBuckets: addBuckets([], entry.latencyBuckets) },
    );
  }
  return trimRoutes([...merged.values()]);
}

/**
 * Soma duas medições da mesma hora: contadores e faixas somam; a memória guarda o maior valor;
 * as rotas somam pelo nome. É o que torna a gravação aditiva (CA-RN-92.3).
 */
export function mergeMetrics(a: MetricRow, b: MetricRow): MetricRow {
  return {
    requests: a.requests + b.requests,
    errors4xx: a.errors4xx + b.errors4xx,
    errors5xx: a.errors5xx + b.errors5xx,
    rateLimited: a.rateLimited + b.rateLimited,
    loginsOk: a.loginsOk + b.loginsOk,
    loginsFailed: a.loginsFailed + b.loginsFailed,
    latencyBuckets: addBuckets(a.latencyBuckets, b.latencyBuckets),
    memoryMb: Math.max(a.memoryMb, b.memoryMb),
    routes: mergeRoutes(a.routes, b.routes),
  };
}
