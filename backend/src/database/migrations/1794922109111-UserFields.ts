import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate UserFields`. Revise antes de publicar. */
export class UserFields1794922109111 implements MigrationInterface {
  name = 'UserFields1794922109111';

  async up(q: QueryRunner): Promise<void> {
    await q.query("CREATE TYPE \"public\".\"user_field_kind\" AS ENUM('text', 'number', 'date', 'mask', 'choice')");
    await q.query(
      'CREATE TABLE "user_field" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "label_pt" character varying(60) NOT NULL, "label_en" character varying(60), "hint_pt" character varying(200), "hint_en" character varying(200), "kind" "public"."user_field_kind" NOT NULL, "config" jsonb NOT NULL DEFAULT \'{}\', "required" boolean NOT NULL DEFAULT false, "searchable" boolean NOT NULL DEFAULT false, "sensitive" boolean NOT NULL DEFAULT false, "admin_locked" boolean NOT NULL DEFAULT false, "integration" boolean NOT NULL DEFAULT false, "unique_values" boolean NOT NULL DEFAULT false, "active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT \'0\', CONSTRAINT "ck_user_field_sensitive_integration" CHECK (NOT (sensitive AND integration)), CONSTRAINT "ck_user_field_unique_open" CHECK (NOT unique_values OR kind <> \'choice\'), CONSTRAINT "PK_51e0c7c9d4e1667300bd748a13f" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "user_field_option" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "field_id" uuid NOT NULL, "label" character varying(80) NOT NULL, "active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT \'0\', CONSTRAINT "PK_b3ff9e97ebe58d34266df42cead" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_16899c22e315f7da733a5885f5" ON "user_field_option"  ("field_id") ');
    await q.query('CREATE UNIQUE INDEX "uq_user_field_option_label" ON "user_field_option"  ("field_id", "label") ');
    await q.query(
      'CREATE TABLE "user_field_value" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "field_id" uuid NOT NULL, "value" character varying(200), "option_id" uuid, "unique_key" character varying(200), CONSTRAINT "ck_user_field_value_one" CHECK ((value IS NULL) <> (option_id IS NULL)), CONSTRAINT "PK_2b14f799e7c735dbb6d90b258a0" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_061de2558aad058dbd9b0502a8" ON "user_field_value"  ("field_id") ');
    await q.query('CREATE INDEX "IDX_8098a13ecaab61828961b0b67b" ON "user_field_value"  ("option_id") ');
    await q.query(
      'CREATE UNIQUE INDEX "uq_user_field_value_unique" ON "user_field_value"  ("field_id", "unique_key") WHERE unique_key IS NOT NULL',
    );
    await q.query('CREATE UNIQUE INDEX "uq_user_field_value_user" ON "user_field_value"  ("user_id", "field_id") ');
    await q.query(
      'CREATE TABLE "idea_field_value" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "idea_id" uuid NOT NULL, "field_id" uuid NOT NULL, "option_id" uuid NOT NULL, "label" character varying(80) NOT NULL, CONSTRAINT "PK_c9afdaea67608dd4139e8dea12e" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_fa0ab7ce993654b498ef522487" ON "idea_field_value"  ("field_id") ');
    await q.query('CREATE INDEX "IDX_e2d245e2bb6086614a63895d75" ON "idea_field_value"  ("option_id") ');
    await q.query('CREATE UNIQUE INDEX "uq_idea_field_value" ON "idea_field_value"  ("idea_id", "field_id") ');
    await q.query(
      'ALTER TABLE "user_field_option" ADD CONSTRAINT "FK_16899c22e315f7da733a5885f57" FOREIGN KEY ("field_id") REFERENCES "user_field"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "user_field_value" ADD CONSTRAINT "FK_d1b2872faf3cae952d99ba84796" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "user_field_value" ADD CONSTRAINT "FK_061de2558aad058dbd9b0502a81" FOREIGN KEY ("field_id") REFERENCES "user_field"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "user_field_value" ADD CONSTRAINT "FK_8098a13ecaab61828961b0b67bc" FOREIGN KEY ("option_id") REFERENCES "user_field_option"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_field_value" ADD CONSTRAINT "FK_9d5d933c9dfd48e62ba6ed40479" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_field_value" ADD CONSTRAINT "FK_fa0ab7ce993654b498ef522487b" FOREIGN KEY ("field_id") REFERENCES "user_field"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_field_value" ADD CONSTRAINT "FK_e2d245e2bb6086614a63895d759" FOREIGN KEY ("option_id") REFERENCES "user_field_option"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "idea_field_value" DROP CONSTRAINT "FK_e2d245e2bb6086614a63895d759"');
    await q.query('ALTER TABLE "idea_field_value" DROP CONSTRAINT "FK_fa0ab7ce993654b498ef522487b"');
    await q.query('ALTER TABLE "idea_field_value" DROP CONSTRAINT "FK_9d5d933c9dfd48e62ba6ed40479"');
    await q.query('ALTER TABLE "user_field_value" DROP CONSTRAINT "FK_8098a13ecaab61828961b0b67bc"');
    await q.query('ALTER TABLE "user_field_value" DROP CONSTRAINT "FK_061de2558aad058dbd9b0502a81"');
    await q.query('ALTER TABLE "user_field_value" DROP CONSTRAINT "FK_d1b2872faf3cae952d99ba84796"');
    await q.query('ALTER TABLE "user_field_option" DROP CONSTRAINT "FK_16899c22e315f7da733a5885f57"');
    await q.query('DROP INDEX "public"."uq_idea_field_value"');
    await q.query('DROP INDEX "public"."IDX_e2d245e2bb6086614a63895d75"');
    await q.query('DROP INDEX "public"."IDX_fa0ab7ce993654b498ef522487"');
    await q.query('DROP TABLE "idea_field_value"');
    await q.query('DROP INDEX "public"."uq_user_field_value_user"');
    await q.query('DROP INDEX "public"."uq_user_field_value_unique"');
    await q.query('DROP INDEX "public"."IDX_8098a13ecaab61828961b0b67b"');
    await q.query('DROP INDEX "public"."IDX_061de2558aad058dbd9b0502a8"');
    await q.query('DROP TABLE "user_field_value"');
    await q.query('DROP INDEX "public"."uq_user_field_option_label"');
    await q.query('DROP INDEX "public"."IDX_16899c22e315f7da733a5885f5"');
    await q.query('DROP TABLE "user_field_option"');
    await q.query('DROP TABLE "user_field"');
    await q.query('DROP TYPE "public"."user_field_kind"');
  }
}
