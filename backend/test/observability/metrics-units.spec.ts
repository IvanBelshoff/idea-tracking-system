import { describe, expect, it } from 'vitest';
import { resolveHistoryRange } from '../../src/observability/history-range.js';
import { HttpMetricsStore } from '../../src/observability/http-metrics.store.js';
import {
  addBuckets,
  BUCKET_COUNT,
  bucketIndex,
  emptyBuckets,
  LATENCY_LIMITS_MS,
  percentileMs,
} from '../../src/observability/latency.js';
import {
  emptyMetricRow,
  MAX_ROUTES,
  mergeMetrics,
  type RouteStats,
  TOP_ROUTES,
  trimRoutes,
} from '../../src/observability/metric-merge.js';

const NOW = new Date('2026-11-10T12:34:56Z');
const HOUR = new Date('2026-11-10T12:00:00Z');

const bucketsOf = (...values: number[]) => values.reduce((acc, ms) => addBuckets(acc, one(ms)), emptyBuckets());
const one = (ms: number) => {
  const buckets = emptyBuckets();
  buckets[bucketIndex(ms)] = 1;
  return buckets;
};

describe('Faixas de tempo (RN-92)', () => {
  it('cada medida cai na faixa do primeiro limite que a comporta; o que passa do maior vai para a última', () => {
    expect(bucketIndex(0)).toBe(0);
    expect(bucketIndex(5)).toBe(0);
    expect(bucketIndex(5.1)).toBe(1);
    expect(bucketIndex(10_000)).toBe(LATENCY_LIMITS_MS.length - 1);
    expect(bucketIndex(10_001)).toBe(LATENCY_LIMITS_MS.length);
    expect(emptyBuckets()).toHaveLength(BUCKET_COUNT);
  });

  it('o percentil é o limite da faixa onde ele cai (arredonda para cima); sem medida, 0', () => {
    expect(percentileMs(emptyBuckets(), 0.95)).toBe(0);
    const buckets = bucketsOf(...Array.from({ length: 95 }, () => 3), ...Array.from({ length: 5 }, () => 400));
    expect(percentileMs(buckets, 0.5)).toBe(5);
    expect(percentileMs(buckets, 0.95)).toBe(5);
    expect(percentileMs(buckets, 0.96)).toBe(500);
    expect(percentileMs(bucketsOf(20_000), 0.99)).toBe(20_000);
  });
});

describe('Soma de medições (CA-RN-92.3)', () => {
  const rows = () => {
    const a = {
      ...emptyMetricRow(),
      requests: 3,
      errors5xx: 1,
      latencyBuckets: bucketsOf(3, 3, 30),
      memoryMb: 120,
      routes: [{ route: 'GET /x', requests: 3, errors: 1, latencyBuckets: bucketsOf(3, 3, 30) }],
    };
    const b = {
      ...emptyMetricRow(),
      requests: 2,
      rateLimited: 1,
      loginsFailed: 1,
      latencyBuckets: bucketsOf(3, 700),
      memoryMb: 90,
      routes: [
        { route: 'GET /x', requests: 1, errors: 0, latencyBuckets: bucketsOf(3) },
        { route: 'GET /y', requests: 1, errors: 0, latencyBuckets: bucketsOf(700) },
      ],
    };
    return { a, b };
  };

  it('somar duas medições dá o mesmo que medir tudo junto; a memória fica com o maior valor', () => {
    const { a, b } = rows();
    const merged = mergeMetrics(a, b);
    expect(merged.requests).toBe(5);
    expect(merged.errors5xx).toBe(1);
    expect(merged.rateLimited).toBe(1);
    expect(merged.loginsFailed).toBe(1);
    expect(merged.memoryMb).toBe(120);
    expect(merged.latencyBuckets).toEqual(bucketsOf(3, 3, 30, 3, 700));
    expect(percentileMs(merged.latencyBuckets, 0.95)).toBe(percentileMs(bucketsOf(3, 3, 30, 3, 700), 0.95));
    expect(merged.routes.find((r) => r.route === 'GET /x')).toMatchObject({ requests: 4, errors: 1 });
    expect(merged.routes.find((r) => r.route === 'GET /y')).toMatchObject({ requests: 1 });
  });

  it('a ordem da soma não muda o resultado', () => {
    const { a, b } = rows();
    expect(mergeMetrics(a, b).latencyBuckets).toEqual(mergeMetrics(b, a).latencyBuckets);
    expect(mergeMetrics(a, b).requests).toBe(mergeMetrics(b, a).requests);
  });

  it('guarda as 20 rotas mais pedidas e as que tiveram erro 5xx, no máximo 40', () => {
    const routes: RouteStats[] = Array.from({ length: 60 }, (_, i) => ({
      route: `GET /r${i}`,
      requests: 100 - i,
      errors: i >= 50 ? 1 : 0,
      latencyBuckets: emptyBuckets(),
    }));
    const kept = trimRoutes(routes);
    expect(kept.slice(0, TOP_ROUTES).map((r) => r.route)).toEqual(routes.slice(0, TOP_ROUTES).map((r) => r.route));
    expect(kept.filter((r) => r.errors > 0)).toHaveLength(10);
    expect(kept.length).toBeLessThanOrEqual(MAX_ROUTES);
  });
});

