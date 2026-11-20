import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { prepareDatabase } from '../../src/database/bootstrap.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { Role, RolePermission } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { FACTORY_ROLES } from '../../src/identity-access/factory-roles.js';
import { ALL_PERMISSIONS } from '../../src/identity-access/permissions.js';
import { createMigratedTestDatabase, type TestDatabase } from '../support/test-db.js';

/** Tabelas de negócio no esquema public (sem a tabela de controle das migrações). */
async function businessTables(db: TestDatabase): Promise<string[]> {
  const rows: { table_name: string }[] = await db.dataSource.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> 'typeorm_migration' ORDER BY 1`,
  );
  return rows.map((r) => r.table_name);
}

/** Diferença entre as entidades e o banco; vazia = o esquema das migrações é o do modelo. */
async function schemaDrift(db: TestDatabase): Promise<string[]> {
  const sql = await db.dataSource.driver.createSchemaBuilder().log();
  return sql.upQueries.map((q) => q.query);
}

describe('Esquema e migrações (M1)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
  });
  afterAll(async () => {
    await db?.drop();
  });

  it('CA-T.9 subir o banco vazio com as migrações dá o mesmo esquema das entidades', async () => {
    expect(await schemaDrift(db)).toEqual([]);
    expect(await businessTables(db)).toEqual([
      'achievement',
      'alert_dedup',
      'approval_evidence',
      'approval_recipient',
      'approval_request',
      'approval_request_attachment',
      'attachment',
      'audit_log',
      'campaign',
      'campaign_category',
      'campaign_entity',
      'category',
      'comment',
      'email_log',
      'email_template',
      'entity',
      'financial_gain',
      'hall_dismissal',
      'highlight',
      'highlight_consent',
      'highlight_praise',
      'idea',
      'idea_category',
      'idea_event',
      'idea_field_value',
      'idea_like',
      'idea_participant',
      'idea_sequence',
      'integration',
      'integration_hour',
      'integration_idempotency',
      'integration_scope',
      'integration_token',
      'level',
      'login_media',
      'mail_provider',
      'measurement',
      'mural_comment',
      'mural_comment_revision',
      'mural_consent',
      'mural_post',
      'mural_reaction',
      'mural_report',
      'mural_share',
      'notification',
      'notification_preference',
      'ops_alert_state',
      'ops_heartbeat',
      'ops_metric_hour',
      'organization_logo',
      'password_reset',
      'point_ledger',
      'reward_record',
      'role',
      'role_permission',
      'saved_filter',
      'season',
      'session',
      'setting',
      'sso_provider',
      'step',
      'store_expiry_notice',
      'store_item',
      'store_item_entity',
      'store_ledger',
      'store_order',
      'sustainment_review',
      'triage_rule',
      'user',
      'user_achievement',
      'user_avatar',
      'user_field',
      'user_field_option',
      'user_field_value',
      'user_identity',
      'user_role_scope',
      'webhook_delivery',
      'webhook_event',
      'webhook_secret',
      'webhook_subscription',
    ]);
  });

  it('CA-T.9 reverter as migrações uma a uma funciona e reaplicar volta ao mesmo esquema', async () => {
    for (let i = 0; i < MIGRATIONS.length; i++) await db.dataSource.undoLastMigration({ transaction: 'each' });
    expect(await businessTables(db)).toEqual([]);

    await prepareDatabase(db.dataSource);
    expect(await schemaDrift(db)).toEqual([]);
    expect(await businessTables(db)).toHaveLength(80);
  });

  it('CA-RN-43.3 depois de migrar e semear não existe nenhum usuário (nem senha padrão)', async () => {
    expect(await db.dataSource.getRepository(User).count()).toBe(0);
  });

  describe('log de auditoria somente inserção (RN-39)', () => {
    it('aceita inserção e recusa UPDATE, DELETE e TRUNCATE', async () => {
      const repo = db.dataSource.getRepository(AuditLog);
      const row = await repo.save(repo.create({ action: 'test.event', data: { ok: true } }));
      expect(row.id).toBeDefined();

      await expect(repo.update({ id: row.id }, { action: 'alterado' })).rejects.toThrow(/somente inserção/);
      await expect(repo.delete({ id: row.id })).rejects.toThrow(/somente inserção/);
      await expect(db.dataSource.query('TRUNCATE audit_log')).rejects.toThrow(/somente inserção/);
      expect(await repo.countBy({ id: row.id })).toBe(1);
    });
  });

  describe('perfis de fábrica (§3.1)', () => {
    const permissionsOf = async (key: string) => {
      const role = await db.dataSource.getRepository(Role).findOneByOrFail({ systemKey: key });
      const rows = await db.dataSource.getRepository(RolePermission).findBy({ roleId: role.id });
      return { role, permissions: rows.map((r) => r.permission).sort() };
    };

    it('cria os cinco perfis, marcados como de sistema, e o Administrador tem todas as permissões', async () => {
      const roles = await db.dataSource.getRepository(Role).find();
      expect(roles.map((r) => r.systemKey).sort()).toEqual(FACTORY_ROLES.map((r) => r.key).sort());
      expect(roles.every((r) => r.isSystem)).toBe(true);
      expect((await permissionsOf('admin')).permissions).toEqual([...ALL_PERMISSIONS].sort());
      expect((await permissionsOf('collaborator')).permissions).toEqual(['idea.comment', 'idea.submit']);
    });

    it('semear de novo não duplica nem desfaz a edição do admin (base do CA-RN-01.7)', async () => {
      const { role } = await permissionsOf('analyst');
      await db.dataSource.getRepository(RolePermission).delete({ roleId: role.id, permission: 'idea.triage' });

      await prepareDatabase(db.dataSource);

      expect(await db.dataSource.getRepository(Role).count()).toBe(FACTORY_ROLES.length);
      expect((await permissionsOf('analyst')).permissions).not.toContain('idea.triage');
    });

    it('o Administrador recebe de volta permissões que faltarem (versões novas trazem códigos novos)', async () => {
      const { role } = await permissionsOf('admin');
      await db.dataSource.getRepository(RolePermission).delete({ roleId: role.id, permission: 'audit.view' });

      await prepareDatabase(db.dataSource);

      expect((await permissionsOf('admin')).permissions).toContain('audit.view');
    });
  });
});
