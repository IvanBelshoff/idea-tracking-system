import type { DataSource } from 'typeorm';
import { daysAgo, hoursFromNow, localTimeInZone } from '../common/dates.js';
import { PtBrLogger } from '../common/pt-br-logger.js';
import { IntegrationHour } from '../integration/entities.js';
import { INTEGRATION_LIMITS } from '../integration/modules.js';
import { getSetting } from '../organization/settings.service.js';
import { OpsHeartbeat, OpsMetricHour } from './entities.js';

const logger = new PtBrLogger('Observabilidade');

/** Batimento de máquina que sumiu (contêiner recriado) é apagado depois de 1 dia sem sinal. */
const HEARTBEAT_KEEP_DAYS = 1;

/**
 * Apaga o histórico por hora (métricas e consumo das integrações) que passou de `ops.retention_days` e os batimentos de máquinas que
 * sumiram. Idempotente: repetir não muda mais nada (CA-RN-92.5).
 */
export async function purgeOpsData(
  ds: DataSource,
  now = new Date(),
): Promise<{ metrics: number; heartbeats: number; integrations: number; webhooks: number; idempotency: number }> {
  const days = await getSetting(ds.manager, 'ops.retention_days');
  const metrics = await ds
    .createQueryBuilder()
    .delete()
    .from(OpsMetricHour)
    .where('hour < :cut', { cut: daysAgo(days, now) })
    .execute();
  // Consumo da API de integração (M16, RN-113): a mesma retenção da observabilidade.
  const integrations = await ds
    .createQueryBuilder()
    .delete()
    .from(IntegrationHour)
    .where('hour < :cut', { cut: daysAgo(days, now) })
    .execute();
  // Webhooks (M17): evento e entregas (a cascata leva as entregas junto) pela mesma retenção.
  const webhooks = await ds.query('DELETE FROM webhook_event WHERE created_at < $1', [daysAgo(days, now)]);
  // Chaves de idempotência da escrita (M18, RN-131): valem 24 horas.
  const idempotency = await ds.query('DELETE FROM integration_idempotency WHERE created_at < $1', [
    hoursFromNow(-INTEGRATION_LIMITS.idempotencyHours, now),
  ]);
  const heartbeats = await ds
    .createQueryBuilder()
    .delete()
    .from(OpsHeartbeat)
    .where('last_seen_at < :cut', { cut: daysAgo(HEARTBEAT_KEEP_DAYS, now) })
    .execute();
  return {
    metrics: metrics.affected ?? 0,
    heartbeats: heartbeats.affected ?? 0,
    integrations: integrations.affected ?? 0,
    webhooks: Array.isArray(webhooks) ? Number(webhooks[1] ?? 0) : 0,
    idempotency: Array.isArray(idempotency) ? Number(idempotency[1] ?? 0) : 0,
  };
}

/**
 * Manutenção chamada pelo disparo de cada minuto do worker: a limpeza roda uma vez por hora, no
 * minuto 10 (no fuso da instalação). Nunca lança: falha vai para o log e o disparo segue.
 */
export async function runOpsMaintenance(ds: DataSource, now = new Date()) {
  try {
    const timeZone = await getSetting(ds.manager, 'organization.timezone');
    if (!localTimeInZone(now, timeZone).endsWith(':10')) return null;
    return await purgeOpsData(ds, now);
  } catch (error) {
    logger.warn(`Falha na limpeza da observabilidade: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
