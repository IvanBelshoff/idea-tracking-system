import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Results`. Revise antes de publicar. */
export class Results1793987909896 implements MigrationInterface {
  name = 'Results1793987909896';

  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE TYPE "public"."measurement_direction" AS ENUM(\'increase\', \'decrease\')');
    await q.query(
      'CREATE TABLE "measurement" ("idea_id" uuid NOT NULL, "indicator" character varying(200) NOT NULL, "unit" character varying(40) NOT NULL, "direction" "public"."measurement_direction" NOT NULL, "baseline" numeric(18,4) NOT NULL, "target" numeric(18,4), "achieved" numeric(18,4), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f058847ac5db6b0c4ba42cbcacf" PRIMARY KEY ("idea_id"))',
    );
    await q.query("CREATE TYPE \"public\".\"gain_periodicity\" AS ENUM('once', 'monthly', 'yearly')");
    await q.query('CREATE TYPE "public"."gain_status" AS ENUM(\'declared\', \'validated\')');
    await q.query(
      'CREATE TABLE "financial_gain" ("idea_id" uuid NOT NULL, "currency" character(3) NOT NULL, "periodicity" "public"."gain_periodicity" NOT NULL, "estimated" numeric(14,2), "realized" numeric(14,2), "implementation_cost" numeric(14,2), "status" "public"."gain_status" NOT NULL DEFAULT \'declared\', "validated_by_id" uuid, "validated_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_gain_validated" CHECK (status <> \'validated\' OR (realized IS NOT NULL AND validated_at IS NOT NULL)), CONSTRAINT "ck_gain_non_negative" CHECK ((estimated IS NULL OR estimated >= 0) AND (realized IS NULL OR realized >= 0) AND (implementation_cost IS NULL OR implementation_cost >= 0)), CONSTRAINT "PK_7e071ace0a755e56571548f0ec7" PRIMARY KEY ("idea_id"))',
    );
    await q.query('CREATE TYPE "public"."step_model" AS ENUM(\'free\', \'pdca\')');
    await q.query('ALTER TABLE "idea" ADD "step_model" "public"."step_model" NOT NULL DEFAULT \'free\'');
    await q.query('ALTER TABLE "idea" ADD "standard_adopted" text');
    await q.query('ALTER TABLE "idea" ADD "is_replicable" boolean NOT NULL DEFAULT false');
    await q.query('ALTER TABLE "idea" ADD "origin_idea_id" uuid');
    await q.query("CREATE TYPE \"public\".\"pdca_phase\" AS ENUM('plan', 'do', 'check', 'act')");
    await q.query('ALTER TABLE "step" ADD "pdca_phase" "public"."pdca_phase"');
    await q.query('CREATE INDEX "IDX_8d962ed475f3cfde020146c2e7" ON "idea"  ("origin_idea_id") ');
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "FK_8d962ed475f3cfde020146c2e72" FOREIGN KEY ("origin_idea_id") REFERENCES "idea"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "measurement" ADD CONSTRAINT "FK_f058847ac5db6b0c4ba42cbcacf" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "financial_gain" ADD CONSTRAINT "FK_7e071ace0a755e56571548f0ec7" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "financial_gain" ADD CONSTRAINT "FK_8d7fd905b5d91c0be654c01aaf8" FOREIGN KEY ("validated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "financial_gain" DROP CONSTRAINT "FK_8d7fd905b5d91c0be654c01aaf8"');
    await q.query('ALTER TABLE "financial_gain" DROP CONSTRAINT "FK_7e071ace0a755e56571548f0ec7"');
    await q.query('ALTER TABLE "measurement" DROP CONSTRAINT "FK_f058847ac5db6b0c4ba42cbcacf"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "FK_8d962ed475f3cfde020146c2e72"');
    await q.query('DROP INDEX "public"."IDX_8d962ed475f3cfde020146c2e7"');
    await q.query('ALTER TABLE "step" DROP COLUMN "pdca_phase"');
    await q.query('DROP TYPE "public"."pdca_phase"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "origin_idea_id"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "is_replicable"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "standard_adopted"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "step_model"');
    await q.query('DROP TYPE "public"."step_model"');
    await q.query('DROP TABLE "financial_gain"');
    await q.query('DROP TYPE "public"."gain_status"');
    await q.query('DROP TYPE "public"."gain_periodicity"');
    await q.query('DROP TABLE "measurement"');
    await q.query('DROP TYPE "public"."measurement_direction"');
  }
}
