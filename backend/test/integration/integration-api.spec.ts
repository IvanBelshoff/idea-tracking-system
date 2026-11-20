import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../src/app.factory.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User, UserStatus } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { SettingsService } from '../../src/organization/settings.service.js';
import {
  ALL_MODULES,
  buildScenario,
  createIntegration,
  enableIntegration,
  IntegrationClient,
  type Scenario,
  walk,
} from '../support/integration-support.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Idea {
  code: string;
  title: string | null;
  description: string | null;
  status: string;
  author: string | null;
  archived: boolean;
  converged_into: string | null;
  campaign_id: string | null;
  steps: { position: number; name: string }[];
  updated_at: string;
  submitted_at: string;
  entity: { id: string };
}
interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

describe('API de integração: leitura (M16, RN-102 a RN-112)', () => {
  let t: TestApp;
  let admin: Client;
  let s: Scenario;
  let a: IntegrationClient; // escopo A com subentidades, todos os módulos
  let b: IntegrationClient; // escopo B1
  let integrationA: { id: string; token: string };
  let integrationB: { id: string; token: string };
  const url = () => t.baseUrl;
  const settings = () => t.app.get(SettingsService, { strict: false });
  const client = (token: string | null) => new IntegrationClient(url(), token);

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    s = await buildScenario(t, admin);
    // CA-RN-102.1: antes de ligar, nada existe.
    const before = await createIntegrationDisabled();
    expect(before).toBe(404);
    await enableIntegration(t, admin, ALL_MODULES);
    integrationA = await createIntegration(admin, {
      name: 'BI da Unidade A',
      modules: ALL_MODULES,
      scope: [{ entityId: s.ent.A, includeChildren: true }],
      ratePerMinute: 600,
    });
    integrationB = await createIntegration(admin, {
      name: 'ERP do setor B1',
      modules: ALL_MODULES,
      scope: [{ entityId: s.ent.B1, includeChildren: false }],
      ratePerMinute: 600,
    });
    a = client(integrationA.token);
    b = client(integrationB.token);
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });

  /** Sem a chave geral ligada, qualquer chamada (mesmo com token) dá 404 (CA-RN-102.1). */
  async function createIntegrationDisabled(): Promise<number> {
    const res = await client('its_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').get('/ideas');
    const doc = await client('its_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').get('/openapi.json');
    expect(doc.status).toBe(404);
    return res.status;
  }

  describe('chave geral e módulos (RN-102)', () => {
    it('CA-RN-102.3 módulo desligado → 404 nas rotas dele; os outros seguem; CA-RN-102.4 corta na hora e volta', async () => {
      const c = client(
        (
          await createIntegration(admin, {
            name: 'só ideias',
            modules: ['ideas', 'users'],
            scope: [{ entityId: s.ent.A, includeChildren: true }],
          })
        ).token,
      );
      expect((await c.get('/users')).status).toBe(200);
      expect((await admin.put('/admin/integrations/modules', { modules: ['ideas'] })).status).toBe(200);
      expect((await c.get('/users')).status).toBe(404);
      expect((await c.get('/ideas')).status).toBe(200);
      expect((await admin.put('/admin/integrations/modules', { modules: ALL_MODULES })).status).toBe(200);
      expect((await c.get('/users')).status).toBe(200);
    });

    it('CA-RN-102.1 desligar a chave geral → 404 em tudo, na hora; religar volta', async () => {
      expect((await a.get('/ideas')).status).toBe(200);
      expect((await admin.put('/admin/integrations/enabled', { enabled: false })).status).toBe(200);
      expect((await a.get('/ideas')).status).toBe(404);
      expect((await a.get('/openapi.json')).status).toBe(404);
      expect((await a.request('POST', '/ideas')).status).toBe(404);
      expect((await admin.put('/admin/integrations/enabled', { enabled: true })).status).toBe(200);
      expect((await a.get('/ideas')).status).toBe(200);
    });
  });

  describe('autenticação (RN-104)', () => {
    it('CA-RN-104.7 todas as falhas dão o MESMO 401, sem dizer o motivo', async () => {
      const suspended = await createIntegration(admin, {
        name: 'suspensa',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
      });
      expect((await admin.post(`/admin/integrations/${suspended.id}/suspend`)).status).toBe(200);
      const revoked = await createIntegration(admin, {
        name: 'revogada',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
      });
      expect((await admin.post(`/admin/integrations/${revoked.id}/revoke`)).status).toBe(200);
      const fenced = await createIntegration(admin, {
        name: 'só um IP',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
        ipAllowlist: ['203.0.113.0/24'],
      });
      const expiring = await createIntegration(admin, {
        name: 'vence logo',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
      });
      await t.db.dataSource.query(
        `UPDATE integration_token SET expires_at = now() - interval '1 minute' WHERE integration_id = $1`,
        [expiring.id],
      );
      const rotated = await createIntegration(admin, {
        name: 'girada',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
      });
      const row: { id: string }[] = await t.db.dataSource.query(
        'SELECT id FROM integration_token WHERE integration_id = $1',
        [rotated.id],
      );
      expect((await admin.post(`/admin/integrations/${rotated.id}/tokens/${row[0]?.id}/revoke`)).status).toBe(200);

      const tries: { label: string; res: Awaited<ReturnType<IntegrationClient['get']>> }[] = [
        { label: 'sem cabeçalho', res: await client(null).get('/ideas') },
        {
          label: 'esquema errado',
          res: await client(null).request('GET', '/ideas', { headers: { authorization: `Basic ${a.token}` } }),
        },
        { label: 'malformado', res: await client('isto-nao-e-um-token').get('/ideas') },
        { label: 'inexistente', res: await client(`its_${'x'.repeat(43)}`).get('/ideas') },
        { label: 'vencido', res: await client(expiring.token).get('/ideas') },
        { label: 'revogado', res: await client(rotated.token).get('/ideas') },
        { label: 'integração suspensa', res: await client(suspended.token).get('/ideas') },
        { label: 'integração revogada', res: await client(revoked.token).get('/ideas') },
        { label: 'IP fora da lista', res: await client(fenced.token).get('/ideas') },
      ];
      for (const { label, res } of tries) {
        expect(res.status, label).toBe(401);
        expect(res.body, label).toEqual(tries[0]?.res.body);
        expect(res.headers.get('www-authenticate'), label).toBe('Bearer');
      }
    });

    it('CA-RN-104.8 o token correto em ?token= conta como ausente', async () => {
      const bare = client(null);
      expect((await bare.request('GET', `/ideas?token=${a.token}`)).status).toBe(401);
    });

    it('CA-RN-104.10 a última chamada do token é gravada', async () => {
      const made = await createIntegration(admin, {
        name: 'uso',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
      });
      const rows = async (): Promise<{ last_used_at: Date | null }[]> =>
        t.db.dataSource.query('SELECT last_used_at FROM integration_token WHERE integration_id = $1', [made.id]);
      expect((await rows())[0]?.last_used_at).toBeNull();
      expect((await client(made.token).get('/ideas')).status).toBe(200);
      expect((await rows())[0]?.last_used_at).not.toBeNull();
    });

    it('CA-RN-104.5 rotação: o token novo vale e o antigo vale pela janela; depois dá 401', async () => {
      const made = await createIntegration(admin, {
        name: 'rotação',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
      });
      const rotated = await admin.post<{ token: string }>(`/admin/integrations/${made.id}/tokens`, {
        expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        overlapHours: 24,
      });
      expect(rotated.status).toBe(200);
      expect((await client(rotated.body.token).get('/ideas')).status).toBe(200);
      expect((await client(made.token).get('/ideas')).status).toBe(200);
      // O limite de 2 tokens ativos (CA-RN-104.5).
      const third = await admin.post(`/admin/integrations/${made.id}/tokens`, {
        expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      });
      expect(third.status).toBe(409);
      expect((third.body as { code: string }).code).toBe('too_many_tokens');
      // Janela de 0 hora: o antigo sai na hora.
      const row: { id: string }[] = await t.db.dataSource.query(
        'SELECT id FROM integration_token WHERE integration_id = $1 AND token_hash <> $2 ORDER BY created_at LIMIT 1',
        [made.id, (await import('../../src/identity-access/password.js')).tokenHash(rotated.body.token)],
      );
      expect((await admin.post(`/admin/integrations/${made.id}/tokens/${row[0]?.id}/revoke`)).status).toBe(200);
      expect((await client(made.token).get('/ideas')).status).toBe(401);
      expect((await client(rotated.body.token).get('/ideas')).status).toBe(200);
      const again = await admin.post<{ token: string }>(`/admin/integrations/${made.id}/tokens`, {
        expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        overlapHours: 0,
      });
      expect(again.status).toBe(200);
      expect((await client(rotated.body.token).get('/ideas')).status).toBe(401);
      expect((await client(again.body.token).get('/ideas')).status).toBe(200);
    });

    it('CA-RN-104.4 no instante do vencimento o token passa a dar 401', async () => {
      const made = await createIntegration(admin, {
        name: 'curta',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
      });
      await t.db.dataSource.query(
        `UPDATE integration_token SET expires_at = now() + interval '1 second' WHERE integration_id = $1`,
        [made.id],
      );
      expect((await client(made.token).get('/ideas')).status).toBe(200);
      await new Promise((r) => setTimeout(r, 1300));
      expect((await client(made.token).get('/ideas')).status).toBe(401);
    });
  });

  describe('escopo e módulos da integração (RN-103)', () => {
    it('CA-RN-103.2 integração sem escopo recebe lista vazia, nunca "tudo"', async () => {
      const made = await createIntegration(admin, { name: 'sem escopo', modules: ALL_MODULES, scope: [] });
      const c = client(made.token);
      for (const path of ['/ideas', '/gains', '/campaigns', '/hall', '/entities', '/users']) {
        const res = await c.get<Page<unknown>>(path);
        expect(res.status, path).toBe(200);
        expect(res.body.data, path).toEqual([]);
      }
    });

    it('CA-RN-103.3 escopo sem subentidades não vê a subárvore; com subentidades vê; B nunca', async () => {
      const without = client(
        (
          await createIntegration(admin, {
            name: 'só A',
            modules: ['ideas'],
            scope: [{ entityId: s.ent.A, includeChildren: false }],
          })
        ).token,
      );
      expect((await walk<Idea>(without, '/ideas')).map((i) => i.code)).toEqual([]);
      const withChildren = (await walk<Idea>(a, '/ideas')).map((i) => i.code).sort();
      expect(withChildren).toEqual([s.code.i1, s.code.i2, s.code.i4, s.code.i5].sort());
      expect(withChildren).not.toContain(s.code.i3);
    });

    it('CA-RN-103.4 módulo ligado mas fora da integração → 403 module_not_allowed', async () => {
      const c = client(
        (
          await createIntegration(admin, {
            name: 'só campanhas',
            modules: ['campaigns'],
            scope: [{ entityId: s.ent.A, includeChildren: true }],
          })
        ).token,
      );
      const res = await c.get<{ code: string }>('/ideas');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('module_not_allowed');
      expect((await c.get('/campaigns')).status).toBe(200);
    });

    it('CA-RN-103.5 suspensa dá 401 e volta ao reativar; revogada dá 401 e não reativa (409)', async () => {
      const made = await createIntegration(admin, {
        name: 'ciclo',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
      });
      const c = client(made.token);
      expect((await c.get('/ideas')).status).toBe(200);
      expect((await admin.post(`/admin/integrations/${made.id}/suspend`)).status).toBe(200);
      expect((await c.get('/ideas')).status).toBe(401);
      expect((await admin.post(`/admin/integrations/${made.id}/reactivate`)).status).toBe(200);
      expect((await c.get('/ideas')).status).toBe(200);
      expect((await admin.post(`/admin/integrations/${made.id}/revoke`)).status).toBe(200);
      expect((await c.get('/ideas')).status).toBe(401);
      expect((await admin.post(`/admin/integrations/${made.id}/reactivate`)).status).toBe(409);
    });

    it('CA-RN-103.8 lista de IPs: dentro passa, fora e sem IP dão 401, vazia aceita qualquer', async () => {
      const made = await createIntegration(admin, {
        name: 'com IP',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
        ipAllowlist: ['203.0.113.0/24', '198.51.100.77'],
      });
      const c = client(made.token);
      expect((await c.request('GET', '/ideas', { headers: { 'x-forwarded-for': '203.0.113.9' } })).status).toBe(200);
      expect((await c.request('GET', '/ideas', { headers: { 'x-forwarded-for': '198.51.100.77' } })).status).toBe(200);
      expect((await c.request('GET', '/ideas', { headers: { 'x-forwarded-for': '203.0.114.1' } })).status).toBe(401);
      expect((await a.get('/ideas')).status).toBe(200);
    });

    it('CA-RN-103.9 entidade inativa no escopo continua valendo', async () => {
      await t.db.dataSource.getRepository(OrgEntity).update({ id: s.ent.A2 }, { active: false });
      const codes = (await walk<Idea>(a, '/ideas')).map((i) => i.code);
      expect(codes).toContain(s.code.i4);
      const entities = await a.get<Page<{ id: string; active: boolean }>>('/entities');
      expect(entities.body.data.find((e) => e.id === s.ent.A2)?.active).toBe(false);
      await t.db.dataSource.getRepository(OrgEntity).update({ id: s.ent.A2 }, { active: true });
    });
  });

  describe('limites (RN-105)', () => {
    it('CA-RN-105.1 e 105.2 estourou o limite → 429 com Retry-After; os cabeçalhos vão em toda resposta', async () => {
      const made = await createIntegration(admin, {
        name: 'limite 3',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
        ratePerMinute: 3,
      });
      const c = client(made.token);
      const first = await c.get('/ideas');
      expect(first.headers.get('x-ratelimit-limit')).toBe('3');
      expect(first.headers.get('x-ratelimit-remaining')).toBe('2');
      expect((await c.get('/ideas')).status).toBe(200);
      expect((await c.get('/ideas')).status).toBe(200);
      const blocked = await c.get('/ideas');
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      expect(blocked.headers.get('x-ratelimit-remaining')).toBe('0');
    });

    it('CA-RN-105.3 o limite é por integração', async () => {
      const x = await createIntegration(admin, {
        name: 'limite x',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
        ratePerMinute: 1,
      });
      const y = await createIntegration(admin, {
        name: 'limite y',
        modules: ['ideas'],
        scope: [{ entityId: s.ent.A, includeChildren: true }],
        ratePerMinute: 1,
      });
      expect((await client(x.token).get('/ideas')).status).toBe(200);
      expect((await client(x.token).get('/ideas')).status).toBe(429);
      expect((await client(y.token).get('/ideas')).status).toBe(200);
    });

    it('CA-RN-105.4 a 21ª tentativa com token inválido do mesmo IP → 429; chamada válida não consome', async () => {
      const spammer = client(`its_${'y'.repeat(43)}`);
      for (let i = 0; i < 20; i++) expect((await spammer.get('/ideas')).status).toBe(401);
      expect((await spammer.get('/ideas')).status).toBe(429);
      const clean = client(integrationA.token);
      for (let i = 0; i < 25; i++) expect((await clean.get('/entities')).status).toBe(200);
    });
  });

  describe('contrato v1 (RN-106)', () => {
    it('CA-RN-106.1 outros métodos → 405 com Allow: GET; nada é gravado', async () => {
      const before = (await t.db.dataSource.query('SELECT count(*)::int AS n FROM idea'))[0].n;
      // As rotas de leitura seguem só GET; só as quatro de escrita do M18 aceitam outro método.
      for (const path of ['/indicators/summary', '/entities', '/categories', '/users']) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          const res = await a.request(method, path, { body: { title: 'x' } });
          expect(res.status, `${method} ${path}`).toBe(405);
          expect(res.headers.get('allow')).toBe('GET');
        }
      }
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const res = await a.request(method, '/ideas', { body: { title: 'x' } });
        expect(res.status, method).toBe(405);
        expect(res.headers.get('allow')).toBe('GET, POST');
      }
      expect((await t.db.dataSource.query('SELECT count(*)::int AS n FROM idea'))[0].n).toBe(before);
    });

    it('CA-RN-106.2 paginação: limite padrão, cursor inválido e percurso sem repetir nem pular, mesmo com item novo no meio', async () => {
      expect((await a.get('/ideas?limit=201')).status).toBe(422);
      expect((await a.get('/ideas?limit=0')).status).toBe(422);
      expect((await a.get('/ideas?cursor=lixo')).status).toBe(422);
      const all = (await a.get<Page<Idea>>('/ideas')).body.data.map((i) => i.code);
      const first = await a.get<Page<Idea>>('/ideas?limit=2');
      expect(first.body.data).toHaveLength(2);
      expect(first.body.next_cursor).not.toBeNull();
      // Chega uma ideia nova no meio do percurso.
      const maria = new Client(t.baseUrl);
      expect((await maria.post('/auth/login', { email: 'maria@example.test', password: STRONG_PASSWORD })).status).toBe(
        200,
      );
      const fresh = await maria.post<{ code: string }>('/ideas', {
        title: 'Chegou no meio',
        description: 'x',
        entityId: s.ent.A1,
        categoryId: s.cat.Qualidade,
      });
      expect(fresh.status).toBe(201);
      const seen = first.body.data.map((i) => i.code);
      let cursor = first.body.next_cursor;
      while (cursor) {
        const page: { body: Page<Idea> } = await a.get(`/ideas?limit=2&cursor=${cursor}`);
        seen.push(...page.body.data.map((i) => i.code));
        cursor = page.body.next_cursor;
      }
      expect(new Set(seen).size).toBe(seen.length);
      for (const code of all) expect(seen).toContain(code);
      expect(seen.at(-1)).toBe(fresh.body.code);
    });

    it('CA-RN-106.3 updated_since devolve só o que mudou; data inválida → 422', async () => {
      const all = (await a.get<Page<Idea>>('/ideas')).body.data;
      const newest = all.at(-1) as Idea;
      const since = await a.get<Page<Idea>>(
        `/ideas?updated_since=${encodeURIComponent(newest.updated_at.replace(/\d{3}Z$/, 'Z'))}`,
      );
      expect(since.body.data.map((i) => i.code)).toContain(newest.code);
      expect(since.body.data.length).toBeLessThan(all.length);
      expect((await a.get('/ideas?updated_since=ontem')).status).toBe(422);
      // Mudar a situação da ideia (arquivar) a faz reaparecer.
      const maria = new Client(t.baseUrl);
      await maria.post('/auth/login', { email: 'maria@example.test', password: STRONG_PASSWORD });
      // Folga de 2 s: o relógio do Node e o do banco podem divergir por milissegundos.
      const mark = new Date(Date.now() - 2000).toISOString();
      const extra = await maria.post<{ code: string }>('/ideas', {
        title: 'Para arquivar',
        description: 'x',
        entityId: s.ent.A1,
        categoryId: s.cat.Qualidade,
      });
      expect((await admin.post(`/ideas/${extra.body.code}/archive`, { reason: 'teste' })).status).toBe(200);
      const after = await a.get<Page<Idea>>(`/ideas?updated_since=${encodeURIComponent(mark)}`);
      const row = after.body.data.find((i) => i.code === extra.body.code);
      expect(row?.archived).toBe(true);
    });

    it('CA-RN-106.4 envelope { data, next_cursor }, última página com cursor nulo, datas ISO UTC com Z', async () => {
      const res = await a.get<Page<Idea>>('/ideas?limit=200');
      expect(Object.keys(res.body).sort()).toEqual(['data', 'next_cursor']);
      expect(res.body.next_cursor).toBeNull();
      for (const idea of res.body.data) {
        expect(idea.submitted_at).toMatch(/Z$/);
        expect(idea.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
      }
    });

    it('CA-RN-106.5 e 106.6 erros no formato da API interna e Cache-Control: no-store em toda resposta', async () => {
      const notFound = await a.get<{ code: string; message: string }>('/ideas/ITS-0000-0000');
      expect(notFound.status).toBe(404);
      expect(notFound.body.code).toBe('not_found');
      expect(typeof notFound.body.message).toBe('string');
      for (const res of [
        notFound,
        await a.get('/ideas'),
        await client(null).get('/ideas'),
        await a.request('POST', '/ideas'),
      ]) {
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
    });

    it('CA-RN-106.7 não há CORS', async () => {
      const preflight = await a.request('OPTIONS', '/ideas', {
        headers: { origin: 'https://qualquer.example', 'access-control-request-method': 'GET' },
      });
      const withOrigin = await a.request('GET', '/ideas', { headers: { origin: 'https://qualquer.example' } });
      for (const res of [preflight, withOrigin]) {
        expect([...res.headers.keys()].filter((h) => h.startsWith('access-control-'))).toEqual([]);
      }
    });

    it('CA-RN-106.8 o OpenAPI exige token e mostra só os módulos da integração', async () => {
      expect((await client(null).get('/openapi.json')).status).toBe(401);
      const only = client(
        (await createIntegration(admin, { name: 'só ideias (contrato)', modules: ['ideas'], scope: [] })).token,
      );
      const doc = await only.get<{ paths: Record<string, unknown> }>('/openapi.json');
      expect(doc.status).toBe(200);
      const paths = Object.keys(doc.body.paths).sort();
      expect(paths).toEqual(['/integration/v1/ideas', '/integration/v1/ideas/{code}', '/integration/v1/openapi.json']);
      const full = await a.get<{ paths: Record<string, unknown> }>('/openapi.json');
      expect(Object.keys(full.body.paths)).toContain('/integration/v1/users');
    });

    it('CA-RN-106.9 e CA-T.15 o contrato interno não tem nenhuma rota de integração', async () => {
      const internal = buildOpenApiDocument(t.app);
      expect(Object.keys(internal.paths).filter((p) => p.startsWith('/integration'))).toEqual([]);
      expect(JSON.stringify(internal.components?.schemas ?? {})).not.toContain('IdeaItem');
    });
  });

  describe('módulo Ideias (RN-107)', () => {
    it('CA-RN-107.1 o detalhe de ideia fora do escopo → 404, não 403', async () => {
      expect((await a.get(`/ideas/${s.code.i3}`)).status).toBe(404);
      expect((await b.get(`/ideas/${s.code.i1}`)).status).toBe(404);
      expect((await a.get(`/ideas/${s.code.i1}`)).status).toBe(200);
    });

    it('CA-RN-107.2 só os campos do contrato: nada de comentário, histórico, anexo, responsável, ganho ou e-mail', async () => {
      const maria = new Client(t.baseUrl);
      await maria.post('/auth/login', { email: 'maria@example.test', password: STRONG_PASSWORD });
      expect(
        (
          await admin.post(`/ideas/${s.code.i1}/comments`, {
            body: 'Comentário interno secreto',
            visibility: 'internal',
          })
        ).status,
      ).toBe(201);
      const res = await a.get<Idea>(`/ideas/${s.code.i2}`);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'archived',
          'author',
          'campaign_id',
          'category',
          'code',
          'converged_into',
          'deadline',
          'description',
          'entity',
          'external_ref',
          // M21 (RN-157): o contrato só ganhou.
          'mural_published_at',
          'on_mural',
          'other_categories',
          // M24 (RN-191): o contrato só ganhou.
          'pending_approval',
          'progress',
          'proposed_solution',
          'status',
          'steps',
          'submitted_at',
          'title',
          'updated_at',
        ].sort(),
      );
      const text = JSON.stringify(await walk<Idea>(a, '/ideas'));
      for (const forbidden of [
        'Comentário interno secreto',
        'example.test',
        'assignee',
        'realized',
        'comment',
        'attachment',
        'history',
      ]) {
        expect(text, forbidden).not.toContain(forbidden);
      }
    });

    it('CA-RN-107.3 as etapas vêm com nome, posição e datas', async () => {
      const res = await a.get<
        Idea & {
          steps: {
            position: number;
            name: string;
            start_date: string;
            due_date: string;
            completed_at: string | null;
          }[];
        }
      >(`/ideas/${s.code.i2}`);
      expect(res.body.steps).toHaveLength(1);
      expect(res.body.steps[0]).toMatchObject({ position: 1, name: 'Executar a troca' });
      expect(res.body.steps[0]?.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.body.steps[0]?.completed_at).not.toBeNull();
    });

    it('CA-RN-107.4 ideia convergida vem com a principal e sem o texto de quem a enviou', async () => {
      const res = await a.get<Idea>(`/ideas/${s.code.i4}`);
      expect(res.body.converged_into).toBe(s.code.i1);
      expect(res.body.title).toBeNull();
      expect(res.body.description).toBeNull();
      expect(res.body.steps).toEqual([]);
    });

    it('CA-RN-107.5 arquivada segue na lista marcada; excluída fisicamente some', async () => {
      const list = await walk<Idea>(a, '/ideas');
      expect(list.find((i) => i.code === s.code.i5)?.archived).toBe(true);
      expect(list.find((i) => i.code === s.code.i1)?.archived).toBe(false);
    });

    it('CA-RN-107.6 autor: nome na ideia comum; nulo com opt-out; "Ex-colaborador" quando anonimizado', async () => {
      expect((await a.get<Idea>(`/ideas/${s.code.i1}`)).body.author).toBe('Maria Souza');
      expect((await a.get<Idea>(`/ideas/${s.code.i2}`)).body.author).toBeNull();
      const ds = t.db.dataSource;
      const tmp = await ds.getRepository(User).save(
        ds.getRepository(User).create({
          email: 'tmp@example.test',
          name: 'Pessoa Que Saiu',
          passwordHash: await hashPassword(STRONG_PASSWORD),
        }),
      );
      const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: 'collaborator' });
      await ds
        .getRepository(UserRoleScope)
        .save(ds.getRepository(UserRoleScope).create({ userId: tmp.id, roleId: role.id, entityId: s.ent.A1 }));
      const c = new Client(t.baseUrl);
      await c.post('/auth/login', { email: 'tmp@example.test', password: STRONG_PASSWORD });
      const idea = await c.post<{ code: string }>('/ideas', {
        title: 'Da pessoa que saiu',
        description: 'x',
        entityId: s.ent.A1,
        categoryId: s.cat.Qualidade,
      });
      expect((await a.get<Idea>(`/ideas/${idea.body.code}`)).body.author).toBe('Pessoa Que Saiu');
      await ds.getRepository(User).update({ id: tmp.id }, { status: UserStatus.Anonymized, name: 'Anonimizado' });
      const after = await a.get<Idea>(`/ideas/${idea.body.code}`);
      expect(after.body.author).toBe('Ex-colaborador');
      expect(JSON.stringify(after.body)).not.toContain('Pessoa Que Saiu');
    });

    it('CA-RN-107.7 filtros funcionam; entidade fora do escopo devolve lista vazia, não 403', async () => {
      expect((await walk<Idea>(a, '/ideas?status=implemented')).map((i) => i.code)).toEqual([s.code.i2]);
      expect((await walk<Idea>(a, `/ideas?campaign_id=${s.campaignId}`)).map((i) => i.code)).toEqual([s.code.i1]);
      expect((await walk<Idea>(a, `/ideas?entity_id=${s.ent.A2}`)).map((i) => i.code)).toEqual([s.code.i4]);
      const out = await a.get<Page<Idea>>(`/ideas?entity_id=${s.ent.B1}`);
      expect(out.status).toBe(200);
      expect(out.body.data).toEqual([]);
      expect((await a.get('/ideas?status=inventado')).status).toBe(422);
    });

    it('CA-RN-107.8 ideias "Enviada" aparecem', async () => {
      expect((await a.get<Idea>(`/ideas/${s.code.i1}`)).body.status).toBe('submitted');
    });
  });

  describe('módulo Indicadores e ganhos (RN-108)', () => {
    it('CA-RN-108.1 e 108.2 os indicadores são os do relatório interno, sem contar convergida em dobro', async () => {
      const internal = await admin.get<{
        total: number;
        byStatus: { status: string; count: number }[];
        process: { decided: number; inProgress: number; authors: number };
      }>(`/reports/summary?entityId=${s.ent.A}`);
      const mine = await a.get<{
        total: number;
        by_status: { status: string; count: number }[];
        process: { decided: number; in_progress: number; authors: number };
      }>('/indicators/summary');
      expect(mine.status).toBe(200);
      expect(mine.body.total).toBe(internal.body.total);
      expect(mine.body.by_status).toEqual(internal.body.byStatus);
      expect(mine.body.process.decided).toBe(internal.body.process.decided);
      expect(mine.body.process.in_progress).toBe(internal.body.process.inProgress);
      expect(mine.body.process.authors).toBe(internal.body.process.authors);
      // i4 (convergida) e as arquivadas não contam.
      const codes = (await walk<Idea>(a, '/ideas')).filter((i) => !i.archived && !i.converged_into).length;
      expect(mine.body.total).toBe(codes);
      const eng = await a.get<{ ideas: number; implemented: number }>('/indicators/engagement');
      const engInternal = await admin.get<{ ideas: number; implemented: number }>(
        `/reports/engagement?entityId=${s.ent.A}`,
      );
      expect(eng.body.ideas).toBe(engInternal.body.ideas);
      expect(eng.body.implemented).toBe(engInternal.body.implemented);
    });

    it('CA-RN-108.3 e 108.4 só ganho validado, com os campos do contrato e sem pessoas', async () => {
      // Um ganho só declarado (i1 ainda em triagem) nunca sai.
      expect((await admin.put(`/ideas/${s.code.i1}/gain`, { periodicity: 'once', estimated: 777 })).status).toBe(200);
      const gains = await walk<{
        idea_code: string;
        realized: number;
        currency: string;
        periodicity: string;
        implementation_cost: number | null;
      }>(a, '/gains');
      expect(gains.map((g) => g.idea_code)).toEqual([s.code.i2]);
      expect(gains[0]).toMatchObject({
        realized: 12000,
        currency: 'BRL',
        periodicity: 'once',
        implementation_cost: 3000,
      });
      const text = JSON.stringify(gains);
      for (const forbidden of ['validated_by', 'author', 'Admin Teste', 'estimated'])
        expect(text, forbidden).not.toContain(forbidden);
      // O ganho estimado (777) não sai como valor; "777" solto pode aparecer num id ou numa data.
      expect(text).not.toMatch(/:777[,}]/);
      const results = await a.get<{ currencies: Record<string, unknown>[] }>('/indicators/results');
      expect(results.body.currencies[0]).toMatchObject({
        currency: 'BRL',
        validated_annual: 12000,
        validated_ideas: 1,
      });
      expect(JSON.stringify(results.body)).not.toContain('declared');
    });

    it('CA-RN-108.5 ganho de ideia fora do escopo não entra na lista nem nos totais', async () => {
      const other = client(
        (
          await createIntegration(admin, {
            name: 'só A2',
            modules: ['indicators'],
            scope: [{ entityId: s.ent.A2, includeChildren: false }],
          })
        ).token,
      );
      expect((await other.get<Page<unknown>>('/gains')).body.data).toEqual([]);
      expect((await other.get<{ currencies: unknown[] }>('/indicators/results')).body.currencies).toEqual([]);
    });

    it('CA-RN-108.6 nenhum campo identifica pessoa', async () => {
      const text = JSON.stringify([
        (await a.get('/indicators/summary')).body,
        (await a.get('/indicators/engagement')).body,
        (await a.get('/indicators/results')).body,
      ]);
      for (const forbidden of ['Maria Souza', 'João Oculto', 'example.test', 'author_id', 'user_id'])
        expect(text, forbidden).not.toContain(forbidden);
    });
  });

  describe('módulo Campanhas (RN-109)', () => {
    interface Campaign {
      id: string;
      name: string;
      status: string;
      idea_codes: string[];
      target_entities: { id: string }[];
      totals: { received: number; participants: number };
    }
    it('CA-RN-109.1 a 109.4 ativa aparece; rascunho nunca; só as ideias do escopo; recompensa não sai', async () => {
      expect(
        (
          await admin.post('/campaigns', {
            name: 'Rascunho secreto',
            objective: 'x',
            startsOn: '2026-11-01',
            endsOn: '2026-12-01',
            goalType: 'qualitative',
            goalText: 'x',
            entityIds: [],
            categoryIds: [],
          })
        ).status,
      ).toBe(201);
      const list = await walk<Campaign>(a, '/campaigns');
      expect(list.map((c) => c.name)).toEqual(['Menos paradas']);
      expect(list[0]?.status).toBe('active');
      expect(list[0]?.idea_codes).toEqual([s.code.i1]);
      expect(list[0]?.totals.received).toBe(1);
      expect(list[0]?.target_entities.map((e) => e.id)).toEqual([s.ent.A]);
      const text = JSON.stringify(list);
      for (const forbidden of ['Almoço para o time', 'reward', 'Rascunho secreto'])
        expect(text, forbidden).not.toContain(forbidden);
    });

    it('CA-RN-109.2 campanha de outro ramo não aparece; sem entidade-alvo aparece a qualquer integração', async () => {
      expect((await walk<Campaign>(b, '/campaigns')).map((c) => c.name)).toEqual([]);
      const open = await admin.post<{ id: string }>('/campaigns', {
        name: 'Para todos',
        objective: 'x',
        startsOn: '2026-11-01',
        endsOn: '2026-12-31',
        goalType: 'qualitative',
        goalText: 'x',
        entityIds: [],
        categoryIds: [],
      });
      expect((await admin.post(`/campaigns/${open.body.id}/activate`)).status).toBe(200);
      expect((await walk<Campaign>(b, '/campaigns')).map((c) => c.name)).toEqual(['Para todos']);
      expect((await walk<Campaign>(a, '/campaigns')).map((c) => c.name).sort()).toEqual([
        'Menos paradas',
        'Para todos',
      ]);
    });
  });

  describe('módulo Hall e reconhecimento (RN-110)', () => {
    interface Hall {
      id: string;
      state: string;
      idea_code: string;
      people: unknown[];
      gain: unknown;
      likes: number | null;
      praises: Record<string, unknown>[];
      before: string;
      after: string | null;
    }
    it('CA-RN-110.1 a 110.6 destaque da ideia do escopo, ganho só com a opção, elogio sem autor, nada de pontos', async () => {
      const list = await walk<Hall>(a, '/hall');
      expect(list.map((h) => h.idea_code)).toEqual([s.code.i2]);
      expect(list[0]).toMatchObject({ state: 'active', gain: null, likes: 0, after: 'Zero paradas em 60 dias.' });
      expect(list[0]?.praises).toHaveLength(1);
      expect(Object.keys(list[0]?.praises[0] ?? {}).sort()).toEqual(['body', 'created_at']);
      expect(list[0]?.people).toEqual([]); // o autor ocultou o nome (RN-70) e não aceitou
      // CA-RN-110.2: só com "mostrar ganho no Hall".
      await settings().set('hall.show_gain', true, null);
      expect((await walk<Hall>(a, '/hall'))[0]?.gain).toEqual({ validated_annual: 12000, currency: 'BRL' });
      await settings().set('hall.show_gain', false, null);
      expect((await walk<Hall>(a, '/hall'))[0]?.gain).toBeNull();
      const text = JSON.stringify(list);
      for (const forbidden of ['points', 'level', 'achievement', 'reward', 'ranking', 'João Oculto'])
        expect(text, forbidden).not.toContain(forbidden);
      expect(await walk<Hall>(b, '/hall')).toEqual([]);
    });

    it('CA-RN-110.1 e 110.4 elogio ocultado e destaque revogado não saem', async () => {
      const detail = await admin.get<{ praiseList: { id: string }[] }>(`/hall/highlights/${s.highlightId}`);
      expect(
        (await admin.post(`/hall/praises/${detail.body.praiseList[0]?.id}/hide`, { reason: 'teste' })).status,
      ).toBe(200);
      expect((await walk<Hall>(a, '/hall'))[0]?.praises).toEqual([]);
      expect((await admin.post(`/hall/highlights/${s.highlightId}/revoke`, { reason: 'teste' })).status).toBe(200);
      expect(await walk<Hall>(a, '/hall')).toEqual([]);
    });
  });

  describe('módulo Entidades e categorias (RN-111)', () => {
    it('CA-RN-111.1 a 111.3 a árvore é cortada ao escopo; o pai fora do escopo vem nulo; categorias completas', async () => {
      const tree =
        await a.get<Page<{ id: string; name: string; parent_id: string | null; active: boolean }>>('/entities');
      const byId = new Map(tree.body.data.map((e) => [e.id, e]));
      expect([...byId.keys()].sort()).toEqual([s.ent.A, s.ent.A1, s.ent.A2].sort());
      expect(byId.get(s.ent.A)?.parent_id).toBeNull();
      expect(byId.get(s.ent.A1)?.parent_id).toBe(s.ent.A);
      const cats = await a.get<Page<{ name: string; color: string; active: boolean }>>('/categories');
      expect(cats.body.data.map((c) => c.name).sort()).toEqual(['Qualidade', 'Segurança']);
      expect(JSON.stringify([tree.body, cats.body])).not.toContain('example.test');
    });
  });

  describe('módulo Usuários (RN-112)', () => {
    interface U {
      id: string;
      name: string;
      status: string;
      email?: string;
      links: { role: string; entity: { id: string }; include_children: boolean }[];
    }
    it('CA-RN-112.1 a 112.3 só quem tem perfil no escopo, vínculos cortados e sem a chave de e-mail', async () => {
      const ds = t.db.dataSource;
      const misto = await ds.getRepository(User).save(
        ds.getRepository(User).create({
          email: 'misto@example.test',
          name: 'Pessoa Mista',
          passwordHash: await hashPassword(STRONG_PASSWORD),
        }),
      );
      const collab = await ds.getRepository(Role).findOneByOrFail({ systemKey: 'collaborator' });
      const analyst = await ds.getRepository(Role).findOneByOrFail({ systemKey: 'analyst' });
      await ds
        .getRepository(UserRoleScope)
        .save([
          ds.getRepository(UserRoleScope).create({ userId: misto.id, roleId: collab.id, entityId: s.ent.A1 }),
          ds.getRepository(UserRoleScope).create({ userId: misto.id, roleId: analyst.id, entityId: s.ent.B1 }),
        ]);
      const users = await walk<U>(a, '/users');
      expect(users.map((u) => u.name).sort()).toEqual(
        ['Ana Analista', 'João Oculto', 'Maria Souza', 'Pessoa Mista'].sort(),
      );
      const mixed = users.find((u) => u.name === 'Pessoa Mista');
      expect(mixed?.links.map((l) => l.entity.id)).toEqual([s.ent.A1]);
      for (const u of users) expect('email' in u, u.name).toBe(false);
      // `?email=` não filtra nem revela nada.
      const probe = await a.get<Page<U>>('/users?email=maria@example.test');
      expect(probe.body.data.length).toBe(users.length);
      expect(JSON.stringify(probe.body)).not.toContain('example.test');
    });

    it('CA-RN-112.4 com "incluir e-mail" o e-mail vem; o anonimizado nunca aparece', async () => {
      const withEmail = client(
        (
          await createIntegration(admin, {
            name: 'com e-mail',
            modules: ['users'],
            scope: [{ entityId: s.ent.A, includeChildren: true }],
            includeEmail: true,
          })
        ).token,
      );
      const users = await walk<U>(withEmail, '/users');
      expect(users.find((u) => u.name === 'Maria Souza')?.email).toBe('maria@example.test');
      const ds = t.db.dataSource;
      await ds.getRepository(User).update({ email: 'misto@example.test' }, { status: UserStatus.Anonymized });
      expect((await walk<U>(withEmail, '/users')).map((u) => u.name)).not.toContain('Anonimizado');
      expect(
        (await walk<U>(a, '/users')).some((u) => u.id === (users.find((x) => x.name === 'Pessoa Mista')?.id ?? 'x')),
      ).toBe(false);
    });

    it('CA-RN-112.5 nunca saem senha, hash, sessão, login corporativo, foto, último acesso ou idioma', async () => {
      const text = JSON.stringify(await walk<U>(a, '/users'));
      for (const forbidden of [
        'password',
        'hash',
        'session',
        'issuer',
        'subject',
        'photo',
        'last_login',
        'locale',
        'theme',
      ]) {
        expect(text.toLowerCase(), forbidden).not.toContain(forbidden);
      }
    });
  });

  describe('transversais', () => {
    it('CA-T.14 nada fora do escopo: o ramo A e o ramo B nunca se enxergam em nenhuma rota', async () => {
      const routes = [
        '/ideas',
        '/gains',
        '/campaigns',
        '/hall',
        '/entities',
        '/users',
        '/indicators/summary',
        '/indicators/engagement',
        '/indicators/results',
      ];
      const textOf = async (c: IntegrationClient) => {
        const out: string[] = [];
        for (const route of routes) {
          const res = await c.get(route);
          expect(res.status, route).toBe(200);
          out.push(JSON.stringify(res.body));
        }
        return out.join('\n');
      };
      const forA = await textOf(a);
      const forB = await textOf(b);
      for (const onlyB of [s.code.i3, s.ent.B1, 'Pedro Bê', 'Setor B1'])
        expect(forA, `A não vê ${onlyB}`).not.toContain(onlyB);
      for (const onlyA of [
        s.code.i1,
        s.code.i2,
        s.code.i4,
        s.ent.A,
        s.ent.A1,
        'Maria Souza',
        'Setor A1',
        'Menos paradas',
      ]) {
        expect(forB, `B não vê ${onlyA}`).not.toContain(onlyA);
      }
      expect((await b.get(`/ideas/${s.code.i1}`)).status).toBe(404);
      expect((await a.get(`/ideas/${s.code.i3}`)).status).toBe(404);
    });

    it('CA-T.15 o token não vale em /api e o cookie de sessão não vale em /integration', async () => {
      const viaToken = await fetch(`${url()}/api/ideas`, {
        headers: { authorization: `Bearer ${integrationA.token}` },
      });
      expect(viaToken.status).toBe(401);
      const viaCookie = await fetch(`${url()}/integration/v1/ideas`, {
        headers: { cookie: admin.cookie ?? '', 'x-forwarded-for': '198.51.100.250' },
      });
      expect(viaCookie.status).toBe(401);
    });

    it('CA-T.13 o token nunca fica guardado nem aparece em erro, auditoria, tabela de consumo ou resposta', async () => {
      const tokens = [integrationA.token, integrationB.token];
      // Erros e 401 não repetem o que foi enviado.
      const bad = await client(`its_${'z'.repeat(43)}`).get('/ideas');
      expect(JSON.stringify(bad.body)).not.toContain('zzzz');
      const ds = t.db.dataSource;
      const dump = JSON.stringify({
        audit: await ds.query('SELECT action, data, ip, target_id FROM audit_log'),
        integration: await ds.query('SELECT * FROM integration'),
        scope: await ds.query('SELECT * FROM integration_scope'),
        hours: await ds.query('SELECT * FROM integration_hour'),
        tokens: await ds.query('SELECT id, integration_id, prefix, expires_at FROM integration_token'),
      });
      for (const token of tokens) expect(dump).not.toContain(token);
      // Só o hash e o prefixo existem; o valor completo não está em nenhuma coluna.
      const rows: Record<string, string>[] = await ds.query('SELECT token_hash, prefix FROM integration_token');
      for (const row of rows) {
        expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.prefix).toHaveLength(8);
        expect(row.prefix).toMatch(/^its_/);
      }
      // A listagem de administração nunca devolve o valor.
      const view = JSON.stringify((await admin.get('/admin/integrations')).body);
      for (const token of tokens) expect(view).not.toContain(token);
    });
  });
});
