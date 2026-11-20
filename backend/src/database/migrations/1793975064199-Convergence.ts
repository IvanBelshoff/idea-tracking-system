import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Convergence`. Revise antes de publicar. */
export class Convergence1793975064199 implements MigrationInterface {
  name = 'Convergence1793975064199';

  async up(q: QueryRunner): Promise<void> {
    // Busca de semelhantes (RN-57): trigramas sobre título + descrição sem
    // acento. A função precisa ser IMMUTABLE para entrar num índice.
    await q.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await q.query('CREATE EXTENSION IF NOT EXISTS unaccent');
    await q.query(
      "CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$ SELECT public.unaccent('public.unaccent', $1) $$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT",
    );
    await q.query(
      `CREATE INDEX "ix_idea_search_trgm" ON "idea" USING gin (immutable_unaccent(lower(title || ' ' || description)) gin_trgm_ops)`,
    );
    await q.query('ALTER TABLE "idea" ADD "converged_into_id" uuid');
    await q.query('ALTER TABLE "idea" ADD "converged_at" TIMESTAMP WITH TIME ZONE');
    await q.query('ALTER TABLE "idea" ADD "converged_by_id" uuid');
    await q.query('ALTER TABLE "idea" ADD "converged_reason" text');
    await q.query('ALTER TABLE "idea_participant" ADD "source_idea_id" uuid');
    await q.query('CREATE INDEX "IDX_753c136104ebd10c1c8a66ca13" ON "idea"  ("converged_into_id") ');
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "ck_idea_not_self_converged" CHECK (converged_into_id IS NULL OR converged_into_id <> id)',
    );
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "FK_753c136104ebd10c1c8a66ca131" FOREIGN KEY ("converged_into_id") REFERENCES "idea"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "FK_23e9879ffd2d3807acff7e0d07f" FOREIGN KEY ("converged_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_participant" ADD CONSTRAINT "FK_9893523366dc70b14c0d9691df3" FOREIGN KEY ("source_idea_id") REFERENCES "idea"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX IF EXISTS "ix_idea_search_trgm"');
    await q.query('DROP FUNCTION IF EXISTS immutable_unaccent(text)');
    await q.query('ALTER TABLE "idea_participant" DROP CONSTRAINT "FK_9893523366dc70b14c0d9691df3"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "FK_23e9879ffd2d3807acff7e0d07f"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "FK_753c136104ebd10c1c8a66ca131"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "ck_idea_not_self_converged"');
    await q.query('DROP INDEX "public"."IDX_753c136104ebd10c1c8a66ca13"');
    await q.query('ALTER TABLE "idea_participant" DROP COLUMN "source_idea_id"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "converged_reason"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "converged_by_id"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "converged_at"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "converged_into_id"');
  }
}
