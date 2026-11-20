import 'reflect-metadata';
import { PgBoss } from 'pg-boss';
import { runApprovalJobs } from './approvals/approval-jobs.js';
import { minutesSince } from './common/dates.js';
import { PtBrLogger } from './common/pt-br-logger.js';
import {
  expireStuckEmails,
  runDailyDigest,
  runDeadlineAlerts,
  runSustainmentReminders,
  runTriageSlaAlerts,
} from './communication/jobs.js';
import { deliverEmail } from './communication/mail.js';
import { createDataSource } from './database/data-source.js';
import { runHallJobs } from './hall/hall-core.js';
import { deliverDue } from './integration/webhooks/webhook-sender.js';
import { pgBossTypeormAdapter } from './jobs/pg-boss-typeorm.adapter.js';
import { EMAIL_QUEUE, enqueuePendingEmails, setupQueues, TICK_QUEUE } from './jobs/queues.js';
import { AlertService } from './observability/alert.service.js';
import { metricsEnabled, processStartedAt } from './observability/config.js';
import { HealthService } from './observability/health.service.js';
import { writeHeartbeat } from './observability/heartbeat.js';
import { runOpsMaintenance } from './observability/retention.js';
import { flushWorkerMetrics } from './observability/worker-flush.js';
import { WorkerMetrics } from './observability/worker-stats.js';
import { runStoreExpiry } from './store/store-core.js';

/**
 * Processo de jobs (mesma imagem da API, outro comando): alertas de prazo, resumo diário e envio
 * de e-mail (M4). A API só grava; quem conversa com o servidor de e-mail é este processo.
 */
