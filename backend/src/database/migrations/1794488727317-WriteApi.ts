import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate WriteApi`. Revise antes de publicar. */
export class WriteApi1794488727317 implements MigrationInterface {
  name = 'WriteApi1794488727317';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "integration_idempotency" ("integration_id" uuid NOT NULL, "route" character varying(200) NOT NULL, "key" character varying(64) NOT NULL, "request_hash" character varying(64) NOT NULL, "state" character varying(12) NOT NULL, "status" integer, "response" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_integration_idempotency_state" CHECK (state IN (\'in_progress\', \'done\')), CONSTRAINT "PK_a50cb779c3261012cc867196dd9" PRIMARY KEY ("integration_id", "route", "key"))',
    );
    await q.query('CREATE INDEX "ix_integration_idempotency_created" ON "integration_idempotency"  ("created_at") ');
    await q.query('ALTER TABLE "idea" ADD "source_integration_id" uuid');
    await q.query('ALTER TABLE "comment" ADD "source_integration_id" uuid');
    await q.query('ALTER TABLE "comment" DROP CONSTRAINT "FK_3ce66469b26697baa097f8da923"');
    await q.query('ALTER TABLE "comment" ALTER COLUMN "author_id" DROP NOT NULL');
    await q.query(
      'ALTER TABLE "idea" ADD CONSTRAINT "FK_4d89496fe71aa8a46ce2bd1bbbf" FOREIGN KEY ("source_integration_id") REFERENCES "integration"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "comment" ADD CONSTRAINT "FK_3ce66469b26697baa097f8da923" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "comment" ADD CONSTRAINT "FK_f3f562dfec448bc4699dd590b26" FOREIGN KEY ("source_integration_id") REFERENCES "integration"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    // Os CHECK de módulos passam a aceitar os oito (RN-126); o gerador não enxerga mudança de CHECK.
    await q.query('ALTER TABLE "integration" DROP CONSTRAINT "ck_integration_modules"');
    await q.query(
      `ALTER TABLE "integration" ADD CONSTRAINT "ck_integration_modules" CHECK (modules <@ ARRAY['ideas', 'indicators', 'campaigns', 'hall', 'entities', 'users', 'ideas_write', 'gains_write']::text[])`,
    );
    await q.query('ALTER TABLE "integration_hour" DROP CONSTRAINT "ck_integration_hour_module"');
    await q.query(
      `ALTER TABLE "integration_hour" ADD CONSTRAINT "ck_integration_hour_module" CHECK (module IN ('ideas', 'indicators', 'campaigns', 'hall', 'entities', 'users', 'ideas_write', 'gains_write'))`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    // Volta aos seis módulos: tira os de escrita das integrações e apaga o que só a escrita criou.
    await q.query(
      `UPDATE "integration" SET modules = array_remove(array_remove(modules, 'ideas_write'), 'gains_write')`,
    );
    await q.query(`DELETE FROM "integration_hour" WHERE module IN ('ideas_write', 'gains_write')`);
    await q.query('ALTER TABLE "integration_hour" DROP CONSTRAINT "ck_integration_hour_module"');
    await q.query(
      `ALTER TABLE "integration_hour" ADD CONSTRAINT "ck_integration_hour_module" CHECK (module IN ('ideas', 'indicators', 'campaigns', 'hall', 'entities', 'users'))`,
    );
    await q.query('ALTER TABLE "integration" DROP CONSTRAINT "ck_integration_modules"');
    await q.query(
      `ALTER TABLE "integration" ADD CONSTRAINT "ck_integration_modules" CHECK (modules <@ ARRAY['ideas', 'indicators', 'campaigns', 'hall', 'entities', 'users']::text[])`,
    );
    // Comentário de integração não tem autor: some junto, para a coluna voltar a ser obrigatória.
    await q.query('DELETE FROM "comment" WHERE author_id IS NULL');
    await q.query('ALTER TABLE "comment" DROP CONSTRAINT "FK_f3f562dfec448bc4699dd590b26"');
    await q.query('ALTER TABLE "comment" DROP CONSTRAINT "FK_3ce66469b26697baa097f8da923"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "FK_4d89496fe71aa8a46ce2bd1bbbf"');
    await q.query('ALTER TABLE "comment" ALTER COLUMN "author_id" SET NOT NULL');
    await q.query(
      'ALTER TABLE "comment" ADD CONSTRAINT "FK_3ce66469b26697baa097f8da923" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query('ALTER TABLE "comment" DROP COLUMN "source_integration_id"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "source_integration_id"');
    await q.query('DROP INDEX "public"."ix_integration_idempotency_created"');
    await q.query('DROP TABLE "integration_idempotency"');
  }
}
