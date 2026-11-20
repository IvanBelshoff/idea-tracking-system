import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate UserPreferences`. Revise antes de publicar. */
export class UserPreferences1793887230449 implements MigrationInterface {
  name = 'UserPreferences1793887230449';

  async up(q: QueryRunner): Promise<void> {
    await q.query("CREATE TYPE \"public\".\"theme_preference\" AS ENUM('system', 'light', 'dark')");
    await q.query('ALTER TABLE "user" ADD "theme" "public"."theme_preference" NOT NULL DEFAULT \'system\'');
    await q.query('ALTER TABLE "user" ADD "nav_collapsed" boolean NOT NULL DEFAULT false');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "user" DROP COLUMN "nav_collapsed"');
    await q.query('ALTER TABLE "user" DROP COLUMN "theme"');
    await q.query('DROP TYPE "public"."theme_preference"');
  }
}
