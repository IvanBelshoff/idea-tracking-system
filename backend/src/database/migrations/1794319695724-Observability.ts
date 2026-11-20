import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Observability`. Revise antes de publicar. */
export class Observability1794319695724 implements MigrationInterface {
  name = 'Observability1794319695724';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "ops_heartbeat" ("process" character varying(10) NOT NULL, "instance" character varying(100) NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, "memory_mb" integer NOT NULL, "event_loop_p99_ms" integer, "storage_free_pct" integer, "last_tick_ms" integer, "version" character varying(40) NOT NULL, CONSTRAINT "PK_fdd9c848516fb535e8181c1a6cc" PRIMARY KEY ("process", "instance"), CONSTRAINT "ck_ops_heartbeat_process" CHECK (process IN (\'api\', \'worker\')))',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE "ops_heartbeat"');
  }
}
