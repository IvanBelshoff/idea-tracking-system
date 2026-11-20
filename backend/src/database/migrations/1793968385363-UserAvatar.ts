import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate UserAvatar`. Revise antes de publicar. */
export class UserAvatar1793968385363 implements MigrationInterface {
  name = 'UserAvatar1793968385363';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "user_avatar" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "stored_name" character varying(60) NOT NULL, "mime" character varying(30) NOT NULL, "size_bytes" integer NOT NULL, "width" integer NOT NULL, "height" integer NOT NULL, CONSTRAINT "UQ_90a1254abd9cce470f8cbea3b18" UNIQUE ("user_id"), CONSTRAINT "PK_b777e56620c3f1ac0308514fc4c" PRIMARY KEY ("id"))',
    );
    await q.query(
      'ALTER TABLE "user_avatar" ADD CONSTRAINT "FK_90a1254abd9cce470f8cbea3b18" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "user_avatar" DROP CONSTRAINT "FK_90a1254abd9cce470f8cbea3b18"');
    await q.query('DROP TABLE "user_avatar"');
  }
}
