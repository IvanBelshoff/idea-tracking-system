import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Branding`. Revise antes de publicar. */
export class Branding1794232674969 implements MigrationInterface {
  name = 'Branding1794232674969';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "organization_logo" ("variant" character varying(10) NOT NULL, "stored_name" character varying(60) NOT NULL, "width" integer NOT NULL, "height" integer NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8a51b530f67a5f7bc3c088b6f2e" PRIMARY KEY ("variant"))',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE "organization_logo"');
  }
}
