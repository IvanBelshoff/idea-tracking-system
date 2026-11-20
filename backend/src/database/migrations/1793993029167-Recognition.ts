import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Gerada por `pnpm migration:generate Recognition`. Revise antes de publicar. */
export class Recognition1793993029167 implements MigrationInterface {
  name = 'Recognition1793993029167';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "season" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "starts_on" date NOT NULL, "ends_on" date NOT NULL, "campaign_id" uuid, CONSTRAINT "ck_season_period" CHECK (ends_on >= starts_on), CONSTRAINT "PK_8ac0d081dbdb7ab02d166bcda9f" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "point_ledger" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "idea_id" uuid, "event_type" character varying(40) NOT NULL, "points" integer NOT NULL, "season_id" uuid, CONSTRAINT "uq_point_once" UNIQUE ("user_id", "idea_id", "event_type"), CONSTRAINT "PK_d6b8fc449335a8d010aa8da923c" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_4640f7908e162a2fff30091811" ON "point_ledger"  ("user_id") ');
    await q.query('CREATE INDEX "ix_point_season_user" ON "point_ledger"  ("season_id", "user_id") ');
    await q.query(
      'CREATE TABLE "level" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(80) NOT NULL, "min_points" integer NOT NULL, CONSTRAINT "UQ_70f70a06e45845e51111e212aaf" UNIQUE ("min_points"), CONSTRAINT "ck_level_min" CHECK (min_points >= 0), CONSTRAINT "PK_d3f1a7a6f09f1c3144bacdc6bcc" PRIMARY KEY ("id"))',
    );
    await q.query(
      "CREATE TYPE \"public\".\"achievement_rule\" AS ENUM('ideas_submitted', 'ideas_implemented', 'points')",
    );
    await q.query(
      'CREATE TABLE "achievement" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(60) NOT NULL, "name" character varying(120) NOT NULL, "description" text, "rule_type" "public"."achievement_rule" NOT NULL, "threshold" integer NOT NULL, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_9262a29763482eb20bfdd2a9c53" UNIQUE ("code"), CONSTRAINT "PK_441339f40e8ce717525a381671e" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "user_achievement" ("user_id" uuid NOT NULL, "achievement_id" uuid NOT NULL, "granted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_47db305cc6e77e8f88fe0aec8cd" PRIMARY KEY ("user_id", "achievement_id"))',
    );
    await q.query(
      'CREATE TABLE "reward_record" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "idea_id" uuid, "description" character varying(500) NOT NULL, "granted_on" date NOT NULL, "registered_by_id" uuid, CONSTRAINT "PK_14c183bc814ae3c3b24f2595576" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "IDX_c7319895c615ea112403282b0b" ON "reward_record"  ("user_id") ');
    await q.query(
      'ALTER TABLE "season" ADD CONSTRAINT "FK_6000c12b22507d67b3a9e368db7" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "point_ledger" ADD CONSTRAINT "FK_4640f7908e162a2fff30091811f" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "point_ledger" ADD CONSTRAINT "FK_aaf9773679bea25a477071b5591" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "point_ledger" ADD CONSTRAINT "FK_5adb9a93c75f83160659fce924a" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "user_achievement" ADD CONSTRAINT "FK_676d00b5a31b28beaab0617b265" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "user_achievement" ADD CONSTRAINT "FK_14f2bb86ac0603a47ae089b0d26" FOREIGN KEY ("achievement_id") REFERENCES "achievement"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "reward_record" ADD CONSTRAINT "FK_c7319895c615ea112403282b0b8" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "reward_record" ADD CONSTRAINT "FK_3793ba2abad3a374fe3b104429b" FOREIGN KEY ("idea_id") REFERENCES "idea"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "reward_record" ADD CONSTRAINT "FK_0301c442d3858b548da8e343947" FOREIGN KEY ("registered_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    // Valores iniciais editáveis (RN-67, RN-68). O módulo continua desligado até o admin ligar.
    await q.query(
      `INSERT INTO "level" (id, name, min_points) VALUES
         (gen_random_uuid(), 'Iniciante', 0), (gen_random_uuid(), 'Colaborador', 100),
         (gen_random_uuid(), 'Especialista', 300), (gen_random_uuid(), 'Mestre', 1000)`,
    );
    await q.query(
      `INSERT INTO "achievement" (id, code, name, description, rule_type, threshold) VALUES
         (gen_random_uuid(), 'first_idea', 'Primeira ideia', 'Enviou a primeira ideia.', 'ideas_submitted', 1),
         (gen_random_uuid(), 'first_implemented', 'Primeira implementada', 'Teve a primeira ideia implementada.', 'ideas_implemented', 1),
         (gen_random_uuid(), 'five_implemented', 'Cinco implementadas', 'Cinco ideias implementadas.', 'ideas_implemented', 5),
         (gen_random_uuid(), 'points_500', '500 pontos', 'Chegou a 500 pontos.', 'points', 500)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "reward_record" DROP CONSTRAINT "FK_0301c442d3858b548da8e343947"');
    await q.query('ALTER TABLE "reward_record" DROP CONSTRAINT "FK_3793ba2abad3a374fe3b104429b"');
    await q.query('ALTER TABLE "reward_record" DROP CONSTRAINT "FK_c7319895c615ea112403282b0b8"');
    await q.query('ALTER TABLE "user_achievement" DROP CONSTRAINT "FK_14f2bb86ac0603a47ae089b0d26"');
    await q.query('ALTER TABLE "user_achievement" DROP CONSTRAINT "FK_676d00b5a31b28beaab0617b265"');
    await q.query('ALTER TABLE "point_ledger" DROP CONSTRAINT "FK_5adb9a93c75f83160659fce924a"');
    await q.query('ALTER TABLE "point_ledger" DROP CONSTRAINT "FK_aaf9773679bea25a477071b5591"');
    await q.query('ALTER TABLE "point_ledger" DROP CONSTRAINT "FK_4640f7908e162a2fff30091811f"');
    await q.query('ALTER TABLE "season" DROP CONSTRAINT "FK_6000c12b22507d67b3a9e368db7"');
    await q.query('DROP INDEX "public"."IDX_c7319895c615ea112403282b0b"');
    await q.query('DROP TABLE "reward_record"');
    await q.query('DROP TABLE "user_achievement"');
    await q.query('DROP TABLE "achievement"');
    await q.query('DROP TYPE "public"."achievement_rule"');
    await q.query('DROP TABLE "level"');
    await q.query('DROP INDEX "public"."ix_point_season_user"');
    await q.query('DROP INDEX "public"."IDX_4640f7908e162a2fff30091811"');
    await q.query('DROP TABLE "point_ledger"');
    await q.query('DROP TABLE "season"');
  }
}
