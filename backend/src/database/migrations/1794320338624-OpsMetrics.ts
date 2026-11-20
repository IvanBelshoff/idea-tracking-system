import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate OpsMetrics`. Revise antes de publicar. */
export class OpsMetrics1794320338624 implements MigrationInterface {
  name = 'OpsMetrics1794320338624';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "ops_metric_hour" ("hour" TIMESTAMP WITH TIME ZONE NOT NULL, "process" character varying(10) NOT NULL, "requests" integer NOT NULL DEFAULT \'0\', "errors_4xx" integer NOT NULL DEFAULT \'0\', "errors_5xx" integer NOT NULL DEFAULT \'0\', "rate_limited" integer NOT NULL DEFAULT \'0\', "logins_ok" integer NOT NULL DEFAULT \'0\', "logins_failed" integer NOT NULL DEFAULT \'0\', "latency_buckets" jsonb NOT NULL DEFAULT \'[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]\', "memory_mb" integer NOT NULL DEFAULT \'0\', "routes" jsonb NOT NULL DEFAULT \'[]\', "worker" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_ops_metric_hour_process" CHECK (process IN (\'api\', \'worker\')), CONSTRAINT "PK_fca470a8d46e09382874da07a0a" PRIMARY KEY ("hour", "process"))',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE "ops_metric_hour"');
  }
}