const logger = new PtBrLogger('Worker');
/** De quanto em quanto tempo o alerta de saúde confere (RN-94). */
const ALERT_EVERY_MINUTES = 5;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function main(): Promise<void> {
  const dataSource = createDataSource();
  await dataSource.initialize();

  const boss = new PgBoss({ db: pgBossTypeormAdapter(dataSource), schema: 'pgboss' });
  boss.on('error', (error) => logger.error(`Erro no pg-boss: ${error.message}`, error.stack));
  await boss.start();
  await setupQueues(boss);

  const drain = async () => {
    try {
      const count = await enqueuePendingEmails(dataSource, boss);
      if (count > 0) logger.log(`${count} e-mail(s) na fila de envio`);
    } catch (error) {
      logger.error(`Falha ao enfileirar e-mails: ${errorText(error)}`);
    }
  };

  // Sinal de vida do worker (RN-93): a saúde e o alerta enxergam o processo por aqui.
  const beat = async (lastTickMs: number | null) => {
    try {
      await writeHeartbeat(dataSource, { process: 'worker', startedAt: processStartedAt, lastTickMs });
    } catch (error) {
      logger.warn(`Não foi possível gravar o batimento do worker: ${errorText(error)}`);
    }
  };
  await beat(null);

  let lastStoreExpiryDay: string | null = null;
  let lastApprovalHour: string | null = null;
  const runTick = async () => {
    const alerts = await runDeadlineAlerts(dataSource);
    const triage = await runTriageSlaAlerts(dataSource);
    const sustainment = await runSustainmentReminders(dataSource);
    const hall = await runHallJobs(dataSource);
    // Validade do saldo da loja (RN-162): uma vez por dia (a conta é idempotente, mas não precisa rodar a cada minuto).
    const today = new Date().toISOString().slice(0, 10);
    const storeExpired = lastStoreExpiryDay === today ? 0 : await runStoreExpiry(dataSource);
    lastStoreExpiryDay = today;
    // Aprovação de outras áreas (RN-189): prazo vencido e lembretes, uma vez por hora (idempotente).
    const hour = new Date().toISOString().slice(0, 13);
    const approvals = lastApprovalHour === hour ? { expired: 0, reminders: 0 } : await runApprovalJobs(dataSource);
    lastApprovalHour = hour;
    const digests = await runDailyDigest(dataSource);
    const expired = await expireStuckEmails(dataSource);
    const purged = await runOpsMaintenance(dataSource);
    if (alerts > 0) logger.log(`${alerts} alerta(s) de prazo criado(s)`);
    if (triage > 0) logger.log(`${triage} alerta(s) de triagem atrasada criado(s)`);
    if (sustainment > 0) logger.log(`${sustainment} lembrete(s) de sustentação criado(s)`);
    if (hall.expired > 0) logger.log(`${hall.expired} destaque(s) do Hall foram para o Hall da fama`);
    if (storeExpired > 0) logger.log(`Saldo da loja: pontos vencidos de ${storeExpired} pessoa(s)`);
    if (approvals.expired > 0) logger.log(`${approvals.expired} pedido(s) de aprovação vencido(s)`);
    if (approvals.reminders > 0) logger.log(`${approvals.reminders} lembrete(s) de aprovação enviado(s)`);
    if (hall.created > 0) logger.log(`${hall.created} destaque(s) do Hall criado(s) pela entrada automática`);
    if (digests > 0) logger.log(`${digests} resumo(s) diário(s) preparado(s)`);
    if (expired > 0) logger.warn(`${expired} e-mail(s) sem conclusão marcados como falha`);
    if (
      purged &&
      (purged.metrics > 0 ||
        purged.heartbeats > 0 ||
        purged.integrations > 0 ||
        purged.webhooks > 0 ||
        purged.idempotency > 0)
    ) {
      logger.log(
        `Limpeza da observabilidade: ${purged.metrics} hora(s) de métricas, ${purged.integrations} hora(s) de consumo das integrações, ${purged.webhooks} aviso(s) de webhook, ${purged.idempotency} chave(s) de idempotência e ${purged.heartbeats} batimento(s) antigos apagados`,
      );
    }
    await drain();
  };

  // Alerta de saúde (RN-94): conferido a cada 5 minutos; o estado fica no banco, então reiniciar não repete aviso.
  const alerts = new AlertService(dataSource, new HealthService(dataSource));
  let lastAlertCheck: Date | null = null;

  // Métricas do worker (RN-92): disparos, duração e resultado dos e-mails, gravados a cada disparo.
  const workerMetrics = new WorkerMetrics();

  await boss.work(TICK_QUEUE, async () => {
    if (!lastAlertCheck || minutesSince(lastAlertCheck) >= ALERT_EVERY_MINUTES) {
      lastAlertCheck = new Date();
      await alerts.check(); // nunca lança
    }
    const tickStart = process.hrtime.bigint();
    let ok = true;
    try {
      await runTick();
    } catch (error) {
      ok = false;
      throw error;
    } finally {
      const ms = Math.round(Number(process.hrtime.bigint() - tickStart) / 1e6);
      if (metricsEnabled()) workerMetrics.recordTick(ms, ok);
      await flushWorkerMetrics(dataSource, workerMetrics);
      await beat(ms);
    }
  });

  await boss.work<{ emailId: string }>(EMAIL_QUEUE, async ([job]) => {
    if (!job) return;
    const outcome = await deliverEmail(dataSource, job.data.emailId);
    if (metricsEnabled()) workerMetrics.recordEmail(outcome);
    if (outcome === 'retry') throw new Error('Falha no envio; nova tentativa agendada');
    if (outcome === 'failed') logger.warn(`E-mail ${job.data.emailId} não enviado; veja "Envios com falha"`);
  });

  // A fila de saída também é conferida a cada 10 s (ex.: link de recuperação de senha).
  const timer = setInterval(() => void drain(), 10_000);
  // Webhooks de saída (M17, RN-121): as entregas devidas são pegas e enviadas a cada 5 s (nunca lança).
  const webhookTimer = setInterval(() => {
    deliverDue(dataSource)
      .then((n) => {
        if (n > 0) logger.log(`${n} entrega(s) de webhook tentada(s)`);
      })
      .catch((error) => logger.error(`Falha ao entregar webhooks: ${errorText(error)}`));
  }, 5_000);
  logger.log('Pronto para processar jobs');

  const shutdown = async (signal: string) => {
    logger.log(`${signal} recebido, encerrando...`);
    clearInterval(timer);
    clearInterval(webhookTimer);
    await boss.stop({ graceful: true });
    await dataSource.destroy();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal(`Falha ao iniciar: ${errorText(error)}`);
  process.exit(1);
});
