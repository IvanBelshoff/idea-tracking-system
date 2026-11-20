import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aprovação de outras áreas (M24, RN-183 a RN-192): o pedido, os aprovadores (com o SHA-256 do link de
 * uso único, nunca o link), os anexos mostrados e as evidências do registro manual. Gerada por
 * `pnpm migration:generate Approvals` e revisada: um pedido aberto por ideia (índice único parcial).
 */
export class Approvals1794848463621 implements MigrationInterface {
  name = 'Approvals1794848463621';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      "CREATE TYPE \"public\".\"approval_status\" AS ENUM('pending', 'approved', 'rejected', 'expired', 'cancelled')",
    );
    await q.query('CREATE TYPE "public"."approval_hold" AS ENUM(\'approve\', \'implement\')');
    await q.query(
      'CREATE TABLE "approval_request" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "idea_id" uuid NOT NULL, "status" "public"."approval_status" NOT NULL DEFAULT \'pending\', "holds" "public"."approval_hold" NOT NULL, "idea_code" character varying(40) NOT NULL, "idea_title" character varying(200) NOT NULL, "summary" character varying(2000) NOT NULL, "gain_snapshot" jsonb, "due_on" date NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "requested_by" uuid NOT NULL, "closed_at" TIMESTAMP WITH TIME ZONE, "cancelled_by" uuid, "cancel_reason" character varying(1000), "overridden_at" TIMESTAMP WITH TIME ZONE, "overridden_by" uuid, "override_reason" character varying(1000), CONSTRAINT "ck_approval_request_closed" CHECK ((status = \'pending\') = (closed_at IS NULL)), CONSTRAINT "PK_7ec7f6581285148e265d3415327" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_247110d3005f397a1aa071932a" ON "approval_request"  ("idea_id") ');
    await q.query(
      'CREATE UNIQUE INDEX "uq_approval_request_open" ON "approval_request"  ("idea_id") WHERE status = \'pending\'',
    );
    await q.query("CREATE TYPE \"public\".\"approval_decision\" AS ENUM('pending', 'approved', 'rejected', 'void')");
    await q.query("CREATE TYPE \"public\".\"approval_source\" AS ENUM('link', 'its', 'manual')");
    await q.query(
      'CREATE TABLE "approval_recipient" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "request_id" uuid NOT NULL, "user_id" uuid, "name" character varying(120) NOT NULL, "email" character varying(254), "area" character varying(80) NOT NULL DEFAULT \'\', "token_hash" character(64), "decision" "public"."approval_decision" NOT NULL DEFAULT \'pending\', "source" "public"."approval_source", "comment" character varying(1000), "decided_name" character varying(120), "decided_at" TIMESTAMP WITH TIME ZONE, "decided_ip" character varying(64), "recorded_by" uuid, "decided_on" date, "code_hash" character(64), "code_expires_at" TIMESTAMP WITH TIME ZONE, "code_attempts" integer NOT NULL DEFAULT \'0\', "reminders_sent" integer NOT NULL DEFAULT \'0\', CONSTRAINT "ck_approval_recipient_decided" CHECK ((decision IN (\'approved\', \'rejected\')) = (decided_at IS NOT NULL)), CONSTRAINT "ck_approval_recipient_who" CHECK (user_id IS NOT NULL OR email IS NOT NULL), CONSTRAINT "PK_f9ad03703fe272feab1ce3b09cd" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_c61b2d26397cf969c21804fe43" ON "approval_recipient"  ("request_id") ');
    await q.query('CREATE INDEX "IDX_3ce53a65497e46f10d8fa05f27" ON "approval_recipient"  ("user_id") ');
    await q.query(
      'CREATE UNIQUE INDEX "uq_approval_recipient_token" ON "approval_recipient"  ("token_hash") WHERE token_hash IS NOT NULL',
    );
    await q.query(
      'CREATE TABLE "approval_request_attachment" ("request_id" uuid NOT NULL, "attachment_id" uuid NOT NULL, CONSTRAINT "PK_5f688c3eeddda79945e95b335d6" PRIMARY KEY ("request_id", "attachment_id"))',
    );
    await q.query(
      'CREATE TABLE "approval_evidence" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "recipient_id" uuid NOT NULL, "original_name" character varying(255) NOT NULL, "stored_name" character varying(80) NOT NULL, "mime_type" character varying(120) NOT NULL, "size_bytes" integer NOT NULL, "uploaded_by" uuid NOT NULL, CONSTRAINT "UQ_d829be7d1f1ad04e0118dfd7ee4" UNIQUE ("stored_name"), CONSTRAINT "PK_5c02a79bfdbfac0ac5e3e40156c" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_78a64d7087205a9b18cdc5ba0c" ON "approval_evidence"  ("recipient_id") ');
    await q.query(
      'ALTER TABLE "approval_request" ADD CONSTRAINT "FK_247110d3005f397a1aa071932a7" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "approval_request" ADD CONSTRAINT "FK_4e6630540fdca2667b30f5dedd1" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "approval_recipient" ADD CONSTRAINT "FK_c61b2d26397cf969c21804fe433" FOREIGN KEY ("request_id") REFERENCES "approval_request"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "approval_recipient" ADD CONSTRAINT "FK_3ce53a65497e46f10d8fa05f279" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "approval_request_attachment" ADD CONSTRAINT "FK_84cd6758347456304c3dd511478" FOREIGN KEY ("request_id") REFERENCES "approval_request"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "approval_request_attachment" ADD CONSTRAINT "FK_3bedad378ab91e3950bd18245f7" FOREIGN KEY ("attachment_id") REFERENCES "attachment"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "approval_evidence" ADD CONSTRAINT "FK_78a64d7087205a9b18cdc5ba0c2" FOREIGN KEY ("recipient_id") REFERENCES "approval_recipient"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "approval_evidence" DROP CONSTRAINT "FK_78a64d7087205a9b18cdc5ba0c2"');
    await q.query('ALTER TABLE "approval_request_attachment" DROP CONSTRAINT "FK_3bedad378ab91e3950bd18245f7"');
    await q.query('ALTER TABLE "approval_request_attachment" DROP CONSTRAINT "FK_84cd6758347456304c3dd511478"');
    await q.query('ALTER TABLE "approval_recipient" DROP CONSTRAINT "FK_3ce53a65497e46f10d8fa05f279"');
    await q.query('ALTER TABLE "approval_recipient" DROP CONSTRAINT "FK_c61b2d26397cf969c21804fe433"');
    await q.query('ALTER TABLE "approval_request" DROP CONSTRAINT "FK_4e6630540fdca2667b30f5dedd1"');
    await q.query('ALTER TABLE "approval_request" DROP CONSTRAINT "FK_247110d3005f397a1aa071932a7"');
    await q.query('DROP INDEX "public"."IDX_78a64d7087205a9b18cdc5ba0c"');
    await q.query('DROP TABLE "approval_evidence"');
    await q.query('DROP TABLE "approval_request_attachment"');
    await q.query('DROP INDEX "public"."uq_approval_recipient_token"');
    await q.query('DROP INDEX "public"."IDX_3ce53a65497e46f10d8fa05f27"');
    await q.query('DROP INDEX "public"."IDX_c61b2d26397cf969c21804fe43"');
    await q.query('DROP TABLE "approval_recipient"');
    await q.query('DROP TYPE "public"."approval_source"');
    await q.query('DROP TYPE "public"."approval_decision"');
    await q.query('DROP INDEX "public"."uq_approval_request_open"');
    await q.query('DROP INDEX "public"."IDX_247110d3005f397a1aa071932a"');
    await q.query('DROP TABLE "approval_request"');
    await q.query('DROP TYPE "public"."approval_hold"');
    await q.query('DROP TYPE "public"."approval_status"');
  }
}
