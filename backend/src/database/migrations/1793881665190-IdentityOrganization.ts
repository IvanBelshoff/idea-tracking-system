import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate IdentityOrganization`. Revise antes de publicar. */
export class IdentityOrganization1793881665190 implements MigrationInterface {
  name = 'IdentityOrganization1793881665190';

  async up(q: QueryRunner): Promise<void> {
    await q.query("CREATE TYPE \"public\".\"user_status\" AS ENUM('active', 'disabled', 'anonymized')");
    await q.query(
      'CREATE TABLE "user" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "email" citext NOT NULL, "name" character varying(200) NOT NULL, "password_hash" character varying(255), "status" "public"."user_status" NOT NULL DEFAULT \'active\', "locale" character varying(10) NOT NULL DEFAULT \'pt-BR\', "hide_name" boolean NOT NULL DEFAULT false, "failed_attempts" integer NOT NULL DEFAULT \'0\', "locked_until" TIMESTAMP WITH TIME ZONE, "last_login_at" TIMESTAMP WITH TIME ZONE, "anonymized_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "audit_log" ("id" BIGSERIAL NOT NULL, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actor_id" uuid, "action" character varying(64) NOT NULL, "target_type" character varying(64), "target_id" character varying(64), "data" jsonb NOT NULL, "ip" character varying(64), CONSTRAINT "PK_07fefa57f7f5ab8fc3f52b3ed0b" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_ba27cef5b8b2b1a756e06ebcc5" ON "audit_log"  ("at") ');
    await q.query('CREATE INDEX "IDX_15a6f5aad57db494c17986ed2e" ON "audit_log"  ("actor_id") ');
    await q.query(
      'CREATE TABLE "password_reset" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_0309de62e0cb0960ebb2cb65c95" UNIQUE ("token_hash"), CONSTRAINT "PK_8515e60a2cc41584fa4784f52ce" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_ad88301fdc79593dd222268a8b" ON "password_reset"  ("user_id") ');
    await q.query(
      'CREATE TABLE "role" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(100) NOT NULL, "description" text, "is_system" boolean NOT NULL DEFAULT false, "system_key" character varying(50), CONSTRAINT "UQ_ae4578dcaed5adff96595e61660" UNIQUE ("name"), CONSTRAINT "UQ_3d6cb29b6e6b7495ae2309bdd5a" UNIQUE ("system_key"), CONSTRAINT "PK_b36bcfe02fc8de3c57a8b2391c2" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "role_permission" ("role_id" uuid NOT NULL, "permission" character varying(64) NOT NULL, CONSTRAINT "PK_c19306b8b5bce5c1d852345dc6d" PRIMARY KEY ("role_id", "permission"))',
    );
    await q.query(
      'CREATE TABLE "session" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "ip" character varying(64), "user_agent" character varying(500), CONSTRAINT "UQ_a83507eb0338ac037780e02f2b9" UNIQUE ("token_hash"), CONSTRAINT "PK_f55da76ac1c3ac420f444d2ff11" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_30e98e8746699fb9af235410af" ON "session"  ("user_id") ');
    await q.query(
      'CREATE TABLE "entity" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(200) NOT NULL, "active" boolean NOT NULL DEFAULT true, "mpath" character varying DEFAULT \'\', "parent_id" uuid, CONSTRAINT "uq_entity_parent_name" UNIQUE ("parent_id", "name"), CONSTRAINT "PK_50a7741b415bc585fcf9c984332" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "user_role_scope" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "role_id" uuid NOT NULL, "entity_id" uuid NOT NULL, "include_children" boolean NOT NULL DEFAULT true, CONSTRAINT "uq_user_role_scope" UNIQUE ("user_id", "role_id", "entity_id"), CONSTRAINT "PK_06f67e4218ca6ddde1917cc1914" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_9ea928613823517a6c795e5cfe" ON "user_role_scope"  ("user_id") ');
    await q.query('CREATE INDEX "IDX_1d00f8ffc9f120f9e13f43dbac" ON "user_role_scope"  ("role_id") ');
    await q.query('CREATE INDEX "IDX_8e79013ff0c49b75c991229acc" ON "user_role_scope"  ("entity_id") ');
    await q.query(
      'CREATE TABLE "category" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(100) NOT NULL, "color" character varying(7) NOT NULL, "active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT \'0\', CONSTRAINT "UQ_23c05c292c439d77b0de816b500" UNIQUE ("name"), CONSTRAINT "PK_9c4e4a89e3674fc9f382d733f03" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "setting" ("key" character varying(100) NOT NULL, "value" jsonb NOT NULL, "updated_by" uuid, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1c4c95d773004250c157a744d6e" PRIMARY KEY ("key"))',
    );
    await q.query(
      'ALTER TABLE "audit_log" ADD CONSTRAINT "FK_15a6f5aad57db494c17986ed2e2" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "password_reset" ADD CONSTRAINT "FK_ad88301fdc79593dd222268a8b6" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "role_permission" ADD CONSTRAINT "FK_3d0a7155eafd75ddba5a7013368" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "session" ADD CONSTRAINT "FK_30e98e8746699fb9af235410aff" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "entity" ADD CONSTRAINT "FK_d4c7f27275d63e27a9896f32556" FOREIGN KEY ("parent_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "user_role_scope" ADD CONSTRAINT "FK_9ea928613823517a6c795e5cfea" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "user_role_scope" ADD CONSTRAINT "FK_1d00f8ffc9f120f9e13f43dbac3" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "user_role_scope" ADD CONSTRAINT "FK_8e79013ff0c49b75c991229accf" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "setting" ADD CONSTRAINT "FK_40a5e6248087ada1f7ec9a9b0f0" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "setting" DROP CONSTRAINT "FK_40a5e6248087ada1f7ec9a9b0f0"');
    await q.query('ALTER TABLE "user_role_scope" DROP CONSTRAINT "FK_8e79013ff0c49b75c991229accf"');
    await q.query('ALTER TABLE "user_role_scope" DROP CONSTRAINT "FK_1d00f8ffc9f120f9e13f43dbac3"');
    await q.query('ALTER TABLE "user_role_scope" DROP CONSTRAINT "FK_9ea928613823517a6c795e5cfea"');
    await q.query('ALTER TABLE "entity" DROP CONSTRAINT "FK_d4c7f27275d63e27a9896f32556"');
    await q.query('ALTER TABLE "session" DROP CONSTRAINT "FK_30e98e8746699fb9af235410aff"');
    await q.query('ALTER TABLE "role_permission" DROP CONSTRAINT "FK_3d0a7155eafd75ddba5a7013368"');
    await q.query('ALTER TABLE "password_reset" DROP CONSTRAINT "FK_ad88301fdc79593dd222268a8b6"');
    await q.query('ALTER TABLE "audit_log" DROP CONSTRAINT "FK_15a6f5aad57db494c17986ed2e2"');
    await q.query('DROP TABLE "setting"');
    await q.query('DROP TABLE "category"');
    await q.query('DROP INDEX "public"."IDX_8e79013ff0c49b75c991229acc"');
    await q.query('DROP INDEX "public"."IDX_1d00f8ffc9f120f9e13f43dbac"');
    await q.query('DROP INDEX "public"."IDX_9ea928613823517a6c795e5cfe"');
    await q.query('DROP TABLE "user_role_scope"');
    await q.query('DROP TABLE "entity"');
    await q.query('DROP INDEX "public"."IDX_30e98e8746699fb9af235410af"');
    await q.query('DROP TABLE "session"');
    await q.query('DROP TABLE "role_permission"');
    await q.query('DROP TABLE "role"');
    await q.query('DROP INDEX "public"."IDX_ad88301fdc79593dd222268a8b"');
    await q.query('DROP TABLE "password_reset"');
    await q.query('DROP INDEX "public"."IDX_15a6f5aad57db494c17986ed2e"');
    await q.query('DROP INDEX "public"."IDX_ba27cef5b8b2b1a756e06ebcc5"');
    await q.query('DROP TABLE "audit_log"');
    await q.query('DROP TABLE "user"');
    await q.query('DROP TYPE "public"."user_status"');
  }
}
