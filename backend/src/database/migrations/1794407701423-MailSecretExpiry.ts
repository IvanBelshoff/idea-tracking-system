import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate MailSecretExpiry`. Revise antes de publicar. */
export class MailSecretExpiry1794407701423 implements MigrationInterface {
  name = 'MailSecretExpiry1794407701423';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "mail_provider" ADD "secret_expires_on" date');
    await q.query('ALTER TABLE "sso_provider" ADD "secret_expires_on" date');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "sso_provider" DROP COLUMN "secret_expires_on"');
    await q.query('ALTER TABLE "mail_provider" DROP COLUMN "secret_expires_on"');
  }
}
