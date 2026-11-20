import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate OpsAlertState`. Revise antes de publicar. */
export class OpsAlertState1794320947761 implements MigrationInterface {
  name = 'OpsAlertState1794320947761';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "ops_alert_state" ("item_key" character varying(40) NOT NULL, "state" character varying(10) NOT NULL DEFAULT \'ok\', "clean_checks" integer NOT NULL DEFAULT \'0\', "last_failure_notice_at" TIMESTAMP WITH TIME ZONE, "silenced" boolean NOT NULL DEFAULT false, "since" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_ops_alert_state_state" CHECK (state IN (\'ok\', \'failed\')), CONSTRAINT "PK_e6e2cd15c75e84c4ab89b6b5b26" PRIMARY KEY ("item_key"))',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE "ops_alert_state"');
  }
}
