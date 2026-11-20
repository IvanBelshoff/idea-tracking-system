import 'reflect-metadata';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Item {
  id: string;
  name: string;
  cost: number;
  kind: string;
  active: boolean;
  stock: number | null;
  openOrders: number;
  totalOrders: number;
  photoVersion: string | null;
  entities: { id: string }[];
  code?: string;
}
interface CatalogItem {
  id: string;
  cost: number;
  stockLeft: number | null;
  limit: { qty: number; period: string; used: number } | null;
  redemptions: number;
  canOrder: boolean;
  blockedReason: string | null;
}
interface Catalog {
  account: { balance: number; reserved: number; earnedPoints: number };
  items: CatalogItem[];
  currency: string;
}
interface Order {
  id: string;
  status: string;
  cost: number;
  kind: string;
  bonusValue: number | null;
  reason: string | null;
  person: { userId: string; name: string } | null;
  paidOn: string | null;
  paidReference: string | null;
  code?: string;
}

describe('Loja: itens, vitrine, pedidos e bonificação (M22, RN-163 a RN-167, RN-169, CA-T.25)', () => {
  let t: TestApp;
  let admin: Client;
  let adminId: string;
  const ent: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};

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
  const settings = (values: Record<string, unknown>) => admin.request('PATCH', '/settings', { values });
  const credit = async (key: string, amount: number) =>
    expect(
      (await admin.post('/store/adjustments', { userId: uid[key], amount, reason: 'Saldo de teste' })).status,
    ).toBe(200);
  const createItem = async (over: Record<string, unknown> = {}) => {
    const res = await admin.post<Item>('/store/items', { name: 'Caneca', kind: 'product', cost: 30, ...over });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const place = (who: Client, itemId: string, note?: string) => who.post<Order>('/store/orders', { itemId, note });
  const catalog = (who: Client) => who.get<Catalog>('/store/catalog');
  const balance = async (who: Client) => (await who.get<{ balance: number }>('/store/me')).body.balance;
  const ledgerSum = async (userId: string) =>
    Number(
      (
        (await t.db.dataSource.query('SELECT coalesce(sum(amount), 0) AS s FROM store_ledger WHERE user_id = $1', [
          userId,
        ])) as { s: string }[]
      )[0]?.s,
    );
  const decide = (who: Client, id: string, action: string, body?: unknown) =>
    who.post<Order>(`/store/orders/${id}/${action}`, body);

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    adminId = (await admin.get<{ id: string }>('/auth/me')).body.id;
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    ent.A = (await tree.save(tree.create({ name: 'Unidade A', parent: org }))).id;
    ent.A1 = (
      await tree.save(
        tree.create({ name: 'Setor A1', parent: await ds.getRepository(OrgEntity).findOneByOrFail({ id: ent.A }) }),
      )
    ).id;
    ent.B = (await tree.save(tree.create({ name: 'Unidade B', parent: org }))).id;
    await user('colab1', 'collaborator', ent.A1!);
    await user('colab2', 'collaborator', ent.A1!);
    await user('colab3', 'collaborator', ent.B!);
    await user('rh', 'collaborator', ent.A!);
    const rh = await ds.getRepository(Role).save(ds.getRepository(Role).create({ name: 'RH', description: 'Loja' }));
    await ds.query(`INSERT INTO role_permission (role_id, permission) VALUES ($1, 'store.manage')`, [rh.id]);
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: uid.rh!, roleId: rh.id, entityId: ent.A! }));
    expect((await settings({ 'recognition.enabled': true, 'store.enabled': true })).status).toBe(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-163.1 validação do item: nome, custo e valor da bonificação', async () => {
    const bad = async (body: Record<string, unknown>) =>
      (await admin.post('/store/items', { name: 'X', kind: 'product', cost: 10, ...body })).status;
    expect(await bad({ name: '' })).toBe(422);
    expect(await bad({ cost: 0 })).toBe(422);
    expect(await bad({ cost: -5 })).toBe(422);
    expect(await bad({ cost: 1.5 })).toBe(422);
    expect(await bad({ kind: 'bonus' })).toBe(422); // sem valor informativo
    expect(await bad({ limitQty: 1 })).toBe(422); // limite sem período
    expect(await bad({ entityIds: ['00000000-0000-4000-8000-000000000000'] })).toBe(422);
    expect((await c.colab1!.post('/store/items', { name: 'X', kind: 'product', cost: 10 })).status).toBe(403);
  });

  it('CA-RN-165.1 / 160.1 / 160.2 pedir reserva o custo, baixa o estoque e não mexe nos pontos ganhos', async () => {
    const item = await createItem({ name: 'Garrafa', cost: 60, stock: 5 });
    await credit('colab1', 100);
    const res = await place(c.colab1!, item.id, 'Cor azul, por favor');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending', cost: 60, person: null });
    const cat = (await catalog(c.colab1!)).body;
    expect(cat.account).toMatchObject({ balance: 40, reserved: 60, earnedPoints: 0 });
    expect(cat.items.find((i) => i.id === item.id)?.stockLeft).toBe(4);
    expect(await ledgerSum(uid.colab1!)).toBe(40);
    const lines: { kind: string; amount: number; order_id: string }[] = await t.db.dataSource.query(
      `SELECT kind, amount, order_id FROM store_ledger WHERE user_id = $1 AND kind = 'reserve'`,
      [uid.colab1],
    );
    expect(lines).toEqual([{ kind: 'reserve', amount: -60, order_id: res.body.id }]);
  });

  it('CA-RN-165.2 / 164.2 sem saldo, sem estoque, limite atingido e item inativo', async () => {
    const pricey = await createItem({ name: 'Fone', cost: 500 });
    const r1 = await place(c.colab1!, pricey.id);
    expect([r1.status, r1.body.code]).toEqual([422, 'insufficient_balance']);
    const last = await createItem({ name: 'Última unidade', cost: 1, stock: 0 });
    expect((await place(c.colab1!, last.id)).body).toMatchObject({ code: 'out_of_stock' });
    const limited = await createItem({ name: 'Vale-café', cost: 5, limitQty: 1, limitPeriod: 'quarter' });
    expect((await place(c.colab1!, limited.id)).status).toBe(201);
    expect((await place(c.colab1!, limited.id)).body).toMatchObject({ code: 'limit_reached' });
    const off = await createItem({ name: 'Inativo', cost: 1, active: false });
    expect((await place(c.colab1!, off.id)).status).toBe(404);
    const cat = (await catalog(c.colab1!)).body.items;
    expect(cat.find((i) => i.id === pricey.id)).toMatchObject({
      canOrder: false,
      blockedReason: 'insufficient_balance',
    });
    expect(cat.find((i) => i.id === last.id)).toMatchObject({ canOrder: false, blockedReason: 'out_of_stock' });
    expect(cat.find((i) => i.id === limited.id)).toMatchObject({
      canOrder: false,
      blockedReason: 'limit_reached',
      limit: { qty: 1, period: 'quarter', used: 1 },
    });
    expect(cat.some((i) => i.id === off.id)).toBe(false);
  });

  it('CA-RN-165.4 / 165.5 cancelar o próprio pendente estorna e libera o limite; aprovado não se cancela pela pessoa', async () => {
    const limited = await createItem({ name: 'Ingresso', cost: 10, limitQty: 1, limitPeriod: 'month', stock: 2 });
    await credit('colab2', 50);
    const first = (await place(c.colab2!, limited.id)).body;
    const cancelled = await c.colab2!.post<Order>(`/store/me/orders/${first.id}/cancel`);
    expect(cancelled.body.status).toBe('cancelled');
    expect(await balance(c.colab2!)).toBe(50);
    const second = (await place(c.colab2!, limited.id)).body; // o cancelado não conta para o limite
    expect(second.status).toBe('pending');
    expect((await decide(admin, second.id, 'approve')).status).toBe(200);
    expect((await c.colab2!.post(`/store/me/orders/${second.id}/cancel`)).status).toBe(409);
    expect((await c.colab1!.post(`/store/me/orders/${second.id}/cancel`)).status).toBe(404); // de outra pessoa
    // Pedido de um trimestre/mês anterior não conta.
    await t.db.dataSource.query(`UPDATE store_order SET created_at = created_at - interval '400 days' WHERE id = $1`, [
      second.id,
    ]);
    expect((await place(c.colab2!, limited.id)).status).toBe(201);
  });

  it('CA-RN-166.1 a 166.4 aprovar, entregar, recusar e cancelar com estorno; ninguém decide o próprio pedido', async () => {
    const item = await createItem({ name: 'Mochila', cost: 20, stock: 10 });
    await credit('colab3', 100);
    const o1 = (await place(c.colab3!, item.id)).body;
    expect((await decide(admin, o1.id, 'deliver')).status).toBe(409); // pendente não se entrega
    const approved = await decide(c.rh!, o1.id, 'approve');
    expect(approved.body).toMatchObject({ status: 'approved', person: { userId: uid.colab3, name: 'Pessoa colab3' } });
    expect((await decide(admin, o1.id, 'approve')).status).toBe(409);
    const delivered = await decide(admin, o1.id, 'deliver', { note: 'Retirada na portaria' });
    expect(delivered.body.status).toBe('delivered');
    expect((await decide(admin, o1.id, 'cancel', { reason: 'x' })).status).toBe(409); // entregue é final

    const o2 = (await place(c.colab3!, item.id)).body;
    expect((await decide(admin, o2.id, 'reject', { reason: '' })).status).toBe(422);
    const rejected = await decide(admin, o2.id, 'reject', { reason: 'Item em falta no fornecedor' });
    expect(rejected.body).toMatchObject({ status: 'rejected', reason: 'Item em falta no fornecedor' });
    const o3 = (await place(c.colab3!, item.id)).body;
    await decide(admin, o3.id, 'approve');
    expect((await decide(admin, o3.id, 'cancel', { reason: 'Compra suspensa' })).body.status).toBe('cancelled');
    expect(await balance(c.colab3!)).toBe(80); // só o entregue ficou
    const items = (await admin.get<Item[]>('/store/items')).body;
    expect(items.find((i) => i.id === item.id)?.stock).toBe(9);
    expect(await ledgerSum(uid.colab3!)).toBe(80);

    // O gestor da loja que pede não decide o próprio pedido.
    await credit('rh', 50);
    const own = (await place(c.rh!, item.id)).body;
    for (const action of ['approve', 'reject', 'cancel']) {
      const res = await decide(c.rh!, own.id, action, { reason: 'x' });
      expect([res.status, res.body.code]).toEqual([403, 'own_order']);
    }
    expect((await c.colab1!.get('/store/orders')).status).toBe(403);
    expect((await decide(c.colab1!, own.id, 'approve')).status).toBe(403);
  });

  it('CA-RN-166.5 decisões simultâneas no mesmo pedido: só uma vale', async () => {
    const item = await createItem({ name: 'Camiseta', cost: 5 });
    await credit('colab1', 20);
    const o = (await place(c.colab1!, item.id)).body;
    const results = await Promise.all([
      decide(admin, o.id, 'approve'),
      decide(c.rh!, o.id, 'reject', { reason: 'Duplicado' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const refunds: { n: string }[] = await t.db.dataSource.query(
      `SELECT count(*) AS n FROM store_ledger WHERE order_id = $1 AND kind = 'refund'`,
      [o.id],
    );
    const final = results.find((r) => r.status === 200)?.body.status;
    expect(Number(refunds[0]?.n)).toBe(final === 'rejected' ? 1 : 0);
  });

  it('CA-RN-163.2 / 163.3 / 163.4 mudar o custo não muda pedidos feitos; desativar mantém os pendentes; excluir só sem pedidos', async () => {
    const item = await createItem({ name: 'Agenda', cost: 100 });
    await credit('colab2', 300);
    const o1 = (await place(c.colab2!, item.id)).body;
    const o2 = (await place(c.colab2!, item.id)).body;
    const changed = await admin.request<Item>('PATCH', `/store/items/${item.id}`, { cost: 150 });
    expect(changed.body.cost).toBe(150);
    const audit: { action: string; data: { before: { cost: number }; after: { cost: number } } }[] =
      await t.db.dataSource.query(`SELECT action, data FROM audit_log WHERE target_id = $1 ORDER BY id`, [item.id]);
    expect(audit.at(-1)).toMatchObject({
      action: 'store.item_updated',
      data: { before: { cost: 100 }, after: { cost: 150 } },
    });
    const deact = await admin.request<Item>('PATCH', `/store/items/${item.id}`, { active: false });
    expect(deact.body).toMatchObject({ active: false, openOrders: 2 });
    expect((await catalog(c.colab2!)).body.items.some((i) => i.id === item.id)).toBe(false);
    expect((await decide(admin, o1.id, 'approve')).body.cost).toBe(100);
    expect((await decide(admin, o1.id, 'deliver')).body.status).toBe('delivered');
    expect((await decide(admin, o2.id, 'approve')).status).toBe(200);
    expect((await admin.request('DELETE', `/store/items/${item.id}`)).status).toBe(409);
    expect((await admin.request('PATCH', `/store/items/${item.id}`, { kind: 'bonus', bonusValue: 10 })).status).toBe(
      409,
    );
    const empty = await createItem({ name: 'Sem pedidos' });
    expect((await admin.request('DELETE', `/store/items/${empty.id}`)).status).toBe(204);
    const actions: { action: string }[] = await t.db.dataSource.query(
      `SELECT action FROM audit_log WHERE target_id = ANY($1) ORDER BY id`,
      [[item.id, empty.id]],
    );
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'store.item_created',
        'store.item_updated',
        'store.item_deactivated',
        'store.item_deleted',
      ]),
    );
  });

  it('CA-RN-163.5 / 164.1 / 170.2 disponibilidade por entidade (com sub-entidades) e vitrine sem nomes', async () => {
    const onlyA = await createItem({ name: 'Só da Unidade A', cost: 1, entityIds: [ent.A] });
    expect((await catalog(c.colab1!)).body.items.some((i) => i.id === onlyA.id)).toBe(true); // Setor A1
    expect((await catalog(c.colab3!)).body.items.some((i) => i.id === onlyA.id)).toBe(false); // Unidade B
    expect((await place(c.colab3!, onlyA.id)).status).toBe(404);
    expect((await place(c.colab1!, onlyA.id)).status).toBe(201);
    const view = (await catalog(c.colab2!)).body;
    expect(view.items.find((i) => i.id === onlyA.id)?.redemptions).toBe(1);
    const text = JSON.stringify(view);
    expect(text).not.toContain('Pessoa colab1');
    expect(text).not.toContain(uid.colab1!);
  });

  it('CA-RN-163.6 foto do item: tipo pelo conteúdo, WebP, e só quem vê o item a recebe', async () => {
    const item = await createItem({ name: 'Com foto', cost: 1, entityIds: [ent.B] });
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#4f46e5' } })
      .png()
      .toBuffer();
    const up = await admin.upload<{ version: string }>(
      `/store/items/${item.id}/photo`,
      'foto.png',
      png,
      'image/png',
      'PUT',
    );
    expect(up.status).toBe(200);
    expect(up.body.version).toBeTruthy();
    const fake = await admin.upload(
      `/store/items/${item.id}/photo`,
      'foto.png',
      Buffer.from('<svg></svg>'),
      'image/png',
      'PUT',
    );
    expect(fake.status).toBe(415);
    const res = await c.colab3!.raw(`/store/items/${item.id}/photo`);
    expect([res.status, res.headers.get('content-type')]).toEqual([200, 'image/webp']);
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);
    expect((await c.colab1!.raw(`/store/items/${item.id}/photo`)).status).toBe(404); // item só da Unidade B
    expect((await c.colab1!.upload(`/store/items/${item.id}/photo`, 'f.png', png, 'image/png', 'PUT')).status).toBe(
      403,
    );
  });

  it('CA-RN-167.1 a 167.4 bonificação: aprovar, pagar com data e referência, CSV para o RH', async () => {
    const bonus = await createItem({ name: '=Vale alimentação', kind: 'bonus', cost: 40, bonusValue: 150.5 });
    await credit('colab1', 100);
    const o = (await place(c.colab1!, bonus.id)).body;
    expect(o).toMatchObject({ kind: 'bonus', bonusValue: 150.5 });
    await decide(admin, o.id, 'approve');
    expect((await decide(admin, o.id, 'deliver')).status).toBe(409); // bonificação não é entregue
    const toPay = (await admin.get<Order[]>('/store/bonuses')).body;
    expect(toPay.map((b) => b.id)).toContain(o.id);
    const csv = await admin.raw('/store/bonuses/export');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text = await csv.text();
    expect(text).toContain("'=Vale alimentação"); // fórmula neutralizada (CA-T.4)
    expect(text).toContain('150,50');
    expect(text).toContain('Pessoa colab1');
    expect((await decide(admin, o.id, 'pay', { paidOn: '2026-11-30' })).status).toBe(422);
    const paid = await decide(admin, o.id, 'pay', { paidOn: '2026-11-30', reference: 'Folha 11/2026' });
    expect(paid.body).toMatchObject({
      status: 'paid',
      paidOn: '2026-11-30',
      paidReference: 'Folha 11/2026',
      bonusValue: 150.5,
    });
    expect((await admin.get<Order[]>('/store/bonuses')).body.map((b) => b.id)).not.toContain(o.id);
    expect((await admin.get<Order[]>('/store/bonuses?status=paid')).body.map((b) => b.id)).toContain(o.id);
    // Produto não é "pago".
    const product = await createItem({ name: 'Boné', cost: 1 });
    const p = (await place(c.colab1!, product.id)).body;
    await decide(admin, p.id, 'approve');
    expect((await decide(admin, p.id, 'pay', { paidOn: '2026-11-30', reference: 'x' })).status).toBe(409);
  });

  it('CA-RN-169.1 saldo negativo bloqueia pedidos novos; o já reservado segue', async () => {
    await user('devedor', 'collaborator', ent.A!);
    await credit('devedor', 30);
    const item = await createItem({ name: 'Chaveiro', cost: 30 });
    const o = (await place(c.devedor!, item.id)).body;
    expect(
      (await admin.post('/store/adjustments', { userId: uid.devedor, amount: -20, reason: 'Correção' })).status,
    ).toBe(200);
    expect(await balance(c.devedor!)).toBe(-20);
    const cheap = await createItem({ name: 'Adesivo', cost: 1 });
    expect((await place(c.devedor!, cheap.id)).body).toMatchObject({ code: 'insufficient_balance' });
    await decide(admin, o.id, 'approve');
    expect((await decide(admin, o.id, 'deliver')).body.status).toBe('delivered');
  });

  it('CA-RN-170.3 decisões e pagamento vão para a auditoria com quem fez', async () => {
    const rows: { action: string; actor_id: string }[] = await t.db.dataSource.query(
      `SELECT DISTINCT action, actor_id FROM audit_log WHERE action LIKE 'store.order_%' OR action = 'store.bonus_paid'`,
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      'store.order_approved',
      'store.order_rejected',
      'store.order_delivered',
      'store.order_cancelled',
      'store.bonus_paid',
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
    expect(rows.every((r) => r.actor_id === adminId || r.actor_id === uid.rh)).toBe(true);
  });

  it('CA-T.25 / CA-RN-165.3 pedidos simultâneos nunca gastam o mesmo saldo nem a última unidade', async () => {
    await user('paralelo', 'collaborator', ent.A!);
    await credit('paralelo', 100);
    const item = await createItem({ name: 'Disputado', cost: 30 });
    const results = await Promise.all(Array.from({ length: 8 }, () => place(c.paralelo!, item.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422).every((r) => r.body.code === 'insufficient_balance')).toBe(true);
    expect(await balance(c.paralelo!)).toBe(10);
    expect(await ledgerSum(uid.paralelo!)).toBe(10);
    // A última unidade, disputada por pessoas diferentes.
    const lastOne = await createItem({ name: 'Unidade única', cost: 1, stock: 1 });
    await credit('colab2', 10);
    await credit('colab3', 10);
    const race = await Promise.all([
      place(c.colab2!, lastOne.id),
      place(c.colab3!, lastOne.id),
      place(c.paralelo!, lastOne.id),
    ]);
    expect(race.filter((r) => r.status === 201)).toHaveLength(1);
    const [row]: { stock: number }[] = await t.db.dataSource.query('SELECT stock FROM store_item WHERE id = $1', [
      lastOne.id,
    ]);
    expect(row?.stock).toBe(0);
    // Pedidos e cancelamentos misturados: o saldo segue igual à soma do extrato e o estoque nunca fica negativo.
    const pending = results.filter((r) => r.status === 201).map((r) => r.body.id);
    await Promise.all([
      ...pending.map((id) => c.paralelo!.post(`/store/me/orders/${id}/cancel`)),
      ...Array.from({ length: 4 }, () => place(c.paralelo!, item.id)),
    ]);
    const bal = await balance(c.paralelo!);
    expect(bal).toBe(await ledgerSum(uid.paralelo!));
    expect(bal).toBeGreaterThanOrEqual(0);
    const negative: { n: string }[] = await t.db.dataSource.query(
      'SELECT count(*) AS n FROM store_item WHERE stock < 0',
    );
    expect(Number(negative[0]?.n)).toBe(0);
  });
});
