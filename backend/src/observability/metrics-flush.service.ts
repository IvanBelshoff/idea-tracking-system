import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { PtBrLogger } from '../common/pt-br-logger.js';
import { metricsEnabled } from './config.js';
import { OpsMetricHour, type OpsProcess } from './entities.js';
import { type DrainedHour, HttpMetricsStore } from './http-metrics.store.js';
import { emptyMetricRow, type MetricRow, mergeMetrics } from './metric-merge.js';
import { mergeWorkerStats, type WorkerStats } from './worker-stats.js';

/** De quanto em quanto tempo o que está em memória vai para o banco (intervalo do temporizador). */
const FLUSH_INTERVAL_MS = 60_000;

/** A linha do banco como medição. */
export function rowToMetric(row: OpsMetricHour): MetricRow {
  return {
    requests: row.requests,
    errors4xx: row.errors4xx,
    errors5xx: row.errors5xx,
    rateLimited: row.rateLimited,
    loginsOk: row.loginsOk,
    loginsFailed: row.loginsFailed,
    latencyBuckets: row.latencyBuckets,
    memoryMb: row.memoryMb,
    routes: row.routes,
  };
}

/**
 * Soma uma medição na linha (hora, processo) do banco, criando-a se preciso. A linha é lida com
 * trava (`FOR UPDATE`) e regravada na mesma transação, então a soma é exata mesmo com mais de uma
 * instância gravando a mesma hora (CA-RN-92.3).
 */
export async function addToHour(
  m: EntityManager,
  hour: Date,
  process: OpsProcess,
  delta: MetricRow,
  worker?: WorkerStats,
): Promise<void> {
  await m.query('INSERT INTO ops_metric_hour (hour, process) VALUES ($1, $2) ON CONFLICT DO NOTHING', [hour, process]);
  const row = await m.findOneOrFail(OpsMetricHour, { where: { hour, process }, lock: { mode: 'pessimistic_write' } });
  const merged = mergeMetrics(rowToMetric(row), delta);
  await m.update(
    OpsMetricHour,
    { hour, process },
    {
      requests: merged.requests,
      errors4xx: merged.errors4xx,
      errors5xx: merged.errors5xx,
      rateLimited: merged.rateLimited,
      loginsOk: merged.loginsOk,
      loginsFailed: merged.loginsFailed,
      latencyBuckets: merged.latencyBuckets,
      memoryMb: merged.memoryMb,
      routes: merged.routes,
      ...(worker ? { worker: mergeWorkerStats(row.worker, worker) } : {}),
    },
  );
}

/**
 * Grava o tráfego da API no banco (RN-92): na subida não há nada, e a cada minuto vai só o que é
 * novo desde a última gravação (uma queda perde no máximo o último minuto). Ao encerrar, grava o resto.
 */
@Injectable()
export class MetricsFlushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PtBrLogger('Métricas');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: HttpMetricsStore,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  /** Uma gravação. Pública para os testes; nunca lança (o que falhar volta para a memória). */
  async flush(now = new Date()): Promise<void> {
    if (!metricsEnabled()) return;
    const drained = this.store.drain(now);
    if (drained.length === 0) return;
    const memoryMb = Math.round(process.memoryUsage().rss / 1024 ** 2);
    try {
      await this.persist(drained, memoryMb);
    } catch (error) {
      this.store.restore(drained);
      this.logger.warn(`Não foi possível gravar as métricas: ${error instanceof Error ? error.message : error}`);
    }
  }

  private persist(drained: DrainedHour[], memoryMb: number): Promise<void> {
    return this.dataSource.transaction(async (m) => {
      for (const { hour, row } of drained) {
        await addToHour(m, hour, 'api', mergeMetrics(emptyMetricRow(), { ...row, memoryMb }));
      }
    });
  }
}
