import type { PgBoss } from 'pg-boss';
import type { DataSource } from 'typeorm';
import { MAX_ATTEMPTS } from '../communication/mail.js';

/** Filas do pg-boss (docs/STACK-E-ARQUITETURA.md, §4). */
export const EMAIL_QUEUE = 'email-send';
export const TICK_QUEUE = 'notifications-tick';

interface PgClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export async function setupQueues(boss: PgBoss): Promise<void> {
  // Cada e-mail é um job: falhou, o pg-boss repete com espera crescente (30 s, 60 s, 120 s...).
  await boss.createQueue(EMAIL_QUEUE, {
    retryLimit: MAX_ATTEMPTS - 1,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 900,
  });
  // A cada minuto: alertas de prazo, resumo diário e limpeza. Um só worker executa cada disparo.
  await boss.createQueue(TICK_QUEUE, { retryLimit: 0, expireInSeconds: 300 });
  await boss.schedule(TICK_QUEUE, '* * * * *');
}

/**
 * Fila de saída → pg-boss, numa transação só: a linha só fica marcada como enfileirada se o job
 * foi criado (e vice-versa). Dois workers juntos não pegam a mesma linha (SKIP LOCKED).
 */
export async function enqueuePendingEmails(ds: DataSource, boss: PgBoss, limit = 50): Promise<number> {
  const runner = ds.createQueryRunner();
  const client = (await runner.connect()) as PgClient;
  try {
    await runner.startTransaction();
    const rows: { id: string }[] = await runner.query(
      `SELECT id FROM email_log WHERE status = 'pending' AND queued_at IS NULL
        ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    const db = {
      // biome-ignore lint/suspicious/noExplicitAny: contrato do pg-boss (IDatabase) usa any[]
      executeSql: (text: string, values?: unknown[]) => client.query(text, values) as Promise<{ rows: any[] }>,
    };
    for (const { id } of rows) {
      await boss.send(EMAIL_QUEUE, { emailId: id }, { db });
    }
    if (rows.length > 0) {
      await runner.query('UPDATE email_log SET queued_at = now() WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id)]);
    }
    await runner.commitTransaction();
    return rows.length;
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}
