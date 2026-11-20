import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate SsoAccess`. Revise antes de publicar. */
export class SsoAccess1794398886037 implements MigrationInterface {
  name = 'SsoAccess1794398886037';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "sso_provider" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "provider" character varying(20) NOT NULL, "client_id" character varying(200) NOT NULL, "tenant_id" character varying(100), "config_encrypted" bytea, "enabled" boolean NOT NULL DEFAULT false, "last_test_at" TIMESTAMP WITH TIME ZONE, "last_test_ok" boolean, "last_test_error" text, "updated_by_id" uuid, CONSTRAINT "UQ_0cd3449ee1cd6ced95e8691eb26" UNIQUE ("provider"), CONSTRAINT "ck_sso_provider_provider" CHECK (provider IN (\'microsoft\', \'google\')), CONSTRAINT "PK_4863b249a2a525793873a326b64" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "user_identity" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "provider" character varying(20) NOT NULL, "issuer" character varying(300) NOT NULL, "subject" character varying(300) NOT NULL, "email_at_link" character varying(320) NOT NULL, "last_login_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "ck_user_identity_provider" CHECK (provider IN (\'microsoft\', \'google\')), CONSTRAINT "PK_87b5856b206b5b77e6e2fa29508" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE UNIQUE INDEX "ux_user_identity_user_provider" ON "user_identity"  ("user_id", "provider") ');
    await q.query(
      'CREATE UNIQUE INDEX "ux_user_identity_subject" ON "user_identity"  ("provider", "issuer", "subject") ',
    );
    await q.query(
      'ALTER TABLE "sso_provider" ADD CONSTRAINT "FK_8fb537ec122b118a01972c2742a" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "user_identity" ADD CONSTRAINT "FK_2818839f889ab24f4077437753f" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "user_identity" DROP CONSTRAINT "FK_2818839f889ab24f4077437753f"');
    await q.query('ALTER TABLE "sso_provider" DROP CONSTRAINT "FK_8fb537ec122b118a01972c2742a"');
    await q.query('DROP INDEX "public"."ux_user_identity_subject"');
    await q.query('DROP INDEX "public"."ux_user_identity_user_provider"');
    await q.query('DROP TABLE "user_identity"');
    await q.query('DROP TABLE "sso_provider"');
  }
}
