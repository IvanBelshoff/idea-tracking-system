import type { DataSource } from 'typeorm';
import { seedFactoryRoles } from '../identity-access/factory-roles.js';
import { runMigrations } from './migrate.js';

/**
 * Prepara o banco ao iniciar a API: migrações pendentes (com trava) e dados de fábrica
 * idempotentes. Sem usuário nem senha padrão: o administrador nasce no assistente (RN-43).
 */
export async function prepareDatabase(dataSource: DataSource): Promise<string[]> {
  return runMigrations(dataSource, () => dataSource.transaction((m) => seedFactoryRoles(m)));
}
