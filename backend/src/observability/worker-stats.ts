import { startOfUtcHour } from '../common/dates.js';
import { addBuckets, type Buckets, bucketIndex, emptyBuckets } from './latency.js';

/** O que o worker mede por hora (RN-92): disparos, quanto demoram e o resultado dos e-mails. */
export interface WorkerStats {
  ticks: number;
  tickFailures: number;
  /** Faixas de tempo dos disparos (as mesmas do tráfego). */
  tickBuckets: Buckets;
  emailsSent: number;
  emailsFailed: number;
  emailsRetried: number;
}

export const emptyWorkerStats = (): WorkerStats => ({
  ticks: 0,
  tickFailures: 0,
  tickBuckets: emptyBuckets(),
  emailsSent: 0,
  emailsFailed: 0,
  emailsRetried: 0,
});

/** Soma duas medições do worker na mesma hora; a primeira pode vir do banco, já gravada, ou faltar. */
export function mergeWorkerStats(a: Partial<WorkerStats> | null | undefined, b: WorkerStats): WorkerStats {
  return {
    ticks: (a?.ticks ?? 0) + b.ticks,
    tickFailures: (a?.tickFailures ?? 0) + b.tickFailures,
    tickBuckets: addBuckets(a?.tickBuckets ?? [], b.tickBuckets),
    emailsSent: (a?.emailsSent ?? 0) + b.emailsSent,
    emailsFailed: (a?.emailsFailed ?? 0) + b.emailsFailed,
    emailsRetried: (a?.emailsRetried ?? 0) + b.emailsRetried,
  };
}

export type EmailOutcome = 'sent' | 'retry' | 'failed' | 'skipped';

export interface DrainedWorkerHour {
  hour: Date;
  stats: WorkerStats;
}

/**
 * Coletor do worker: guarda em memória, por hora, o que aconteceu desde a última gravação. Cada
 * disparo grava e esvazia (`drain`); se a gravação falhar, `restore` devolve o que não foi gravado.
 */
export class WorkerMetrics {
  private hours = new Map<number, WorkerStats>();

  private hourOf(now: Date): WorkerStats {
    const key = startOfUtcHour(now).getTime();
    const found = this.hours.get(key);
    if (found) return found;
    const created = emptyWorkerStats();
    this.hours.set(key, created);
    return created;
  }

  recordTick(ms: number, ok: boolean, now = new Date()): void {
    const hour = this.hourOf(now);
    hour.ticks += 1;
    if (!ok) hour.tickFailures += 1;
    const index = bucketIndex(ms);
    hour.tickBuckets[index] = (hour.tickBuckets[index] ?? 0) + 1;
  }

  /** `skipped` (já enviado, ou fora da fila) não é tentativa de envio e não conta. */
  recordEmail(outcome: EmailOutcome, now = new Date()): void {
    if (outcome === 'skipped') return;
    const hour = this.hourOf(now);
    if (outcome === 'sent') hour.emailsSent += 1;
    else if (outcome === 'failed') hour.emailsFailed += 1;
    else hour.emailsRetried += 1;
  }

  /** Entrega o que ainda não foi gravado e esvazia a memória. */
  drain(): DrainedWorkerHour[] {
    const drained = [...this.hours.entries()]
      .sort(([a], [b]) => a - b)
      .map(([key, stats]) => ({ hour: new Date(key), stats }))
      .filter(({ stats }) => stats.ticks + stats.emailsSent + stats.emailsFailed + stats.emailsRetried > 0);
    this.hours = new Map();
    return drained;
  }

  restore(items: readonly DrainedWorkerHour[]): void {
    for (const { hour, stats } of items) {
      const key = hour.getTime();
      this.hours.set(key, mergeWorkerStats(this.hours.get(key), stats));
    }
  }
}
