import type { DataSource } from 'typeorm';

/** Chave da trava consultiva: impede duas instâncias da API de migrarem ao mesmo tempo. */
const MIGRATION_LOCK = 7_262_001;

/**
 * Aplica as migrações pendentes, segurando uma trava consultiva do Postgres durante a operação.
 * A API chama ao iniciar (docs/STACK-E-ARQUITETURA.md, §6); cada migração roda na sua transação.
 * `afterMigrations` roda ainda sob a trava (ex.: seed), para duas instâncias não colidirem.
 */
export async function runMigrations(dataSource: DataSource, afterMigrations?: () => Promise<void>): Promise<string[]> {
  const lock = dataSource.createQueryRunner();
  await lock.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    await afterMigrations?.();
    return applied.map((m) => m.name);
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    await lock.release();
  }
}
