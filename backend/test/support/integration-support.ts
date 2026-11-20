import { expect } from 'vitest';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { SettingsService } from '../../src/organization/settings.service.js';
import { Client, STRONG_PASSWORD, type TestApp } from './test-app.js';

/** Resposta da API de integração. */
export interface IntegrationResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

/**
 * Cliente da API de integração (`/integration/v1`): URL absoluta fora de `/api` e cabeçalho
 * `Authorization: Bearer`. É o "consumidor" dos testes (nada fala com a internet).
 */
let nextIp = 1;

export class IntegrationClient {
  /** Cada cliente chega de um IP de documentação diferente (via X-Forwarded-For, aceito do loopback), para o limite por IP de um teste não pesar no outro. */
  readonly ip = `198.51.100.${(nextIp++ % 250) + 1}`;

  constructor(
    private readonly baseUrl: string,
    public token: string | null = null,
  ) {}

  async request<T = unknown>(
    method: string,
    path: string,
    options: { token?: string | null; headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<IntegrationResponse<T>> {
    const token = options.token === undefined ? this.token : options.token;
    const res = await fetch(`${this.baseUrl}/integration/v1${path}`, {
      method,
      headers: {
        'x-forwarded-for': this.ip,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body: body as T, headers: res.headers };
  }

  get<T = unknown>(path: string, token?: string | null) {
    return this.request<T>('GET', path, { token });
  }
}

/** Percorre uma lista inteira pelo cursor e devolve todos os itens, na ordem. */
export async function walk<T>(client: IntegrationClient, path: string, limit = 2): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  const sep = path.includes('?') ? '&' : '?';
  for (let guard = 0; guard < 200; guard++) {
    const res: IntegrationResponse<{ data: T[]; next_cursor: string | null }> = await client.get(
      `${path}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
    );
    expect(res.status).toBe(200);
    out.push(...res.body.data);
    cursor = res.body.next_cursor;
    if (!cursor) return out;
  }
  throw new Error('Lista sem fim');
}

export interface Scenario {
  ent: Record<'org' | 'A' | 'A1' | 'A2' | 'B' | 'B1', string>;
  cat: Record<'Segurança' | 'Qualidade', string>;
  uid: Record<'maria' | 'joao' | 'pedro' | 'analista' | 'gestorb', string>;
  /** Códigos das ideias do cenário. */
  code: Record<'i1' | 'i2' | 'i3' | 'i4' | 'i5', string>;
  campaignId: string;
  highlightId: string;
}

/** Liga a chave geral e os módulos pela própria API de administração (com o endereço em HTTPS). */
export async function enableIntegration(t: TestApp, admin: Client, modules: string[]): Promise<void> {
  await t.app.get(SettingsService, { strict: false }).set('email.app_url', 'https://its.example.test', null);
  expect((await admin.put('/admin/integrations/enabled', { enabled: true })).status).toBe(200);
  expect((await admin.put('/admin/integrations/modules', { modules })).status).toBe(200);
}

export const ALL_MODULES = ['ideas', 'indicators', 'campaigns', 'hall', 'entities', 'users'];

/**
 * Monta uma instalação com dois ramos (A e B), ideias em vários estados, um ganho validado, uma
 * campanha e um destaque do Hall. Tudo fictício. O administrador já está logado em `admin`.
 */
export async function buildScenario(t: TestApp, admin: Client): Promise<Scenario> {
  const ds = t.db.dataSource;
  const ent: Record<string, string> = {};
  const cat: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const code: Record<string, string> = {};
  const clients: Record<string, Client> = {};
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  async function entity(name: string, parentId: string | null) {
    const repo = ds.getTreeRepository(OrgEntity);
    const parent = parentId ? await repo.findOneByOrFail({ id: parentId }) : null;
    return (await repo.save(repo.create({ name, parent }))).id;
  }
  async function user(key: string, name: string, grants: [string, string][], extra: Partial<User> = {}) {
    const u = await ds
      .getRepository(User)
      .save(
        ds
          .getRepository(User)
          .create({ email: `${key}@example.test`, name, passwordHash: await hashPassword(STRONG_PASSWORD), ...extra }),
      );
    for (const [roleKey, entityId] of grants) {
      const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: roleKey });
      await ds
        .getRepository(UserRoleScope)
        .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId }));
    }
    uid[key] = u.id;
    const client = new Client(t.baseUrl);
    expect((await client.post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(
      200,
    );
    clients[key] = client;
  }

  ent.org = (await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;
  ent.A = await entity('Unidade A', ent.org);
  ent.A1 = await entity('Setor A1', ent.A);
  ent.A2 = await entity('Setor A2', ent.A);
  ent.B = await entity('Unidade B', ent.org);
  ent.B1 = await entity('Setor B1', ent.B);
  for (const name of ['Segurança', 'Qualidade']) {
    cat[name] = (
      await ds.getRepository(Category).save(ds.getRepository(Category).create({ name, color: '#4f46e5' }))
    ).id;
  }
  await user('maria', 'Maria Souza', [
    ['collaborator', ent.A1],
    ['collaborator', ent.A2],
  ]);
  await user('joao', 'João Oculto', [['collaborator', ent.A1]], { hideName: true });
  await user('pedro', 'Pedro Bê', [['collaborator', ent.B1]]);
  await user('analista', 'Ana Analista', [['analyst', ent.A]]);
  await user('gestorb', 'Gil Gestor B', [['manager', ent.B]]);

  // Campanha ativa da Unidade A (RN-50).
  const campaign = await admin.post<{ id: string }>('/campaigns', {
    name: 'Menos paradas',
    objective: 'Reduzir as paradas não planejadas.',
    startsOn: day(-5),
    endsOn: day(60),
    goalType: 'ideas',
    goalValue: 10,
    rewardNote: 'Almoço para o time (não deve sair pela API)',
    entityIds: [ent.A],
    categoryIds: [],
  });
  expect(campaign.status).toBe(201);
  expect((await admin.post(`/campaigns/${campaign.body.id}/activate`)).status).toBe(200);

  const submit = async (who: string, body: Record<string, unknown>) => {
    const res = await clients[who]!.post<{ code: string }>('/ideas', {
      description: 'Descrição fictícia da situação atual.',
      categoryId: cat.Qualidade,
      ...body,
    });
    expect(res.status, `${who} ${JSON.stringify(res.body)} ${JSON.stringify(body)}`).toBe(201);
    return res.body.code;
  };
  code.i1 = await submit('maria', { title: 'Ideia do setor A1', entityId: ent.A1, campaignId: campaign.body.id });
  code.i2 = await submit('joao', { title: 'Ideia implementada do A1', entityId: ent.A1 });
  code.i3 = await submit('pedro', { title: 'Ideia do setor B1', entityId: ent.B1 });
  code.i4 = await submit('maria', { title: 'Ideia repetida do A2', entityId: ent.A2 });
  code.i5 = await submit('maria', { title: 'Ideia arquivada do A1', entityId: ent.A1 });

  // i2: aprovada, etapa concluída, implementada, ganho validado.
  const approved = await admin.post<{ steps: { id: string }[] }>(`/ideas/${code.i2}/approve`, {
    stepName: 'Executar a troca',
    assigneeId: uid.analista,
    dueDate: day(10),
  });
  expect(approved.status).toBe(200);
  expect((await admin.post(`/ideas/${code.i2}/steps/${approved.body.steps[0]?.id}/complete`)).status).toBe(200);
  expect((await admin.post(`/ideas/${code.i2}/implement`, { resultText: 'Zero paradas em 60 dias.' })).status).toBe(
    200,
  );
  expect(
    (await admin.put(`/ideas/${code.i2}/gain`, { periodicity: 'once', realized: 12000, implementationCost: 3000 }))
      .status,
  ).toBe(200);
  expect((await admin.post(`/ideas/${code.i2}/gain/validate`)).status).toBe(200);
  // i3 (ramo B) também com ganho declarado, ainda não validado: nunca deve sair.
  // i4 converge na i1 (a mais antiga é a principal); i5 é arquivada.
  expect(
    (await admin.post(`/ideas/${code.i4}/converge`, { targetRef: code.i1, reason: 'É a mesma coisa.' })).status,
  ).toBe(200);
  expect((await admin.post(`/ideas/${code.i5}/archive`, { reason: 'Duplicada.' })).status).toBe(200);

  // Destaque do Hall da ideia implementada, com um elogio.
  const highlight = await admin.post<{ card: { id: string } }>('/hall/highlights', {
    ideaRef: code.i2,
    scope: 'organization',
    justification: 'Economia comprovada e ideia replicável.',
    startsOn: day(-1),
    endsOn: day(30),
  });
  expect(highlight.status).toBe(201);
  expect(
    (await admin.post(`/hall/highlights/${highlight.body.card.id}/praises`, { body: 'Parabéns pela ideia!' })).status,
  ).toBe(201);

  return {
    ent: ent as Scenario['ent'],
    cat: cat as Scenario['cat'],
    uid: uid as Scenario['uid'],
    code: code as Scenario['code'],
    campaignId: campaign.body.id,
    highlightId: highlight.body.card.id,
  };
}

/** Cria uma integração pela API de administração e devolve o token (mostrado uma vez). */
export async function createIntegration(
  admin: Client,
  input: {
    name: string;
    modules: string[];
    scope: { entityId: string; includeChildren: boolean }[];
    ratePerMinute?: number;
    ipAllowlist?: string[];
    includeEmail?: boolean;
    days?: number;
  },
): Promise<{ id: string; token: string }> {
  const expiresAt = new Date(Date.now() + (input.days ?? 90) * 86_400_000).toISOString();
  const res = await admin.post<{ integration: { id: string }; token: string }>('/admin/integrations', {
    name: input.name,
    owner: 'Time de testes',
    modules: input.modules,
    scope: input.scope,
    ratePerMinute: input.ratePerMinute,
    ipAllowlist: input.ipAllowlist ?? [],
    includeEmail: input.includeEmail ?? false,
    expiresAt,
  });
  expect(res.status).toBe(201);
  return { id: res.body.integration.id, token: res.body.token };
}
