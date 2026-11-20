import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Webhooks`. Revise antes de publicar. */
export class Webhooks1794425750547 implements MigrationInterface {
  name = 'Webhooks1794425750547';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "webhook_subscription" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "integration_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "url" text NOT NULL, "events" text array NOT NULL DEFAULT \'{}\', "status" character varying(12) NOT NULL DEFAULT \'active\', "suspended_reason" character varying(12), "consecutive_failures" integer NOT NULL DEFAULT \'0\', "created_by_id" uuid, CONSTRAINT "uq_webhook_subscription_name" UNIQUE ("integration_id", "name"), CONSTRAINT "ck_webhook_subscription_reason" CHECK (suspended_reason IS NULL OR suspended_reason IN (\'admin\', \'failures\')), CONSTRAINT "ck_webhook_subscription_status" CHECK (status IN (\'active\', \'suspended\')), CONSTRAINT "PK_b52cb4811c5ada4f42896c37ba8" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_69348f70bc6663e4f294c82516" ON "webhook_subscription"  ("integration_id") ');
    await q.query(
      'CREATE TABLE "webhook_secret" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "subscription_id" uuid NOT NULL, "secret_encrypted" bytea NOT NULL, "prefix" character varying(12) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "retire_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "ck_webhook_secret_validity" CHECK (expires_at <= created_at + interval \'365 days\'), CONSTRAINT "PK_5846dcede2111cca14b94f259eb" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_4ab74643eaac8c24c2b5a67dd0" ON "webhook_secret"  ("subscription_id") ');
    await q.query(
      'CREATE TABLE "webhook_event" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "type" character varying(40) NOT NULL, "data" jsonb NOT NULL, "entity_id" uuid, "origin_integration_id" uuid, CONSTRAINT "PK_0f56d2f40f5ec823acf8e8edad1" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "webhook_delivery" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "event_id" uuid NOT NULL, "subscription_id" uuid NOT NULL, "state" character varying(10) NOT NULL DEFAULT \'pending\', "attempts" integer NOT NULL DEFAULT \'0\', "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_status" integer, "last_error" character varying(40), "delivered_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_webhook_delivery" UNIQUE ("event_id", "subscription_id"), CONSTRAINT "ck_webhook_delivery_state" CHECK (state IN (\'pending\', \'delivered\', \'failed\')), CONSTRAINT "PK_b1ae290239a778f12399db91354" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_236a6a1218756223393d1fb5ac" ON "webhook_delivery"  ("subscription_id") ');
    await q.query(
      'CREATE INDEX "ix_webhook_delivery_due" ON "webhook_delivery"  ("next_attempt_at") WHERE state = \'pending\'',
    );
    await q.query(
      'ALTER TABLE "webhook_subscription" ADD CONSTRAINT "FK_69348f70bc6663e4f294c825160" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "webhook_subscription" ADD CONSTRAINT "FK_80e48a48f81e5bc190af616a321" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "webhook_secret" ADD CONSTRAINT "FK_4ab74643eaac8c24c2b5a67dd00" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscription"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "webhook_event" ADD CONSTRAINT "FK_c67b048c9864b7a514ecd1d8877" FOREIGN KEY ("origin_integration_id") REFERENCES "integration"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "webhook_delivery" ADD CONSTRAINT "FK_b723a573cd78b4cff3404153ad1" FOREIGN KEY ("event_id") REFERENCES "webhook_event"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "webhook_delivery" ADD CONSTRAINT "FK_236a6a1218756223393d1fb5acc" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscription"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "webhook_delivery" DROP CONSTRAINT "FK_236a6a1218756223393d1fb5acc"');
    await q.query('ALTER TABLE "webhook_delivery" DROP CONSTRAINT "FK_b723a573cd78b4cff3404153ad1"');
    await q.query('ALTER TABLE "webhook_event" DROP CONSTRAINT "FK_c67b048c9864b7a514ecd1d8877"');
    await q.query('ALTER TABLE "webhook_secret" DROP CONSTRAINT "FK_4ab74643eaac8c24c2b5a67dd00"');
    await q.query('ALTER TABLE "webhook_subscription" DROP CONSTRAINT "FK_80e48a48f81e5bc190af616a321"');
    await q.query('ALTER TABLE "webhook_subscription" DROP CONSTRAINT "FK_69348f70bc6663e4f294c825160"');
    await q.query('DROP INDEX "public"."ix_webhook_delivery_due"');
    await q.query('DROP INDEX "public"."IDX_236a6a1218756223393d1fb5ac"');
    await q.query('DROP TABLE "webhook_delivery"');
    await q.query('DROP TABLE "webhook_event"');
    await q.query('DROP INDEX "public"."IDX_4ab74643eaac8c24c2b5a67dd0"');
    await q.query('DROP TABLE "webhook_secret"');
    await q.query('DROP INDEX "public"."IDX_69348f70bc6663e4f294c82516"');
    await q.query('DROP TABLE "webhook_subscription"');
  }
}
