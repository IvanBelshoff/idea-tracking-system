import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Base escrita à mão (antes das tabelas):
 *  - `citext`: e-mail sem diferenciar maiúsculas (login por e-mail, RN-42);
 *  - `forbid_mutation()`: função dos triggers que tornam tabelas "somente inserção"
 *    (`audit_log` no M1, `idea_event` no M2; docs/MODELO-DE-DADOS.md, §9).
 */
export class Extensions1762300000000 implements MigrationInterface {
  name = 'Extensions1762300000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE EXTENSION IF NOT EXISTS citext');
    await q.query(`
      CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'a tabela % é somente inserção (% recusado)', TG_TABLE_NAME, TG_OP
          USING ERRCODE = 'insufficient_privilege';
      END;
      $$`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP FUNCTION IF EXISTS forbid_mutation()');
    await q.query('DROP EXTENSION IF EXISTS citext');
  }
}
