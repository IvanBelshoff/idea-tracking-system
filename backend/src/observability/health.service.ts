import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { hoursFromNow } from '../common/dates.js';
import { PtBrLogger } from '../common/pt-br-logger.js';
import { MailProvider } from '../communication/entities.js';
import { isEmailActive } from '../communication/mail.js';
import { SsoProvider } from '../identity-access/entities/sso-provider.entity.js';
import { webhooksEnabled } from '../integration/webhooks/webhook-emit.js';
import { getSetting } from '../organization/settings.service.js';
import { appVersion } from './app-version.js';
import { metricsEnabled, processStartedAt } from './config.js';
import type { OpsProcess } from './entities.js';
import { evaluateHealth, type HealthSnapshot, LIMITS, type Probe } from './health-rules.js';
import type { OpsHealthReport } from './ops.dto.js';

const logger = new PtBrLogger('Saúde');

/** Roda uma coleta sem deixar o erro subir: coleta que falha vira item em falha (RN-93). */
async function safe<T>(name: string, collect: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { ok: true, data: await collect() };
  } catch (error) {
    logger.warn(`Coleta de saúde falhou (${name}): ${error instanceof Error ? error.message : error}`);
    return { ok: false };
  }
}

/**
 * A saúde da instalação agora (RN-93). Funciona nos dois processos: a API (tela) e o worker
 * (alerta), porque só consulta o banco e os batimentos. Nunca lança.
 */
