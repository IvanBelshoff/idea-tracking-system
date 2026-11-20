import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { PtBrLogger } from '../common/pt-br-logger.js';
import { processStartedAt } from './config.js';
import { storageFreePercent, writeHeartbeat } from './heartbeat.js';

/** A cada minuto, em milissegundos (intervalo do temporizador, não regra de data). */
const BEAT_INTERVAL_MS = 60_000;

/**
 * Sinal de vida da API (RN-93): grava na subida e a cada minuto a memória, o atraso do ciclo de
 * eventos e o espaço livre dos anexos. É o worker quem avisa se a API ficar sem dar sinal.
 */
@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PtBrLogger('Batimento');
  private readonly loop = monitorEventLoopDelay({ resolution: 20 });
  private timer: NodeJS.Timeout | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    this.loop.enable();
    void this.beat();
    this.timer = setInterval(() => void this.beat(), BEAT_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.loop.disable();
  }

  /** Uma batida. Pública para os testes não esperarem um minuto; nunca lança. */
  async beat(): Promise<void> {
    const p99 = Math.round(this.loop.percentile(99) / 1e6);
    this.loop.reset();
    try {
      await writeHeartbeat(this.dataSource, {
        process: 'api',
        startedAt: processStartedAt,
        eventLoopP99Ms: Number.isFinite(p99) ? p99 : null,
        storageFreePct: storageFreePercent(),
      });
    } catch (error) {
      this.logger.warn(`Não foi possível gravar o batimento da API: ${error instanceof Error ? error.message : error}`);
    }
  }
}
