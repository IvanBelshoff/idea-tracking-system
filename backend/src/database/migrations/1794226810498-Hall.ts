import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Hall`. Revise antes de publicar. */
export class Hall1794226810498 implements MigrationInterface {
  name = 'Hall1794226810498';

  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE TYPE "public"."highlight_scope" AS ENUM(\'entity\', \'organization\')');
    await q.query("CREATE TYPE \"public\".\"highlight_status\" AS ENUM('active', 'expired', 'revoked')");
    await q.query(
      'CREATE TABLE "highlight" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "idea_id" uuid NOT NULL, "scope" "public"."highlight_scope" NOT NULL, "justification" text NOT NULL, "starts_on" date NOT NULL, "ends_on" date NOT NULL, "status" "public"."highlight_status" NOT NULL DEFAULT \'active\', "curated_by_id" uuid, "revoked_reason" text, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "ck_highlight_revoked" CHECK (status <> \'revoked\' OR revoked_reason IS NOT NULL), CONSTRAINT "ck_highlight_period" CHECK (ends_on >= starts_on), CONSTRAINT "PK_0f4191998a1e1e8f8455f1d4adb" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_0811747ad83d67d369bc437b27" ON "highlight"  ("idea_id") ');
    await q.query('CREATE INDEX "ix_highlight_active_end" ON "highlight"  ("ends_on") WHERE status = \'active\'');
    await q.query("CREATE TYPE \"public\".\"consent_status\" AS ENUM('pending', 'accepted', 'declined')");
    await q.query(
      'CREATE TABLE "highlight_consent" ("highlight_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" character varying(20) NOT NULL, "status" "public"."consent_status" NOT NULL DEFAULT \'pending\', "answered_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ab74bba172e431e272eee55337e" PRIMARY KEY ("highlight_id", "user_id"))',
    );
    await q.query(
      'CREATE TABLE "highlight_praise" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "highlight_id" uuid NOT NULL, "author_id" uuid, "body" character varying(1000) NOT NULL, "hidden_at" TIMESTAMP WITH TIME ZONE, "hidden_by_id" uuid, "hidden_reason" text, CONSTRAINT "PK_67a023f132b4308e2c4b8044db8" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_39d01b56d6fc25c69e5e2a3da7" ON "highlight_praise"  ("highlight_id") ');
    await q.query(
      'CREATE TABLE "idea_like" ("idea_id" uuid NOT NULL, "user_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2146ec1459824a6bb69b83e0d9b" PRIMARY KEY ("idea_id", "user_id"))',
    );
    await q.query(
      'CREATE TABLE "hall_dismissal" ("idea_id" uuid NOT NULL, "dismissed_by_id" uuid, "dismissed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_590fc68e2b4a7e61087fa5af137" PRIMARY KEY ("idea_id"))',
    );
    await q.query(
      'ALTER TABLE "highlight" ADD CONSTRAINT "FK_0811747ad83d67d369bc437b272" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "highlight" ADD CONSTRAINT "FK_d22f1d12faebfbd74d3677be0b9" FOREIGN KEY ("curated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "highlight_consent" ADD CONSTRAINT "FK_43306caad66bb49610130dac737" FOREIGN KEY ("highlight_id") REFERENCES "highlight"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "highlight_consent" ADD CONSTRAINT "FK_4e954a7753fab0539dbbfa6a66c" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "highlight_praise" ADD CONSTRAINT "FK_39d01b56d6fc25c69e5e2a3da76" FOREIGN KEY ("highlight_id") REFERENCES "highlight"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "highlight_praise" ADD CONSTRAINT "FK_6668258f54b41c041a70578624d" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "highlight_praise" ADD CONSTRAINT "FK_1a74f5ceed181bf732c0b578c24" FOREIGN KEY ("hidden_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_like" ADD CONSTRAINT "FK_71f20e160775bdcebc4aa1d0cae" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "idea_like" ADD CONSTRAINT "FK_40770823b3128e7f70772e0b4a9" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "hall_dismissal" ADD CONSTRAINT "FK_590fc68e2b4a7e61087fa5af137" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "hall_dismissal" DROP CONSTRAINT "FK_590fc68e2b4a7e61087fa5af137"');
    await q.query('ALTER TABLE "idea_like" DROP CONSTRAINT "FK_40770823b3128e7f70772e0b4a9"');
    await q.query('ALTER TABLE "idea_like" DROP CONSTRAINT "FK_71f20e160775bdcebc4aa1d0cae"');
    await q.query('ALTER TABLE "highlight_praise" DROP CONSTRAINT "FK_1a74f5ceed181bf732c0b578c24"');
    await q.query('ALTER TABLE "highlight_praise" DROP CONSTRAINT "FK_6668258f54b41c041a70578624d"');
    await q.query('ALTER TABLE "highlight_praise" DROP CONSTRAINT "FK_39d01b56d6fc25c69e5e2a3da76"');
    await q.query('ALTER TABLE "highlight_consent" DROP CONSTRAINT "FK_4e954a7753fab0539dbbfa6a66c"');
    await q.query('ALTER TABLE "highlight_consent" DROP CONSTRAINT "FK_43306caad66bb49610130dac737"');
    await q.query('ALTER TABLE "highlight" DROP CONSTRAINT "FK_d22f1d12faebfbd74d3677be0b9"');
    await q.query('ALTER TABLE "highlight" DROP CONSTRAINT "FK_0811747ad83d67d369bc437b272"');
    await q.query('DROP TABLE "hall_dismissal"');
    await q.query('DROP TABLE "idea_like"');
    await q.query('DROP INDEX "public"."IDX_39d01b56d6fc25c69e5e2a3da7"');
    await q.query('DROP TABLE "highlight_praise"');
    await q.query('DROP TABLE "highlight_consent"');
    await q.query('DROP TYPE "public"."consent_status"');
    await q.query('DROP INDEX "public"."ix_highlight_active_end"');
    await q.query('DROP INDEX "public"."IDX_0811747ad83d67d369bc437b27"');
    await q.query('DROP TABLE "highlight"');
    await q.query('DROP TYPE "public"."highlight_status"');
    await q.query('DROP TYPE "public"."highlight_scope"');
  }
}
