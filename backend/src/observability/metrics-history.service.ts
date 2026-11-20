import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Between, type DataSource } from 'typeorm';
import { OpsMetricHour } from './entities.js';
import { percentileMs } from './latency.js';
import type { HistoryHour, WorkerHour } from './ops.dto.js';

/** O tráfego por hora no período, lido do banco. Os percentis saem das faixas gravadas (RN-92). */
@Injectable()
export class MetricsHistoryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async hours(from: Date, to: Date): Promise<HistoryHour[]> {
    const rows = await this.dataSource.getRepository(OpsMetricHour).find({
      where: { process: 'api', hour: Between(from, to) },
      order: { hour: 'ASC' },
    });
    return rows.map((row) => ({
      hour: row.hour.toISOString(),
      requests: row.requests,
      errors4xx: row.errors4xx,
      errors5xx: row.errors5xx,
      rateLimited: row.rateLimited,
      loginsOk: row.loginsOk,
      loginsFailed: row.loginsFailed,
      p50Ms: percentileMs(row.latencyBuckets, 0.5),
      p95Ms: percentileMs(row.latencyBuckets, 0.95),
      p99Ms: percentileMs(row.latencyBuckets, 0.99),
      memoryMb: row.memoryMb,
      routes: row.routes.map((entry) => ({
        route: entry.route,
        requests: entry.requests,
        errors: entry.errors,
        p95Ms: percentileMs(entry.latencyBuckets, 0.95),
      })),
    }));
  }

  /** A execução do worker por hora no período (disparos, duração e e-mails). */
  async workerHours(from: Date, to: Date): Promise<WorkerHour[]> {
    const rows = await this.dataSource.getRepository(OpsMetricHour).find({
      where: { process: 'worker', hour: Between(from, to) },
      order: { hour: 'ASC' },
    });
    return rows.map((row) => ({
      hour: row.hour.toISOString(),
      ticks: row.worker?.ticks ?? 0,
      tickFailures: row.worker?.tickFailures ?? 0,
      tickP95Ms: percentileMs(row.worker?.tickBuckets ?? [], 0.95),
      emailsSent: row.worker?.emailsSent ?? 0,
      emailsFailed: row.worker?.emailsFailed ?? 0,
      emailsRetried: row.worker?.emailsRetried ?? 0,
    }));
  }
}
