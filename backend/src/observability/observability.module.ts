import { Module } from '@nestjs/common';
import { AlertService } from './alert.service.js';
import { AlertSchedulerService } from './alert-scheduler.service.js';
import { HealthService } from './health.service.js';
import { HeartbeatService } from './heartbeat.service.js';
import { HttpMetricsStore } from './http-metrics.store.js';
import { MetricsFlushService } from './metrics-flush.service.js';
import { MetricsHistoryService } from './metrics-history.service.js';
import { OpsController } from './ops.controller.js';
import { UsageService } from './usage.service.js';

/**
 * Observabilidade (M12): saúde por itens, batimento da API, métricas de tráfego (em memória, com
 * gravação por hora) e, na fase seguinte, o alerta. O worker usa as mesmas funções, sem o
 * contêiner do Nest.
 */
@Module({
  controllers: [OpsController],
  providers: [
    HealthService,
    HeartbeatService,
    HttpMetricsStore,
    MetricsFlushService,
    MetricsHistoryService,
    UsageService,
    AlertService,
    AlertSchedulerService,
  ],
  exports: [HealthService, HttpMetricsStore, AlertService],
})
export class ObservabilityModule {}
