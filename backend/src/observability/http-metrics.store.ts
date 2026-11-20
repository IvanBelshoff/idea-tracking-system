import { Injectable } from '@nestjs/common';
import { startOfMinuteOf, startOfUtcHour } from '../common/dates.js';
import { bucketIndex, emptyBuckets, percentileMs } from './latency.js';
import {
  emptyMetricRow,
  type MetricRow,
  mergeMetrics,
  mergeRoutes,
  type RouteStats,
  trimRoutes,
} from './metric-merge.js';

/** A rota do login: dela saem as contagens de entrada com sucesso e com falha. */
const LOGIN_ROUTE = 'POST /api/auth/login';
/** Quantos minutos o "ao vivo" guarda. */
const LIVE_MINUTES = 60;
/** Um minuto, em milissegundos (passo da série ao vivo, não regra de data). */
const MINUTE_MS = 60_000;

/** O acumulado de uma janela (o total desde o boot, ou uma hora). */
class Window {
  requests = 0;
  errors4xx = 0;
  errors5xx = 0;
  rateLimited = 0;
  loginsOk = 0;
  loginsFailed = 0;
  buckets = emptyBuckets();
  routes = new Map<string, RouteStats>();

  record(route: string, status: number, ms: number): void {
    this.requests += 1;
    const index = bucketIndex(ms);
    this.buckets[index] = (this.buckets[index] ?? 0) + 1;
    if (status >= 500) this.errors5xx += 1;
    else if (status >= 400) this.errors4xx += 1;
    if (status === 429) this.rateLimited += 1;
    if (route === LOGIN_ROUTE) {
      if (status < 300) this.loginsOk += 1;
      else if (status === 401) this.loginsFailed += 1;
    }
    const stats = this.routes.get(route) ?? { route, requests: 0, errors: 0, latencyBuckets: emptyBuckets() };
    stats.requests += 1;
    if (status >= 500) stats.errors += 1;
    stats.latencyBuckets[index] = (stats.latencyBuckets[index] ?? 0) + 1;
    this.routes.set(route, stats);
  }

  isEmpty(): boolean {
    return this.requests === 0;
  }

  /** O acumulado como medição (sem a memória, que quem grava acrescenta). */
  toRow(): MetricRow {
    return {
      ...emptyMetricRow(),
      requests: this.requests,
      errors4xx: this.errors4xx,
      errors5xx: this.errors5xx,
      rateLimited: this.rateLimited,
      loginsOk: this.loginsOk,
      loginsFailed: this.loginsFailed,
      latencyBuckets: [...this.buckets],
      routes: trimRoutes([...this.routes.values()]),
    };
  }

  /** Soma de volta uma medição (quando a gravação falhou e as medidas voltam para a memória). */
  absorb(row: MetricRow): void {
    const merged = mergeMetrics(this.toRow(), row);
    this.requests = merged.requests;
    this.errors4xx = merged.errors4xx;
    this.errors5xx = merged.errors5xx;
    this.rateLimited = merged.rateLimited;
    this.loginsOk = merged.loginsOk;
    this.loginsFailed = merged.loginsFailed;
    this.buckets = merged.latencyBuckets;
    this.routes = new Map(mergeRoutes([...this.routes.values()], row.routes).map((entry) => [entry.route, entry]));
  }
}

export interface DrainedHour {
  hour: Date;
  row: MetricRow;
}

export interface LiveTraffic {
  since: Date;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  rateLimited: number;
  loginsOk: number;
  loginsFailed: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minutes: { minute: Date; requests: number; errors5xx: number }[];
  routes: { route: string; requests: number; errors: number; p95Ms: number }[];
}

/**
 * As métricas de tráfego em memória (RN-92): o total desde que a API subiu, o minuto a minuto da
 * última hora e o acumulado por hora, que o coletor grava no banco a cada minuto (só o que é novo).
 * Só entra a rota molde, o status e o tempo: nada que identifique pessoa (CA-T.11).
 */
@Injectable()
export class HttpMetricsStore {
  readonly since = new Date();
  private readonly total = new Window();
  private hours = new Map<number, Window>();
  private readonly minutes = new Map<number, { requests: number; errors5xx: number }>();

  record(route: string, status: number, ms: number, now = new Date()): void {
    this.total.record(route, status, ms);

    const hourKey = startOfUtcHour(now).getTime();
    const hour = this.hours.get(hourKey) ?? new Window();
    hour.record(route, status, ms);
    this.hours.set(hourKey, hour);

    const minuteKey = startOfMinuteOf(now).getTime();
    const minute = this.minutes.get(minuteKey) ?? { requests: 0, errors5xx: 0 };
    minute.requests += 1;
    if (status >= 500) minute.errors5xx += 1;
    this.minutes.set(minuteKey, minute);
    for (const key of this.minutes.keys()) {
      if (key <= minuteKey - LIVE_MINUTES * MINUTE_MS) this.minutes.delete(key);
    }
  }

  live(now = new Date()): LiveTraffic {
    const current = startOfMinuteOf(now).getTime();
    const minutes = Array.from({ length: LIVE_MINUTES }, (_, i) => {
      const key = current - (LIVE_MINUTES - 1 - i) * MINUTE_MS;
      return { minute: new Date(key), ...(this.minutes.get(key) ?? { requests: 0, errors5xx: 0 }) };
    });
    return {
      since: this.since,
      requests: this.total.requests,
      errors4xx: this.total.errors4xx,
      errors5xx: this.total.errors5xx,
      rateLimited: this.total.rateLimited,
      loginsOk: this.total.loginsOk,
      loginsFailed: this.total.loginsFailed,
      p50Ms: percentileMs(this.total.buckets, 0.5),
      p95Ms: percentileMs(this.total.buckets, 0.95),
      p99Ms: percentileMs(this.total.buckets, 0.99),
      minutes,
      routes: trimRoutes([...this.total.routes.values()]).map((entry) => ({
        route: entry.route,
        requests: entry.requests,
        errors: entry.errors,
        p95Ms: percentileMs(entry.latencyBuckets, 0.95),
      })),
    };
  }

  /**
   * Tira da memória o que ainda não foi gravado (só as horas com medida) e devolve para gravar. As
   * horas passadas somem; a hora atual segue, vazia, recebendo o que vier depois.
   */
  drain(now = new Date()): DrainedHour[] {
    const currentHour = startOfUtcHour(now).getTime();
    const drained: DrainedHour[] = [];
    for (const [key, window] of [...this.hours.entries()].sort(([a], [b]) => a - b)) {
      if (!window.isEmpty()) drained.push({ hour: new Date(key), row: window.toRow() });
      if (key < currentHour) this.hours.delete(key);
      else this.hours.set(key, new Window());
    }
    return drained;
  }

  /** Devolve à memória o que não deu para gravar. */
  restore(items: readonly DrainedHour[]): void {
    for (const { hour, row } of items) {
      const key = hour.getTime();
      const window = this.hours.get(key) ?? new Window();
      window.absorb(row);
      this.hours.set(key, window);
    }
  }
}