@Injectable()
export class HealthService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** O retrato do sistema, uma coleta por item, cada uma isolada das outras. */
  async snapshot(now = new Date()): Promise<HealthSnapshot> {
    const [
      database,
      migrations,
      storage,
      email,
      emailQueue,
      emailSecret,
      ssoSecret,
      integrationToken,
      webhookSecret,
      webhookDelivery,
      worker,
      api,
      timeZone,
    ] = await Promise.all([
      safe('banco', () => this.probeDatabase()),
      safe('migrações', () => this.probeMigrations()),
      safe('armazenamento', () => this.probeStorage()),
      safe('e-mail', () => this.probeEmail(now)),
      safe('fila de e-mail', () => this.probeEmailQueue()),
      safe('segredo do e-mail', () => this.probeEmailSecret()),
      safe('segredo do login corporativo', () => this.probeSsoSecret()),
      safe('token de integração', () => this.probeIntegrationToken()),
      safe('segredo dos webhooks', () => this.probeWebhookSecret()),
      safe('entrega dos webhooks', () => this.probeWebhookDelivery(now)),
      safe('worker', () => this.probeHeartbeat('worker')),
      safe('API', () => this.probeApi()),
      getSetting(this.dataSource.manager, 'organization.timezone').catch(() => 'UTC'),
    ]);
    return {
      now,
      database,
      migrations,
      storage,
      email,
      emailQueue,
      emailSecret,
      ssoSecret,
      integrationToken,
      webhookSecret,
      webhookDelivery,
      worker,
      api,
      timeZone,
    };
  }

  /** Os itens e o estado geral, sem a parte de apresentação. Usado pelo alerta. */
  async evaluate(now = new Date()) {
    return evaluateHealth(await this.snapshot(now));
  }

  /** O que `GET /api/ops/health` devolve. */
  async report(now = new Date()): Promise<OpsHealthReport> {
    const { state, items } = await this.evaluate(now);
    return {
      state,
      checkedAt: now.toISOString(),
      version: appVersion,
      environment: process.env.NODE_ENV ?? 'development',
      apiStartedAt: processStartedAt.toISOString(),
      metricsEnabled: metricsEnabled(),
      items,
    };
  }

  private async probeDatabase() {
    const start = process.hrtime.bigint();
    await this.dataSource.query('SELECT 1');
    return { ms: Math.round(Number(process.hrtime.bigint() - start) / 1e6) };
  }

  private async probeMigrations() {
    return { pending: await this.dataSource.showMigrations() };
  }

  private async probeStorage() {
    const rows: { storage_free_pct: number | null }[] = await this.dataSource.query(
      `SELECT storage_free_pct FROM ops_heartbeat WHERE process = 'api' ORDER BY last_seen_at DESC LIMIT 1`,
    );
    return { freePct: rows[0]?.storage_free_pct ?? null };
  }

  private async probeEmail(now: Date) {
    const providerActive = await isEmailActive(this.dataSource.manager);
    const rows: { status: string; total: string }[] = await this.dataSource.query(
      `SELECT status, count(*) AS total FROM email_log
        WHERE created_at > $1 AND status IN ('sent', 'failed') GROUP BY status`,
      [hoursFromNow(-LIMITS.emailWindowHours, now)],
    );
    const count = (status: string) => Number(rows.find((row) => row.status === status)?.total ?? 0);
    const failed = count('failed');
    return { providerActive, attempts: count('sent') + failed, failed };
  }

  private async probeEmailQueue() {
    const rows: { oldest: Date | null }[] = await this.dataSource.query(
      `SELECT min(created_at) AS oldest FROM email_log WHERE status = 'pending'`,
    );
    return { oldestPendingAt: rows[0]?.oldest ?? null };
  }

  /**
   * Validade do segredo do envio (RN-100): só conta com o envio ligado. Microsoft sempre (sem data é atenção);
   * Google só com data informada (as chaves de conta de serviço não vencem por padrão).
   */
  private async probeEmailSecret() {
    const p = await this.dataSource.getRepository(MailProvider).findOneBy({ active: true });
    const expiresOn = p?.secretExpiresOn ?? null;
    const applicable = p?.type === 'microsoft_graph' || (p?.type === 'google_workspace' && expiresOn !== null);
    return { applicable, expiresOn };
  }

  /** Validade do segredo de cada provedor de login corporativo ligado (RN-100). */
  private async probeSsoSecret() {
    const rows = await this.dataSource.getRepository(SsoProvider).findBy({ enabled: true });
    return { providers: rows.map((r) => ({ expiresOn: r.secretExpiresOn })) };
  }

  /**
   * Token de integração (RN-113): só conta com a chave geral ligada. Para cada integração ATIVA, o
   * token de maior validade entre os não revogados (integração suspensa ou revogada não conta).
   */
  private async probeIntegrationToken() {
    const enabled = await getSetting(this.dataSource.manager, 'integration.enabled');
    if (!enabled) return { enabled, integrations: [] };
    const rows: { expires_at: Date }[] = await this.dataSource.query(
      `SELECT max(t.expires_at) AS expires_at
         FROM integration i JOIN integration_token t ON t.integration_id = i.id AND t.revoked_at IS NULL
        WHERE i.status = 'active' GROUP BY i.id`,
    );
    return { enabled, integrations: rows.map((r) => ({ expiresAt: r.expires_at })) };
  }

  /** Segredo dos webhooks (RN-123): só com a chave ligada; o de maior validade entre os não revogados de cada assinatura ativa. */
  private async probeWebhookSecret() {
    const enabled = await webhooksEnabled(this.dataSource.manager);
    if (!enabled) return { enabled, subscriptions: [] };
    const rows: { expires_at: Date }[] = await this.dataSource.query(
      `SELECT max(sec.expires_at) AS expires_at
         FROM webhook_subscription s
         JOIN integration i ON i.id = s.integration_id AND i.status = 'active'
         JOIN webhook_secret sec ON sec.subscription_id = s.id AND sec.revoked_at IS NULL
        WHERE s.status = 'active' GROUP BY s.id`,
    );
    return { enabled, subscriptions: rows.map((r) => ({ expiresAt: r.expires_at })) };
  }

  /** Entrega dos webhooks (RN-123): assinaturas, falhas das últimas 24 horas e a pendência mais antiga. */
  private async probeWebhookDelivery(now: Date) {
    const enabled = await webhooksEnabled(this.dataSource.manager);
    if (!enabled) return { enabled, active: 0, suspendedByFailures: 0, failedLast24h: 0, oldestPendingAt: null };
    const [subs]: { active: string; suspended: string }[] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status = 'active') AS active,
              count(*) FILTER (WHERE status = 'suspended' AND suspended_reason = 'failures') AS suspended
         FROM webhook_subscription`,
    );
    const [recent]: { failed: string; oldest: Date | null }[] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE state = 'failed' AND created_at > $1) AS failed,
              min(next_attempt_at) FILTER (WHERE state = 'pending' AND next_attempt_at <= $2) AS oldest
         FROM webhook_delivery`,
      [hoursFromNow(-24, now), now],
    );
    return {
      enabled,
      active: Number(subs?.active ?? 0),
      suspendedByFailures: Number(subs?.suspended ?? 0),
      failedLast24h: Number(recent?.failed ?? 0),
      oldestPendingAt: recent?.oldest ?? null,
    };
  }

  private async lastSeen(kind: OpsProcess): Promise<Date | null> {
    const rows: { last_seen_at: Date | null }[] = await this.dataSource.query(
      'SELECT max(last_seen_at) AS last_seen_at FROM ops_heartbeat WHERE process = $1',
      [kind],
    );
    return rows[0]?.last_seen_at ?? null;
  }

  private async probeHeartbeat(kind: OpsProcess) {
    return { lastSeenAt: await this.lastSeen(kind) };
  }

  private async probeApi() {
    const rows: { event_loop_p99_ms: number | null }[] = await this.dataSource.query(
      `SELECT event_loop_p99_ms FROM ops_heartbeat WHERE process = 'api' ORDER BY last_seen_at DESC LIMIT 1`,
    );
    return { lastSeenAt: await this.lastSeen('api'), eventLoopP99Ms: rows[0]?.event_loop_p99_ms ?? null };
  }
}
