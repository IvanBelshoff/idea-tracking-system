import { randomBytes } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { prepareDatabase } from '../../src/database/bootstrap.js';
import { ENTITIES } from '../../src/database/entities.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';

/**
 * Banco de dados temporário para testes.
 *
 * Regras (docs/STACK-E-ARQUITETURA.md, §10):
 *  - os testes nunca tocam o banco principal;
 *  - cada arquivo de teste cria um banco novo com o prefixo TEST_DATABASE_PREFIX,
 *    e só este módulo o descarta;
 *  - a conexão de DATABASE_URL é usada APENAS para criar e apagar bancos de teste
 *    (aponta para o banco de manutenção "postgres").
 */
export interface TestDatabase {
  name: string;
  url: string;
  dataSource: DataSource;
  drop(): Promise<void>;
}

const PREFIX_FORMAT = /^[a-z][a-z0-9_]*_$/;

export async function createTestDatabase(
  options: Pick<DataSourceOptions, 'entities' | 'migrations' | 'migrationsTableName'> & {
    synchronize?: boolean;
    beforeSync?: (admin: DataSource, url: string) => Promise<void>;
  },
): Promise<TestDatabase> {
  const adminUrl = process.env.DATABASE_URL;
  const prefix = process.env.TEST_DATABASE_PREFIX;
  if (!adminUrl) throw new Error('DATABASE_URL não definida (veja .env.example).');
  if (!prefix || !PREFIX_FORMAT.test(prefix)) {
    throw new Error('TEST_DATABASE_PREFIX ausente ou inválido (ex.: its_test_).');
  }

  const name = `${prefix}${randomBytes(5).toString('hex')}`;
  // Poucas conexões por banco de teste: dezenas de arquivos rodam em paralelo no mesmo PostgreSQL.
  const admin = new DataSource({ type: 'postgres', url: adminUrl, extra: { max: 1 } });
  await admin.initialize();
  await admin.query(`CREATE DATABASE "${name}"`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;

  // Pré-configuração do banco novo (extensões, funções) antes do synchronize.
  if (options.beforeSync) {
    const setup = new DataSource({ type: 'postgres', url: url.toString(), extra: { max: 1 } });
    await setup.initialize();
    try {
      await options.beforeSync(setup, url.toString());
    } finally {
      await setup.destroy();
    }
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url: url.toString(),
    entities: options.entities,
    migrations: options.migrations,
    migrationsTableName: options.migrationsTableName,
    synchronize: options.synchronize ?? true, // apenas nos spikes; a partir do M1 só migrações
    extra: { max: 3 },
  });
  await dataSource.initialize();

  return {
    name,
    url: url.toString(),
    dataSource,
    async drop() {
      if (dataSource.isInitialized) await dataSource.destroy();
      // Trava de segurança: só apaga bancos criados por este módulo.
      if (!name.startsWith(prefix)) throw new Error(`Recusando apagar "${name}"`);
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.destroy();
    },
  };
}

/**
 * Banco de teste com o esquema REAL: as migrações do zero e os dados de fábrica, exatamente
 * como a API faz ao iniciar (já exercita o CA-T.9 em toda execução).
 */
export async function createMigratedTestDatabase(): Promise<TestDatabase> {
  const db = await createTestDatabase({
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: 'typeorm_migration',
    synchronize: false,
  });
  try {
    await prepareDatabase(db.dataSource);
  } catch (error) {
    await db.drop();
    throw error;
  }
  return db;
}
