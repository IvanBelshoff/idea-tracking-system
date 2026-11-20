import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Sustainment`. Revise antes de publicar. */
export class Sustainment1793989618207 implements MigrationInterface {
  name = 'Sustainment1793989618207';

  async up(q: QueryRunner): Promise<void> {
    await q.query("CREATE TYPE \"public\".\"sustainment_status\" AS ENUM('pending', 'confirmed', 'contested')");
    await q.query(
      'CREATE TABLE "sustainment_review" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "idea_id" uuid NOT NULL, "due_on" date NOT NULL, "status" "public"."sustainment_status" NOT NULL DEFAULT \'pending\', "reviewed_by_id" uuid, "reviewed_at" TIMESTAMP WITH TIME ZONE, "note" text, CONSTRAINT "PK_e90f574366eb19ba3ad6de2580b" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_6d39863252268b8aa85007abd6" ON "sustainment_review"  ("idea_id") ');
    await q.query(
      'CREATE INDEX "ix_sustainment_pending_due" ON "sustainment_review"  ("due_on") WHERE status = \'pending\'',
    );
    await q.query(
      'ALTER TABLE "sustainment_review" ADD CONSTRAINT "FK_6d39863252268b8aa85007abd62" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "sustainment_review" ADD CONSTRAINT "FK_7d8151890d20c1322dae6d9c4bc" FOREIGN KEY ("reviewed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "sustainment_review" DROP CONSTRAINT "FK_7d8151890d20c1322dae6d9c4bc"');
    await q.query('ALTER TABLE "sustainment_review" DROP CONSTRAINT "FK_6d39863252268b8aa85007abd62"');
    await q.query('DROP INDEX "public"."ix_sustainment_pending_due"');
    await q.query('DROP INDEX "public"."IDX_6d39863252268b8aa85007abd6"');
    await q.query('DROP TABLE "sustainment_review"');
    await q.query('DROP TYPE "public"."sustainment_status"');
  }
}
