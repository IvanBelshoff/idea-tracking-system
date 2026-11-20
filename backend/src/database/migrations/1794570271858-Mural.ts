import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mural de ideias (M21, RN-148 a RN-158): publicação, consentimento, reações, conversa (com
 * revisões), denúncias e envios a colegas. Gerada por `pnpm migration:generate Mural` e revisada;
 * o último passo (à mão) dá `mural.manage` ao perfil de fábrica Analista das instalações que já
 * existem (o seed não altera perfis existentes; o Administrador recebe toda permissão nova sozinho).
 */
export class Mural1794570271858 implements MigrationInterface {
  name = 'Mural1794570271858';

  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE TYPE "public"."mural_status" AS ENUM(\'published\', \'withdrawn\')');
    await q.query(
      'CREATE TABLE "mural_post" ("idea_id" uuid NOT NULL, "status" "public"."mural_status" NOT NULL DEFAULT \'published\', "published_at" TIMESTAMP WITH TIME ZONE NOT NULL, "published_by_id" uuid, "withdrawn_at" TIMESTAMP WITH TIME ZONE, "withdrawn_by_id" uuid, "withdrawn_reason" text, CONSTRAINT "ck_mural_post_withdrawn" CHECK (status <> \'withdrawn\' OR withdrawn_reason IS NOT NULL), CONSTRAINT "PK_02006e45aaaff092e64cd13b090" PRIMARY KEY ("idea_id"))',
    );
    await q.query(
      'CREATE INDEX "ix_mural_post_published" ON "mural_post"  ("published_at") WHERE status = \'published\'',
    );
    await q.query(
      'CREATE TABLE "mural_consent" ("idea_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" character varying(20) NOT NULL, "status" "public"."consent_status" NOT NULL DEFAULT \'pending\', "answered_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_759560aafd3348963f2a584fbaa" PRIMARY KEY ("idea_id", "user_id"))',
    );
    await q.query(
      "CREATE TYPE \"public\".\"mural_reaction_kind\" AS ENUM('like', 'congrats', 'support', 'brilliant', 'inspiring')",
    );
    await q.query(
      'CREATE TABLE "mural_reaction" ("idea_id" uuid NOT NULL, "user_id" uuid NOT NULL, "kind" "public"."mural_reaction_kind" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1ae484d9d025c56c2088bd18b5b" PRIMARY KEY ("idea_id", "user_id"))',
    );
    await q.query('CREATE INDEX "ix_mural_reaction_idea" ON "mural_reaction"  ("idea_id", "kind") ');
    await q.query(
      'CREATE TABLE "mural_comment" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "idea_id" uuid NOT NULL, "parent_id" uuid, "author_id" uuid, "body" character varying(2000) NOT NULL, "edited_at" TIMESTAMP WITH TIME ZONE, "deleted_at" TIMESTAMP WITH TIME ZONE, "hidden_at" TIMESTAMP WITH TIME ZONE, "hidden_by_id" uuid, "hidden_reason" text, CONSTRAINT "ck_mural_comment_hidden" CHECK (hidden_at IS NULL OR hidden_reason IS NOT NULL), CONSTRAINT "PK_1a4f4097288ba09629a3586dbcc" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "ix_mural_comment_author" ON "mural_comment"  ("author_id", "created_at") ');
    await q.query('CREATE INDEX "ix_mural_comment_idea" ON "mural_comment"  ("idea_id", "created_at") ');
    await q.query(
      'CREATE TABLE "mural_comment_revision" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "comment_id" uuid NOT NULL, "body" character varying(2000) NOT NULL, CONSTRAINT "PK_4d49847f4abe9db93b8e21bc4c6" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_173e2014c0ddd7b17d7ef7ae0e" ON "mural_comment_revision"  ("comment_id") ');
    await q.query(
      "CREATE TYPE \"public\".\"mural_report_reason\" AS ENUM('offensive', 'personal_data', 'off_topic', 'other')",
    );
    await q.query('CREATE TYPE "public"."mural_report_resolution" AS ENUM(\'hidden\', \'dismissed\')');
    await q.query(
      'CREATE TABLE "mural_report" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "comment_id" uuid NOT NULL, "reporter_id" uuid NOT NULL, "reason" "public"."mural_report_reason" NOT NULL, "note" character varying(500), "resolved_at" TIMESTAMP WITH TIME ZONE, "resolved_by_id" uuid, "resolution" "public"."mural_report_resolution", CONSTRAINT "uq_mural_report_reporter" UNIQUE ("comment_id", "reporter_id"), CONSTRAINT "PK_88c80612954ffd7cfc5a30195e3" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "ix_mural_report_pending" ON "mural_report"  ("created_at") WHERE resolved_at IS NULL');
    await q.query(
      'CREATE TABLE "mural_share" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "idea_id" uuid NOT NULL, "sender_id" uuid NOT NULL, "recipient_id" uuid NOT NULL, "message" character varying(300), CONSTRAINT "PK_599bd4adc228c7f0379a2c6abe6" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "ix_mural_share_sender" ON "mural_share"  ("sender_id", "created_at") ');
    await q.query(
      'ALTER TABLE "mural_post" ADD CONSTRAINT "FK_02006e45aaaff092e64cd13b090" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_post" ADD CONSTRAINT "FK_a2b239dc80a4f8b3bc6200bc125" FOREIGN KEY ("published_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_post" ADD CONSTRAINT "FK_3818d8eae63798b295173952f0a" FOREIGN KEY ("withdrawn_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_consent" ADD CONSTRAINT "FK_3863c913a8e2ab69d080e277f6a" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_consent" ADD CONSTRAINT "FK_e6e3e38fb6084d8848b2a2297a5" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_reaction" ADD CONSTRAINT "FK_e265b29de8f0b400b989c1015b0" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_reaction" ADD CONSTRAINT "FK_ae0b850c6f148cf94043c252be5" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_comment" ADD CONSTRAINT "FK_d408cc3027b25fe613721218f24" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_comment" ADD CONSTRAINT "FK_eae08a7735a94ecf746efdbf9e4" FOREIGN KEY ("parent_id") REFERENCES "mural_comment"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_comment" ADD CONSTRAINT "FK_1837349d35e0ed671c4916976f6" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_comment" ADD CONSTRAINT "FK_cca300f581381cd78facf9a8023" FOREIGN KEY ("hidden_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_comment_revision" ADD CONSTRAINT "FK_173e2014c0ddd7b17d7ef7ae0ea" FOREIGN KEY ("comment_id") REFERENCES "mural_comment"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_report" ADD CONSTRAINT "FK_888c6fef69168aeec92ff7c8279" FOREIGN KEY ("comment_id") REFERENCES "mural_comment"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_report" ADD CONSTRAINT "FK_3284929843ecedd2623928c142d" FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_report" ADD CONSTRAINT "FK_b5f6381298881fea5c7e7ab08f6" FOREIGN KEY ("resolved_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_share" ADD CONSTRAINT "FK_b635cb3e78c52c75255375b1505" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_share" ADD CONSTRAINT "FK_67427381a9b32f53bb72414f6ca" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "mural_share" ADD CONSTRAINT "FK_e2336ef87692860ec5e1f98705b" FOREIGN KEY ("recipient_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      `INSERT INTO "role_permission" ("role_id", "permission")
       SELECT "id", 'mural.manage' FROM "role" WHERE "system_key" = 'analyst'
       ON CONFLICT DO NOTHING`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM "role_permission" WHERE "permission" = 'mural.manage'`);
    await q.query('ALTER TABLE "mural_share" DROP CONSTRAINT "FK_e2336ef87692860ec5e1f98705b"');
    await q.query('ALTER TABLE "mural_share" DROP CONSTRAINT "FK_67427381a9b32f53bb72414f6ca"');
    await q.query('ALTER TABLE "mural_share" DROP CONSTRAINT "FK_b635cb3e78c52c75255375b1505"');
    await q.query('ALTER TABLE "mural_report" DROP CONSTRAINT "FK_b5f6381298881fea5c7e7ab08f6"');
    await q.query('ALTER TABLE "mural_report" DROP CONSTRAINT "FK_3284929843ecedd2623928c142d"');
    await q.query('ALTER TABLE "mural_report" DROP CONSTRAINT "FK_888c6fef69168aeec92ff7c8279"');
    await q.query('ALTER TABLE "mural_comment_revision" DROP CONSTRAINT "FK_173e2014c0ddd7b17d7ef7ae0ea"');
    await q.query('ALTER TABLE "mural_comment" DROP CONSTRAINT "FK_cca300f581381cd78facf9a8023"');
    await q.query('ALTER TABLE "mural_comment" DROP CONSTRAINT "FK_1837349d35e0ed671c4916976f6"');
    await q.query('ALTER TABLE "mural_comment" DROP CONSTRAINT "FK_eae08a7735a94ecf746efdbf9e4"');
    await q.query('ALTER TABLE "mural_comment" DROP CONSTRAINT "FK_d408cc3027b25fe613721218f24"');
    await q.query('ALTER TABLE "mural_reaction" DROP CONSTRAINT "FK_ae0b850c6f148cf94043c252be5"');
    await q.query('ALTER TABLE "mural_reaction" DROP CONSTRAINT "FK_e265b29de8f0b400b989c1015b0"');
    await q.query('ALTER TABLE "mural_consent" DROP CONSTRAINT "FK_e6e3e38fb6084d8848b2a2297a5"');
    await q.query('ALTER TABLE "mural_consent" DROP CONSTRAINT "FK_3863c913a8e2ab69d080e277f6a"');
    await q.query('ALTER TABLE "mural_post" DROP CONSTRAINT "FK_3818d8eae63798b295173952f0a"');
    await q.query('ALTER TABLE "mural_post" DROP CONSTRAINT "FK_a2b239dc80a4f8b3bc6200bc125"');
    await q.query('ALTER TABLE "mural_post" DROP CONSTRAINT "FK_02006e45aaaff092e64cd13b090"');
    await q.query('DROP INDEX "public"."ix_mural_share_sender"');
    await q.query('DROP TABLE "mural_share"');
    await q.query('DROP INDEX "public"."ix_mural_report_pending"');
    await q.query('DROP TABLE "mural_report"');
    await q.query('DROP TYPE "public"."mural_report_resolution"');
    await q.query('DROP TYPE "public"."mural_report_reason"');
    await q.query('DROP INDEX "public"."IDX_173e2014c0ddd7b17d7ef7ae0e"');
    await q.query('DROP TABLE "mural_comment_revision"');
    await q.query('DROP INDEX "public"."ix_mural_comment_idea"');
    await q.query('DROP INDEX "public"."ix_mural_comment_author"');
    await q.query('DROP TABLE "mural_comment"');
    await q.query('DROP INDEX "public"."ix_mural_reaction_idea"');
    await q.query('DROP TABLE "mural_reaction"');
    await q.query('DROP TYPE "public"."mural_reaction_kind"');
    await q.query('DROP TABLE "mural_consent"');
    await q.query('DROP INDEX "public"."ix_mural_post_published"');
    await q.query('DROP TABLE "mural_post"');
    await q.query('DROP TYPE "public"."mural_status"');
  }
}
