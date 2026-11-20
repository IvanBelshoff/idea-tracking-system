import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Integrations`. Revise antes de publicar. */
export class Integrations1794418811626 implements MigrationInterface {
  name = 'Integrations1794418811626';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "integration" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "name_key" character varying(120) NOT NULL, "owner" character varying(200) NOT NULL DEFAULT \'\', "status" character varying(12) NOT NULL DEFAULT \'active\', "modules" text array NOT NULL DEFAULT \'{}\', "include_email" boolean NOT NULL DEFAULT false, "rate_per_minute" integer NOT NULL DEFAULT \'60\', "ip_allowlist" text array NOT NULL DEFAULT \'{}\', "created_by_id" uuid, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_5fc978ca9ff0bcbc995a9cba384" UNIQUE ("name_key"), CONSTRAINT "ck_integration_modules" CHECK (modules <@ ARRAY[\'ideas\', \'indicators\', \'campaigns\', \'hall\', \'entities\', \'users\']::text[]), CONSTRAINT "ck_integration_ip_count" CHECK (cardinality(ip_allowlist) <= 20), CONSTRAINT "ck_integration_rate" CHECK (rate_per_minute BETWEEN 1 AND 600), CONSTRAINT "ck_integration_status" CHECK (status IN (\'active\', \'suspended\', \'revoked\')), CONSTRAINT "PK_f348d4694945d9dc4c7049a178a" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "integration_scope" ("integration_id" uuid NOT NULL, "entity_id" uuid NOT NULL, "include_children" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_ec2d3accaf10df175a59968ee2c" PRIMARY KEY ("integration_id", "entity_id"))',
    );
    await q.query(
      'CREATE TABLE "integration_token" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "integration_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "prefix" character varying(8) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "retire_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "last_used_at" TIMESTAMP WITH TIME ZONE, "created_by_id" uuid, CONSTRAINT "UQ_02a0c79d12383b800fc5dd4de85" UNIQUE ("token_hash"), CONSTRAINT "ck_integration_token_validity" CHECK (expires_at <= created_at + interval \'365 days\'), CONSTRAINT "PK_05394f5feacbc8f17d85116dd2a" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_1582281c2f5e6f4ae06e3e81f3" ON "integration_token"  ("integration_id") ');
    await q.query(
      'CREATE TABLE "integration_hour" ("hour" TIMESTAMP WITH TIME ZONE NOT NULL, "integration_id" uuid NOT NULL, "module" character varying(20) NOT NULL, "requests" integer NOT NULL DEFAULT \'0\', "errors_4xx" integer NOT NULL DEFAULT \'0\', "errors_5xx" integer NOT NULL DEFAULT \'0\', "rate_limited" integer NOT NULL DEFAULT \'0\', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_integration_hour_module" CHECK (module IN (\'ideas\', \'indicators\', \'campaigns\', \'hall\', \'entities\', \'users\')), CONSTRAINT "PK_2f38e16c70ea311edaa3b9367f3" PRIMARY KEY ("hour", "integration_id", "module"))',
    );
    await q.query(
      'ALTER TABLE "integration" ADD CONSTRAINT "FK_baec4023320597dbd36515f6134" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "integration_scope" ADD CONSTRAINT "FK_1c7c1be19e8b57456d5cbdbbb15" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "integration_scope" ADD CONSTRAINT "FK_c3e19ec17bd762f0e715af1115d" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "integration_token" ADD CONSTRAINT "FK_1582281c2f5e6f4ae06e3e81f3b" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "integration_token" ADD CONSTRAINT "FK_a29883d00599b106671bea258c6" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "integration_hour" ADD CONSTRAINT "FK_90ed50c7fc5275e1bd60a9c4de1" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "integration_hour" DROP CONSTRAINT "FK_90ed50c7fc5275e1bd60a9c4de1"');
    await q.query('ALTER TABLE "integration_token" DROP CONSTRAINT "FK_a29883d00599b106671bea258c6"');
    await q.query('ALTER TABLE "integration_token" DROP CONSTRAINT "FK_1582281c2f5e6f4ae06e3e81f3b"');
    await q.query('ALTER TABLE "integration_scope" DROP CONSTRAINT "FK_c3e19ec17bd762f0e715af1115d"');
    await q.query('ALTER TABLE "integration_scope" DROP CONSTRAINT "FK_1c7c1be19e8b57456d5cbdbbb15"');
    await q.query('ALTER TABLE "integration" DROP CONSTRAINT "FK_baec4023320597dbd36515f6134"');
    await q.query('DROP TABLE "integration_hour"');
    await q.query('DROP INDEX "public"."IDX_1582281c2f5e6f4ae06e3e81f3"');
    await q.query('DROP TABLE "integration_token"');
    await q.query('DROP TABLE "integration_scope"');
    await q.query('DROP TABLE "integration"');
  }
}
