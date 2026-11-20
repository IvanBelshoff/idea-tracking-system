import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { startOfUtcHour } from '../common/dates.js';
import { PtBrLogger } from '../common/pt-br-logger.js';
import type { IntegrationModuleId } from './modules.js';

/** De quanto em quanto tempo o consumo em memória vai para o banco. */
const FLUSH_INTERVAL_MS = 30_000;

interface Bucket {
  hour: Date;
  integrationId: string;
  module: IntegrationModuleId;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  rateLimited: number;
}

/**
 * Consumo por hora, por integração e por módulo (RN-113). Acumula em memória e grava de forma
 * ADITIVA (`ON CONFLICT ... DO UPDATE SET x = x + novo`), então várias instâncias da API, ou um
 * reinício dentro da hora, não perdem nem duplicam contagem. Nada de URL crua, parâmetro, IP ou
 * identificador de pessoa ou de ideia (CA-RN-113.9).
 */
@Injectable()
export class IntegrationUsageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PtBrLogger('Integrações');
  private buffer = new Map<string, Bucket>();
  private timer: NodeJS.Timeout | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  /** Conta uma resposta já enviada. */
  record(integrationId: string, module: IntegrationModuleId, status: number, now = new Date()): void {
    const hour = startOfUtcHour(now);
    const key = `${hour.toISOString()}|${integrationId}|${module}`;
    const bucket = this.buffer.get(key) ?? {
      hour,
      integrationId,
      module,
      requests: 0,
      errors4xx: 0,
      errors5xx: 0,
      rateLimited: 0,
    };
    bucket.requests += 1;
    if (status >= 500) bucket.errors5xx += 1;
    else if (status >= 400) bucket.errors4xx += 1;
    if (status === 429) bucket.rateLimited += 1;
    this.buffer.set(key, bucket);
  }

  /** Uma gravação. Pública para os testes e para a tela de consumo; nunca lança (o que falhar volta). */
  async flush(): Promise<void> {
    if (this.buffer.size === 0) return;
    const drained = [...this.buffer.values()];
    this.buffer = new Map();
    try {
      await this.dataSource.transaction(async (m) => {
        for (const b of drained) {
          await m.query(
            `INSERT INTO integration_hour (hour, integration_id, module, requests, errors_4xx, errors_5xx, rate_limited)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (hour, integration_id, module) DO UPDATE SET
               requests = integration_hour.requests + EXCLUDED.requests,
               errors_4xx = integration_hour.errors_4xx + EXCLUDED.errors_4xx,
               errors_5xx = integration_hour.errors_5xx + EXCLUDED.errors_5xx,
               rate_limited = integration_hour.rate_limited + EXCLUDED.rate_limited,
               updated_at = now()`,
            [b.hour, b.integrationId, b.module, b.requests, b.errors4xx, b.errors5xx, b.rateLimited],
          );
        }
      });
    } catch (error) {
      this.restore(drained);
      this.logger.warn(
        `Não foi possível gravar o consumo das integrações: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** Devolve à memória o que não foi gravado, somando ao que chegou nesse meio-tempo. */
  private restore(drained: Bucket[]): void {
    for (const b of drained) {
      const key = `${b.hour.toISOString()}|${b.integrationId}|${b.module}`;
      const now = this.buffer.get(key);
      if (!now) this.buffer.set(key, b);
      else {
        now.requests += b.requests;
        now.errors4xx += b.errors4xx;
        now.errors5xx += b.errors5xx;
        now.rateLimited += b.rateLimited;
      }
    }
  }
}
