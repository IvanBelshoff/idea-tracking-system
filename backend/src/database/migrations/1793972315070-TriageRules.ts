import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate TriageRules`. Revise antes de publicar. */
export class TriageRules1793972315070 implements MigrationInterface {
  name = 'TriageRules1793972315070';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "triage_rule" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "entity_id" uuid, "category_id" uuid, "assignee_id" uuid NOT NULL, "priority" integer NOT NULL DEFAULT \'0\', "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_b271d64dc6d29ad3d274237a916" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_70ff82f1f8eb8f95022e990d50" ON "triage_rule"  ("entity_id") ');
    await q.query(
      'ALTER TABLE "triage_rule" ADD CONSTRAINT "FK_70ff82f1f8eb8f95022e990d50a" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "triage_rule" ADD CONSTRAINT "FK_a7ebea2cd025d203330112dade8" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "triage_rule" ADD CONSTRAINT "FK_1d5c9d564a05cc66ef58c29fb74" FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "triage_rule" DROP CONSTRAINT "FK_1d5c9d564a05cc66ef58c29fb74"');
    await q.query('ALTER TABLE "triage_rule" DROP CONSTRAINT "FK_a7ebea2cd025d203330112dade8"');
    await q.query('ALTER TABLE "triage_rule" DROP CONSTRAINT "FK_70ff82f1f8eb8f95022e990d50a"');
    await q.query('DROP INDEX "public"."IDX_70ff82f1f8eb8f95022e990d50"');
    await q.query('DROP TABLE "triage_rule"');
  }
}
