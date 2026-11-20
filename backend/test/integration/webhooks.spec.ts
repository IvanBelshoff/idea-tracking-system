import 'reflect-metadata';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Notification } from '../../src/communication/entities.js';
import { SENDER_DEPS } from '../../src/integration/webhooks/admin/webhooks-admin.service.js';
import { verifySignature } from '../../src/integration/webhooks/rules.js';
import { emitWebhookEvent } from '../../src/integration/webhooks/webhook-emit.js';
import { deliverDue, type SenderDeps } from '../../src/integration/webhooks/webhook-sender.js';
import { AlertService } from '../../src/observability/alert.service.js';
import { HealthService } from '../../src/observability/health.service.js';
import { writeHeartbeat } from '../../src/observability/heartbeat.js';
import { purgeOpsData } from '../../src/observability/retention.js';
import { SettingsService } from '../../src/organization/settings.service.js';
import { FakeWebhookReceiver } from '../support/fake-webhook-receiver.js';
import {
  ALL_MODULES,
  buildScenario,
  createIntegration,
  enableIntegration,
  type Scenario,
} from '../support/integration-support.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Secret {
  id: string;
  prefix: string;
  state: string;
}
interface SubView {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: string;
  suspendedReason: string | null;
  consecutiveFailures: number;
  secrets: Secret[];
  pending: number;
  failed: number;
}
interface Overview {
  enabled: boolean;
  integrationEnabled: boolean;
  destinations: string[];
  subscriptions: SubView[];
  integrations: { id: string; name: string }[];
  events: { type: string; module: string }[];
}
interface DeliveryView {
  id: string;
  eventId: string;
  eventType: string;
  state: string;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
}
interface Created {
  subscription: SubView;
  secret: string;
}

const ALL_EVENTS = [
  'idea.submitted',
  'idea.status_changed',
  'idea.archived',
  'idea.deleted',
  'idea.converged',
  'gain.validated',
  'highlight.created',
  'highlight.revoked',
  'campaign.status_changed',
];
const SECRET_PATH = '/its/segredo-do-caminho';
const SECRET_QUERY = 'chave=valor-secreto-123';

