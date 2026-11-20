import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface EntityView {
  id: string;
  name: string;
  parentId: string | null;
  active: boolean;
  depth: number;
  canManage: boolean;
}
interface CategoryView {
  id: string;
  name: string;
  color: string;
  active: boolean;
  sortOrder: number;
}

describe('Entidades e categorias (M1, fatia 4)', () => {
  let t: TestApp;
  let admin: Client;
  let colab: Client;
  const ids: Record<string, string> = {};

  const list = async (c: Client) => (await c.get<EntityView[]>('/entities')).body;
  const find = async (c: Client, id: string) => (await list(c)).find((e) => e.id === id) as EntityView;

  async function userWith(email: string, roleId: string, entityId: string) {
    const ds = t.db.dataSource;
    const u = await ds
      .getRepository(User)
      .save(ds.getRepository(User).create({ email, name: email, passwordHash: await hashPassword(STRONG_PASSWORD) }));
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId, entityId, includeChildren: true }));
    const c = new Client(t.baseUrl);
    expect((await c.post('/auth/login', { email, password: STRONG_PASSWORD })).status).toBe(200);
    return c;
  }
  const roleId = async (systemKey: string) =>
    (await t.db.dataSource.getRepository(Role).findOneByOrFail({ systemKey })).id;

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    ids.org = (await list(admin)).find((e) => e.name === 'Org')?.id as string;
    for (const [key, name, parent] of [
      ['A', 'Unidade A', 'org'],
      ['A1', 'Setor A1', 'A'],
      ['B', 'Unidade B', 'org'],
    ] as const) {
      const res = await admin.post<EntityView>('/entities', { name, parentId: ids[parent] });
      expect(res.status).toBe(201);
      ids[key] = res.body.id;
    }
    colab = await userWith('colab1@example.test', await roleId('collaborator'), ids.A1 as string);
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('árvore de entidades (RN-25)', () => {
    it('a estrutura padrão fica sob a organização, com profundidade e pai corretos', async () => {
      const a1 = await find(admin, ids.A1 as string);
      expect(a1.parentId).toBe(ids.A);
      expect(a1.depth).toBe(2);
      expect(a1.canManage).toBe(true);
      expect((await find(admin, ids.org as string)).parentId).toBeNull();
    });

    it('nome repetido no mesmo nível é recusado (sem diferenciar maiúsculas); em outro nível, aceito', async () => {
      expect((await admin.post('/entities', { name: 'unidade a', parentId: ids.org })).status).toBe(409);
      const res = await admin.post<EntityView>('/entities', { name: 'Setor A1', parentId: ids.B });
      expect(res.status).toBe(201);
      ids.B1 = res.body.id;
    });

    it('qualquer usuário logado vê a estrutura, mas não a altera (403)', async () => {
      const seen = await list(colab);
      expect(seen.map((e) => e.name)).toEqual(expect.arrayContaining(['Org', 'Unidade A', 'Setor A1', 'Unidade B']));
      expect(seen.every((e) => !e.canManage)).toBe(true);
      expect((await colab.post('/entities', { name: 'X', parentId: ids.org })).status).toBe(403);
    });

    it('CA-RN-25.1 mover para dentro de si mesma ou de uma descendente é recusado', async () => {
      const intoChild = await admin.request<{ code: string }>('PATCH', `/entities/${ids.A}`, { parentId: ids.A1 });
      expect(intoChild.status).toBe(409);
      expect(intoChild.body.code).toBe('entity_cycle');
      expect((await admin.request('PATCH', `/entities/${ids.A}`, { parentId: ids.A })).status).toBe(409);
    });

    it('mover leva as descendentes junto (o caminho da subárvore é reescrito) e volta sem perda', async () => {
      expect((await admin.request('PATCH', `/entities/${ids.A}`, { parentId: ids.B })).status).toBe(200);
      expect((await find(admin, ids.A as string)).depth).toBe(2);
      expect((await find(admin, ids.A1 as string)).depth).toBe(3);
      // Ciclo continua detectado na nova posição: B agora é ancestral de A.
      expect((await admin.request('PATCH', `/entities/${ids.B}`, { parentId: ids.A1 })).status).toBe(409);

      expect((await admin.request('PATCH', `/entities/${ids.A}`, { parentId: ids.org })).status).toBe(200);
      expect((await find(admin, ids.A1 as string)).depth).toBe(2);
    });

    it('mover para um nível onde já existe o mesmo nome é recusado', async () => {
      const res = await admin.request<{ code: string }>('PATCH', `/entities/${ids.A1}`, { parentId: ids.B });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('entity_name_taken');
    });

    it('a organização (raiz) não se move, não se inativa e não se apaga', async () => {
      expect((await admin.request('PATCH', `/entities/${ids.org}`, { parentId: ids.A })).status).toBe(409);
      expect((await admin.request('PATCH', `/entities/${ids.org}`, { active: false })).status).toBe(409);
      expect((await admin.request('DELETE', `/entities/${ids.org}`)).status).toBe(409);
      expect(
        (await admin.request<EntityView>('PATCH', `/entities/${ids.org}`, { name: 'Org Renomeada' })).body.name,
      ).toBe('Org Renomeada');
    });

    it('quem administra só a Unidade A cria e altera dentro de A, e nada em B', async () => {
      const role = await admin.post<{ id: string }>('/roles', {
        name: 'Gestão da estrutura',
        permissions: ['entity.manage'],
      });
      const manager = await userWith('estrutura@example.test', role.body.id, ids.A as string);

      const seen = await list(manager);
      expect(seen.find((e) => e.id === ids.A)?.canManage).toBe(true);
      expect(seen.find((e) => e.id === ids.A1)?.canManage).toBe(true);
      expect(seen.find((e) => e.id === ids.B)?.canManage).toBe(false);

      expect((await manager.post('/entities', { name: 'Setor A2', parentId: ids.A })).status).toBe(201);
      expect((await manager.post('/entities', { name: 'Setor B2', parentId: ids.B })).status).toBe(403);
      expect((await manager.request('PATCH', `/entities/${ids.B}`, { name: 'Invadida' })).status).toBe(404);
      expect((await manager.request('PATCH', `/entities/${ids.A1}`, { parentId: ids.B })).status).toBe(403);
    });

    it('RN-26 inativar mantém a entidade visível (as ideias antigas continuam), e reativar volta', async () => {
      expect((await admin.request<EntityView>('PATCH', `/entities/${ids.B1}`, { active: false })).body.active).toBe(
        false,
      );
      expect((await find(colab, ids.B1 as string)).active).toBe(false);
      expect((await admin.request<EntityView>('PATCH', `/entities/${ids.B1}`, { active: true })).body.active).toBe(
        true,
      );
    });

    it('apaga só entidade sem uso; com filhas ou com perfis, recusa (o caminho é inativar)', async () => {
      expect((await admin.request<{ code: string }>('DELETE', `/entities/${ids.A}`)).body.code).toBe('entity_in_use');
      expect((await admin.request<{ code: string }>('DELETE', `/entities/${ids.A1}`)).body.code).toBe('entity_in_use'); // colab1 tem perfil
      expect((await admin.request('DELETE', `/entities/${ids.B1}`)).status).toBe(204);
      expect(await find(admin, ids.B1 as string)).toBeUndefined();
      expect((await admin.request('DELETE', `/entities/${ids.B1}`)).status).toBe(404);
    });
  });

  describe('categorias (RN-24, RN-26)', () => {
    it('CA-RN-24.2 importar Segurança + QDCEP cria 6 categorias; importar de novo não duplica', async () => {
      const first = await admin.post<{ created: CategoryView[]; skipped: number }>('/categories/import', {
        set: 'safety_qdcep',
      });
      expect(first.status).toBe(200);
      expect(first.body.created.map((c) => c.name)).toEqual([
        'Segurança',
        'Qualidade',
        'Entrega',
        'Custo',
        'Meio ambiente',
        'Pessoas',
      ]);

      const again = await admin.post<{ created: CategoryView[]; skipped: number }>('/categories/import', {
        set: 'safety_qdcep',
      });
      expect(again.body.created).toEqual([]);
      expect(again.body.skipped).toBe(6);

      // O genérico só acrescenta o que falta (Custo, Segurança e Pessoas já existem).
      const generic = await admin.post<{ created: CategoryView[]; skipped: number }>('/categories/import', {
        set: 'generic',
      });
      expect(generic.body.created.map((c) => c.name)).toEqual([
        'Processo',
        'Cliente',
        'Sustentabilidade',
        'Tecnologia',
      ]);
      expect(generic.body.skipped).toBe(3);
      expect((await admin.get<CategoryView[]>('/categories')).body).toHaveLength(10);
    });

    it('CA-RN-24.1 o admin cria, edita e inativa; quem não administra recebe 403', async () => {
      const created = await admin.post<CategoryView>('/categories', { name: 'Inovação', color: '#7E22CE' });
      expect(created.status).toBe(201);
      expect(created.body.color).toBe('#7e22ce');
      const edited = await admin.request<CategoryView>('PATCH', `/categories/${created.body.id}`, {
        name: 'Inovação aberta',
        sortOrder: 5,
      });
      expect(edited.body.name).toBe('Inovação aberta');
      const off = await admin.request<CategoryView>('PATCH', `/categories/${created.body.id}`, { active: false });
      expect(off.body.active).toBe(false);

      expect((await colab.post('/categories', { name: 'X', color: '#000000' })).status).toBe(403);
      expect((await colab.request('PATCH', `/categories/${created.body.id}`, { active: true })).status).toBe(403);
      expect((await colab.post('/categories/import', { set: 'generic' })).status).toBe(403);
    });

    it('RN-26 inativa some da lista de quem envia ideias, mas continua para quem administra', async () => {
      const forColab = await colab.get<CategoryView[]>('/categories?includeInactive=true');
      expect(forColab.body.map((c) => c.name)).not.toContain('Inovação aberta');
      const forAdmin = await admin.get<CategoryView[]>('/categories?includeInactive=true');
      expect(forAdmin.body.find((c) => c.name === 'Inovação aberta')?.active).toBe(false);
    });

    it('recusa nome repetido e cor fora do formato', async () => {
      expect((await admin.post('/categories', { name: 'qualidade', color: '#123456' })).status).toBe(409);
      expect((await admin.post('/categories', { name: 'Nova', color: 'azul' })).status).toBe(400);
    });

    it('as importações usam o idioma padrão da instalação (en → nomes em inglês)', async () => {
      const ds = t.db.dataSource;
      await ds.query(`INSERT INTO setting (key, value) VALUES ('organization.default_locale', '"en"')
                      ON CONFLICT (key) DO UPDATE SET value = '"en"'`);
      const res = await admin.post<{ created: CategoryView[] }>('/categories/import', { set: 'safety_qdcep' });
      expect(res.body.created.map((c) => c.name)).toContain('Safety');
    });
  });

  describe('ordem das categorias (M19, RN-137)', () => {
    const all = async () => (await admin.get<CategoryView[]>('/categories?includeInactive=true')).body;
    const create = async (name: string) =>
      (await admin.post<CategoryView>('/categories', { name, color: '#336699' })).body;

    it('CA-RN-137.1 e .3 a ordem nova vale para a lista inteira, de 10 em 10, e volta igual ao recarregar', async () => {
      await create('Ordem A');
      await create('Ordem B');
      const inactive = await create('Ordem C');
      await admin.request('PATCH', `/categories/${inactive.id}`, { active: false });
      const before = await all();
      expect(before.length).toBeGreaterThanOrEqual(3);
      const reversed = [...before].reverse().map((c) => c.id);
      const res = await admin.put<CategoryView[]>('/categories/order', { ids: reversed });
      expect(res.status).toBe(200);
      expect(res.body.map((c) => c.id)).toEqual(reversed);
      expect(res.body.map((c) => c.sortOrder)).toEqual(reversed.map((_, i) => (i + 1) * 10));
      expect((await all()).map((c) => c.id)).toEqual(reversed);
      // Quem só envia ideias vê as ativas, na mesma ordem relativa.
      const visible = (await colab.get<CategoryView[]>('/categories')).body.map((c) => c.id);
      const activeIds = new Set((await all()).filter((c) => c.active).map((c) => c.id));
      expect(visible).toEqual(reversed.filter((id) => activeIds.has(id)));
    });

    it('CA-RN-137.3 lista incompleta, repetida ou com id desconhecido → 422 e nada muda (negativo)', async () => {
      const current = await all();
      const order = current.map((c) => c.id);
      const bad: string[][] = [
        order.slice(1),
        [...order, order[0] as string],
        [...order.slice(1), '00000000-0000-4000-8000-000000000000'],
        [],
      ];
      for (const ids of bad) {
        const res = await admin.put<{ code: string }>('/categories/order', { ids });
        expect(res.status, JSON.stringify(ids.length)).toBe(422);
      }
      expect((await admin.put<{ code: string }>('/categories/order', { ids: order.slice(1) })).body.code).toBe(
        'invalid_order',
      );
      expect(await all()).toEqual(current);
    });

    it('CA-RN-137.4 sem category.manage → 403, sem sessão → 401; a reordenação fica na auditoria (negativo)', async () => {
      const order = (await all()).map((c) => c.id);
      expect((await colab.put('/categories/order', { ids: order })).status).toBe(403);
      expect((await new Client(t.baseUrl).put('/categories/order', { ids: order })).status).toBe(401);
      const audits = await t.db.dataSource.getRepository(AuditLog).find({ where: { action: 'category.reordered' } });
      expect(audits.length).toBeGreaterThanOrEqual(1);
      expect(audits[0]?.data).toMatchObject({ count: expect.any(Number) });
    });

    it('CA-RN-137.5 reordenações simultâneas não deixam a ordem com repetição nem lacuna (CA-T.2)', async () => {
      const order = (await all()).map((c) => c.id);
      const shuffles = [order, [...order].reverse(), [...order.slice(1), order[0] as string]];
      const results = await Promise.all(shuffles.map((ids) => admin.put('/categories/order', { ids })));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      const after = await all();
      expect(after.map((c) => c.sortOrder)).toEqual(after.map((_, i) => (i + 1) * 10));
      // A ordem final é exatamente uma das três pedidas (a última a ser aplicada vale inteira).
      expect(shuffles.map((x) => x.join(',')).includes(after.map((c) => c.id).join(','))).toBe(true);
    });
  });

  it('CA-RN-39.1 (parte) alterações de entidades e categorias ficam na auditoria', async () => {
    const actions = new Set((await t.db.dataSource.getRepository(AuditLog).find()).map((a) => a.action));
    for (const a of [
      'entity.created',
      'entity.updated',
      'entity.deleted',
      'category.created',
      'category.updated',
      'category.imported',
      'category.reordered',
    ]) {
      expect(actions).toContain(a);
    }
  });
});
