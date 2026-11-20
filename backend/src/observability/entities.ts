import { Check, Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { RouteStats } from './metric-merge.js';
import type { WorkerStats } from './worker-stats.js';

export type OpsProcess = 'api' | 'worker';

/**
 * Sinal de vida de um processo (RN-93). Cada processo regrava a própria linha a cada minuto;
 * a saúde usa o `last_seen_at` mais recente de cada tipo. Sem dado pessoal (CA-T.11).
 */
@Entity('ops_heartbeat')
@Check('ck_ops_heartbeat_process', "process IN ('api', 'worker')")
export class OpsHeartbeat {
  /** `api` ou `worker`. */
  @PrimaryColumn({ type: 'varchar', length: 10 })
  process!: OpsProcess;

  /** Nome da máquina (contêiner); recriar o contêiner muda o nome, e a limpeza apaga a linha velha. */
  @PrimaryColumn({ type: 'varchar', length: 100 })
  instance!: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt!: Date;

  @Column({ name: 'memory_mb', type: 'int' })
  memoryMb!: number;

  /** Atraso do ciclo de eventos (p99, no último minuto). Só na API. */
  @Column({ name: 'event_loop_p99_ms', type: 'int', nullable: true })
  eventLoopP99Ms!: number | null;

  /** Percentual livre do volume dos anexos. Só na API. */
  @Column({ name: 'storage_free_pct', type: 'int', nullable: true })
  storageFreePct!: number | null;

  /** Duração do último disparo de jobs. Só no worker. */
  @Column({ name: 'last_tick_ms', type: 'int', nullable: true })
  lastTickMs!: number | null;

  @Column({ type: 'varchar', length: 40 })
  version!: string;
}

/**
 * O tráfego de uma hora de um processo (RN-92). Uma linha por (`hour`, `process`); a gravação é
 * aditiva: quem grava lê a linha com trava, soma e regrava, então várias instâncias, ou um reinício
 * dentro da hora, não perdem nem duplicam medidas. Os percentis saem das faixas de tempo.
 */
@Entity('ops_metric_hour')
@Check('ck_ops_metric_hour_process', "process IN ('api', 'worker')")
export class OpsMetricHour {
  /** Início da hora, em UTC. */
  @PrimaryColumn({ type: 'timestamptz' })
  hour!: Date;

  @PrimaryColumn({ type: 'varchar', length: 10 })
  process!: OpsProcess;

  @Column({ type: 'int', default: 0 })
  requests!: number;

  @Column({ name: 'errors_4xx', type: 'int', default: 0 })
  errors4xx!: number;

  @Column({ name: 'errors_5xx', type: 'int', default: 0 })
  errors5xx!: number;

  /** Respostas 429 (também contam nos 4xx). */
  @Column({ name: 'rate_limited', type: 'int', default: 0 })
  rateLimited!: number;

  @Column({ name: 'logins_ok', type: 'int', default: 0 })
  loginsOk!: number;

  @Column({ name: 'logins_failed', type: 'int', default: 0 })
  loginsFailed!: number;

  /** Doze contagens, uma por faixa de tempo (`latency.ts`). */
  @Column({ name: 'latency_buckets', type: 'jsonb', default: () => `'[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]'` })
  latencyBuckets!: number[];

  /** A maior memória vista na hora. */
  @Column({ name: 'memory_mb', type: 'int', default: 0 })
  memoryMb!: number;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  routes!: RouteStats[];

  /** Só no worker: disparos, duração e e-mails da hora. */
  @Column({ type: 'jsonb', nullable: true })
  worker!: Partial<WorkerStats> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * O que o alerta de saúde lembra de cada item (RN-94). Fica no banco, e não na memória, para o
 * reinício do worker não repetir nem perder avisos. Uma linha por item da saúde.
 */
@Entity('ops_alert_state')
@Check('ck_ops_alert_state_state', "state IN ('ok', 'failed')")
export class OpsAlertState {
  @PrimaryColumn({ name: 'item_key', type: 'varchar', length: 40 })
  itemKey!: string;

  @Column({ type: 'varchar', length: 10, default: 'ok' })
  state!: 'ok' | 'failed';

  /** Conferências seguidas sem falha desde que falhou. */
  @Column({ name: 'clean_checks', type: 'int', default: 0 })
  cleanChecks!: number;

  @Column({ name: 'last_failure_notice_at', type: 'timestamptz', nullable: true })
  lastFailureNoticeAt!: Date | null;

  /** A falha caiu nos 30 minutos e não avisou: a volta também não avisa. */
  @Column({ type: 'boolean', default: false })
  silenced!: boolean;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  since!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
