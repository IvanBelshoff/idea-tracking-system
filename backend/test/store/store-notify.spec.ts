import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInZone } from '../../src/common/dates.js';
import { MANDATORY_TYPES, STORE_TYPES } from '../../src/communication/notification-rules.js';
import { describeNotification } from '../../src/communication/notification-text.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { eventModule } from '../../src/integration/webhooks/events.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { runStoreExpiry } from '../../src/store/store-core.js';
import { createIntegration, enableIntegration, IntegrationClient } from '../support/integration-support.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Row {
  type: string;
  payload: Record<string, unknown>;
}

describe('Loja: avisos e integração (M22, RN-162, RN-171, RN-172)', () => {
  let t: TestApp;
  let admin: Client;
  let adminId: string;
  const ent: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
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
  const settings = (values: Record<string, unknown>) => admin.request('PATCH', '/settings', { values });
  const notes = (userId: string, type: string): Promise<Row[]> =>
    t.db.dataSource.query(
      'SELECT type, payload FROM notification WHERE user_id = $1 AND type = $2 ORDER BY created_at, id',
      [userId, type],
    );
  const credit = (key: string, amount: number) =>
    admin.post('/store/adjustments', { userId: uid[key], amount, reason: 'Campanha de outubro' });
  const item = async (over: Record<string, unknown> = {}) =>
    (await admin.post<{ id: string }>('/store/items', { name: 'Caneca', kind: 'product', cost: 10, ...over })).body;
  const place = async (key: string, itemId: string) =>
    (await c[key]!.post<{ id: string }>('/store/orders', { itemId })).body;

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    adminId = (await admin.get<{ id: string }>('/auth/me')).body.id;
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    ent.A = (await tree.save(tree.create({ name: 'Unidade A', parent: org }))).id;
    await user('colab1', 'collaborator', ent.A!);
    await user('colab2', 'collaborator', ent.A!);
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

  it('regras: textos do e-mail, decisões obrigatórias e eventos do módulo store', () => {
    for (const type of STORE_TYPES) {
      expect(
        describeNotification(type, { itemName: 'Caneca', amount: 5, on: '2026-12-01', orders: 2 }, 'pt-BR'),
      ).not.toBe(type);
      expect(describeNotification(type, { itemName: 'Caneca', amount: 5, on: '2026-12-01', orders: 2 }, 'en')).not.toBe(
        type,
      );
    }
    expect(describeNotification('store_balance_adjusted', { amount: 50, reason: 'Campanha' }, 'pt-BR')).toBe(
      'o seu saldo da loja mudou +50 pontos. Motivo: Campanha',
    );
    for (const type of ['store_order_approved', 'store_order_rejected', 'store_order_cancelled'] as const) {
      expect(MANDATORY_TYPES.has(type)).toBe(true);
    }
    expect(MANDATORY_TYPES.has('store_order_delivered')).toBe(false);
    for (const e of ['store.order_approved', 'store.order_delivered', 'store.bonus_paid'] as const) {
      expect(eventModule(e)).toBe('store');
    }
  });

  it('CA-RN-171.1 cada decisão e o ajuste avisam a pessoa; as decisões não se desligam', async () => {
    // A pessoa tenta desligar tudo da loja: só o que não é decisão é desligado.
    const prefs = await c.colab1!.get<{ events: { type: string; group: string; mandatory: boolean }[] }>(
      '/notifications/preferences',
    );
    const store = prefs.body.events.filter((e) => e.group === 'store');
    expect(store.map((e) => e.type).sort()).toEqual([...STORE_TYPES].sort());
    expect(
      store
        .filter((e) => e.mandatory)
        .map((e) => e.type)
        .sort(),
    ).toEqual(['store_order_approved', 'store_order_cancelled', 'store_order_rejected']);
    await c.colab1!.request('PUT', '/notifications/preferences', {
      events: store.map((e) => ({ type: e.type, inApp: false, email: false })),
      deadlineAlertDays: null,
    });
    await credit('colab1', 100);
    const caneca = await item({ name: 'Caneca' });
    const o1 = await place('colab1', caneca.id);
    await admin.post(`/store/orders/${o1.id}/approve`);
    await admin.post(`/store/orders/${o1.id}/deliver`);
    const o2 = await place('colab1', caneca.id);
    await admin.post(`/store/orders/${o2.id}/reject`, { reason: 'Sem estoque no fornecedor' });
    const o3 = await place('colab1', caneca.id);
    await admin.post(`/store/orders/${o3.id}/cancel`, { reason: 'Compra suspensa' });
    expect((await notes(uid.colab1!, 'store_order_approved'))[0]?.payload).toMatchObject({
      orderId: o1.id,
      itemName: 'Caneca',
    });
    expect((await notes(uid.colab1!, 'store_order_rejected'))[0]?.payload).toMatchObject({
      reason: 'Sem estoque no fornecedor',
    });
    expect((await notes(uid.colab1!, 'store_order_cancelled'))[0]?.payload).toMatchObject({
      reason: 'Compra suspensa',
    });
    expect(await notes(uid.colab1!, 'store_order_delivered')).toEqual([]); // desligado pela pessoa
    expect(await notes(uid.colab1!, 'store_balance_adjusted')).toEqual([]); // desligado pela pessoa
    // Outra pessoa, com tudo ligado, recebe a entrega, o ajuste e a bonificação paga.
    await credit('colab2', 100);
    expect((await notes(uid.colab2!, 'store_balance_adjusted'))[0]?.payload).toMatchObject({
      amount: 100,
      reason: 'Campanha de outubro',
    });
    const bonus = await item({ name: 'Vale-cultura', kind: 'bonus', bonusValue: 50 });
    const o4 = await place('colab2', bonus.id);
    await admin.post(`/store/orders/${o4.id}/approve`);
    await admin.post(`/store/orders/${o4.id}/pay`, { paidOn: '2026-11-30', reference: 'Folha 11/2026' });
    expect((await notes(uid.colab2!, 'store_bonus_paid'))[0]?.payload).toMatchObject({ itemName: 'Vale-cultura' });
  });

  it('CA-RN-171.2 três pedidos novos no dia: um aviso agrupado para cada gestor; quem pede não avisa a si mesmo', async () => {
    await t.db.dataSource.query(`DELETE FROM notification WHERE type = 'store_orders_new'`);
    const chaveiro = await item({ name: 'Chaveiro', cost: 1 });
    await place('colab2', chaveiro.id);
    await place('colab2', chaveiro.id);
    await credit('rh', 10);
    await place('rh', chaveiro.id);
    expect((await notes(adminId, 'store_orders_new')).map((n) => n.payload.orders)).toEqual([3]);
    expect((await notes(uid.rh!, 'store_orders_new')).map((n) => n.payload.orders)).toEqual([2]); // não conta o próprio
    expect(await notes(uid.colab2!, 'store_orders_new')).toEqual([]);
  });

  it('CA-RN-171.3 o grupo Loja só aparece com a loja ligada; avisos da loja não geram pontos; desligada, nenhum aviso', async () => {
    const points = async () =>
      Number(((await t.db.dataSource.query('SELECT count(*) AS n FROM point_ledger')) as { n: string }[])[0]?.n);
    const before = await points();
    await credit('colab2', 1);
    expect(await points()).toBe(before);
    expect((await settings({ 'store.enabled': false })).status).toBe(200);
    const prefs = await c.colab2!.get<{ events: { group: string }[] }>('/notifications/preferences');
    expect(prefs.body.events.some((e) => e.group === 'store')).toBe(false);
    expect((await settings({ 'store.enabled': true })).status).toBe(200);
  });

  it('CA-RN-162.4 o aviso de vencimento sai uma vez, 30 dias antes; o vencimento também avisa', async () => {
    await user('veterano', 'collaborator', ent.A!);
    const today = todayInZone(new Date(), zone);
    const d = new Date(Date.parse(`${today}T12:00:00Z`) + 10 * 86_400_000);
    const day = `${d.getUTCFullYear() - 1}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    await t.db.dataSource.query(
      `INSERT INTO store_ledger (id, user_id, kind, amount, created_at) VALUES ($1, $2, 'earned', 25, ($3::date + time '12:00') AT TIME ZONE $4)`,
      [uuidv7(), uid.veterano, day, zone],
    );
    await t.db.dataSource.query(
      `INSERT INTO store_ledger (id, user_id, kind, amount, created_at) VALUES ($1, $2, 'earned', 7, ($3::date + time '12:00') AT TIME ZONE $4)`,
      [uuidv7(), uid.veterano, `${Number(today.slice(0, 4)) - 2}-01-10`, zone],
    );
    expect((await settings({ 'store.expiry_months': 12 })).status).toBe(200);
    await runStoreExpiry(t.db.dataSource);
    await runStoreExpiry(t.db.dataSource);
    const soon = await notes(uid.veterano!, 'store_points_expiring');
    expect(soon).toHaveLength(1);
    expect(soon[0]?.payload.amount).toBe(25);
    expect((await notes(uid.veterano!, 'store_points_expired')).map((n) => n.payload.amount)).toEqual([7]);
    expect((await settings({ 'store.expiry_months': 0 })).status).toBe(200);
  });

  it('CA-RN-172.1 a 172.3 módulo de leitura store, webhooks mínimos; saldo e extrato não saem', async () => {
    await enableIntegration(t, admin, ['ideas', 'store']);
    expect((await admin.put('/admin/webhooks/enabled', { enabled: true })).status).toBe(200);
    expect((await admin.put('/admin/webhooks/destinations', { destinations: ['127.0.0.1'] })).status).toBe(200);
    const plain = await createIntegration(admin, {
      name: 'RH sem e-mail',
      modules: ['store'],
      scope: [{ entityId: ent.A!, includeChildren: true }],
      ratePerMinute: 600,
    });
    const withEmail = await createIntegration(admin, {
      name: 'RH com e-mail',
      modules: ['store'],
      scope: [{ entityId: ent.A!, includeChildren: true }],
      ratePerMinute: 600,
      includeEmail: true,
    });
    const other = await createIntegration(admin, {
      name: 'Só ideias',
      modules: ['ideas'],
      scope: [{ entityId: ent.A!, includeChildren: true }],
      ratePerMinute: 600,
    });
    const sub = await admin.post<{ subscription: { id: string } }>('/admin/webhooks', {
      integrationId: plain.id,
      name: 'loja',
      url: 'http://127.0.0.1:9/hook',
      events: ['store.order_approved', 'store.order_delivered', 'store.bonus_paid'],
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);

    const garrafa = await item({ name: 'Garrafa', cost: 5 });
    const o = await place('colab2', garrafa.id);
    await admin.post(`/store/orders/${o.id}/approve`);
    await admin.post(`/store/orders/${o.id}/deliver`);

    const api = new IntegrationClient(t.baseUrl, plain.token);
    const list = await api.get<{
      data: { id: string; person: Record<string, unknown>; status: string; cost: number }[];
    }>('/store/orders?limit=100');
    expect(list.status).toBe(200);
    const mine = list.body.data.find((x) => x.id === o.id);
    expect(mine).toMatchObject({ status: 'delivered', cost: 5, person: { id: uid.colab2, name: 'Pessoa colab2' } });
    expect(mine?.person.email).toBeUndefined();
    const emailed = await new IntegrationClient(t.baseUrl, withEmail.token).get<{
      data: { id: string; person: { email?: string } }[];
    }>('/store/orders?limit=100');
    expect(emailed.body.data.find((x) => x.id === o.id)?.person.email).toBe('colab2@example.test');
    expect((await new IntegrationClient(t.baseUrl, other.token).get('/store/orders')).status).toBe(403);

    const events: { type: string; data: Record<string, unknown> }[] = await t.db.dataSource.query(
      `SELECT e.type, e.data FROM webhook_event e JOIN webhook_delivery d ON d.event_id = e.id
        WHERE d.subscription_id = $1 ORDER BY e.created_at, e.id`,
      [sub.body.subscription.id],
    );
    expect(events).toEqual([
      { type: 'store.order_approved', data: { order_id: o.id, item_id: garrafa.id, status: 'approved' } },
      { type: 'store.order_delivered', data: { order_id: o.id, item_id: garrafa.id, status: 'delivered' } },
    ]);
    expect(JSON.stringify(events)).not.toContain(uid.colab2!);
    for (const path of [
      '/store/balance',
      '/store/ledger',
      `/store/accounts/${uid.colab2}`,
      '/store/orders/x/approve',
    ]) {
      expect([404, 405]).toContain((await api.get(path)).status);
    }
    expect([404, 405]).toContain((await api.request('POST', '/store/orders', { body: { itemId: garrafa.id } })).status);
  });
});
