/**
 * Gera uma migração com a diferença entre as entidades e o esquema produzido pelas migrações
 * existentes. Ferramenta de desenvolvimento.
 *
 * Uso (na pasta backend):  pnpm migration:generate NomeDaMigracao
 *
 * Cria um banco TEMPORÁRIO (prefixo `its_gen_`) a partir do banco de manutenção de DATABASE_URL,
 * roda as migrações, compara com as entidades, escreve o arquivo em src/database/migrations,
 * registra em migrations/index.ts e apaga o banco temporário. Nunca toca o banco da aplicação.
 * Revise o arquivo gerado: índices com classe de operador, triggers e dados vão à mão.
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';

const name = process.argv[2];
if (!name || !/^[A-Z][A-Za-z0-9]+$/.test(name)) {
  console.error('Informe o nome em PascalCase. Ex.: pnpm migration:generate IdentityOrganization');
  process.exit(1);
}
if (existsSync('.env')) process.loadEnvFile('.env');
const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL não definida (banco de manutenção).');

const tempName = `its_gen_${randomBytes(5).toString('hex')}`;
const admin = new DataSource({ type: 'postgres', url: adminUrl });
await admin.initialize();
await admin.query(`CREATE DATABASE "${tempName}"`);
const url = new URL(adminUrl);
url.pathname = `/${tempName}`;
const ds = createDataSource(url.toString());

try {
  await ds.initialize();
  await ds.runMigrations({ transaction: 'each' });
  const sql = await ds.driver.createSchemaBuilder().log();
  if (sql.upQueries.length === 0) {
    console.log('Nada a gerar: as entidades já batem com as migrações.');
  } else {
    const timestamp = Date.now();
    const className = `${name}${timestamp}`;
    const fmt = (qs: { query: string; parameters?: unknown[] }[]) =>
      qs
        .map(
          (q) =>
            `    await q.query(${JSON.stringify(q.query)}${q.parameters?.length ? `, ${JSON.stringify(q.parameters)}` : ''});`,
        )
        .join('\n');
    const file = `import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por \`pnpm migration:generate ${name}\`. Revise antes de publicar. */
export class ${className} implements MigrationInterface {
  name = '${className}';

  async up(q: QueryRunner): Promise<void> {
${fmt(sql.upQueries)}
  }

  async down(q: QueryRunner): Promise<void> {
${fmt([...sql.downQueries].reverse())}
  }
}
`;
    const dir = join('src', 'database', 'migrations');
    const fileName = `${timestamp}-${name}`;
    writeFileSync(join(dir, `${fileName}.ts`), file);

    const indexPath = join(dir, 'index.ts');
    let index = readFileSync(indexPath, 'utf8');
    const lastImport = index.lastIndexOf("from './");
    const eol = index.indexOf('\n', lastImport);
    index = `${index.slice(0, eol + 1)}import { ${className} } from './${fileName}.js';\n${index.slice(eol + 1)}`;
    // Acrescenta ao fim da lista, esteja ela numa linha só ou quebrada pelo formatador (vírgula final).
    index = index.replace(/,?\s*\];\s*$/, `,\n  ${className},\n];\n`);
    writeFileSync(indexPath, index);
    console.log(`Gerada: ${join(dir, `${fileName}.ts`)} (${sql.upQueries.length} instruções). Rode "pnpm format".`);
  }
} finally {
  if (ds.isInitialized) await ds.destroy();
  // Trava de segurança: só apaga o banco temporário criado acima.
  if (tempName.startsWith('its_gen_')) await admin.query(`DROP DATABASE IF EXISTS "${tempName}" WITH (FORCE)`);
  await admin.destroy();
}
