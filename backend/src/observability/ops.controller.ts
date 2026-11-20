import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ApiErrorBody, parseInput } from '../common/api-error.js';
import { RequirePermission } from '../identity-access/auth-context.js';
import { metricsEnabled } from './config.js';
import { HealthService } from './health.service.js';
import { HistoryQuerySchema, resolveHistoryRange } from './history-range.js';
import { HttpMetricsStore } from './http-metrics.store.js';
import { MetricsHistoryService } from './metrics-history.service.js';
import { HistoryReport, OpsHealthReport, TrafficReport, UsageReport } from './ops.dto.js';
import { UsageService } from './usage.service.js';

/** Observabilidade (M12, RN-92 a RN-94): só para quem tem `ops.view` (por padrão, o Administrador). */
@ApiTags('ops')
@ApiCookieAuth()
@ApiForbiddenResponse({
  type: ApiErrorBody,
  description: 'Sem a permissão ops.view (por padrão, só o Administrador).',
})
@Controller('ops')
@RequirePermission('ops.view')
export class OpsController {
  constructor(
    private readonly healthService: HealthService,
    private readonly store: HttpMetricsStore,
    private readonly history: MetricsHistoryService,
    private readonly usageService: UsageService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Saúde por itens: banco, migrações, anexos, e-mail, fila, worker e API (RN-93)' })
  @ApiOkResponse({ type: OpsHealthReport })
  health(): Promise<OpsHealthReport> {
    return this.healthService.report();
  }

  @Get('traffic')
  @ApiOperation({ summary: 'Tráfego desde que a API subiu: requisições, erros, tempos e rotas (RN-92)' })
  @ApiOkResponse({ type: TrafficReport })
  traffic(): TrafficReport {
    const live = this.store.live();
    return {
      ...live,
      metricsEnabled: metricsEnabled(),
      since: live.since.toISOString(),
      minutes: live.minutes.map((entry) => ({ ...entry, minute: entry.minute.toISOString() })),
    };
  }

  @Get('history')
  @ApiOperation({ summary: 'Tráfego por hora no período; padrão: últimas 24 horas, até 31 dias (RN-92)' })
  @ApiQuery({ name: 'from', required: false, description: 'Início do período (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'Fim do período (ISO 8601)' })
  @ApiOkResponse({ type: HistoryReport })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description: 'Período inválido, invertido ou maior que 31 dias.',
  })
  async historyOf(@Query() query: unknown): Promise<HistoryReport> {
    const { from, to } = resolveHistoryRange(parseInput(HistoryQuerySchema, query, 422));
    return {
      metricsEnabled: metricsEnabled(),
      from: from.toISOString(),
      to: to.toISOString(),
      hours: await this.history.hours(from, to),
      workerHours: await this.history.workerHours(from, to),
    };
  }

  @Get('usage')
  @ApiOperation({ summary: 'Uso e segurança: contas, sessões, entradas, falhas, bloqueios e crescimento do banco' })
  @ApiOkResponse({ type: UsageReport })
  usage(): Promise<UsageReport> {
    return this.usageService.report();
  }
}
