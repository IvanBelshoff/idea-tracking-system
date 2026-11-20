import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Ideas`. Revise antes de publicar. */
export class Ideas1793888228311 implements MigrationInterface {
  name = 'Ideas1793888228311';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      "CREATE TYPE \"public\".\"idea_status\" AS ENUM('submitted', 'in_review', 'in_progress', 'implemented', 'rejected')",
    );
    await q.query(
      'CREATE TABLE "idea" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(30) NOT NULL, "title" character varying(200) NOT NULL, "description" text NOT NULL, "proposed_solution" text, "expected_gain" text, "status" "public"."idea_status" NOT NULL DEFAULT \'submitted\', "entity_id" uuid NOT NULL, "category_id" uuid, "external_ref" character varying(100), "author_id" uuid, "registered_by_id" uuid, "assigned_to_id" uuid, "submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL, "review_started_at" TIMESTAMP WITH TIME ZONE, "decided_at" TIMESTAMP WITH TIME ZONE, "implemented_at" TIMESTAMP WITH TIME ZONE, "rejection_reason" text, "result_text" text, "archived_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_a86f57146f67c102556edbf9281" UNIQUE ("code"), CONSTRAINT "PK_5096f543c484b349f5234da9d97" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_d7af1a6c1caf954e87c0866263" ON "idea"  ("author_id") ');
    await q.query('CREATE INDEX "ix_idea_assigned_status" ON "idea"  ("assigned_to_id", "status") ');
    await q.query('CREATE INDEX "ix_idea_entity_status" ON "idea"  ("entity_id", "status") ');
    await q.query(
      'CREATE TABLE "idea_category" ("idea_id" uuid NOT NULL, "category_id" uuid NOT NULL, CONSTRAINT "PK_30ab230bd15cbd9c28738de839f" PRIMARY KEY ("idea_id", "category_id"))',
    );
    await q.query(
      'CREATE TABLE "idea_sequence" ("year" integer NOT NULL, "last_value" integer NOT NULL, CONSTRAINT "PK_099e51b23e2fe822b0aa621e7cd" PRIMARY KEY ("year"))',
    );
    await q.query("CREATE TYPE \"public\".\"participant_role\" AS ENUM('author', 'executor', 'co_author')");
    await q.query(
      "CREATE TYPE \"public\".\"participant_origin\" AS ENUM('original', 'support', 'converged', 'manual')",
    );
    await q.query(
      'CREATE TABLE "idea_participant" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "idea_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" "public"."participant_role" NOT NULL, "origin" "public"."participant_origin" NOT NULL DEFAULT \'original\', "note" text, "added_by" uuid, CONSTRAINT "uq_idea_participant" UNIQUE ("idea_id", "user_id", "role"), CONSTRAINT "PK_7495c8c7e24f89854ae1b0ca3fa" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_b4bc22426fc78c28553898693c" ON "idea_participant"  ("idea_id") ');
    await q.query('CREATE INDEX "IDX_2a34dee21390e8fa76fc746e1e" ON "idea_participant"  ("user_id") ');
    await q.query(
      'CREATE TABLE "step" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "idea_id" uuid NOT NULL, "position" integer NOT NULL, "name" character varying(200) NOT NULL, "description" text, "assignee_id" uuid NOT NULL, "start_date" date NOT NULL, "due_date" date NOT NULL, "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_step_position" UNIQUE ("idea_id", "position"), CONSTRAINT "PK_70d386ace569c3d265e05db0cc7" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_af546b3661ae92fd5e51256c5b" ON "step"  ("assignee_id") ');
    await q.query('CREATE TYPE "public"."visibility" AS ENUM(\'public\', \'internal\')');
    await q.query(
      'CREATE TABLE "comment" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "idea_id" uuid NOT NULL, "author_id" uuid NOT NULL, "body" text NOT NULL, "visibility" "public"."visibility" NOT NULL, CONSTRAINT "PK_0b0e4bbc8415ec426f87f3a88e2" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "ix_comment_idea_created" ON "comment"  ("idea_id", "created_at") ');
    await q.query(
      'CREATE TABLE "idea_event" ("id" BIGSERIAL NOT NULL, "idea_id" uuid NOT NULL, "type" character varying(40) NOT NULL, "actor_id" uuid, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "reason" text, "data" jsonb NOT NULL, "visibility" "public"."visibility" NOT NULL, CONSTRAINT "PK_654ab92ebdefaab5ff5a0e31ebe" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "ix_idea_event_idea_at" ON "idea_event"  ("idea_id", "at") ');
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "FK_69834fef6d40cebb55f21c2e6db" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "FK_295231e6b24bee9dd4238d97f40" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "FK_d7af1a6c1caf954e87c0866263f" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "FK_4ce645d4a87c7bc20449341facc" FOREIGN KEY ("registered_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "FK_9b3a084b97ac074caf3e3016fd4" FOREIGN KEY ("assigned_to_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_category" ADD CONSTRAINT "FK_307464ba6e31b766b28ddf73e1c" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_category" ADD CONSTRAINT "FK_d243b752664b1f8b512c7ab0557" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_participant" ADD CONSTRAINT "FK_b4bc22426fc78c28553898693c8" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_participant" ADD CONSTRAINT "FK_2a34dee21390e8fa76fc746e1ee" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_participant" ADD CONSTRAINT "FK_aebffe36b55c721576109f11742" FOREIGN KEY ("added_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "step" ADD CONSTRAINT "FK_330b5fa7411ab52f4c3275ea772" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "step" ADD CONSTRAINT "FK_af546b3661ae92fd5e51256c5b1" FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "comment" ADD CONSTRAINT "FK_a5eb3e85bba237ee2a155e76805" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "comment" ADD CONSTRAINT "FK_3ce66469b26697baa097f8da923" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_event" ADD CONSTRAINT "FK_c48a28d01b71774ea37a63c6a47" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_event" ADD CONSTRAINT "FK_3cb34468fa39f0b6d6d076adf25" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "idea_event" DROP CONSTRAINT "FK_3cb34468fa39f0b6d6d076adf25"');
    await q.query('ALTER TABLE "idea_event" DROP CONSTRAINT "FK_c48a28d01b71774ea37a63c6a47"');
    await q.query('ALTER TABLE "comment" DROP CONSTRAINT "FK_3ce66469b26697baa097f8da923"');
    await q.query('ALTER TABLE "comment" DROP CONSTRAINT "FK_a5eb3e85bba237ee2a155e76805"');
    await q.query('ALTER TABLE "step" DROP CONSTRAINT "FK_af546b3661ae92fd5e51256c5b1"');
    await q.query('ALTER TABLE "step" DROP CONSTRAINT "FK_330b5fa7411ab52f4c3275ea772"');
    await q.query('ALTER TABLE "idea_participant" DROP CONSTRAINT "FK_aebffe36b55c721576109f11742"');
    await q.query('ALTER TABLE "idea_participant" DROP CONSTRAINT "FK_2a34dee21390e8fa76fc746e1ee"');
    await q.query('ALTER TABLE "idea_participant" DROP CONSTRAINT "FK_b4bc22426fc78c28553898693c8"');
    await q.query('ALTER TABLE "idea_category" DROP CONSTRAINT "FK_d243b752664b1f8b512c7ab0557"');
    await q.query('ALTER TABLE "idea_category" DROP CONSTRAINT "FK_307464ba6e31b766b28ddf73e1c"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "FK_9b3a084b97ac074caf3e3016fd4"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "FK_4ce645d4a87c7bc20449341facc"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "FK_d7af1a6c1caf954e87c0866263f"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "FK_295231e6b24bee9dd4238d97f40"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "FK_69834fef6d40cebb55f21c2e6db"');
    await q.query('DROP INDEX "public"."ix_idea_event_idea_at"');
    await q.query('DROP TABLE "idea_event"');
    await q.query('DROP INDEX "public"."ix_comment_idea_created"');
    await q.query('DROP TABLE "comment"');
    await q.query('DROP TYPE "public"."visibility"');
    await q.query('DROP INDEX "public"."IDX_af546b3661ae92fd5e51256c5b"');
    await q.query('DROP TABLE "step"');
    await q.query('DROP INDEX "public"."IDX_2a34dee21390e8fa76fc746e1e"');
    await q.query('DROP INDEX "public"."IDX_b4bc22426fc78c28553898693c"');
    await q.query('DROP TABLE "idea_participant"');
    await q.query('DROP TYPE "public"."participant_origin"');
    await q.query('DROP TYPE "public"."participant_role"');
    await q.query('DROP TABLE "idea_sequence"');
    await q.query('DROP TABLE "idea_category"');
    await q.query('DROP INDEX "public"."ix_idea_entity_status"');
    await q.query('DROP INDEX "public"."ix_idea_assigned_status"');
    await q.query('DROP INDEX "public"."IDX_d7af1a6c1caf954e87c0866263"');
    await q.query('DROP TABLE "idea"');
    await q.query('DROP TYPE "public"."idea_status"');
  }
}
