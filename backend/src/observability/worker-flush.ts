import type { DataSource } from 'typeorm';
import { PtBrLogger } from '../common/pt-br-logger.js';
import { metricsEnabled } from './config.js';
import { emptyMetricRow } from './metric-merge.js';
import { addToHour } from './metrics-flush.service.js';
import type { WorkerMetrics } from './worker-stats.js';

const logger = new PtBrLogger('Métricas');

/**
 * Grava no banco o que o worker mediu desde a última vez (uma linha `worker` por hora). Nunca
 * lança: se falhar, as medidas voltam para a memória e entram na próxima gravação.
 */
export async function flushWorkerMetrics(ds: DataSource, metrics: WorkerMetrics): Promise<void> {
  if (!metricsEnabled()) return;
  const drained = metrics.drain();
  if (drained.length === 0) return;
  const memoryMb = Math.round(process.memoryUsage().rss / 1024 ** 2);
  try {
    await ds.transaction(async (m) => {
      for (const { hour, stats } of drained) {
        await addToHour(m, hour, 'worker', { ...emptyMetricRow(), memoryMb }, stats);
      }
    });
  } catch (error) {
    metrics.restore(drained);
    logger.warn(`Não foi possível gravar as métricas do worker: ${error instanceof Error ? error.message : error}`);
  }
}
