import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Communication`. Revise antes de publicar. */
export class Communication1793899496476 implements MigrationInterface {
  name = 'Communication1793899496476';

  async up(q: QueryRunner): Promise<void> {
    await q.query("CREATE TYPE \"public\".\"notification_email_state\" AS ENUM('none', 'pending', 'digested')");
    await q.query(
      'CREATE TABLE "notification" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "type" character varying(40) NOT NULL, "idea_id" uuid, "payload" jsonb NOT NULL, "in_app" boolean NOT NULL DEFAULT true, "email_state" "public"."notification_email_state" NOT NULL DEFAULT \'none\', "read_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_705b6c7cdf9b2c2ff7ac7872cb7" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_8256ab9a7f1a375da59e358ded" ON "notification"  ("idea_id") ');
    await q.query(
      'CREATE INDEX "ix_notification_email_pending" ON "notification"  ("user_id") WHERE email_state = \'pending\'',
    );
    await q.query('CREATE INDEX "ix_notification_user_read" ON "notification"  ("user_id", "read_at", "created_at") ');
    await q.query('CREATE TYPE "public"."notification_channel" AS ENUM(\'in_app\', \'email\')');
    await q.query(
      'CREATE TABLE "notification_preference" ("user_id" uuid NOT NULL, "event_type" character varying(40) NOT NULL, "channel" "public"."notification_channel" NOT NULL, "enabled" boolean NOT NULL, CONSTRAINT "PK_6e8ec67531e408bc587c829d8a1" PRIMARY KEY ("user_id", "event_type", "channel"))',
    );
    await q.query(
      'CREATE TABLE "alert_dedup" ("kind" character varying(30) NOT NULL, "target_id" uuid NOT NULL, "day" date NOT NULL, "user_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7f011d974235109914b8af402fd" PRIMARY KEY ("kind", "target_id", "day", "user_id"))',
    );
    await q.query(
      'CREATE TABLE "mail_provider" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "type" character varying(20) NOT NULL DEFAULT \'smtp\', "name" character varying(100) NOT NULL, "config_encrypted" bytea NOT NULL, "from_address" character varying(320) NOT NULL, "from_name" character varying(200), "active" boolean NOT NULL DEFAULT false, "last_test_at" TIMESTAMP WITH TIME ZONE, "last_test_ok" boolean, "last_test_error" text, "updated_by_id" uuid, CONSTRAINT "PK_ce451e934fed5defac80dd8cfe3" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "email_template" ("key" character varying(40) NOT NULL, "locale" character varying(10) NOT NULL, "subject" character varying(300) NOT NULL, "body" text NOT NULL, "updated_by_id" uuid, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9acb60ce0a5ea2e604339fe8042" PRIMARY KEY ("key", "locale"))',
    );
    await q.query("CREATE TYPE \"public\".\"email_status\" AS ENUM('pending', 'sent', 'failed')");
    await q.query(
      'CREATE TABLE "email_log" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "kind" character varying(40) NOT NULL, "user_id" uuid, "to_address" character varying(320) NOT NULL, "subject" character varying(300) NOT NULL, "body_encrypted" bytea NOT NULL, "status" "public"."email_status" NOT NULL DEFAULT \'pending\', "attempts" integer NOT NULL DEFAULT \'0\', "last_error" text, "queued_at" TIMESTAMP WITH TIME ZONE, "sent_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_edfd3f7225051fc07bdd63a22dc" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_e0a1ff4e21a00383b9aebb3568" ON "email_log"  ("user_id") ');
    await q.query('CREATE INDEX "ix_email_log_status_created" ON "email_log"  ("status", "created_at") ');
    await q.query('ALTER TABLE "user" ADD "deadline_alert_days" integer');
    await q.query('CREATE INDEX "ix_step_open_due" ON "step"  ("due_date") WHERE completed_at IS NULL');
    await q.query(
      'ALTER TABLE "notification" ADD CONSTRAINT "FK_928b7aa1754e08e1ed7052cb9d8" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "notification" ADD CONSTRAINT "FK_8256ab9a7f1a375da59e358ded1" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "notification_preference" ADD CONSTRAINT "FK_ff040d2d2e35c49b00525783829" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "alert_dedup" ADD CONSTRAINT "FK_7fccde535e1055c7f70e57d0554" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mail_provider" ADD CONSTRAINT "FK_36e2e9afc5637cb1261bdc1ba01" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "email_template" ADD CONSTRAINT "FK_bf591db8c1f58e34fa24fb58ebc" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "email_log" ADD CONSTRAINT "FK_e0a1ff4e21a00383b9aebb35687" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "email_log" DROP CONSTRAINT "FK_e0a1ff4e21a00383b9aebb35687"');
    await q.query('ALTER TABLE "email_template" DROP CONSTRAINT "FK_bf591db8c1f58e34fa24fb58ebc"');
    await q.query('ALTER TABLE "mail_provider" DROP CONSTRAINT "FK_36e2e9afc5637cb1261bdc1ba01"');
    await q.query('ALTER TABLE "alert_dedup" DROP CONSTRAINT "FK_7fccde535e1055c7f70e57d0554"');
    await q.query('ALTER TABLE "notification_preference" DROP CONSTRAINT "FK_ff040d2d2e35c49b00525783829"');
    await q.query('ALTER TABLE "notification" DROP CONSTRAINT "FK_8256ab9a7f1a375da59e358ded1"');
    await q.query('ALTER TABLE "notification" DROP CONSTRAINT "FK_928b7aa1754e08e1ed7052cb9d8"');
    await q.query('DROP INDEX "public"."ix_step_open_due"');
    await q.query('ALTER TABLE "user" DROP COLUMN "deadline_alert_days"');
    await q.query('DROP INDEX "public"."ix_email_log_status_created"');
    await q.query('DROP INDEX "public"."IDX_e0a1ff4e21a00383b9aebb3568"');
    await q.query('DROP TABLE "email_log"');
    await q.query('DROP TYPE "public"."email_status"');
    await q.query('DROP TABLE "email_template"');
    await q.query('DROP TABLE "mail_provider"');
    await q.query('DROP TABLE "alert_dedup"');
    await q.query('DROP TABLE "notification_preference"');
    await q.query('DROP TYPE "public"."notification_channel"');
    await q.query('DROP INDEX "public"."ix_notification_user_read"');
    await q.query('DROP INDEX "public"."ix_notification_email_pending"');
    await q.query('DROP INDEX "public"."IDX_8256ab9a7f1a375da59e358ded"');
    await q.query('DROP TABLE "notification"');
    await q.query('DROP TYPE "public"."notification_email_state"');
  }
}
