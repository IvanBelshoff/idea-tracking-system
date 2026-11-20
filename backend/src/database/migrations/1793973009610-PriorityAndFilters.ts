import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate PriorityAndFilters`. Revise antes de publicar. */
export class PriorityAndFilters1793973009610 implements MigrationInterface {
  name = 'PriorityAndFilters1793973009610';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "saved_filter" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "definition" jsonb NOT NULL, CONSTRAINT "PK_efff8142c6db3d6ed6f47bc2719" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_ac2504faca9526903410012192" ON "saved_filter"  ("user_id") ');
    await q.query('ALTER TABLE "idea" ADD "impact" smallint');
    await q.query('ALTER TABLE "idea" ADD "effort" smallint');
    await q.query('ALTER TABLE "idea" ADD "priority_score" real');
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "ck_idea_priority" CHECK ((impact IS NULL OR impact BETWEEN 1 AND 5) AND (effort IS NULL OR effort BETWEEN 1 AND 5))',
    );
    await q.query(
      'ALTER TABLE "saved_filter" ADD CONSTRAINT "FK_ac2504faca95269034100121927" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "saved_filter" DROP CONSTRAINT "FK_ac2504faca95269034100121927"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "ck_idea_priority"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "priority_score"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "effort"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "impact"');
    await q.query('DROP INDEX "public"."IDX_ac2504faca9526903410012192"');
    await q.query('DROP TABLE "saved_filter"');
  }
}
