import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tela de login (M23, RN-176 a RN-180): os arquivos do fundo (imagem, capa do vídeo e vídeo), um de cada.
 * Gerada por `pnpm migration:generate LoginScreen`; o CHECK dos tipos foi acrescentado à mão. A
 * configuração em si fica na chave `branding.login` da tabela `setting` (sem mudança de esquema).
 */
export class LoginScreen1794833285059 implements MigrationInterface {
  name = 'LoginScreen1794833285059';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE TABLE "login_media" ("kind" character varying(10) NOT NULL, "stored_name" character varying(60) NOT NULL, "content_type" character varying(20) NOT NULL, "size_bytes" integer NOT NULL, "width" integer, "height" integer, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2921425a75357a15f58bff30bb1" PRIMARY KEY ("kind"))',
    );
    await q.query(
      `ALTER TABLE "login_media" ADD CONSTRAINT "ck_login_media_kind" CHECK (kind IN ('image', 'poster', 'video'))`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE "login_media"');
  }
}
