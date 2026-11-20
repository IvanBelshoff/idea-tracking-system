import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate PublicLookup`. Revise antes de publicar. */
export class PublicLookup1793967740136 implements MigrationInterface {
  name = 'PublicLookup1793967740136';

  async up(q: QueryRunner): Promise<void> {
    // Ideias já existentes recebem um código aleatório (dois UUID v4 do PostgreSQL, 244 bits, 64
    // caracteres hexadecimais); as novas usam 256 bits em base64url, gerados pela aplicação.
    await q.query('ALTER TABLE "idea" ADD "public_code" character varying(64)');
    await q.query(
      'UPDATE "idea" SET "public_code" = replace(gen_random_uuid()::text || gen_random_uuid()::text, \'-\', \'\')',
    );
    await q.query('ALTER TABLE "idea" ALTER COLUMN "public_code" SET NOT NULL');
    await q.query('ALTER TABLE "idea" ADD CONSTRAINT "UQ_113513feb5f6d9f52662bee193c" UNIQUE ("public_code")');
    await q.query('ALTER TABLE "idea" ADD "public_enabled" boolean NOT NULL DEFAULT true');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "idea" DROP COLUMN "public_enabled"');
    await q.query('ALTER TABLE "idea" DROP CONSTRAINT "UQ_113513feb5f6d9f52662bee193c"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "public_code"');
  }
}