describe('Webhooks de saída (M17, RN-117 a RN-125)', () => {
  let t: TestApp;
  let admin: Client;
  let maria: Client;
  let pedro: Client;
  let sc: Scenario;
  let deps: SenderDeps;
  let allIntegration: string;
  let bIntegration: string;
  let subAll: { id: string; secret: string };
  let subB: { id: string; secret: string };
  const receiver = new FakeWebhookReceiver();
  const dns = new Map<string, string[]>();
  const ds = () => t.db.dataSource;
  const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const overview = async () => (await admin.get<Overview>('/admin/webhooks')).body;
  const hookUrl = () => `${receiver.base}${SECRET_PATH}?${SECRET_QUERY}`;
  const settings = () => t.app.get(SettingsService, { strict: false });
  const run = (now: () => Date = () => new Date()) => deliverDue(ds(), { ...deps, now });
  const makeDue = () => ds().query(`UPDATE webhook_delivery SET next_attempt_at = now() WHERE state = 'pending'`);
  const rows = <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    ds().query(sql, params);
  const count = async (sql: string, params: unknown[] = []) => Number((await rows<{ n: string }>(sql, params))[0]?.n);
  const audits = (like = 'integration.webhook%') =>
    rows<{ action: string; actor_id: string | null; target_id: string | null; data: Record<string, unknown> }>(
      'SELECT action, actor_id, target_id, data FROM audit_log WHERE action LIKE $1 ORDER BY id',
      [like],
    );
  const deliveries = (subId: string) =>
    rows<{ id: string; state: string; attempts: number; last_error: string | null; last_status: number | null }>(
      'SELECT id, state, attempts, last_error, last_status FROM webhook_delivery WHERE subscription_id = $1 ORDER BY created_at',
      [subId],
    );
  const makeSub = async (
    integrationId: string,
    name: string,
    over: { url?: string; events?: string[]; expiresAt?: string } = {},
  ) => {
    const res = await admin.post<Created>('/admin/webhooks', {
      integrationId,
      name,
      url: over.url ?? hookUrl(),
      events: over.events ?? ALL_EVENTS,
      expiresAt: over.expiresAt ?? future(90),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { id: res.body.subscription.id, secret: res.body.secret };
  };
  const submit = (who: Client, entityId: string, title = 'Ideia para o webhook') =>
    who.post<{ code: string }>('/ideas', {
      title,
      description: 'Descrição fictícia da situação atual.',
      categoryId: sc.cat.Qualidade,
      entityId,
    });
  const login = async (email: string) => {
    const c = new Client(t.baseUrl);
    expect((await c.post('/auth/login', { email, password: STRONG_PASSWORD })).status).toBe(200);
    return c;
  };
  /** Verifica a entrega recebida contra o segredo, como o receptor de referência da Ajuda. */
  const check = (hook: (typeof receiver.received)[number], secret: string) =>
    verifySignature({
      header: hook.headers['x-its-signature'] as string,
      secret,
      timestamp: hook.headers['x-its-timestamp'] as string,
      body: hook.body,
    });

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    sc = await buildScenario(t, admin);
    maria = await login('maria@example.test');
    pedro = await login('pedro@example.test');
    await writeHeartbeat(ds(), { process: 'api', startedAt: new Date(), storageFreePct: 80 });
    await writeHeartbeat(ds(), { process: 'worker', startedAt: new Date() });
    await receiver.start();
    // O DNS e o relógio do envio são falsos: nada aqui consulta a internet.
    deps = t.app.get(SENDER_DEPS, { strict: false });
    deps.resolve = async (hostname) => {
      const found = dns.get(hostname);
      if (!found) throw new Error('ENOTFOUND');
      return found;
    };
    expect(deps.allowLoopback).toBe(true);
  }, 180_000);

  afterAll(async () => {
    await receiver.stop();
    await t?.close();
  });

  describe('chave e destinos (RN-117)', () => {
    it('CA-RN-117.1 a chave nasce desligada e exige a chave geral da integração', async () => {
      const first = await overview();
      expect(first).toMatchObject({ enabled: false, integrationEnabled: false, destinations: [] });
      const res = await admin.put<{ code: string }>('/admin/webhooks/enabled', { enabled: true });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('webhooks_require_integration');
      await enableIntegration(t, admin, ALL_MODULES);
      expect((await admin.put('/admin/webhooks/enabled', { enabled: true })).status).toBe(200);
      expect((await overview()).enabled).toBe(true);
      expect((await admin.put('/admin/webhooks/enabled', { enabled: false })).status).toBe(200);
      expect((await overview()).enabled).toBe(false);
    });

    it('CA-RN-117.3 a lista de destinos normaliza; inválida ou com mais de 50 → 422', async () => {
      const ok = await admin.put<Overview>('/admin/webhooks/destinations', {
        destinations: [' Erp.Test ', '*.empresa.com.br', '127.0.0.1', '127.0.0.1'],
      });
      expect(ok.status).toBe(200);
      expect(ok.body.destinations).toEqual(['erp.test', '*.empresa.com.br', '127.0.0.1']);
      for (const bad of [
        ['http://erp.test'],
        ['com espaço'],
        ['10.0.0.0/99'],
        Array.from({ length: 51 }, (_, i) => `h${i}.x.org`),
      ]) {
        const res = await admin.put<{ code: string }>('/admin/webhooks/destinations', { destinations: bad });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('invalid_destinations');
      }
      expect((await overview()).destinations).toEqual(['erp.test', '*.empresa.com.br', '127.0.0.1']);
    });

    it('CA-RN-117.6 e CA-RN-122.5 só integration.manage vê, mexe e reenvia; sem sessão → 401', async () => {
      const routes: [string, string][] = [
        ['GET', '/admin/webhooks'],
        ['PUT', '/admin/webhooks/enabled'],
        ['PUT', '/admin/webhooks/destinations'],
        ['POST', '/admin/webhooks'],
        ['PUT', '/admin/webhooks/00000000-0000-4000-8000-000000000001'],
        ['POST', '/admin/webhooks/00000000-0000-4000-8000-000000000001/ping'],
        ['GET', '/admin/webhooks/00000000-0000-4000-8000-000000000001/deliveries'],
        [
          'POST',
          '/admin/webhooks/00000000-0000-4000-8000-000000000001/deliveries/00000000-0000-4000-8000-000000000002/resend',
        ],
      ];
      for (const [method, path] of routes) {
        const body = method === 'GET' ? undefined : {};
        expect((await maria.request(method, path, body)).status, `${method} ${path}`).toBe(403);
        expect((await new Client(t.baseUrl).request(method, path, body)).status, `${method} ${path}`).toBe(401);
      }
    });
  });

  describe('assinaturas (RN-118, RN-120)', () => {
    beforeAll(async () => {
      dns.set('erp.test', ['127.0.0.1']);
      dns.set('publico.test', ['203.0.113.7']);
      dns.set('meta.test', ['169.254.169.254']);
      await admin.put('/admin/webhooks/destinations', {
        destinations: ['erp.test', 'publico.test', 'meta.test', '127.0.0.1', '169.254.169.254'],
      });
      allIntegration = (
        await createIntegration(admin, {
          name: 'Todos os módulos',
          modules: ['ideas', 'indicators', 'campaigns', 'hall'],
          scope: [{ entityId: sc.ent.org, includeChildren: true }],
        })
      ).id;
      bIntegration = (
        await createIntegration(admin, {
          name: 'Só a Unidade B',
          modules: ['ideas'],
          scope: [{ entityId: sc.ent.B, includeChildren: true }],
        })
      ).id;
    });

    it('CA-RN-117.4 destino fora da lista → 422, inclusive rede interna (negativo)', async () => {
      for (const url of ['https://fora.exemplo.org/hook', 'http://10.0.0.5/hook']) {
        if (url.includes('fora')) dns.set('fora.exemplo.org', ['203.0.113.9']);
        const res = await admin.post<{ code: string }>('/admin/webhooks', {
          integrationId: allIntegration,
          name: 'fora',
          url,
          events: ['idea.submitted'],
          expiresAt: future(30),
        });
        expect(res.status, url).toBe(422);
        expect(res.body.code, url).toBe('destination_not_allowed');
      }
      expect((await overview()).subscriptions).toEqual([]);
    });

    it('CA-RN-118.1 destino bloqueado mesmo estando na lista (nome que resolve para os metadados e IP literal)', async () => {
      for (const url of ['https://meta.test/hook', 'https://169.254.169.254/latest/meta-data']) {
        const res = await admin.post<{ code: string }>('/admin/webhooks', {
          integrationId: allIntegration,
          name: 'meta',
          url,
          events: ['idea.submitted'],
          expiresAt: future(30),
        });
        expect(res.status, url).toBe(422);
        expect(res.body.code, url).toBe('destination_blocked');
      }
    });

    it('CA-RN-118.3 http para destino público → https_required; usuário e senha, esquema errado e nome sem resolver → 422', async () => {
      const cases: [string, string][] = [
        ['http://publico.test/hook', 'https_required'],
        ['https://usuario:senha@erp.test/hook', 'credentials_not_allowed'],
        ['ftp://erp.test/hook', 'invalid_url'],
        ['isto não é uma url', 'invalid_url'],
        ['https://naoexiste.test/hook', 'destination_unresolved'],
      ];
      for (const [url, code] of cases) {
        const res = await admin.post<{ code: string }>('/admin/webhooks', {
          integrationId: allIntegration,
          name: 'caso',
          url,
          events: ['idea.submitted'],
          expiresAt: future(30),
        });
        expect(res.status, url).toBe(422);
        expect(res.body.code, url).toBe(code);
      }
      // http para IP interno da lista passa.
      const ok = await makeSub(bIntegration, 'http interno', {
        url: `${receiver.base}/ok`,
        events: ['idea.submitted'],
      });
      expect((await admin.delete(`/admin/webhooks/${ok.id}`)).status).toBe(204);
    });

    it('CA-RN-118.8 evento de módulo que a integração não tem → 422; evento desconhecido ou lista vazia também', async () => {
      const post = (events: string[]) =>
        admin.post<{ code: string }>('/admin/webhooks', {
          integrationId: bIntegration,
          name: 'eventos',
          url: hookUrl(),
          events,
          expiresAt: future(30),
        });
      const hall = await post(['highlight.created']);
      expect(hall.status).toBe(422);
      expect(hall.body.code).toBe('event_not_allowed');
      expect((await post(['idea.inventado'])).body.code).toBe('invalid_events');
      expect((await post([])).body.code).toBe('invalid_events');
    });

    it('CA-RN-120.3 o segredo aparece uma vez; no banco só existe cifrado; listagem nunca o devolve (negativo)', async () => {
      subAll = await makeSub(allIntegration, 'Todos os eventos');
      subB = await makeSub(bIntegration, 'Ideias da B', { events: ['idea.submitted', 'idea.archived'] });
      expect(subAll.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
      const stored = await rows<{ secret_encrypted: Buffer; prefix: string }>(
        'SELECT secret_encrypted, prefix FROM webhook_secret WHERE subscription_id = $1',
        [subAll.id],
      );
      expect(stored).toHaveLength(1);
      const blob = (stored[0] as { secret_encrypted: Buffer }).secret_encrypted;
      expect(blob.toString('utf8')).not.toContain(subAll.secret);
      expect(blob.toString('latin1')).not.toContain(subAll.secret.slice(6));
      expect(blob.length).toBeGreaterThan(subAll.secret.length);
      const view = JSON.stringify(await overview());
      expect(view).not.toContain(subAll.secret);
      expect(view).not.toContain(subAll.secret.slice(6, 30));
      expect(view).toContain(subAll.secret.slice(0, 10));
      const detail = JSON.stringify(
        (
          await admin.put(`/admin/webhooks/${subAll.id}`, {
            name: 'Todos os eventos',
            url: hookUrl(),
            events: ALL_EVENTS,
          })
        ).body,
      );
      expect(detail).not.toContain(subAll.secret);
    });

    it('CA-RN-120.4 validade obrigatória, no futuro e de até 365 dias', async () => {
      const post = (expiresAt?: string) =>
        admin.post<{ code: string }>('/admin/webhooks', {
          integrationId: bIntegration,
          name: 'validade',
          url: hookUrl(),
          events: ['idea.submitted'],
          ...(expiresAt ? { expiresAt } : {}),
        });
      expect((await post()).status).toBe(422);
      expect((await post(future(-1))).body.code).toBe('invalid_expiry');
      expect((await post(future(366))).body.code).toBe('invalid_expiry');
      const edge = await post(future(364));
      expect(edge.status).toBe(201);
      expect((await admin.delete(`/admin/webhooks/${(edge.body as unknown as Created).subscription.id}`)).status).toBe(
        204,
      );
    });

    it('nome repetido na mesma integração → 409; em outra integração vale', async () => {
      const res = await admin.post<{ code: string }>('/admin/webhooks', {
        integrationId: allIntegration,
        name: 'Todos os eventos',
        url: hookUrl(),
        events: ['idea.submitted'],
        expiresAt: future(30),
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('webhook_name_taken');
    });

    it('CA-RN-118.7 a 6ª assinatura de uma integração → 422 too_many_subscriptions', async () => {
      const lim = (await createIntegration(admin, { name: 'Limite', modules: ['ideas'], scope: [] })).id;
      for (let i = 1; i <= 5; i++) await makeSub(lim, `assinatura ${i}`, { events: ['idea.submitted'] });
      const res = await admin.post<{ code: string }>('/admin/webhooks', {
        integrationId: lim,
        name: 'assinatura 6',
        url: hookUrl(),
        events: ['idea.submitted'],
        expiresAt: future(30),
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('too_many_subscriptions');
      expect(await count('SELECT count(*) AS n FROM webhook_subscription WHERE integration_id = $1', [lim])).toBe(5);
    });

    it('CA-T.2 criações simultâneas não passam do limite de 5 assinaturas (a integração é travada)', async () => {
      const lim = (await createIntegration(admin, { name: 'Corrida', modules: ['ideas'], scope: [] })).id;
      for (let i = 1; i <= 4; i++) await makeSub(lim, `existente ${i}`, { events: ['idea.submitted'] });
      const results = await Promise.all(
        [1, 2, 3].map((i) =>
          admin.post<{ code?: string }>('/admin/webhooks', {
            integrationId: lim,
            name: `corrida ${i}`,
            url: hookUrl(),
            events: ['idea.submitted'],
            expiresAt: future(30),
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 422, 422]);
      expect(await count('SELECT count(*) AS n FROM webhook_subscription WHERE integration_id = $1', [lim])).toBe(5);
    });

    it('a edição vale as mesmas checagens e a remoção apaga a assinatura com as entregas', async () => {
      const sub = await makeSub(bIntegration, 'para editar', { events: ['idea.submitted'] });
      const bad = await admin.put<{ code: string }>(`/admin/webhooks/${sub.id}`, {
        name: 'para editar',
        url: 'https://fora.exemplo.org/x',
        events: ['idea.submitted'],
      });
      expect(bad.status).toBe(422);
      const good = await admin.put<SubView>(`/admin/webhooks/${sub.id}`, {
        name: 'editada',
        url: `${receiver.base}/novo`,
        events: ['idea.archived'],
      });
      expect(good.status).toBe(200);
      expect(good.body).toMatchObject({ name: 'editada', events: ['idea.archived'] });
      expect((await admin.delete(`/admin/webhooks/${sub.id}`)).status).toBe(204);
      expect((await admin.delete(`/admin/webhooks/${sub.id}`)).status).toBe(404);
    });
  });

  describe('eventos e entrega', () => {
    beforeEach(async () => {
      receiver.reset();
      dns.set('erp.test', ['127.0.0.1']);
      await ds().query('DELETE FROM webhook_event');
      await ds().query(
        `UPDATE webhook_subscription SET status = 'active', suspended_reason = NULL, consecutive_failures = 0`,
      );
      await ds().query(`UPDATE integration SET status = 'active' WHERE status = 'suspended'`);
      await settings().set('integration.webhooks_enabled', true, null);
      await settings().set('integration.modules', ALL_MODULES, null);
    });

    it('CA-RN-117.2 com a chave desligada nenhum evento é guardado (negativo); religada, volta', async () => {
      await settings().set('integration.webhooks_enabled', false, null);
      expect((await submit(maria, sc.ent.A1)).status).toBe(201);
      expect(await count('SELECT count(*) AS n FROM webhook_event')).toBe(0);
      expect(await run()).toBe(0);
      await settings().set('integration.webhooks_enabled', true, null);
      expect((await submit(maria, sc.ent.A1)).status).toBe(201);
      expect(await count('SELECT count(*) AS n FROM webhook_event')).toBe(1);
    });

    it('CA-RN-119.2 e CA-RN-121.1 ideia do escopo gera a entrega, assinada e mínima; a de fora do escopo não (negativo)', async () => {
      const mine = await submit(maria, sc.ent.A1, 'Título que não pode sair');
      expect(mine.status).toBe(201);
      const theirs = await submit(pedro, sc.ent.B1);
      expect(theirs.status).toBe(201);
      // A integração "todos" vê as duas; a da Unidade B só a do Pedro.
      expect((await deliveries(subAll.id)).length).toBe(2);
      expect((await deliveries(subB.id)).length).toBe(1);

      expect(await run()).toBe(3);
      expect(receiver.received).toHaveLength(3);
      for (const hook of receiver.received) {
        expect(check(hook, subAll.secret).ok || check(hook, subB.secret).ok).toBe(true);
      }
      const delivered = await rows<{ state: string; attempts: number; last_status: number }>(
        'SELECT state, attempts, last_status FROM webhook_delivery',
      );
      expect(delivered.every((d) => d.state === 'delivered' && d.attempts === 1 && d.last_status === 200)).toBe(true);

      const forAll = receiver.received.find((h) => JSON.parse(h.body).data.idea_code === mine.body.code);
      expect(forAll).toBeDefined();
      const body = JSON.parse((forAll as { body: string }).body);
      expect(Object.keys(body)).toEqual(['id', 'type', 'created_at', 'data']);
      expect(body.type).toBe('idea.submitted');
      expect(body.data).toEqual({ idea_code: mine.body.code, entity_id: sc.ent.A1 });
      expect(JSON.stringify(body)).not.toContain('Título que não pode sair');
      // A integração só da B nunca recebeu a ideia da A1.
      const bDelivered = receiver.received.filter((h) => JSON.parse(h.body).data.idea_code === mine.body.code);
      expect(bDelivered).toHaveLength(1);
    });

    it('CA-RN-120.2 toda entrega leva os quatro cabeçalhos e a assinatura com v1=', async () => {
      await submit(maria, sc.ent.A1);
      await run();
      const hook = receiver.received[0];
      expect(hook).toBeDefined();
      const h = (hook as (typeof receiver.received)[number]).headers;
      expect(h['x-its-event']).toBe('idea.submitted');
      expect(h['x-its-event-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(Number(h['x-its-timestamp'])).toBeGreaterThan(1_700_000_000);
      expect(h['x-its-signature']).toMatch(/^v1=[0-9a-f]{64}$/);
      expect(h['content-type']).toContain('application/json');
      expect(JSON.parse((hook as { body: string }).body).id).toBe(h['x-its-event-id']);
    });

    it('CA-RN-119.3 e .4 as transições, o arquivamento e a exclusão saem com os dados mínimos', async () => {
      const day = new Date(Date.now() + 864e5 * 10).toISOString().slice(0, 10);
      const first = (await submit(maria, sc.ent.A2, 'Ideia para aprovar')).body.code;
      const second = (await submit(maria, sc.ent.A2, 'Ideia para arquivar e excluir')).body.code;
      expect(
        (await admin.post(`/ideas/${first}/approve`, { stepName: 'Fazer', assigneeId: sc.uid.analista, dueDate: day }))
          .status,
      ).toBe(200);
      expect((await admin.post(`/ideas/${second}/archive`, { reason: 'Teste.' })).status).toBe(200);
      expect((await admin.delete(`/ideas/${second}`)).status).toBe(204);
      const events = await rows<{ type: string; data: Record<string, string> }>(
        'SELECT type, data FROM webhook_event ORDER BY created_at, id',
      );
      const types = events.map((e) => e.type);
      for (const type of ['idea.submitted', 'idea.status_changed', 'idea.archived', 'idea.deleted']) {
        expect(types, type).toContain(type);
      }
      const change = events.find((e) => e.type === 'idea.status_changed');
      expect(change?.data).toMatchObject({ idea_code: first, entity_id: sc.ent.A2 });
      expect(change?.data.from).toBeTruthy();
      expect(change?.data.to).toBeTruthy();
      expect(events.find((e) => e.type === 'idea.deleted')?.data).toEqual({ idea_code: second, entity_id: sc.ent.A2 });
    });

    it('CA-RN-119.3 reabrir uma ideia encerrada também sai como mudança de situação', async () => {
      const code = (await submit(maria, sc.ent.A2, 'Ideia para recusar e reabrir')).body.code;
      expect((await admin.post(`/ideas/${code}/reject`, { reason: 'Sem verba agora.' })).status).toBe(200);
      expect((await admin.post(`/ideas/${code}/reopen`, { reason: 'Verba liberada.' })).status).toBe(200);
      const changes = await rows<{ data: Record<string, string> }>(
        `SELECT data FROM webhook_event WHERE type = 'idea.status_changed' AND data->>'idea_code' = $1
          ORDER BY created_at, id`,
        [code],
      );
      expect(changes.map((e) => e.data)).toEqual([
        { idea_code: code, entity_id: sc.ent.A2, from: 'submitted', to: 'rejected' },
        { idea_code: code, entity_id: sc.ent.A2, from: 'rejected', to: 'in_review' },
      ]);
    });

    it('CA-RN-119.5 campanha e Hall saem só para quem tem o módulo e o escopo', async () => {
      expect((await admin.post(`/campaigns/${sc.campaignId}/close`)).status).toBe(200);
      expect(
        (await admin.post(`/hall/highlights/${sc.highlightId}/revoke`, { reason: 'Teste do webhook.' })).status,
      ).toBe(200);
      const events = await rows<{ type: string; data: Record<string, string> }>(
        `SELECT type, data FROM webhook_event WHERE type IN ('campaign.status_changed', 'highlight.revoked')`,
      );
      expect(events.map((e) => e.type).sort()).toEqual(['campaign.status_changed', 'highlight.revoked']);
      expect(events.find((e) => e.type === 'campaign.status_changed')?.data).toMatchObject({
        campaign_id: sc.campaignId,
      });
      // A integração só da Unidade B (módulo de ideias apenas) não recebe nenhum dos dois.
      expect(await deliveries(subB.id)).toEqual([]);
      expect((await deliveries(subAll.id)).length).toBe(2);
    });

    it('CA-RN-119.5 gain.validated só sai para quem tem o módulo de indicadores ligado (negativo)', async () => {
      const emit = () =>
        ds().transaction((m) =>
          emitWebhookEvent(m, {
            type: 'gain.validated',
            data: { idea_code: 'IDE-G', entity_id: sc.ent.A1 },
            entityIds: [sc.ent.A1],
          }),
        );
      await emit();
      expect(await count('SELECT count(*) AS n FROM webhook_delivery WHERE subscription_id = $1', [subAll.id])).toBe(1);
      // A integração só de ideias não pode nem escolher o evento, e não recebe.
      expect(await count('SELECT count(*) AS n FROM webhook_delivery WHERE subscription_id = $1', [subB.id])).toBe(0);
      // Desligar o módulo na chave geral corta na hora, para todas as integrações.
      await ds().query('DELETE FROM webhook_event');
      await settings().set('integration.modules', ['ideas'], null);
      await emit();
      expect(await count('SELECT count(*) AS n FROM webhook_event')).toBe(0);
    });

    it('CA-RN-119.6 o evento nasce na transação: se ela desfaz, não sobra evento; se dá certo, uma entrega por assinatura', async () => {
      const emit = (m: Parameters<typeof emitWebhookEvent>[0]) =>
        emitWebhookEvent(m, {
          type: 'idea.archived',
          data: { idea_code: 'IDE-X', entity_id: sc.ent.B1 },
          entityIds: [sc.ent.B1],
        });
      await ds()
        .transaction(async (m) => {
          await emit(m);
          throw new Error('desfaz');
        })
        .catch(() => undefined);
      expect(await count('SELECT count(*) AS n FROM webhook_event')).toBe(0);
      await ds().transaction(emit);
      expect(await count('SELECT count(*) AS n FROM webhook_event')).toBe(1);
      // As duas assinaturas (todas e B) querem idea.archived na B1: uma entrega para cada.
      expect(await count('SELECT count(*) AS n FROM webhook_delivery')).toBe(2);
    });

    it('CA-RN-118.9 integração suspensa não recebe evento novo nem envia o pendente (negativo)', async () => {
      await submit(pedro, sc.ent.B1);
      expect(await count('SELECT count(*) AS n FROM webhook_delivery WHERE subscription_id = $1', [subB.id])).toBe(1);
      expect((await admin.post(`/admin/integrations/${bIntegration}/suspend`)).status).toBe(200);
      await submit(pedro, sc.ent.B1);
      expect(await count('SELECT count(*) AS n FROM webhook_delivery WHERE subscription_id = $1', [subB.id])).toBe(1);
      await makeDue();
      await run();
      const sent = receiver.received.filter((h) => check(h, subB.secret).ok);
      expect(sent).toHaveLength(0);
      expect((await deliveries(subB.id))[0]?.state).toBe('pending');
      // Reativada, a pendente sai.
      expect((await admin.post(`/admin/integrations/${bIntegration}/reactivate`)).status).toBe(200);
      await makeDue();
      await run();
      expect((await deliveries(subB.id))[0]?.state).toBe('delivered');
    });

    it('CA-RN-121.3 e .4 5xx repete com o mesmo aviso e o mesmo id; depois dá certo', async () => {
      receiver.respond = (n) => (n <= 2 ? 503 : 200);
      await ds().query(
        `UPDATE webhook_subscription SET status = 'suspended', suspended_reason = 'admin' WHERE id = $1`,
        [subB.id],
      );
      await submit(maria, sc.ent.A1);
      await run();
      let [d] = await deliveries(subAll.id);
      expect(d).toMatchObject({ state: 'pending', attempts: 1, last_status: 503, last_error: 'http_503' });
      const wait = await rows<{ secs: number }>(
        'SELECT extract(epoch FROM next_attempt_at - now()) AS secs FROM webhook_delivery WHERE subscription_id = $1',
        [subAll.id],
      );
      expect(Number(wait[0]?.secs)).toBeGreaterThan(20);
      expect(Number(wait[0]?.secs)).toBeLessThanOrEqual(31);
      // Antes da hora não envia.
      expect(await run()).toBe(0);
      await makeDue();
      await run();
      await makeDue();
      await run();
      [d] = await deliveries(subAll.id);
      expect(d).toMatchObject({ state: 'delivered', attempts: 3, last_status: 200, last_error: null });
      expect(receiver.received).toHaveLength(3);
      const [a, b, c] = receiver.received;
      expect(a?.headers['x-its-event-id']).toBe(b?.headers['x-its-event-id']);
      expect(b?.headers['x-its-event-id']).toBe(c?.headers['x-its-event-id']);
      expect(a?.body).toBe(b?.body);
      expect(b?.body).toBe(c?.body);
      expect(check(c as (typeof receiver.received)[number], subAll.secret).ok).toBe(true);
    });

    it('CA-RN-121.3 4xx e 3xx são falha definitiva sem repetir (negativo); o redirecionamento não é seguido (CA-RN-118.5)', async () => {
      await ds().query(
        `UPDATE webhook_subscription SET status = 'suspended', suspended_reason = 'admin' WHERE id = $1`,
        [subB.id],
      );
      receiver.respond = 404;
      await submit(maria, sc.ent.A1);
      await run();
      expect((await deliveries(subAll.id))[0]).toMatchObject({
        state: 'failed',
        attempts: 1,
        last_status: 404,
        last_error: 'http_404',
      });
      receiver.reset();
      await ds().query('DELETE FROM webhook_event');
      receiver.respond = 302;
      receiver.location = `${receiver.base}/outro-endereco`;
      await submit(maria, sc.ent.A1);
      await run();
      expect((await deliveries(subAll.id))[0]).toMatchObject({
        state: 'failed',
        attempts: 1,
        last_status: 302,
        last_error: 'redirect',
      });
      expect(receiver.received).toHaveLength(1);
      expect(receiver.received.some((h) => h.path.startsWith('/outro-endereco'))).toBe(false);
    });

    it('CA-RN-118.6 o tempo limite é de 10 s (falha timeout, repete); a resposta grande é descartada', async () => {
      await ds().query(
        `UPDATE webhook_subscription SET status = 'suspended', suspended_reason = 'admin' WHERE id = $1`,
        [subB.id],
      );
      receiver.responseBody = 'x'.repeat(300_000);
      await submit(maria, sc.ent.A1);
      await run();
      expect((await deliveries(subAll.id))[0]).toMatchObject({ state: 'delivered', last_status: 200 });
      receiver.reset();
      await ds().query('DELETE FROM webhook_event');
      receiver.delayMs = 10_800;
      await submit(maria, sc.ent.A1);
      const started = Date.now();
      await run();
      expect(Date.now() - started).toBeLessThan(12_500);
      expect((await deliveries(subAll.id))[0]).toMatchObject({
        state: 'pending',
        attempts: 1,
        last_error: 'timeout',
        last_status: null,
      });
    }, 40_000);

    it('CA-RN-118.4 e CA-T.17 nome que passa a resolver para endereço bloqueado: falha sem abrir conexão (negativo)', async () => {
      await ds().query(
        `UPDATE webhook_subscription SET status = 'suspended', suspended_reason = 'admin' WHERE id = $1`,
        [subB.id],
      );
      const named = await makeSub(allIntegration, 'por nome', {
        url: `http://erp.test:${receiver.port}/hook`,
        events: ['idea.submitted'],
      });
      await submit(maria, sc.ent.A1);
      await ds().query(
        `UPDATE webhook_subscription SET status = 'suspended', suspended_reason = 'admin' WHERE id = $1`,
        [subAll.id],
      );
      await run();
      expect((await deliveries(named.id))[0]).toMatchObject({ state: 'delivered' });
      expect(receiver.connections).toBe(1);

      // O DNS é trocado: o mesmo nome agora aponta para os metadados de nuvem.
      dns.set('erp.test', ['169.254.169.254']);
      await submit(maria, sc.ent.A1);
      await run();
      const [, second] = await deliveries(named.id);
      expect(second).toMatchObject({ state: 'failed', last_error: 'blocked_destination' });
      expect(receiver.connections).toBe(1);
      // Nome que deixa de resolver: tenta de novo mais tarde (não é definitivo).
      dns.delete('erp.test');
      await submit(maria, sc.ent.A1);
      await run();
      const third = (await deliveries(named.id))[2];
      expect(third).toMatchObject({ state: 'pending', last_error: 'dns' });
      expect(receiver.connections).toBe(1);
      // Tirado da lista de destinos, o envio é recusado, também sem conexão.
      await settings().set('integration.webhook_destinations', ['publico.test'], null);
      await makeDue();
      dns.set('erp.test', ['127.0.0.1']);
      await run();
      expect((await deliveries(named.id))[2]).toMatchObject({ state: 'failed', last_error: 'destination_not_allowed' });
      expect(receiver.connections).toBe(1);
      await settings().set(
        'integration.webhook_destinations',
        ['erp.test', 'publico.test', 'meta.test', '127.0.0.1', '169.254.169.254'],
        null,
      );
      await admin.delete(`/admin/webhooks/${named.id}`);
    });

    it('CA-RN-121.6 dois processos não enviam a mesma entrega ao mesmo tempo (CA-T.2)', async () => {
      await ds().query(
        `UPDATE webhook_subscription SET status = 'suspended', suspended_reason = 'admin' WHERE id = $1`,
        [subB.id],
      );
      await submit(maria, sc.ent.A1);
      receiver.delayMs = 300;
      const [x, y] = await Promise.all([run(), run()]);
      expect(x + y).toBe(1);
      expect(receiver.received).toHaveLength(1);
    });

    it('CA-RN-121.5 20 falhas definitivas seguidas suspendem a assinatura; sucesso zera; reativar volta a enviar', async () => {
      await ds().query(
        `UPDATE webhook_subscription SET status = 'suspended', suspended_reason = 'admin' WHERE id = $1`,
        [subB.id],
      );
      receiver.respond = 404;
      const emit = (n: number) =>
        ds().transaction((m) =>
          emitWebhookEvent(m, {
            type: 'idea.archived',
            data: { idea_code: `IDE-${n}`, entity_id: sc.ent.A1 },
            entityIds: [sc.ent.A1],
          }),
        );
      for (let i = 0; i < 3; i++) await emit(i);
      await run();
      expect((await overview()).subscriptions.find((s) => s.id === subAll.id)?.consecutiveFailures).toBe(3);
      // Um sucesso zera a contagem.
      receiver.respond = 200;
      await emit(99);
      await run();
      expect((await overview()).subscriptions.find((s) => s.id === subAll.id)).toMatchObject({
        consecutiveFailures: 0,
        status: 'active',
      });

      receiver.respond = 404;
      for (let i = 0; i < 20; i++) await emit(100 + i);
      await run();
      const view = (await overview()).subscriptions.find((s) => s.id === subAll.id);
      expect(view).toMatchObject({ status: 'suspended', suspendedReason: 'failures', consecutiveFailures: 20 });
      const auto = (await audits('integration.webhook_suspended_failures'))[0];
      expect(auto).toMatchObject({ actor_id: null, target_id: subAll.id });
      expect(auto?.data).toMatchObject({ subscription: 'Todos os eventos', failures: 20 });

      // Suspensa, não envia o que chega depois.
      receiver.respond = 200;
      receiver.received.length = 0;
      await emit(500);
      await makeDue();
      await run();
      expect(receiver.received).toHaveLength(0);

      // Saúde: assinatura parada por falhas é falha, e o alerta dispara; ao reativar, volta.
      const health = new HealthService(ds());
      expect((await health.evaluate()).items.find((i) => i.key === 'webhook_delivery')).toMatchObject({
        state: 'failed',
        code: 'suspended',
      });
      await ds().query('DELETE FROM ops_alert_state');
      await ds().query('DELETE FROM notification');
      const alert = new AlertService(ds(), health);
      expect(await alert.check()).toMatchObject({ failed: ['webhook_delivery'] });
      expect(
        (
          await ds()
            .getRepository(Notification)
            .find({ where: { type: 'ops_failed' } })
        )[0]?.payload,
      ).toEqual({ items: ['webhook_delivery'] });

      const back = await admin.post<SubView>(`/admin/webhooks/${subAll.id}/reactivate`);
      expect(back.status).toBe(200);
      expect(back.body).toMatchObject({ status: 'active', suspendedReason: null, consecutiveFailures: 0 });
      // Reativada, volta a receber o que acontece daqui para frente.
      await emit(501);
      await run();
      expect(receiver.received).toHaveLength(1);
    }, 60_000);

    it('CA-RN-117.5 o que passou de 48 horas vira falha; o pendente com a chave desligada espera', async () => {
      await ds().query(
        `UPDATE webhook_subscription SET status = 'suspended', suspended_reason = 'admin' WHERE id = $1`,
        [subB.id],
      );
      await submit(maria, sc.ent.A1);
      await settings().set('integration.webhooks_enabled', false, null);
      await makeDue();
      await run();
      expect(receiver.received).toHaveLength(0);
      expect((await deliveries(subAll.id))[0]?.state).toBe('pending');
      await settings().set('integration.webhooks_enabled', true, null);
      await ds().query(`UPDATE webhook_delivery SET next_attempt_at = now()`);
      await run();
      expect((await deliveries(subAll.id))[0]?.state).toBe('delivered');

      await submit(maria, sc.ent.A1);
      await ds().query(
        `UPDATE webhook_delivery SET created_at = now() - interval '49 hours', next_attempt_at = now() WHERE state = 'pending'`,
      );
      receiver.received.length = 0;
      await run();
      expect(receiver.received).toHaveLength(0);
      expect((await deliveries(subAll.id)).find((d) => d.state === 'failed')).toMatchObject({ last_error: 'expired' });
    });
  });

  describe('registro, reenvio e teste (RN-122)', () => {
    beforeEach(async () => {
      receiver.reset();
      await ds().query('DELETE FROM webhook_event');
      await ds().query(
        `UPDATE webhook_subscription SET status = 'active', suspended_reason = NULL, consecutive_failures = 0`,
      );
      await settings().set('integration.webhooks_enabled', true, null);
    });

    it('CA-RN-122.1 o registro tem tipo, evento, estado, tentativas, HTTP e erro; a resposta nunca é guardada (negativo)', async () => {
      receiver.respond = 500;
      receiver.responseBody = 'CORPO-DA-RESPOSTA-SECRETO';
      await ds().query(
        `UPDATE webhook_subscription SET status = 'suspended', suspended_reason = 'admin' WHERE id = $1`,
        [subB.id],
      );
      await submit(maria, sc.ent.A1);
      await run();
      const list = await admin.get<DeliveryView[]>(`/admin/webhooks/${subAll.id}/deliveries`);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({
        eventType: 'idea.submitted',
        state: 'pending',
        attempts: 1,
        lastStatus: 500,
        lastError: 'http_500',
      });
      expect(list.body[0]?.eventId).toMatch(/^[0-9a-f-]{36}$/);
      const columns = (
        await rows<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_name IN ('webhook_delivery', 'webhook_event')`,
        )
      ).map((c) => c.column_name);
      expect(columns.some((c) => /body|response|payload/.test(c))).toBe(false);
      const dump = JSON.stringify([
        await rows('SELECT * FROM webhook_delivery'),
        await rows('SELECT * FROM webhook_event'),
        list.body,
      ]);
      expect(dump).not.toContain('CORPO-DA-RESPOSTA-SECRETO');
      expect(dump).not.toContain(SECRET_QUERY);
      expect((await admin.get<DeliveryView[]>(`/admin/webhooks/${subAll.id}/deliveries?state=failed`)).body).toEqual(
        [],
      );
      expect((await admin.get(`/admin/webhooks/${subAll.id}/deliveries?state=outro`)).status).toBe(422);
    });

    it('CA-RN-122.2 reenviar a entrega com falha a volta para pendente e sai igual; a entregue → 409', async () => {
      await ds().query(
        `UPDATE webhook_subscription SET status = 'suspended', suspended_reason = 'admin' WHERE id = $1`,
        [subB.id],
      );
      receiver.respond = 404;
      await submit(maria, sc.ent.A1);
      await run();
      const [failed] = await deliveries(subAll.id);
      expect(failed?.state).toBe('failed');
      const firstBody = receiver.received[0]?.body;
      const firstId = receiver.received[0]?.headers['x-its-event-id'];
      receiver.respond = 200;
      const resend = await admin.post<DeliveryView>(`/admin/webhooks/${subAll.id}/deliveries/${failed?.id}/resend`);
      expect(resend.status).toBe(200);
      expect(resend.body).toMatchObject({ state: 'pending', attempts: 0, lastError: null, lastStatus: null });
      await makeDue();
      await run();
      expect(receiver.received).toHaveLength(2);
      expect(receiver.received[1]?.body).toBe(firstBody);
      expect(receiver.received[1]?.headers['x-its-event-id']).toBe(firstId);
      expect((await deliveries(subAll.id))[0]?.state).toBe('delivered');
      const again = await admin.post<{ code: string }>(`/admin/webhooks/${subAll.id}/deliveries/${failed?.id}/resend`);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('delivery_not_failed');
      expect(
        (await admin.post(`/admin/webhooks/${subAll.id}/deliveries/00000000-0000-4000-8000-000000000009/resend`))
          .status,
      ).toBe(404);
      // A entrega de outra assinatura não é alcançada por esta.
      expect((await admin.post(`/admin/webhooks/${subB.id}/deliveries/${failed?.id}/resend`)).status).toBe(404);
      expect((await audits('integration.webhook_resent')).length).toBe(1);
    });

    it('CA-RN-122.3 o teste (webhook.ping) passa pela checagem e pela assinatura e devolve o resultado na hora', async () => {
      const ok = await admin.post<{ ok: boolean; status: number | null; error: string | null }>(
        `/admin/webhooks/${subAll.id}/ping`,
      );
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ ok: true, status: 200, error: null });
      const hook = receiver.received[0];
      expect(hook?.headers['x-its-event']).toBe('webhook.ping');
      expect(check(hook as (typeof receiver.received)[number], subAll.secret).ok).toBe(true);
      expect(JSON.parse(hook?.body ?? '{}').data).toEqual({});
      expect(await count('SELECT count(*) AS n FROM webhook_event')).toBe(0);

      receiver.respond = 500;
      expect((await admin.post(`/admin/webhooks/${subAll.id}/ping`)).body).toEqual({
        ok: false,
        status: 500,
        error: 'http_500',
      });
      // Uma URL que a checagem recusa nem abre conexão.
      await ds().query(`UPDATE webhook_subscription SET url = 'https://169.254.169.254/x' WHERE id = $1`, [subB.id]);
      const before = receiver.connections;
      expect((await admin.post(`/admin/webhooks/${subB.id}/ping`)).body).toMatchObject({
        ok: false,
        error: 'blocked_destination',
      });
      expect(receiver.connections).toBe(before);
      await ds().query(`UPDATE webhook_subscription SET url = $2 WHERE id = $1`, [subB.id, hookUrl()]);
    });

    it('CA-RN-120.5 a rotação: na janela a entrega leva duas assinaturas e as duas conferem; depois só a nova', async () => {
      const rotated = await admin.post<Created>(`/admin/webhooks/${subAll.id}/secrets`, {
        expiresAt: future(90),
        overlapHours: 24,
      });
      expect(rotated.status).toBe(200);
      const newSecret = rotated.body.secret;
      expect(newSecret).not.toBe(subAll.secret);
      expect(rotated.body.subscription.secrets.map((s) => s.state).sort()).toEqual(['active', 'retiring']);
      await admin.post(`/admin/webhooks/${subAll.id}/ping`);
      const during = receiver.received[0];
      expect(during?.headers['x-its-signature']?.toString().split(',')).toHaveLength(2);
      expect(check(during as (typeof receiver.received)[number], subAll.secret).ok).toBe(true);
      expect(check(during as (typeof receiver.received)[number], newSecret).ok).toBe(true);

      // Um terceiro segredo ativo → 409; janela acima de 72 horas → 422.
      const third = await admin.post<{ code: string }>(`/admin/webhooks/${subAll.id}/secrets`, {
        expiresAt: future(90),
      });
      expect(third.status).toBe(409);
      expect(third.body.code).toBe('too_many_secrets');
      expect(
        (await admin.post(`/admin/webhooks/${subAll.id}/secrets`, { expiresAt: future(90), overlapHours: 73 })).status,
      ).toBe(422);

      // Revogado o antigo, só a nova assinatura sai.
      receiver.reset();
      const oldId = rotated.body.subscription.secrets.find((s) => s.state === 'retiring')?.id;
      expect((await admin.post(`/admin/webhooks/${subAll.id}/secrets/${oldId}/revoke`)).status).toBe(200);
      await admin.post(`/admin/webhooks/${subAll.id}/ping`);
      const after = receiver.received[0] as (typeof receiver.received)[number];
      expect(after.headers['x-its-signature']?.toString().split(',')).toHaveLength(1);
      expect(check(after, newSecret).ok).toBe(true);
      expect(check(after, subAll.secret).ok).toBe(false);
      subAll.secret = newSecret;
    });

    it('um segredo vencido não assina: sem segredo válido a entrega falha com secret_expired', async () => {
      await ds().query(
        `UPDATE webhook_secret SET retire_at = now() - interval '1 hour', revoked_at = NULL WHERE subscription_id = $1`,
        [subB.id],
      );
      await ds().query(
        `UPDATE webhook_secret SET expires_at = now() - interval '1 minute', created_at = now() - interval '2 days' WHERE subscription_id = $1`,
        [subB.id],
      );
      const ping = await admin.post(`/admin/webhooks/${subB.id}/ping`);
      expect(ping.body).toMatchObject({ ok: false, error: 'secret_expired' });
      const renewed = await admin.post<Created>(`/admin/webhooks/${subB.id}/secrets`, { expiresAt: future(30) });
      expect(renewed.status).toBe(200);
      subB.secret = renewed.body.secret;
      expect((await admin.post(`/admin/webhooks/${subB.id}/ping`)).body).toMatchObject({ ok: true });
    });

    it('CA-RN-122.4 a limpeza apaga o que passou de ops.retention_days e repetir não muda nada (CA-T.1)', async () => {
      await ds().query(
        `UPDATE webhook_subscription SET status = 'suspended', suspended_reason = 'admin' WHERE id = $1`,
        [subB.id],
      );
      await submit(maria, sc.ent.A1);
      await submit(maria, sc.ent.A1);
      const days = Number(await settings().get('ops.retention_days'));
      await ds().query(
        `UPDATE webhook_event SET created_at = now() - make_interval(days => $1 + 1) WHERE id = (SELECT id FROM webhook_event ORDER BY created_at LIMIT 1)`,
        [days],
      );
      expect((await purgeOpsData(ds())).webhooks).toBe(1);
      expect((await purgeOpsData(ds())).webhooks).toBe(0);
      expect(await count('SELECT count(*) AS n FROM webhook_event')).toBe(1);
      // As entregas do evento apagado foram junto.
      expect(await count('SELECT count(*) AS n FROM webhook_delivery')).toBe(1);
    });
  });

  describe('auditoria, vazamento e saúde (RN-123, RN-124, CA-T.16)', () => {
    it('CA-RN-124.1 cada ação gera um registro com o administrador como autor, a integração e a assinatura nos dados', async () => {
      const log = await audits();
      const actions = new Set(log.map((a) => a.action));
      for (const action of [
        'integration.webhooks_enabled_changed',
        'integration.webhook_destinations_changed',
        'integration.webhook_created',
        'integration.webhook_secret_created',
        'integration.webhook_updated',
        'integration.webhook_removed',
        'integration.webhook_resent',
        'integration.webhook_ping',
        'integration.webhook_secret_rotated',
        'integration.webhook_secret_revoked',
        'integration.webhook_suspended_failures',
      ]) {
        expect(actions.has(action), action).toBe(true);
      }
      const adminId = (
        await rows<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [INSTALL_INPUT.adminEmail])
      )[0]?.id;
      for (const entry of log.filter((a) => a.action !== 'integration.webhook_suspended_failures')) {
        expect(entry.actor_id, entry.action).toBe(adminId);
      }
      const created = log.find(
        (a) => a.action === 'integration.webhook_created' && a.data.subscription === 'Todos os eventos',
      );
      expect(created?.data).toMatchObject({ integrationId: allIntegration, subscription: 'Todos os eventos' });
    });

    it('CA-RN-124.2 e CA-T.16 só o host vai à auditoria e às respostas de erro; nunca o caminho, a consulta nem o segredo (negativo)', async () => {
      const dump = JSON.stringify(await audits('%'));
      expect(dump).toContain(`127.0.0.1:${receiver.port}`);
      for (const leak of [SECRET_PATH, SECRET_QUERY, 'valor-secreto-123', subAll.secret, subB.secret]) {
        expect(dump, leak).not.toContain(leak);
      }
      // Só o prefixo de reconhecimento (whsec_ mais 4 caracteres) aparece; segredo inteiro, nunca.
      expect(dump).not.toMatch(/whsec_[A-Za-z0-9_-]{12,}/);
      // A resposta de erro de uma URL recusada não repete o endereço.
      const refused = await admin.post('/admin/webhooks', {
        integrationId: allIntegration,
        name: 'recusada',
        url: `https://fora.exemplo.org${SECRET_PATH}?${SECRET_QUERY}`,
        events: ['idea.submitted'],
        expiresAt: future(30),
      });
      expect(refused.status).toBe(422);
      expect(JSON.stringify(refused.body)).not.toContain(SECRET_QUERY);
      // O registro de entregas e os eventos não guardam o endereço.
      const stored = JSON.stringify([
        await rows('SELECT * FROM webhook_delivery'),
        await rows('SELECT * FROM webhook_event'),
      ]);
      expect(stored).not.toContain(SECRET_QUERY);
    });

    it('CA-RN-124.3 cem entregas não criam nenhuma linha em audit_log (negativo)', async () => {
      await settings().set('integration.webhooks_enabled', true, null);
      receiver.reset();
      await ds().query('DELETE FROM webhook_event');
      await ds().query(
        `UPDATE webhook_subscription SET status = 'active', suspended_reason = NULL, consecutive_failures = 0`,
      );
      const before = await count('SELECT count(*) AS n FROM audit_log');
      for (let i = 0; i < 50; i++) {
        await ds().transaction((m) =>
          emitWebhookEvent(m, {
            type: 'idea.archived',
            data: { idea_code: `IDE-L${i}`, entity_id: sc.ent.B1 },
            entityIds: [sc.ent.B1],
          }),
        );
      }
      let sent = 0;
      for (let i = 0; i < 6; i++) sent += await run();
      expect(sent).toBe(100);
      expect(receiver.received).toHaveLength(100);
      expect(await count('SELECT count(*) AS n FROM audit_log')).toBe(before);
    }, 60_000);

    it('CA-RN-123.3 sem a chave dos webhooks os dois itens de saúde são "não se aplica"', async () => {
      await settings().set('integration.webhooks_enabled', false, null);
      const items = (await new HealthService(ds()).evaluate()).items;
      expect(items.find((i) => i.key === 'webhook_secret')).toMatchObject({ state: 'ok', code: 'not_applicable' });
      expect(items.find((i) => i.key === 'webhook_delivery')).toMatchObject({ state: 'ok', code: 'not_applicable' });
      await settings().set('integration.webhooks_enabled', true, null);
      expect((await new HealthService(ds()).evaluate()).items.find((i) => i.key === 'webhook_delivery')?.code).not.toBe(
        'not_applicable',
      );
    });
  });

  describe('exemplo da Ajuda (CA-RN-125.7)', () => {
    const ajuda = (lang: string) =>
      readFileSync(join(process.cwd(), '..', 'ajuda', 'content', lang, 'ti', 'webhooks-receber.mdx'), 'utf8');
    const snippet = (text: string) => (/```js\n([\s\S]*?)```/.exec(text)?.[1] ?? '').trim();

    it('o exemplo de conferência da Ajuda (pt-BR e en) valida uma entrega real e recusa a adulterada', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'its-ajuda-'));
      try {
        const code = snippet(ajuda('pt-BR'));
        expect(code).toContain('createHmac');
        expect(snippet(ajuda('en'))).toBe(code);
        const file = join(dir, 'verify.mjs');
        writeFileSync(file, code);
        const { verify } = (await import(pathToFileURL(file).href)) as {
          verify: (h: Record<string, unknown>, body: string, secret: string) => boolean;
        };

        receiver.reset();
        await settings().set('integration.webhooks_enabled', true, null);
        expect((await admin.post(`/admin/webhooks/${subAll.id}/ping`)).status).toBe(200);
        const hook = receiver.received[0] as (typeof receiver.received)[number];
        expect(verify(hook.headers, hook.body, subAll.secret)).toBe(true);
        expect(verify(hook.headers, `${hook.body} `, subAll.secret)).toBe(false);
        expect(verify(hook.headers, hook.body, 'whsec_errado')).toBe(false);
        expect(
          verify(
            { ...hook.headers, 'x-its-timestamp': String(Math.floor(Date.now() / 1000) - 400) },
            hook.body,
            subAll.secret,
          ),
        ).toBe(false);
        expect(verify({}, hook.body, subAll.secret)).toBe(false);

        // Na troca de segredo o cabeçalho leva duas assinaturas e o exemplo aceita as duas.
        const rotated = await admin.post<Created>(`/admin/webhooks/${subAll.id}/secrets`, {
          expiresAt: future(90),
          overlapHours: 24,
        });
        expect(rotated.status).toBe(200);
        receiver.reset();
        await admin.post(`/admin/webhooks/${subAll.id}/ping`);
        const both = receiver.received[0] as (typeof receiver.received)[number];
        expect(verify(both.headers, both.body, subAll.secret)).toBe(true);
        expect(verify(both.headers, both.body, rotated.body.secret)).toBe(true);
        subAll.secret = rotated.body.secret;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('o exemplo mostrado na tela do administrador é o mesmo da Ajuda', () => {
      const source = readFileSync(
        join(process.cwd(), '..', 'frontend', 'src', 'app', 'admin', 'integrations', 'webhooks', 'webhook-docs.tsx'),
        'utf8',
      );
      const raw = /export const VERIFY_EXAMPLE = `([\s\S]*?)`;/.exec(source)?.[1] ?? '';
      // No fonte TSX a crase e o `${` do exemplo estão escapados com barra invertida.
      const onScreen = raw.replaceAll('\\`', '`').replaceAll('\\${', '${').trim();
      expect(onScreen).toBe(snippet(ajuda('pt-BR')));
    });
  });
});
