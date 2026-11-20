import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Escrita à mão (o gerador não cobre triggers nem classe de operador):
 *  - `audit_log` somente inserção: UPDATE/DELETE por linha e TRUNCATE recusados (RN-39; MODELO §9);
 *  - índice por prefixo no caminho da árvore de entidades (descendentes com LIKE 'x.%', RN-25).
 */
export class AuditImmutability1793881700000 implements MigrationInterface {
  name = 'AuditImmutability1793881700000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
    );
    await q.query(
      'CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()',
    );
    await q.query('CREATE INDEX "ix_entity_mpath" ON "entity" ("mpath" text_pattern_ops)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX "ix_entity_mpath"');
    await q.query('DROP TRIGGER audit_log_no_truncate ON "audit_log"');
    await q.query('DROP TRIGGER audit_log_immutable ON "audit_log"');
  }
}
