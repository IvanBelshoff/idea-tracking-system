import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Loja e bonificação (M22, RN-159 a RN-173): item, entidades do item, pedido, extrato e avisos de
 * vencimento. Gerada por `pnpm migration:generate Store` e revisada: o tipo `store_item_kind` (usado
 * em duas tabelas) é criado uma vez só, e os gatilhos (à mão) tornam o extrato somente inserção (RN-160,
 * CA-T.26), com a mesma função `forbid_mutation` do log de auditoria.
 */
export class Store1794591165698 implements MigrationInterface {
  name = 'Store1794591165698';

  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE TYPE "public"."store_item_kind" AS ENUM(\'product\', \'bonus\')');
    await q.query("CREATE TYPE \"public\".\"store_limit_period\" AS ENUM('month', 'quarter', 'semester', 'year')");
    await q.query(
      'CREATE TABLE "store_item" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "description" character varying(2000), "kind" "public"."store_item_kind" NOT NULL DEFAULT \'product\', "cost" integer NOT NULL, "bonus_value" numeric(14,2), "active" boolean NOT NULL DEFAULT true, "stock" integer, "limit_qty" integer, "limit_period" "public"."store_limit_period", "photo_stored_name" character varying(60), "photo_version" character varying(20), "created_by_id" uuid, CONSTRAINT "ck_store_item_limit" CHECK ((limit_qty IS NULL) = (limit_period IS NULL) AND (limit_qty IS NULL OR limit_qty >= 1)), CONSTRAINT "ck_store_item_bonus" CHECK (kind <> \'bonus\' OR bonus_value IS NOT NULL), CONSTRAINT "ck_store_item_stock" CHECK (stock IS NULL OR stock >= 0), CONSTRAINT "ck_store_item_cost" CHECK (cost >= 1 AND cost <= 1000000), CONSTRAINT "PK_d8d520cf8af78e9dd5bc47943c2" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE TABLE "store_item_entity" ("item_id" uuid NOT NULL, "entity_id" uuid NOT NULL, CONSTRAINT "PK_cf7af4165f43e16800002ed5171" PRIMARY KEY ("item_id", "entity_id"))',
    );
    await q.query(
      "CREATE TYPE \"public\".\"store_order_status\" AS ENUM('pending', 'approved', 'delivered', 'paid', 'rejected', 'cancelled')",
    );
    await q.query(
      'CREATE TABLE "store_order" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "item_id" uuid NOT NULL, "user_id" uuid NOT NULL, "status" "public"."store_order_status" NOT NULL DEFAULT \'pending\', "cost" integer NOT NULL, "item_kind" "public"."store_item_kind" NOT NULL, "bonus_value" numeric(14,2), "note" character varying(300), "decided_by_id" uuid, "approved_at" TIMESTAMP WITH TIME ZONE, "reason" text, "closed_at" TIMESTAMP WITH TIME ZONE, "delivery_note" character varying(300), "paid_on" date, "paid_reference" character varying(100), CONSTRAINT "PK_7ca8c59d7a14c48ef2fc3b0891c" PRIMARY KEY ("id"))',
    );
    await q.query('CREATE INDEX "ix_store_order_item" ON "store_order"  ("item_id", "created_at") ');
    await q.query('CREATE INDEX "ix_store_order_status" ON "store_order"  ("status", "created_at") ');
    await q.query('CREATE INDEX "ix_store_order_user" ON "store_order"  ("user_id", "created_at") ');
    await q.query(
      "CREATE TYPE \"public\".\"store_ledger_kind\" AS ENUM('initial', 'earned', 'reserve', 'refund', 'adjustment', 'expiration')",
    );
    await q.query(
      'CREATE TABLE "store_ledger" ("id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "kind" "public"."store_ledger_kind" NOT NULL, "amount" integer NOT NULL, "actor_id" uuid, "idea_id" uuid, "point_id" uuid, "order_id" uuid, "reason" character varying(300), CONSTRAINT "ck_store_ledger_amount" CHECK (amount <> 0), CONSTRAINT "PK_cf26812804e245130e3b9bd82e5" PRIMARY KEY ("id"))',
    );
    await q.query(
      'CREATE UNIQUE INDEX "uq_store_ledger_point" ON "store_ledger"  ("point_id") WHERE point_id IS NOT NULL',
    );
    await q.query('CREATE INDEX "ix_store_ledger_user" ON "store_ledger"  ("user_id", "created_at") ');
    await q.query(
      'CREATE TABLE "store_expiry_notice" ("user_id" uuid NOT NULL, "expires_on" date NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_644077357bcb7a8bfc205eed692" PRIMARY KEY ("user_id", "expires_on"))',
    );
    await q.query(
      'ALTER TABLE "store_item" ADD CONSTRAINT "FK_367b3ceea56af1686755bce4ef1" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "store_item_entity" ADD CONSTRAINT "FK_b611b2bb61664f6166ae61b26f5" FOREIGN KEY ("item_id") REFERENCES "store_item"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "store_item_entity" ADD CONSTRAINT "FK_502052980d75abae8ca01c2a167" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "store_order" ADD CONSTRAINT "FK_023db6dafa7d08d4a6e833cbf8b" FOREIGN KEY ("item_id") REFERENCES "store_item"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "store_order" ADD CONSTRAINT "FK_ce7269aab70880c0a1ef4f365bf" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "store_order" ADD CONSTRAINT "FK_4071fe21cbf996630fe894a0394" FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "store_ledger" ADD CONSTRAINT "FK_d9e7d647fee316b8983fabc16bf" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "store_ledger" ADD CONSTRAINT "FK_4dbcdc3e3c9845533957a496aaa" FOREIGN KEY ("order_id") REFERENCES "store_order"("id") ON DELETE RESTRICT ON UPDATE NO ACTION',
    );
    await q.query(
      'ALTER TABLE "store_expiry_notice" ADD CONSTRAINT "FK_0627ca037a9240028f55b1858c8" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    );
    // Integração (RN-172): o módulo de leitura `store` entra nos CHECK de módulos (o gerador não enxerga CHECK).
    await q.query('ALTER TABLE "integration" DROP CONSTRAINT "ck_integration_modules"');
    await q.query(
      `ALTER TABLE "integration" ADD CONSTRAINT "ck_integration_modules" CHECK (modules <@ ARRAY['ideas', 'indicators', 'campaigns', 'hall', 'entities', 'users', 'store', 'ideas_write', 'gains_write']::text[])`,
    );
    await q.query('ALTER TABLE "integration_hour" DROP CONSTRAINT "ck_integration_hour_module"');
    await q.query(
      `ALTER TABLE "integration_hour" ADD CONSTRAINT "ck_integration_hour_module" CHECK (module IN ('ideas', 'indicators', 'campaigns', 'hall', 'entities', 'users', 'store', 'ideas_write', 'gains_write'))`,
    );
    await q.query(
      'CREATE TRIGGER store_ledger_immutable BEFORE UPDATE OR DELETE ON "store_ledger" FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
    );
    await q.query(
      'CREATE TRIGGER store_ledger_no_truncate BEFORE TRUNCATE ON "store_ledger" FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE "integration" SET modules = array_remove(modules, 'store')`);
    await q.query(`DELETE FROM "integration_hour" WHERE module = 'store'`);
    await q.query('ALTER TABLE "integration_hour" DROP CONSTRAINT "ck_integration_hour_module"');
    await q.query(
      `ALTER TABLE "integration_hour" ADD CONSTRAINT "ck_integration_hour_module" CHECK (module IN ('ideas', 'indicators', 'campaigns', 'hall', 'entities', 'users', 'ideas_write', 'gains_write'))`,
    );
    await q.query('ALTER TABLE "integration" DROP CONSTRAINT "ck_integration_modules"');
    await q.query(
      `ALTER TABLE "integration" ADD CONSTRAINT "ck_integration_modules" CHECK (modules <@ ARRAY['ideas', 'indicators', 'campaigns', 'hall', 'entities', 'users', 'ideas_write', 'gains_write']::text[])`,
    );
    await q.query('DROP TRIGGER store_ledger_no_truncate ON "store_ledger"');
    await q.query('DROP TRIGGER store_ledger_immutable ON "store_ledger"');
    await q.query('ALTER TABLE "store_expiry_notice" DROP CONSTRAINT "FK_0627ca037a9240028f55b1858c8"');
    await q.query('ALTER TABLE "store_ledger" DROP CONSTRAINT "FK_4dbcdc3e3c9845533957a496aaa"');
    await q.query('ALTER TABLE "store_ledger" DROP CONSTRAINT "FK_d9e7d647fee316b8983fabc16bf"');
    await q.query('ALTER TABLE "store_order" DROP CONSTRAINT "FK_4071fe21cbf996630fe894a0394"');
    await q.query('ALTER TABLE "store_order" DROP CONSTRAINT "FK_ce7269aab70880c0a1ef4f365bf"');
    await q.query('ALTER TABLE "store_order" DROP CONSTRAINT "FK_023db6dafa7d08d4a6e833cbf8b"');
    await q.query('ALTER TABLE "store_item_entity" DROP CONSTRAINT "FK_502052980d75abae8ca01c2a167"');
    await q.query('ALTER TABLE "store_item_entity" DROP CONSTRAINT "FK_b611b2bb61664f6166ae61b26f5"');
    await q.query('ALTER TABLE "store_item" DROP CONSTRAINT "FK_367b3ceea56af1686755bce4ef1"');
    await q.query('DROP TABLE "store_expiry_notice"');
    await q.query('DROP INDEX "public"."ix_store_ledger_user"');
    await q.query('DROP INDEX "public"."uq_store_ledger_point"');
    await q.query('DROP TABLE "store_ledger"');
    await q.query('DROP TYPE "public"."store_ledger_kind"');
    await q.query('DROP INDEX "public"."ix_store_order_user"');
    await q.query('DROP INDEX "public"."ix_store_order_status"');
    await q.query('DROP INDEX "public"."ix_store_order_item"');
    await q.query('DROP TABLE "store_order"');
    await q.query('DROP TYPE "public"."store_order_status"');
    await q.query('DROP TABLE "store_item_entity"');
    await q.query('DROP TABLE "store_item"');
    await q.query('DROP TYPE "public"."store_limit_period"');
    await q.query('DROP TYPE "public"."store_item_kind"');
  }
}
