import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M20 (RN-144, RN-145): escolha da foto e cor/fonte por pessoa; a foto passa a ter origem (uma por origem)
 * e cada provedor do login corporativo ganha a opção de oferecer a foto. Gerada por
 * `pnpm migration:generate PeopleAttachments` e revisada.
 */
export class PeopleAttachments1794509471722 implements MigrationInterface {
  name = 'PeopleAttachments1794509471722';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "user" ADD "photo_choice" character varying(20) NOT NULL DEFAULT \'upload\'');
    await q.query('ALTER TABLE "user" ADD "ui_color" character varying(20)');
    await q.query('ALTER TABLE "user" ADD "ui_font" character varying(20)');
    await q.query('ALTER TABLE "sso_provider" ADD "photo_enabled" boolean NOT NULL DEFAULT false');
    await q.query('ALTER TABLE "user_avatar" ADD "source" character varying(20) NOT NULL DEFAULT \'upload\'');
    await q.query('ALTER TABLE "user_avatar" DROP CONSTRAINT "FK_90a1254abd9cce470f8cbea3b18"');
    await q.query('ALTER TABLE "user_avatar" DROP CONSTRAINT "UQ_90a1254abd9cce470f8cbea3b18"');
    await q.query(
      "ALTER TABLE \"user\" ADD CONSTRAINT \"ck_user_photo_choice\" CHECK (photo_choice IN ('upload', 'microsoft', 'google', 'default'))",
    );
    await q.query(
      "ALTER TABLE \"user_avatar\" ADD CONSTRAINT \"ck_user_avatar_source\" CHECK (source IN ('upload', 'microsoft', 'google'))",
    );
    await q.query('ALTER TABLE "user_avatar" ADD CONSTRAINT "uq_user_avatar_user_source" UNIQUE ("user_id", "source")');
    await q.query(
      'ALTER TABLE "user_avatar" ADD CONSTRAINT "FK_90a1254abd9cce470f8cbea3b18" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "user_avatar" DROP CONSTRAINT "FK_90a1254abd9cce470f8cbea3b18"');
    await q.query('ALTER TABLE "user_avatar" DROP CONSTRAINT "uq_user_avatar_user_source"');
    await q.query('ALTER TABLE "user_avatar" DROP CONSTRAINT "ck_user_avatar_source"');
    await q.query('ALTER TABLE "user" DROP CONSTRAINT "ck_user_photo_choice"');
    // Volta a uma foto por pessoa: as dos provedores somem (os arquivos ficam órfãos no disco, sem uso).
    await q.query('DELETE FROM "user_avatar" WHERE "source" <> \'upload\'');
    await q.query('ALTER TABLE "user_avatar" ADD CONSTRAINT "UQ_90a1254abd9cce470f8cbea3b18" UNIQUE ("user_id")');
    await q.query(
      'ALTER TABLE "user_avatar" ADD CONSTRAINT "FK_90a1254abd9cce470f8cbea3b18" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query('ALTER TABLE "user_avatar" DROP COLUMN "source"');
    await q.query('ALTER TABLE "sso_provider" DROP COLUMN "photo_enabled"');
    await q.query('ALTER TABLE "user" DROP COLUMN "ui_font"');
    await q.query('ALTER TABLE "user" DROP COLUMN "ui_color"');
    await q.query('ALTER TABLE "user" DROP COLUMN "photo_choice"');
  }
}
