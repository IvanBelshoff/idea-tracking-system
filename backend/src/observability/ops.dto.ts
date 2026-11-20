import { ApiProperty } from '@nestjs/swagger';
import { HEALTH_KEYS, HEALTH_STATES, type HealthKey, type HealthState } from './health-rules.js';

export class HealthItemView {
  @ApiProperty({ enum: HEALTH_KEYS, enumName: 'HealthKey' }) key!: HealthKey;
  @ApiProperty({ enum: HEALTH_STATES, enumName: 'HealthState' }) state!: HealthState;
  @ApiProperty({ example: 'ok', description: 'O que aconteceu, em código estável (a tela traduz)' }) code!: string;
  @ApiProperty({ type: Number, nullable: true, description: 'Número do código (ms, %, minutos...), quando há' })
  value!: number | null;
}

export class OpsHealthReport {
  @ApiProperty({ enum: HEALTH_STATES, enumName: 'HealthState', description: 'O pior estado entre os itens' })
  state!: HealthState;
  @ApiProperty({ format: 'date-time' }) checkedAt!: string;
  @ApiProperty({ example: '1.0.0' }) version!: string;
  @ApiProperty({ example: 'production' }) environment!: string;
  @ApiProperty({ format: 'date-time', description: 'Quando a API subiu' }) apiStartedAt!: string;
  @ApiProperty({ description: 'Falso quando METRICS_ENABLED=false: o tráfego e o histórico ficam zerados' })
  metricsEnabled!: boolean;
  @ApiProperty({ type: [HealthItemView] }) items!: HealthItemView[];
}

export class RouteView {
  @ApiProperty({ example: 'GET /api/ideas/:id', description: 'A rota molde, nunca a URL' }) route!: string;
  @ApiProperty() requests!: number;
  @ApiProperty({ description: 'Respostas 5xx' }) errors!: number;
  @ApiProperty({ description: 'p95 do tempo de resposta, em ms (limite da faixa)' }) p95Ms!: number;
}

export class TrafficMinute {
  @ApiProperty({ format: 'date-time' }) minute!: string;
  @ApiProperty() requests!: number;
  @ApiProperty() errors5xx!: number;
}

export class TrafficReport {
  @ApiProperty({ description: 'Falso quando METRICS_ENABLED=false' }) metricsEnabled!: boolean;
  @ApiProperty({ format: 'date-time', description: 'Desde quando a API conta (zera ao reiniciar)' }) since!: string;
  @ApiProperty() requests!: number;
  @ApiProperty({ description: 'Respostas 4xx (inclui as 429)' }) errors4xx!: number;
  @ApiProperty() errors5xx!: number;
  @ApiProperty({ description: 'Respostas 429 (muitas requisições)' }) rateLimited!: number;
  @ApiProperty() loginsOk!: number;
  @ApiProperty({ description: 'Tentativas de login recusadas (401)' }) loginsFailed!: number;
  @ApiProperty() p50Ms!: number;
  @ApiProperty() p95Ms!: number;
  @ApiProperty() p99Ms!: number;
  @ApiProperty({ type: [TrafficMinute], description: 'Os últimos 60 minutos' }) minutes!: TrafficMinute[];
  @ApiProperty({ type: [RouteView] }) routes!: RouteView[];
}

export class HistoryHour {
  @ApiProperty({ format: 'date-time', description: 'Início da hora, em UTC' }) hour!: string;
  @ApiProperty() requests!: number;
  @ApiProperty() errors4xx!: number;
  @ApiProperty() errors5xx!: number;
  @ApiProperty() rateLimited!: number;
  @ApiProperty() loginsOk!: number;
  @ApiProperty() loginsFailed!: number;
  @ApiProperty() p50Ms!: number;
  @ApiProperty() p95Ms!: number;
  @ApiProperty() p99Ms!: number;
  @ApiProperty({ description: 'A maior memória vista na hora, em MB' }) memoryMb!: number;
  @ApiProperty({ type: [RouteView] }) routes!: RouteView[];
}

export class WorkerHour {
  @ApiProperty({ format: 'date-time', description: 'Início da hora, em UTC' }) hour!: string;
  @ApiProperty({ description: 'Disparos de jobs (um por minuto)' }) ticks!: number;
  @ApiProperty({ description: 'Disparos que terminaram em erro' }) tickFailures!: number;
  @ApiProperty({ description: 'p95 da duração do disparo, em ms (limite da faixa)' }) tickP95Ms!: number;
  @ApiProperty() emailsSent!: number;
  @ApiProperty({ description: 'E-mails que esgotaram as tentativas' }) emailsFailed!: number;
  @ApiProperty({ description: 'Tentativas que falharam e foram agendadas de novo' }) emailsRetried!: number;
}

export class HistoryReport {
  @ApiProperty({ description: 'Falso quando METRICS_ENABLED=false' }) metricsEnabled!: boolean;
  @ApiProperty({ format: 'date-time' }) from!: string;
  @ApiProperty({ format: 'date-time' }) to!: string;
  @ApiProperty({ type: [HistoryHour], description: 'Tráfego da API, uma linha por hora' }) hours!: HistoryHour[];
  @ApiProperty({ type: [WorkerHour], description: 'Execução do worker, uma linha por hora' })
  workerHours!: WorkerHour[];
}

export class TableSize {
  @ApiProperty({ example: 'audit_log' }) name!: string;
  @ApiProperty({ description: 'Linhas (estimativa do banco)' }) rows!: number;
}

export class UsageReport {
  @ApiProperty({ type: Number, nullable: true, description: 'Contas ativas' }) activeUsers!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Sessões abertas e dentro do prazo' })
  activeSessions!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Entradas nas últimas 24 horas' })
  loginsLast24h!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Entradas recusadas nas últimas 24 horas' })
  loginsFailedLast24h!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Contas bloqueadas por tentativas nas últimas 24 horas' })
  lockoutsLast24h!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Tamanho do banco, em bytes' })
  databaseBytes!: number | null;
  @ApiProperty({ type: [TableSize], description: 'Tabelas que só crescem' }) tables!: TableSize[];
}
