import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Escrita à mão: garantias no banco para ideias (docs/MODELO-DE-DADOS.md, §5 e §9).
 *  - CHECK: Implementada exige data e resultado (RN-07); Não autorizada exige justificativa (RN-05);
 *    etapa com posição ≥ 1 e prevista ≥ início (RN-14, RN-16).
 *  - Índice parcial da fila (ideias não arquivadas, por estado e data de envio).
 *  - Histórico imutável (RN-38): UPDATE e TRUNCATE sempre recusados; DELETE só dentro da exclusão
 *    física autorizada pelo administrador (RN-11), que marca `its.purge_idea` com o id da ideia
 *    na própria transação. A exclusão em si fica no log de auditoria, que nunca aceita DELETE.
 */
export class IdeasGuards1793888229311 implements MigrationInterface {
  name = 'IdeasGuards1793888229311';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "idea" ADD CONSTRAINT "ck_idea_implemented"
      CHECK (status <> 'implemented' OR (implemented_at IS NOT NULL AND result_text IS NOT NULL))`);
    await q.query(`ALTER TABLE "idea" ADD CONSTRAINT "ck_idea_rejected"
      CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)`);
    await q.query('ALTER TABLE "step" ADD CONSTRAINT "ck_step_position" CHECK (position >= 1)');
    await q.query('ALTER TABLE "step" ADD CONSTRAINT "ck_step_dates" CHECK (due_date >= start_date)');
    await q.query('CREATE INDEX "ix_idea_queue" ON "idea" ("status", "submitted_at") WHERE archived_at IS NULL');

    await q.query(`
      CREATE OR REPLACE FUNCTION forbid_idea_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND current_setting('its.purge_idea', true) = OLD.idea_id::text THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'a tabela % é somente inserção (% recusado)', TG_TABLE_NAME, TG_OP
          USING ERRCODE = 'insufficient_privilege';
      END;
      $$`);
    await q.query(
      'CREATE TRIGGER idea_event_immutable BEFORE UPDATE OR DELETE ON "idea_event" FOR EACH ROW EXECUTE FUNCTION forbid_idea_event_mutation()',
    );
    await q.query(
      'CREATE TRIGGER idea_event_no_truncate BEFORE TRUNCATE ON "idea_event" FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TRIGGER idea_event_no_truncate ON "idea_event"');
    await q.query('DROP TRIGGER idea_event_immutable ON "idea_event"');
    await q.query('DROP FUNCTION forbid_idea_event_mutation()');
    await q.query('DROP INDEX "ix_idea_queue"');
    await q.query('ALTER TABLE "step" DROP CONSTRAINT "ck_step_dates"');
    await q.query('ALTER TABLE "step" DROP CONSTRAINT "ck_step_position"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "ck_idea_rejected"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "ck_idea_implemented"');
  }
}
