import { statfsSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import type { DataSource } from 'typeorm';
import { appVersion } from './app-version.js';
import { OpsHeartbeat, type OpsProcess } from './entities.js';

export interface HeartbeatInput {
  process: OpsProcess;
  startedAt: Date;
  eventLoopP99Ms?: number | null;
  storageFreePct?: number | null;
  lastTickMs?: number | null;
}

/** Percentual livre (arredondado para baixo) do volume dos anexos; nulo se não der para medir. */
export function storageFreePercent(): number | null {
  try {
    const fs = statfsSync(resolve(process.env.STORAGE_DIR ?? 'storage'));
    return fs.blocks > 0 ? Math.floor((fs.bavail / fs.blocks) * 100) : null;
  } catch {
    return null;
  }
}

/**
 * Grava (ou regrava) o sinal de vida deste processo. Usado pela API (a cada minuto) e pelo worker
 * (a cada disparo). Uma linha por processo e máquina.
 */
export async function writeHeartbeat(dataSource: DataSource, input: HeartbeatInput): Promise<void> {
  await dataSource
    .createQueryBuilder()
    .insert()
    .into(OpsHeartbeat)
    .values({
      process: input.process,
      instance: hostname(),
      startedAt: input.startedAt,
      lastSeenAt: new Date(),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 ** 2),
      eventLoopP99Ms: input.eventLoopP99Ms ?? null,
      storageFreePct: input.storageFreePct ?? null,
      lastTickMs: input.lastTickMs ?? null,
      version: appVersion.slice(0, 40),
    })
    .orUpdate(
      ['started_at', 'last_seen_at', 'memory_mb', 'event_loop_p99_ms', 'storage_free_pct', 'last_tick_ms', 'version'],
      ['process', 'instance'],
    )
    .execute();
}
