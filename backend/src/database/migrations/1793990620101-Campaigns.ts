import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Campaigns`. Revise antes de publicar. */
export class Campaigns1793990620101 implements MigrationInterface {
  name = 'Campaigns1793990620101';

  async up(q: QueryRunner): Promise<void> {
    await q.query("CREATE TYPE \"public\".\"campaign_goal_type\" AS ENUM('ideas', 'gain', 'qualitative')");
    await q.query("CREATE TYPE \"public\".\"campaign_status\" AS ENUM('draft', 'active', 'closed')");
    await q.query(
      'CREATE TABLE "campaign" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(200) NOT NULL, "objective" text NOT NULL, "starts_on" date NOT NULL, "ends_on" date NOT NULL, "goal_type" "public"."campaign_goal_type" NOT NULL, "goal_value" numeric(14,2), "goal_text" character varying(500), "reward_note" text, "status" "public"."campaign_status" NOT NULL DEFAULT \'draft\', "created_by_id" uuid, "closed_at" TIMESTAMP WITH TIME ZONE, "summary" jsonb, CONSTRAINT "ck_campaign_goal" CHECK (goal_type = \'qualitative\' OR goal_value > 0), CONSTRAINT "ck_campaign_period" CHECK (ends_on >= starts_on), CONSTRAINT "PK_0ce34d26e7f2eb316a3a592cdc4" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "campaign_entity" ("campaign_id" uuid NOT NULL, "entity_id" uuid NOT NULL, CONSTRAINT "PK_936de019d95f5d4f4b80495561d" PRIMARY KEY ("campaign_id", "entity_id"))',
    );
    await q.query(
      'CREATE TABLE "campaign_category" ("campaign_id" uuid NOT NULL, "category_id" uuid NOT NULL, CONSTRAINT "PK_41d07338940ea49a4b7678b3a8d" PRIMARY KEY ("campaign_id", "category_id"))',
    );
    await q.query('ALTER TABLE "idea" ADD "campaign_id" uuid');
    await q.query('CREATE INDEX "IDX_33d5a1b7bb6fa1b44873453856" ON "idea"  ("campaign_id") ');
    await q.query(
      'ALTER TABLE "campaign" ADD CONSTRAINT "FK_64a40b9e433948738c2162d4fec" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "campaign_entity" ADD CONSTRAINT "FK_e2432705fe0ba4ac366eb71465f" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "campaign_entity" ADD CONSTRAINT "FK_1888441b6c7b121257e5627ddd6" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "campaign_category" ADD CONSTRAINT "FK_069c11933e8b5744e240d111e2a" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "campaign_category" ADD CONSTRAINT "FK_fd0b3528cbca5257154853d2fb8" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "FK_33d5a1b7bb6fa1b448734538565" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "FK_33d5a1b7bb6fa1b448734538565"');
    await q.query('ALTER TABLE "campaign_category" DROP CONSTRAINT "FK_fd0b3528cbca5257154853d2fb8"');
    await q.query('ALTER TABLE "campaign_category" DROP CONSTRAINT "FK_069c11933e8b5744e240d111e2a"');
    await q.query('ALTER TABLE "campaign_entity" DROP CONSTRAINT "FK_1888441b6c7b121257e5627ddd6"');
    await q.query('ALTER TABLE "campaign_entity" DROP CONSTRAINT "FK_e2432705fe0ba4ac366eb71465f"');
    await q.query('ALTER TABLE "campaign" DROP CONSTRAINT "FK_64a40b9e433948738c2162d4fec"');
    await q.query('DROP INDEX "public"."IDX_33d5a1b7bb6fa1b44873453856"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "campaign_id"');
    await q.query('DROP TABLE "campaign_category"');
    await q.query('DROP TABLE "campaign_entity"');
    await q.query('DROP TABLE "campaign"');
    await q.query('DROP TYPE "public"."campaign_status"');
    await q.query('DROP TYPE "public"."campaign_goal_type"');
  }
}
