import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate RichText`. Revise antes de publicar. */
export class RichText1794501097609 implements MigrationInterface {
  name = 'RichText1794501097609';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "campaign" ADD "objective_rich" jsonb');
    await q.query('ALTER TABLE "idea" ADD "description_rich" jsonb');
    await q.query('ALTER TABLE "idea" ADD "proposed_solution_rich" jsonb');
    await q.query('ALTER TABLE "idea" ADD "result_text_rich" jsonb');
    await q.query('ALTER TABLE "idea" ADD "standard_adopted_rich" jsonb');
    await q.query('ALTER TABLE "step" ADD "description_rich" jsonb');
    await q.query('ALTER TABLE "comment" ADD "body_rich" jsonb');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "comment" DROP COLUMN "body_rich"');
    await q.query('ALTER TABLE "step" DROP COLUMN "description_rich"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "standard_adopted_rich"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "result_text_rich"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "proposed_solution_rich"');
    await q.query('ALTER TABLE "idea" DROP COLUMN "description_rich"');
    await q.query('ALTER TABLE "campaign" DROP COLUMN "objective_rich"');
  }
}
