import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Attachments`. Revise antes de publicar. */
export class Attachments1793897057049 implements MigrationInterface {
  name = 'Attachments1793897057049';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "attachment" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "idea_id" uuid NOT NULL, "step_id" uuid, "original_name" character varying(255) NOT NULL, "stored_name" character varying(80) NOT NULL, "mime" character varying(100) NOT NULL, "size_bytes" integer NOT NULL, "uploaded_by" uuid NOT NULL, CONSTRAINT "UQ_3495cf72c9eecad19c41262fa34" UNIQUE ("stored_name"), CONSTRAINT "PK_d2a80c3a8d467f08a750ac4b420" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_09a7cb3e43db7f0d5018fc0575" ON "attachment"  ("idea_id") ');
    await q.query('CREATE INDEX "IDX_33da00264e5db79602877e339d" ON "attachment"  ("step_id") ');
    await q.query(
      'ALTER TABLE "attachment" ADD CONSTRAINT "FK_09a7cb3e43db7f0d5018fc0575d" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "attachment" ADD CONSTRAINT "FK_33da00264e5db79602877e339d5" FOREIGN KEY ("step_id") REFERENCES "step"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "attachment" ADD CONSTRAINT "FK_a43176f45a7941d1cd50109f07f" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "attachment" DROP CONSTRAINT "FK_a43176f45a7941d1cd50109f07f"');
    await q.query('ALTER TABLE "attachment" DROP CONSTRAINT "FK_33da00264e5db79602877e339d5"');
    await q.query('ALTER TABLE "attachment" DROP CONSTRAINT "FK_09a7cb3e43db7f0d5018fc0575d"');
    await q.query('DROP INDEX "public"."IDX_33da00264e5db79602877e339d"');
    await q.query('DROP INDEX "public"."IDX_09a7cb3e43db7f0d5018fc0575"');
    await q.query('DROP TABLE "attachment"');
  }
}
