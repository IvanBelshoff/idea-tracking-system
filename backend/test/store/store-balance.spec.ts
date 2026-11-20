import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInZone } from '../../src/common/dates.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User, UserStatus } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { FACTORY_ROLES } from '../../src/identity-access/factory-roles.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { runStoreExpiry } from '../../src/store/store-core.js';
import { balanceOf, expiredAmount, expiryCutoff, periodStart } from '../../src/store/store-rules.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Account {
  userId: string;
  balance: number;
  reserved: number;
  earnedPoints: number;
  expiring: { amount: number; on: string } | null;
  expiryMonths: number;
}
interface LedgerPage {
  items: { kind: string; amount: number; reason: string | null; actor: string | null; idea: { code: string } | null }[];
  meta: { total: number };
}

describe('Loja: módulo, saldo, extrato, ajuste e validade (M22, RN-159 a RN-162, RN-168 a RN-170)', () => {
  let t: TestApp;
  let admin: Client;
  const ent: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  let categoryId: string;
  const zone = 'America/Sao_Paulo';

  async function user(key: string, roleKey: string, entityId: string) {
    const ds = t.db.dataSource;
    const repo = ds.getRepository(User);
    const u = await repo.save(
      repo.create({
        email: `${key}@example.test`,
        name: `Pessoa ${key}`,
        passwordHash: await hashPassword(STRONG_PASSWORD),
      }),
    );
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: roleKey });
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId }));
    uid[key] = u.id;
    c[key] = new Client(t.baseUrl);
    expect((await c[key].post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  }
  const settings = (values: Record<string, unknown>) =>
    admin.request<{ code?: string }>('PATCH', '/settings', { values });
  const send = async (who: string, title: string) => {
    const res = await c[who]!.post<{ code: string }>('/ideas', {
      title,
      description: `Antes: ${title}`,
      entityId: ent.A,
      categoryId,
    });
    expect(res.status).toBe(201);
    return res.body;
  };
  const approve = (code: string) =>
    c.ana!.post(`/ideas/${code}/approve`, { stepName: 'Fazer', assigneeId: uid.ana, dueDate: '2099-12-31' });
  const me = (who: Client) => who.get<Account & { code?: string }>('/store/me');
  const ledger = (who: Client) => who.get<LedgerPage>('/store/me/ledger?pageSize=100');
  const adjust = (who: Client, userId: string, amount: number, reason = 'Campanha de segurança') =>
    who.post<Account & { code?: string }>('/store/adjustments', { userId, amount, reason });
  /** Linha no extrato com data no passado (só os testes inserem assim; o banco aceita inserção). */
  const backdated = (userId: string, kind: string, amount: number, day: string) =>
    t.db.dataSource.query(
      `INSERT INTO store_ledger (id, user_id, kind, amount, created_at) VALUES ($1, $2, $3, $4, ($5::date + time '12:00') AT TIME ZONE $6)`,
      [uuidv7(), userId, kind, amount, day, zone],
    );

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    ent.A = (await tree.save(tree.create({ name: 'Unidade A', parent: org }))).id;
    categoryId = (
      await ds.getRepository(Category).save(ds.getRepository(Category).create({ name: 'Qualidade', color: '#4f46e5' }))
    ).id;
    await user('ana', 'analyst', ent.A!);
    await user('colab1', 'collaborator', ent.A!);
    await user('colab2', 'collaborator', ent.A!);
    await user('colab3', 'collaborator', ent.A!);
    // Pontos antes da loja existir: reconhecimento ligado, ideia de colab1 enviada e aprovada (10 + 20).
    expect((await settings({ 'recognition.enabled': true })).status).toBe(200);
    const idea = await send('colab1', 'Antes da loja');
    expect((await approve(idea.code)).status).toBe(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('regras: vencimento pelos créditos mais antigos, dia de corte e períodos do calendário', () => {
    const lines = [
      { kind: 'earned' as const, amount: 100, day: '2025-01-10' },
      { kind: 'reserve' as const, amount: -30, day: '2025-02-01' },
      { kind: 'earned' as const, amount: 50, day: '2026-09-01' },
    ];
    expect(expiredAmount(lines, '2025-06-30')).toBe(70);
    expect(expiredAmount([...lines, { kind: 'expiration', amount: -70, day: '2026-01-01' }], '2025-06-30')).toBe(0);
    expect(expiredAmount([...lines, { kind: 'refund', amount: 30, day: '2025-03-01' }], '2025-06-30')).toBe(100);
    expect(expiredAmount([{ kind: 'adjustment', amount: -500, day: '2025-01-01' }, ...lines], '2025-06-30')).toBe(0);
    expect(balanceOf(lines)).toBe(120);
    expect(expiryCutoff('2026-11-13', 12)).toBe('2025-11-12');
    expect(expiryCutoff('2026-03-31', 1)).toBe('2026-02-27');
    expect(periodStart('2026-11-13', 'month')).toBe('2026-11-01');
    expect(periodStart('2026-11-13', 'quarter')).toBe('2026-10-01');
    expect(periodStart('2026-05-02', 'semester')).toBe('2026-01-01');
    expect(periodStart('2026-08-02', 'semester')).toBe('2026-07-01');
    expect(periodStart('2026-08-02', 'year')).toBe('2026-01-01');
  });

  it('CA-RN-159.4 só o Administrador tem store.manage de fábrica', () => {
    const roles = Object.fromEntries(FACTORY_ROLES.map((r) => [r.key, r.permissions]));
    expect(roles.admin).toContain('store.manage');
    for (const key of ['collaborator', 'analyst', 'manager', 'validator'] as const) {
      expect(roles[key]).not.toContain('store.manage');
    }
  });

  it('CA-RN-159.1 desligada (padrão): as rotas respondem 404 e o ponto ganho não credita nada', async () => {
    expect((await me(c.colab1!)).status).toBe(404);
    expect((await adjust(admin, uid.colab1!, 10)).status).toBe(404);
    const rows: { n: string }[] = await t.db.dataSource.query('SELECT count(*) AS n FROM store_ledger');
    expect(Number(rows[0]?.n)).toBe(0);
    expect((await admin.get<{ store: { enabled: boolean } }>('/settings/public')).body.store).toEqual({
      enabled: false,
    });
  });

  it('CA-RN-159.2 a loja exige o reconhecimento, nos dois sentidos', async () => {
    expect((await settings({ 'recognition.enabled': false })).status).toBe(200);
    const on = await settings({ 'store.enabled': true });
    expect([on.status, on.body.code]).toEqual([422, 'store_requires_recognition']);
    expect((await settings({ 'recognition.enabled': true, 'store.enabled': true })).status).toBe(200);
    const off = await settings({ 'recognition.enabled': false });
    expect([off.status, off.body.code]).toEqual([422, 'store_requires_recognition']);
  });

  it('CA-RN-161.1 / 161.2 ao ligar pela primeira vez, o saldo nasce igual aos pontos já ganhos; religar não repete', async () => {
    const account = await me(c.colab1!);
    expect(account.body).toMatchObject({ balance: 30, earnedPoints: 30, reserved: 0, expiring: null, expiryMonths: 0 });
    expect((await ledger(c.colab1!)).body.items.map((l) => [l.kind, l.amount])).toEqual([['initial', 30]]);
    expect((await me(c.colab2!)).body).toMatchObject({ balance: 0 }); // sem pontos, sem linha
    expect((await ledger(c.colab2!)).body.meta.total).toBe(0);
    const audit: { data: { people: number } }[] = await t.db.dataSource.query(
      `SELECT data FROM audit_log WHERE action = 'store.initialized'`,
    );
    expect(audit.map((a) => a.data.people)).toEqual([1]);
    expect((await settings({ 'store.enabled': false })).status).toBe(200);
    expect((await settings({ 'store.enabled': true })).status).toBe(200);
    expect((await ledger(c.colab1!)).body.items.filter((l) => l.kind === 'initial')).toHaveLength(1);
  });

  it('CA-RN-161.3 / 161.4 cada ponto ganho credita o saldo, também com a loja desligada depois', async () => {
    const idea = await send('colab2', 'Depois da loja');
    expect((await me(c.colab2!)).body.balance).toBe(10); // ideia enviada
    expect((await settings({ 'store.enabled': false })).status).toBe(200);
    expect((await approve(idea.code)).status).toBe(200); // +20 com a loja desligada
    expect((await settings({ 'store.enabled': true })).status).toBe(200);
    const page = (await ledger(c.colab2!)).body;
    expect(page.items.map((l) => [l.kind, l.amount, l.idea?.code])).toEqual([
      ['earned', 20, idea.code],
      ['earned', 10, idea.code],
    ]);
    expect((await me(c.colab2!)).body).toMatchObject({ balance: 30, earnedPoints: 30 });
    // Reprocessar o mesmo ponto não credita de novo (um crédito por ponto).
    const points: { id: string }[] = await t.db.dataSource.query('SELECT id FROM point_ledger WHERE user_id = $1', [
      uid.colab2,
    ]);
    const dup = await t.db.dataSource
      .query(`INSERT INTO store_ledger (id, user_id, kind, amount, point_id) VALUES ($1, $2, 'earned', 20, $3)`, [
        uuidv7(),
        uid.colab2,
        points[0]?.id,
      ])
      .catch((e: Error) => e.message);
    expect(String(dup)).toMatch(/uq_store_ledger_point|duplicate/);
  });

  it('CA-RN-160.3 / CA-T.26 o banco recusa UPDATE, DELETE e TRUNCATE no extrato', async () => {
    const ds = t.db.dataSource;
    await expect(ds.query(`UPDATE store_ledger SET amount = 999 WHERE user_id = $1`, [uid.colab1])).rejects.toThrow(
      /somente inserção/,
    );
    await expect(ds.query('DELETE FROM store_ledger WHERE user_id = $1', [uid.colab1])).rejects.toThrow(
      /somente inserção/,
    );
    await expect(ds.query('TRUNCATE store_ledger CASCADE')).rejects.toThrow(/somente inserção/);
    expect((await me(c.colab1!)).body.balance).toBe(30);
  });

  it('CA-RN-168.1 / 168.2 / 160.1 / 160.4 ajuste manual: motivo, só no saldo, auditoria; ninguém ajusta o próprio', async () => {
    const res = await adjust(admin, uid.colab1!, 50, 'Campanha de segurança');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ balance: 80, earnedPoints: 30 }); // pontos ganhos e nível não mudam
    const top = (await ledger(c.colab1!)).body.items[0];
    expect(top).toMatchObject({
      kind: 'adjustment',
      amount: 50,
      reason: 'Campanha de segurança',
      actor: 'Admin Teste',
    });
    const audit: { actor_id: string; data: Record<string, unknown> }[] = await t.db.dataSource.query(
      `SELECT actor_id, data FROM audit_log WHERE action = 'store.balance_adjusted' AND target_id = $1`,
      [uid.colab1],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.data).toMatchObject({ amount: 50, reason: 'Campanha de segurança' });
    expect((await adjust(admin, uid.colab1!, 0)).status).toBe(422);
    expect((await adjust(admin, uid.colab1!, 5, '  ')).status).toBe(422);
    expect((await adjust(admin, uid.colab1!, 2.5)).status).toBe(422);
    expect((await adjust(c.ana!, uid.colab1!, 5)).status).toBe(403); // sem store.manage
    const own = await adjust(admin, (await admin.get<{ id: string }>('/auth/me')).body.id, 5);
    expect([own.status, own.body.code]).toEqual([403, 'own_account']);
    expect((await adjust(admin, '00000000-0000-4000-8000-000000000000', 5)).status).toBe(404);
  });

  it('CA-RN-168.3 / 169 um débito maior que o saldo deixa o saldo negativo', async () => {
    const res = await adjust(admin, uid.colab3!, -20, 'Correção de lançamento');
    expect(res.body.balance).toBe(-20);
    expect((await me(c.colab3!)).body.balance).toBe(-20);
  });

  it('CA-RN-170.1 / 159.4 saldo e extrato só da própria pessoa e de quem gerencia a loja', async () => {
    expect((await c.colab2!.get(`/store/accounts/${uid.colab1}`)).status).toBe(403);
    expect((await c.colab2!.get(`/store/accounts/${uid.colab1}/ledger`)).status).toBe(403);
    expect((await c.colab2!.get('/store/accounts')).status).toBe(403);
    const view = await admin.get<Account & { name: string }>(`/store/accounts/${uid.colab1}`);
    expect(view.body).toMatchObject({ name: 'Pessoa colab1', balance: 80 });
    const list = await admin.get<{ items: { userId: string; balance: number }[] }>('/store/accounts?search=colab');
    expect(list.body.items.find((i) => i.userId === uid.colab3)?.balance).toBe(-20);
    expect(JSON.stringify(list.body)).not.toContain('@example.test');
    // Com store.manage num perfil de qualquer entidade, gerencia a loja inteira.
    const ds = t.db.dataSource;
    const rh = await ds.getRepository(Role).save(ds.getRepository(Role).create({ name: 'RH', description: 'Loja' }));
    await ds.query(`INSERT INTO role_permission (role_id, permission) VALUES ($1, 'store.manage')`, [rh.id]);
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: uid.colab2!, roleId: rh.id, entityId: ent.A! }));
    expect((await c.colab2!.get(`/store/accounts/${uid.colab1}`)).status).toBe(200);
  });

  it('CA-RN-162.1 / 162.2 / 162.3 sem validade nada vence; com validade, vence o crédito mais antigo, uma vez só', async () => {
    const today = todayInZone(new Date(), zone);
    const old = `${Number(today.slice(0, 4)) - 3}-01-15`;
    await user('veterano', 'collaborator', ent.A!);
    await backdated(uid.veterano!, 'initial', 100, old);
    await backdated(uid.veterano!, 'reserve', -30, old);
    await backdated(uid.veterano!, 'earned', 40, today);
    expect(await runStoreExpiry(t.db.dataSource)).toBe(0); // sem validade
    expect((await me(c.veterano!)).body.balance).toBe(110);
    expect((await settings({ 'store.expiry_months': 12 })).status).toBe(200);
    expect(await runStoreExpiry(t.db.dataSource)).toBeGreaterThanOrEqual(1);
    expect((await me(c.veterano!)).body.balance).toBe(40);
    const lines = (await ledger(c.veterano!)).body.items.filter((l) => l.kind === 'expiration');
    expect(lines.map((l) => l.amount)).toEqual([-70]);
    await runStoreExpiry(t.db.dataSource);
    expect((await ledger(c.veterano!)).body.items.filter((l) => l.kind === 'expiration')).toHaveLength(1);
    expect((await settings({ 'store.expiry_months': 61 })).status).toBe(400);
  });

  it('RN-162 o saldo mostra o que vence nos próximos 30 dias', async () => {
    const today = todayInZone(new Date(), zone);
    // Um crédito que completa 12 meses daqui a 10 dias.
    const d = new Date(Date.parse(`${today}T12:00:00Z`) + 10 * 86_400_000);
    const day = `${d.getUTCFullYear() - 1}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    await user('quasevence', 'collaborator', ent.A!);
    await backdated(uid.quasevence!, 'earned', 25, day);
    const account = (await me(c.quasevence!)).body;
    expect(account.expiring?.amount).toBe(25);
    expect(account.expiring?.on).toBeDefined();
  });

  it('CA-RN-170.4 anonimizar mantém o extrato', async () => {
    await t.db.dataSource.getRepository(User).update(uid.colab3!, { status: UserStatus.Anonymized });
    const view = await admin.get<Account & { name: string }>(`/store/accounts/${uid.colab3}`);
    expect(view.body).toMatchObject({ name: 'Ex-colaborador', balance: -20 });
    expect((await admin.get<LedgerPage>(`/store/accounts/${uid.colab3}/ledger`)).body.meta.total).toBe(1);
    const res = await adjust(admin, uid.colab3!, 10);
    expect([res.status, res.body.code]).toEqual([422, 'person_anonymized']);
  });

  it('CA-RN-159.3 desligar e religar guarda tudo; ligar e desligar vai para a auditoria', async () => {
    const before = (await me(c.colab1!)).body.balance;
    expect((await settings({ 'store.enabled': false })).status).toBe(200);
    expect((await me(c.colab1!)).status).toBe(404);
    expect((await settings({ 'store.enabled': true })).status).toBe(200);
    expect((await me(c.colab1!)).body.balance).toBe(before);
    const rows: { n: string }[] = await t.db.dataSource.query(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'setting.updated' AND target_id = 'store.enabled'`,
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(4);
  });
});
