import { DataSource, type DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities.js';
import { MIGRATIONS } from './migrations/index.js';

/**
 * Opções da conexão. `synchronize` fica SEMPRE desligado: o esquema só muda por migração
 * (docs/STACK-E-ARQUITETURA.md; CA-T.9). Entidades e migrações em listas explícitas.
 */
type PostgresConnectionOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

export function dataSourceOptions(url = process.env.DATABASE_URL): PostgresConnectionOptions {
  if (!url) throw new Error('DATABASE_URL não definida.');
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: 'typeorm_migration',
    synchronize: false,
    // Conexões simultâneas por processo (padrão 10). Os testes usam menos: muitos rodam em paralelo.
    extra: { max: Number(process.env.DB_POOL_MAX ?? 10) },
  };
}

export function createDataSource(url = process.env.DATABASE_URL): DataSource {
  return new DataSource(dataSourceOptions(url));
}
