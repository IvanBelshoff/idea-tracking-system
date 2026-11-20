import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canTransition, goalProgress, isEligible } from '../../src/campaigns/campaign-rules.js';
import { CampaignStatus } from '../../src/campaigns/entities.js';
import { addDaysToDay, todayInZone } from '../../src/common/dates.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface View {
  id: string;
  name: string;
  status: string;
  canManage: boolean;
}
interface Dashboard {
  campaign: View;
  received: number;
  approved: number;
  implemented: number;
  participants: number;
  gains: { currency: string; validatedAnnual: number }[];
  goalProgress: number | null;
  hallCandidates: { code: string }[];
  summary: Record<string, unknown> | null;
}
interface Detail {
  id: string;
  code: string;
  steps: { id: string }[];
  campaign: { id: string; name: string } | null;
}

describe('Campanhas (M7, RN-50 a RN-53)', () => {
  let t: TestApp;
  let admin: Client;
  let adminId: string;
  const ent: Record<string, string> = {};
  const cat: Record<string, string> = {};
  const c: Record<string, Client> = {};
  const today = todayInZone(new Date(), 'America/Sao_Paulo');

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
    c[key] = new Client(t.baseUrl);
    expect((await c[key].post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  }
  const body = (over: Record<string, unknown> = {}) => ({
    name: 'Menos refugo',
    objective: 'Reduzir o refugo da prensa.',
    startsOn: today,
    endsOn: addDaysToDay(today, 30),
    goalType: 'ideas',
    goalValue: 4,
    entityIds: [ent.A],
    categoryIds: [cat.quality],
    ...over,
  });
  const create = async (who: Client, over: Record<string, unknown> = {}) => {
    const res = await who.post<View>('/campaigns', body(over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const submit = (who: Client, extra: Record<string, unknown>) =>
    who.post<Detail>('/ideas', {
      title: 'Ideia',
      description: 'x',
      entityId: ent.A1,
      categoryId: cat.quality,
      ...extra,
    });

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    adminId = (await admin.get<{ id: string }>('/auth/me')).body.id;
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    const a = await tree.save(tree.create({ name: 'Unidade A', parent: org }));
    ent.A = a.id;
    ent.A1 = (await tree.save(tree.create({ name: 'Setor A1', parent: a }))).id;
    ent.B = (await tree.save(tree.create({ name: 'Unidade B', parent: org }))).id;
    const cats = ds.getRepository(Category);
    cat.quality = (await cats.save(cats.create({ name: 'Qualidade', color: '#4f46e5' }))).id;
    cat.safety = (await cats.save(cats.create({ name: 'Segurança', color: '#dc2626' }))).id;
    await user('gestor', 'manager', ent.A);
    await user('colab', 'collaborator', ent.A1);
    await user('colab2', 'collaborator', ent.A1);
    await user('colabB', 'collaborator', ent.B);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('regras: estados, vínculo por período, entidade (com sub-entidades) e categoria, atingimento da meta', () => {
    expect(canTransition(CampaignStatus.Draft, CampaignStatus.Active)).toBe(true);
    expect(canTransition(CampaignStatus.Active, CampaignStatus.Closed)).toBe(true);
    expect(canTransition(CampaignStatus.Closed, CampaignStatus.Active)).toBe(false);
    expect(canTransition(CampaignStatus.Draft, CampaignStatus.Closed)).toBe(false);
    const tree = [
      { id: 'org', mpath: 'org.' },
      { id: 'a', mpath: 'org.a.' },
      { id: 'a1', mpath: 'org.a.a1.' },
      { id: 'b', mpath: 'org.b.' },
    ];
    const camp = {
      status: CampaignStatus.Active,
      startsOn: '2026-11-01',
      endsOn: '2026-11-30',
      entityIds: ['a'],
      categoryIds: ['q'],
    };
    expect(isEligible(camp, { entityId: 'a1', categoryId: 'q' }, tree, '2026-11-06')).toBe(true);
    expect(isEligible(camp, { entityId: 'b', categoryId: 'q' }, tree, '2026-11-06')).toBe(false);
    expect(isEligible(camp, { entityId: 'a1', categoryId: 's' }, tree, '2026-11-06')).toBe(false);
    expect(isEligible(camp, { entityId: 'a1', categoryId: null }, tree, '2026-11-06')).toBe(false);
    expect(isEligible(camp, { entityId: 'a1', categoryId: 'q' }, tree, '2026-12-01')).toBe(false);
    expect(
      isEligible({ ...camp, status: CampaignStatus.Draft }, { entityId: 'a1', categoryId: 'q' }, tree, '2026-11-06'),
    ).toBe(false);
    expect(
      isEligible({ ...camp, entityIds: [], categoryIds: [] }, { entityId: 'b', categoryId: null }, tree, '2026-11-30'),
    ).toBe(true);
    expect(goalProgress('ideas', 4, 3, 0)).toBe(0.75);
    expect(goalProgress('gain', 2400, 3, 1200)).toBe(0.5);
    expect(goalProgress('ideas', 2, 3, 0)).toBe(1.5); // passar da meta mostra mais de 100%
    expect(goalProgress('qualitative', null, 3, 0)).toBeNull();
  });

  it('CA-RN-50.1 cadastro exige nome, período válido e meta quando numérica; sem campaign.manage → 403', async () => {
    const bad = async (over: Record<string, unknown>) => (await c.gestor!.post('/campaigns', body(over))).status;
    expect(await bad({ name: '' })).toBe(422);
    expect(await bad({ endsOn: addDaysToDay(today, -1) })).toBe(422);
    expect(await bad({ goalValue: null })).toBe(422);
    expect(await bad({ goalType: 'qualitative', goalValue: null })).toBe(422); // falta descrever a meta
    expect(await bad({ goalType: 'qualitative', goalValue: null, goalText: 'Reduzir 15% do tempo de entrega' })).toBe(
      201,
    );
    expect((await c.colab!.post('/campaigns', body())).status).toBe(403);
    expect(await bad({ entityIds: [ent.B] })).toBe(403); // fora do escopo do gestor
    expect(await bad({ entityIds: [] })).toBe(403); // todas as entidades exige a raiz
    expect((await admin.post('/campaigns', body({ entityIds: [] }))).status).toBe(201);
    const view = await create(c.gestor!);
    expect(view).toMatchObject({ status: 'draft', canManage: true });
    expect((await c.colab!.get('/campaigns')).status).toBe(403);
  });

  it('CA-RN-50.2 rascunho → ativa → encerrada; encerrada não volta nem muda; só rascunho se exclui', async () => {
    const v = await create(c.gestor!, { name: 'Ciclo' });
    expect((await c.gestor!.post<View>(`/campaigns/${v.id}/close`)).status).toBe(409); // rascunho não encerra
    expect((await c.gestor!.post<View>(`/campaigns/${v.id}/activate`)).body.status).toBe('active');
    expect((await c.gestor!.post(`/campaigns/${v.id}/activate`)).status).toBe(409);
    expect((await c.gestor!.request('DELETE', `/campaigns/${v.id}`)).status).toBe(409);
    expect((await c.gestor!.post<Dashboard>(`/campaigns/${v.id}/close`)).body.campaign.status).toBe('closed');
    expect((await c.gestor!.post(`/campaigns/${v.id}/activate`)).status).toBe(409);
    expect((await c.gestor!.request('PUT', `/campaigns/${v.id}`, body())).status).toBe(409);
    const draft = await create(c.gestor!, { name: 'Descartável' });
    expect((await c.gestor!.request('DELETE', `/campaigns/${draft.id}`)).status).toBe(204);
  });

  it('CA-RN-51.1 / 51.2 só campanhas ativas, no período, da entidade e categoria da ideia; enviar sem campanha continua', async () => {
    const open = await create(c.gestor!, { name: 'Aberta' });
    await c.gestor!.post(`/campaigns/${open.id}/activate`);
    const past = await create(c.gestor!, {
      name: 'Passada',
      startsOn: addDaysToDay(today, -30),
      endsOn: addDaysToDay(today, -1),
    });
    await c.gestor!.post(`/campaigns/${past.id}/activate`);
    await create(c.gestor!, { name: 'Rascunho' });
    const names = async (who: Client, qs: string) =>
      (await who.get<View[]>(`/campaigns/available${qs}`)).body.map((x) => x.name);
    expect(await names(c.colab!, `?entityId=${ent.A1}&categoryId=${cat.quality}`)).toContain('Aberta');
    expect(await names(c.colab!, `?entityId=${ent.A1}&categoryId=${cat.quality}`)).not.toContain('Passada');
    expect(await names(c.colab!, `?entityId=${ent.A1}&categoryId=${cat.quality}`)).not.toContain('Rascunho');
    expect(await names(c.colab!, `?entityId=${ent.A1}&categoryId=${cat.safety}`)).not.toContain('Aberta');
    expect(await names(c.colab!, '')).toContain('Aberta'); // destaque no início (sem categoria ainda)
    expect(await names(c.colabB!, '')).not.toContain('Aberta');
    const linked = await submit(c.colab!, { campaignId: open.id });
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);
    expect(linked.body.campaign).toEqual({ id: open.id, name: 'Aberta' });
    expect((await submit(c.colab!, { campaignId: open.id, categoryId: cat.safety })).status).toBe(422);
    expect((await submit(c.colab!, { campaignId: past.id })).status).toBe(422);
    const free = await submit(c.colab!, {});
    expect([free.status, free.body.campaign]).toEqual([201, null]);
  });

  it('CA-RN-52.1 / 53.1 painel bate com a fixture; encerrar grava o resumo e sugere só implementadas ao Hall', async () => {
    const camp = await create(c.gestor!, { name: 'Painel', goalValue: 4 });
    await c.gestor!.post(`/campaigns/${camp.id}/activate`);
    const ideas: Detail[] = [];
    for (const who of ['colab', 'colab', 'colab2', 'colab2'])
      ideas.push((await submit(c[who]!, { campaignId: camp.id })).body);
    const approve = async (code: string) =>
      (
        await admin.post<Detail>(`/ideas/${code}/approve`, {
          stepName: 'Fazer',
          assigneeId: adminId,
          dueDate: '2099-12-31',
        })
      ).body;
    await approve(ideas[0]!.code);
    const done = await approve(ideas[1]!.code);
    await admin.post(`/ideas/${ideas[1]!.code}/steps/${done.steps[0]!.id}/complete`);
    await admin.post(`/ideas/${ideas[1]!.code}/implement`, { resultText: 'Feito' });
    await admin.put(`/ideas/${ideas[1]!.code}/gain`, { periodicity: 'monthly', realized: 100 });
    await admin.post(`/ideas/${ideas[1]!.code}/gain/validate`);
    await admin.post(`/ideas/${ideas[3]!.code}/archive`, {}); // arquivada não conta
    const d = (await c.gestor!.get<Dashboard>(`/campaigns/${camp.id}`)).body;
    expect(d).toMatchObject({ received: 3, approved: 2, implemented: 1, participants: 2, goalProgress: 0.75 });
    expect(d.gains).toEqual([{ currency: 'BRL', validatedAnnual: 1200 }]);
    expect(d.summary).toBeNull();
    const closed = (await c.gestor!.post<Dashboard>(`/campaigns/${camp.id}/close`)).body;
    expect(closed.campaign.status).toBe('closed');
    expect(closed.hallCandidates.map((h) => h.code)).toEqual([ideas[1]!.code]);
    expect(closed.summary).toMatchObject({ received: 3, implemented: 1, goalProgress: 0.75 });
    expect(((closed.summary?.hallCandidates ?? []) as { code: string }[]).map((h) => h.code)).toEqual([ideas[1]!.code]);
    // Nada entra no Hall sozinho: não existe tabela de Hall ainda e nenhuma ideia muda.
    expect((await admin.get<{ status: string }>(`/ideas/${ideas[1]!.code}`)).body.status).toBe('implemented');
  });
});
