import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { newPublicCode, PUBLIC_LOOKUP_LIMIT } from '../../src/public/public.service.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Detail {
  id: string;
  code: string;
  publicLookup: { enabled: boolean; code: string } | null;
  steps: { id: string }[];
}

const ALLOWED_KEYS = ['category', 'deadline', 'late', 'status', 'steps', 'submittedAt', 'title'];
const ALLOWED_STEP_KEYS = ['completedAt', 'dueDate', 'name', 'position'];

describe('Consulta pública por código (M5, RN-33 a RN-37)', () => {
  let t: TestApp;
  let admin: Client;
  const c: Record<string, Client> = {};
  const uid: Record<string, string> = {};
  let entityId: string;
  let categoryId: string;
  let secret: Detail;
  let anonymous: Client;

  async function user(key: string, roleKey: string) {
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
  const lookup = (code: string) => anonymous.get<Record<string, unknown>>(`/public/ideas/${code}`);

  beforeAll(async () => {
    t = await createTestApp();
    anonymous = new Client(t.baseUrl);
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    entityId = (await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;
    categoryId = (
      await ds.getRepository(Category).save(ds.getRepository(Category).create({ name: 'Segurança', color: '#dc2626' }))
    ).id;
    await user('analista', 'analyst');
    await user('autor', 'collaborator');
    await user('outro', 'collaborator');

    // Ideia aprovada, com etapa, comentário interno e anexo: o que NÃO pode vazar.
    const created = await c.autor!.post<Detail>('/ideas', {
      title: 'Sinalizar o pátio',
      description: 'Texto longo que não é público',
      expectedGain: 'R$ 12.000 por ano',
      entityId,
      categoryId,
      externalRef: 'REF-INTERNA-99',
    });
    expect(created.status).toBe(201);
    secret = created.body;
    await c.analista!.post(`/ideas/${secret.code}/approve`, {
      stepName: 'Pintar a faixa',
      assigneeId: uid.analista,
      dueDate: '2099-12-31',
    });
    await c.analista!.post(`/ideas/${secret.code}/comments`, {
      body: 'Comentário interno sigiloso',
      visibility: 'internal',
    });
    const detail = await c.autor!.get<Detail>(`/ideas/${secret.code}`);
    secret = detail.body;
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-34.1 / 34.2 código com 256 bits de fonte criptográfica, sem repetição nem sequência', () => {
    expect(Buffer.from(newPublicCode(), 'base64url')).toHaveLength(32);
    expect(newPublicCode()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const codes = Array.from({ length: 10_000 }, newPublicCode);
    expect(new Set(codes).size).toBe(10_000);
    // Nenhum padrão sequencial: os primeiros bytes de códigos vizinhos não crescem em ordem.
    const firstBytes = codes.slice(0, 200).map((x) => Buffer.from(x, 'base64url')[0] ?? 0);
    const ascending = firstBytes.slice(1).filter((b, i) => b === (firstBytes[i] ?? 0) + 1).length;
    expect(ascending).toBeLessThan(10);
  });

  it('CA-RN-33.1 em instalação nova a consulta devolve 404, até para código válido', async () => {
    expect(secret.publicLookup?.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const res = await lookup(secret.publicLookup!.code);
    expect(res.status).toBe(404);
    expect((await lookup('x'.repeat(43))).status).toBe(404);
  });

  it('CA-RN-33.2 o admin liga e a rota funciona; desliga e volta a 404 (inclusive para códigos já emitidos)', async () => {
    const on = await admin.request('PATCH', '/settings', { values: { 'public.lookup_enabled': true } });
    expect(on.status).toBe(200);
    expect((await anonymous.get<{ publicLookupEnabled: boolean }>('/settings/public')).body.publicLookupEnabled).toBe(
      true,
    );
    expect((await lookup(secret.publicLookup!.code)).status).toBe(200);

    expect((await admin.request('PATCH', '/settings', { values: { 'public.lookup_enabled': false } })).status).toBe(
      200,
    );
    expect((await lookup(secret.publicLookup!.code)).status).toBe(404);
    expect((await admin.request('PATCH', '/settings', { values: { 'public.lookup_enabled': true } })).status).toBe(200);
  });

  it('CA-RN-35.1 / 35.2 só a lista fechada de campos; nada de autor, comentário, anexo, ganho ou pessoa', async () => {
    const res = await lookup(secret.publicLookup!.code);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(ALLOWED_KEYS);
    const steps = res.body.steps as Record<string, unknown>[];
    expect(steps).toHaveLength(1);
    expect(Object.keys(steps[0]!).sort()).toEqual(ALLOWED_STEP_KEYS);
    expect(res.body).toMatchObject({
      title: 'Sinalizar o pátio',
      status: 'in_progress',
      deadline: '2099-12-31',
      late: false,
    });
    expect(res.body.category).toEqual({ name: 'Segurança', color: '#dc2626' });
    const text = JSON.stringify(res.body);
    for (const leak of [
      'Pessoa autor',
      'Pessoa analista',
      'example.test',
      'sigiloso',
      'Texto longo',
      'R$ 12.000',
      'REF-INTERNA-99',
      secret.code,
      secret.id,
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  it('a resposta não é guardada em cache nem indexada', async () => {
    const res = await fetch(`${t.baseUrl}/api/public/ideas/${secret.publicLookup!.code}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('o código ITS-AAAA-NNNN e o id da ideia não servem de código de acompanhamento', async () => {
    expect((await lookup(secret.code)).status).toBe(404);
    expect((await lookup(secret.id)).status).toBe(404);
    expect((await lookup(encodeURIComponent("' OR 1=1 --"))).status).toBe(404);
  });

  it('CA-RN-37.1 o autor desativa → 404; reativa → volta; outra pessoa não consegue (403 ou 404)', async () => {
    const code = secret.publicLookup!.code;
    const off = await c.autor!.request<Detail>('PUT', `/ideas/${secret.code}/public-lookup`, { enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.publicLookup).toEqual({ enabled: false, code });
    expect((await lookup(code)).status).toBe(404);

    // Equipe (analista vê a ideia) e administrador: 403. Quem não vê a ideia: 404.
    expect((await c.analista!.request('PUT', `/ideas/${secret.code}/public-lookup`, { enabled: true })).status).toBe(
      403,
    );
    expect((await admin.request('PUT', `/ideas/${secret.code}/public-lookup`, { enabled: true })).status).toBe(403);
    expect((await c.outro!.request('PUT', `/ideas/${secret.code}/public-lookup`, { enabled: true })).status).toBe(404);
    expect((await lookup(code)).status).toBe(404);

    const on = await c.autor!.request<Detail>('PUT', `/ideas/${secret.code}/public-lookup`, { enabled: true });
    expect(on.body.publicLookup?.enabled).toBe(true);
    expect((await lookup(code)).status).toBe(200);
    expect((await c.autor!.request('PUT', `/ideas/${secret.code}/public-lookup`, { enabled: 'sim' })).status).toBe(422);
  });

  it('só o autor vê o código de acompanhamento no detalhe', async () => {
    expect((await c.autor!.get<Detail>(`/ideas/${secret.code}`)).body.publicLookup).not.toBeNull();
    expect((await c.analista!.get<Detail>(`/ideas/${secret.code}`)).body.publicLookup).toBeNull();
    expect((await admin.get<Detail>(`/ideas/${secret.code}`)).body.publicLookup).toBeNull();
  });

  it('CA-RN-36.2 código inexistente e consulta desativada pela ideia respondem de forma idêntica', async () => {
    const code = secret.publicLookup!.code;
    await c.autor!.request('PUT', `/ideas/${secret.code}/public-lookup`, { enabled: false });
    const disabled = await fetch(`${t.baseUrl}/api/public/ideas/${code}`);
    const missing = await fetch(`${t.baseUrl}/api/public/ideas/${newPublicCode()}`);
    const malformed = await fetch(`${t.baseUrl}/api/public/ideas/abc`);
    const [a, b, d] = [await disabled.text(), await missing.text(), await malformed.text()];
    expect([disabled.status, missing.status, malformed.status]).toEqual([404, 404, 404]);
    expect(a).toBe(b);
    expect(b).toBe(d);
    await c.autor!.request('PUT', `/ideas/${secret.code}/public-lookup`, { enabled: true });
  });

  it('CA-RN-36.1 acima do limite por IP → 429 com Retry-After; a rota continua pública', async () => {
    let limited: Response | null = null;
    for (let i = 0; i < PUBLIC_LOOKUP_LIMIT + 5 && !limited; i++) {
      const res = await fetch(`${t.baseUrl}/api/public/ideas/${newPublicCode()}`);
      if (res.status === 429) limited = res;
    }
    expect(limited).not.toBeNull();
    expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited!.json()).toMatchObject({ code: 'too_many_requests' });
  });
});