describe('Acumulador de tráfego (RN-92)', () => {
  it('conta 4xx, 5xx, 429 (também 4xx), logins com sucesso e recusados, e as rotas', () => {
    const store = new HttpMetricsStore();
    store.record('GET /api/ideas', 200, 4, NOW);
    store.record('GET /api/ideas', 404, 4, NOW);
    store.record('GET /api/ideas', 500, 40, NOW);
    store.record('GET /api/public/lookup', 429, 1, NOW);
    store.record('POST /api/auth/login', 200, 80, NOW);
    store.record('POST /api/auth/login', 401, 80, NOW);
    store.record('POST /api/other', 401, 80, NOW);
    const live = store.live(NOW);
    expect(live).toMatchObject({
      requests: 7,
      errors4xx: 4,
      errors5xx: 1,
      rateLimited: 1,
      loginsOk: 1,
      loginsFailed: 1,
    });
    expect(live.routes.find((r) => r.route === 'GET /api/ideas')).toMatchObject({ requests: 3, errors: 1 });
    expect(live.minutes).toHaveLength(60);
    expect(live.minutes.at(-1)).toMatchObject({ requests: 7, errors5xx: 1 });
  });

  it('drain entrega só o que é novo e a hora atual segue recebendo; restore devolve o que não foi gravado', () => {
    const store = new HttpMetricsStore();
    store.record('GET /a', 200, 3, NOW);
    store.record('GET /a', 500, 3, NOW);
    const first = store.drain(NOW);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ hour: HOUR, row: { requests: 2, errors5xx: 1 } });
    expect(store.drain(NOW)).toHaveLength(0);

    store.restore(first);
    store.record('GET /a', 200, 3, NOW);
    const again = store.drain(NOW);
    expect(again[0]?.row.requests).toBe(3);
    expect(again[0]?.row.errors5xx).toBe(1);
    // o total desde o boot nunca é zerado pelo drain
    expect(store.live(NOW).requests).toBe(3);
  });

  it('horas passadas saem da memória depois de entregues', () => {
    const store = new HttpMetricsStore();
    store.record('GET /a', 200, 3, new Date('2026-11-10T10:10:00Z'));
    expect(store.drain(NOW)).toHaveLength(1);
    expect(store.drain(NOW)).toHaveLength(0);
  });
});

describe('Período do histórico (CA-RN-92.5)', () => {
  it('padrão: as últimas 24 horas até agora', () => {
    const { from, to } = resolveHistoryRange({}, NOW);
    expect(to).toEqual(NOW);
    expect(from).toEqual(new Date('2026-11-09T12:34:56Z'));
  });

  it('31 dias passa; 32 dias e período invertido dão 422', () => {
    const to = NOW;
    expect(() => resolveHistoryRange({ from: new Date('2026-10-10T12:34:56Z'), to }, NOW)).not.toThrow();
    expect(() => resolveHistoryRange({ from: new Date('2026-10-09T12:34:56Z'), to }, NOW)).toThrow();
    expect(() => resolveHistoryRange({ from: new Date('2026-11-11T00:00:00Z'), to }, NOW)).toThrow();
  });
});
