import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IntegrationUsageService } from '../../src/integration/integration-usage.service.js';
import { SENDER_DEPS } from '../../src/integration/webhooks/admin/webhooks-admin.service.js';
import { IdempotencyService, requestHash } from '../../src/integration/write/idempotency.js';
import { SettingsService } from '../../src/organization/settings.service.js';
import {
  ALL_MODULES,
  buildScenario,
  createIntegration,
  enableIntegration,
  IntegrationClient,
  type Scenario,
} from '../support/integration-support.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Err {
  code: string;
  message: string;
  details?: unknown;
}
interface Submitted {
  code: string;
  status: string;
  entity_id: string;
}

const WRITE_MODULES = [...ALL_MODULES, 'ideas_write', 'gains_write'];

describe('API de integração: escrita (M18, RN-126 a RN-134)', () => {
  let t: TestApp;
  let admin: Client;
  let s: Scenario;
  let w: IntegrationClient; // escopo A (com subentidades), só módulos de escrita
  let wb: IntegrationClient; // escopo B1, ideas_write
  let integrationW: { id: string; token: string };
  let integrationName = '';
  let seq = 0;
  const ds = () => t.db.dataSource;
  const settings = () => t.app.get(SettingsService, { strict: false });
  const client = (token: string | null) => new IntegrationClient(t.baseUrl, token);
  const rows = <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    ds().query(sql, params);
  const count = async (sql: string, params: unknown[] = []) => Number((await rows<{ n: string }>(sql, params))[0]?.n);
  const key = () => `k-${randomUUID()}`;
  const send = (c: IntegrationClient, method: 'POST' | 'PUT', path: string, body: unknown, k: string | null = key()) =>
    c.request(method, path, { body, headers: k ? { 'idempotency-key': k } : {} });
  const post = <T = unknown>(c: IntegrationClient, path: string, body: unknown, k: string | null = key()) =>
    send(c, 'POST', path, body, k) as Promise<{ status: number; body: T; headers: Headers }>;
  const put = <T = unknown>(c: IntegrationClient, path: string, body: unknown, k: string | null = key()) =>
    send(c, 'PUT', path, body, k) as Promise<{ status: number; body: T; headers: Headers }>;
  const idea = (over: Record<string, unknown> = {}) => ({
    author_email: 'maria@example.test',
    title: 'Ideia enviada pela API',
    description: 'Descrição fictícia da situação atual.',
    entity_id: s.ent.A1,
    category_id: s.cat.Qualidade,
    ...over,
  });
  const submit = async (over: Record<string, unknown> = {}, c = w) => {
    const res = await post<Submitted>(c, '/ideas', idea(over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const audits = (like: string) =>
    rows<{ action: string; actor_id: string | null; target_id: string; data: Record<string, unknown> }>(
      'SELECT action, actor_id, target_id, data FROM audit_log WHERE action LIKE $1 ORDER BY id',
      [like],
    );
  const login = async (email: string) => {
    const c = new Client(t.baseUrl);
    expect((await c.post('/auth/login', { email, password: STRONG_PASSWORD })).status).toBe(200);
    return c;
  };

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    s = await buildScenario(t, admin);
    await enableIntegration(t, admin, WRITE_MODULES);
    wb = client(
      (
        await createIntegration(admin, {
          name: 'Formulário B1',
          modules: ['ideas_write'],
          scope: [{ entityId: s.ent.B1, includeChildren: false }],
          ratePerMinute: 600,
        })
      ).token,
    );
  }, 180_000);

  afterAll(async () => {
    await t?.close();
  });

  // O limite de escrita é fixo (30 por minuto, por integração): cada teste usa a sua integração.
  beforeEach(async () => {
    integrationName = `Service desk ${++seq}`;
    integrationW = await createIntegration(admin, {
      name: integrationName,
      modules: ['ideas_write', 'gains_write'],
      scope: [{ entityId: s.ent.A, includeChildren: true }],
      ratePerMinute: 600,
    });
    w = client(integrationW.token);
  });

  describe('módulos de escrita (RN-126)', () => {
    it('CA-RN-126.2 módulo desligado → 404; ligado mas fora da integração → 403 module_not_allowed (negativo)', async () => {
      const readOnly = client(
        (
          await createIntegration(admin, {
            name: 'só leitura',
            modules: ['ideas'],
            scope: [{ entityId: s.ent.A, includeChildren: true }],
            ratePerMinute: 600,
          })
        ).token,
      );
      const res = await post<Err>(readOnly, '/ideas', idea());
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('module_not_allowed');
      await settings().set('integration.modules', ALL_MODULES, null);
      expect((await post(w, '/ideas', idea())).status).toBe(404);
      expect((await put(w, `/ideas/${s.code.i1}/gain`, { periodicity: 'once' })).status).toBe(404);
      await settings().set('integration.modules', WRITE_MODULES, null);
      expect((await post(w, '/ideas', idea())).status).toBe(201);
    });

    it('CA-RN-126.3 ideas_write sem ideas: grava, e GET /ideas → 403; a resposta da gravação é mínima', async () => {
      const created = await submit();
      expect(Object.keys(created).sort()).toEqual(['code', 'entity_id', 'status']);
      const read = await w.get<Err>('/ideas');
      expect(read.status).toBe(403);
      expect(read.body.code).toBe('module_not_allowed');
    });

    it('CA-RN-126.4 rota de escrita com método errado → 405 com o Allow certo; nada é gravado (negativo)', async () => {
      const before = await count('SELECT count(*) AS n FROM comment');
      const wrong: [string, string, string][] = [
        ['PUT', `/ideas/${s.code.i1}/comments`, 'POST'],
        ['PATCH', `/ideas/${s.code.i1}/comments`, 'POST'],
        ['POST', `/ideas/${s.code.i1}/gain`, 'PUT'],
        ['POST', `/ideas/${s.code.i1}/external-ref`, 'PUT'],
        ['DELETE', `/ideas/${s.code.i1}/external-ref`, 'PUT'],
      ];
      for (const [method, path, allow] of wrong) {
        const res = await w.request(method, path, { body: { body: 'x' }, headers: { 'idempotency-key': key() } });
        expect(res.status, `${method} ${path}`).toBe(405);
        expect(res.headers.get('allow')).toBe(allow);
      }
      expect(await count('SELECT count(*) AS n FROM comment')).toBe(before);
    });

    it('CA-RN-126.5 o CHECK de módulos do banco aceita os oito e recusa um desconhecido (CA-T.9)', async () => {
      await rows(`UPDATE integration SET modules = $1 WHERE id = $2`, [[...WRITE_MODULES], integrationW.id]);
      await expect(
        rows(`UPDATE integration SET modules = $1 WHERE id = $2`, [['ideas', 'inventado'], integrationW.id]),
      ).rejects.toThrow();
      await expect(
        rows(`INSERT INTO integration_hour (hour, integration_id, module) VALUES (now(), $1, 'inventado')`, [
          integrationW.id,
        ]),
      ).rejects.toThrow();
      await rows(`UPDATE integration SET modules = $1 WHERE id = $2`, [
        ['ideas_write', 'gains_write'],
        integrationW.id,
      ]);
    });
  });

  describe('enviar ideia (RN-127)', () => {
    it('CA-RN-127.1 e .10 uma ideia válida → 201; entra com o autor indicado, a origem e o histórico', async () => {
      const res = await submit({
        title: 'Trocar o rolo da esteira',
        external_ref: 'CHAMADO-1',
        proposed_solution: 'Rolo selado.',
      });
      expect(res).toEqual({
        code: expect.stringMatching(/^ITS-\d{4}-\d{4}$/),
        status: 'submitted',
        entity_id: s.ent.A1,
      });
      const [row] = await rows<{
        author_id: string;
        entity_id: string;
        status: string;
        source_integration_id: string;
        external_ref: string;
        registered_by_id: string | null;
      }>(
        'SELECT author_id, entity_id, status, source_integration_id, external_ref, registered_by_id FROM idea WHERE code = $1',
        [res.code],
      );
      expect(row).toMatchObject({
        author_id: s.uid.maria,
        entity_id: s.ent.A1,
        status: 'submitted',
        source_integration_id: integrationW.id,
        external_ref: 'CHAMADO-1',
        registered_by_id: null,
      });
      const created = (
        await rows<{ data: Record<string, unknown> }>(
          `SELECT e.data FROM idea_event e JOIN idea i ON i.id = e.idea_id WHERE i.code = $1 AND e.type = 'created'`,
          [res.code],
        )
      )[0];
      expect(created?.data).toMatchObject({ integrationId: integrationW.id, integrationName: integrationName });
    });

    it('CA-RN-127.2 sem Idempotency-Key → 422 idempotency_key_required (negativo)', async () => {
      const before = await count('SELECT count(*) AS n FROM idea');
      const res = await post<Err>(w, '/ideas', idea(), null);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('idempotency_key_required');
      expect(await count('SELECT count(*) AS n FROM idea')).toBe(before);
    });

    it('CA-RN-127.3 entidade fora do escopo → 422 entity_not_in_scope; entidade inativa → 422 (negativo)', async () => {
      const out = await post<Err>(w, '/ideas', idea({ entity_id: s.ent.B1 }));
      expect(out.status).toBe(422);
      expect(out.body.code).toBe('entity_not_in_scope');
      await rows('UPDATE entity SET active = false WHERE id = $1', [s.ent.A2]);
      const inactive = await post<Err>(w, '/ideas', idea({ entity_id: s.ent.A2 }));
      await rows('UPDATE entity SET active = true WHERE id = $1', [s.ent.A2]);
      expect(inactive.status).toBe(422);
    });

    it('CA-RN-127.4 faltando título, descrição ou entidade → 422; a categoria obrigatória segue a configuração', async () => {
      for (const missing of ['title', 'description', 'entity_id']) {
        const body: Record<string, unknown> = idea();
        delete body[missing];
        expect((await post(w, '/ideas', body)).status, missing).toBe(422);
      }
      const noCategory = await post<Err>(w, '/ideas', idea({ category_id: null }));
      expect(noCategory.status).toBe(422);
      await settings().set('ideas.category_required', false, null);
      expect((await post(w, '/ideas', idea({ category_id: null }))).status).toBe(201);
      await settings().set('ideas.category_required', true, null);
    });

    it('CA-RN-127.5 autor ausente, inexistente, desativado ou anonimizado → author_not_found; sem permissão → author_cannot_submit (negativo)', async () => {
      const before = await count('SELECT count(*) AS n FROM idea');
      const bad = async (over: Record<string, unknown>) => (await post<Err>(w, '/ideas', idea(over))).body;
      expect((await bad({ author_email: undefined })).code).toBe('validation_failed');
      expect((await bad({ author_email: 'ninguem@example.test' })).code).toBe('author_not_found');
      await rows(`UPDATE "user" SET status = 'disabled' WHERE id = $1`, [s.uid.joao]);
      expect((await bad({ author_email: 'joao@example.test' })).code).toBe('author_not_found');
      await rows(`UPDATE "user" SET status = 'anonymized' WHERE id = $1`, [s.uid.joao]);
      expect((await bad({ author_email: 'joao@example.test' })).code).toBe('author_not_found');
      await rows(`UPDATE "user" SET status = 'active' WHERE id = $1`, [s.uid.joao]);
      // O Pedro é da B1: não pode enviar para a A1.
      expect((await bad({ author_email: 'pedro@example.test' })).code).toBe('author_cannot_submit');
      expect(await count('SELECT count(*) AS n FROM idea')).toBe(before);
      // O e-mail não diferencia maiúsculas.
      expect((await post(w, '/ideas', idea({ author_email: 'MARIA@Example.TEST' }))).status).toBe(201);
    });

    it('CA-RN-127.6 campanha só se elegível: inexistente ou de outra entidade → 422; elegível → 201', async () => {
      expect((await post(w, '/ideas', idea({ campaign_id: randomUUID() }))).status).toBe(422);
      const ok = await post(w, '/ideas', idea({ campaign_id: s.campaignId }));
      expect(ok.status).toBe(201);
      const [row] = await rows<{ campaign_id: string }>('SELECT campaign_id FROM idea WHERE code = $1', [
        (ok.body as Submitted).code,
      ]);
      expect(row?.campaign_id).toBe(s.campaignId);
    });

    it('CA-RN-127.7 campo desconhecido (status, author_id) → 422; a ideia sempre nasce Enviada (negativo)', async () => {
      for (const extra of [
        { status: 'approved' },
        { author_id: s.uid.pedro },
        { assigned_to: s.uid.analista },
        { visibility: 'internal' },
      ]) {
        const res = await post<Err>(w, '/ideas', idea(extra));
        expect(res.status, JSON.stringify(extra)).toBe(422);
        expect(res.body.code).toBe('validation_failed');
      }
    });

    it('CA-RN-127.8 e CA-RN-132.3 o autor recebe o aviso; a ideia pela API e a pela tela geram o mesmo histórico, os mesmos avisos e o código seguinte', async () => {
      const maria = await login('maria@example.test');
      const body = {
        title: 'Mesmo conteúdo',
        description: 'Descrição igual.',
        entityId: s.ent.A1,
        categoryId: s.cat.Qualidade,
      };
      const screen = await maria.post<{ code: string }>('/ideas', body);
      expect(screen.status).toBe(201);
      const api = await submit({ title: 'Mesmo conteúdo', description: 'Descrição igual.' });
      const seq = (c: string) => Number(c.split('-')[2]);
      expect(seq(api.code)).toBe(seq(screen.body.code) + 1);
      const events = (code: string) =>
        rows<{ type: string }>(
          `SELECT e.type FROM idea_event e JOIN idea i ON i.id = e.idea_id WHERE i.code = $1 ORDER BY e.id`,
          [code],
        );
      expect((await events(api.code)).map((e) => e.type)).toEqual((await events(screen.body.code)).map((e) => e.type));
      const notices = (code: string) =>
        rows<{ type: string; user_id: string }>(
          `SELECT n.type, n.user_id FROM notification n JOIN idea i ON i.id = n.idea_id WHERE i.code = $1 ORDER BY n.type`,
          [code],
        );
      const viaApi = await notices(api.code);
      expect(viaApi.map((n) => n.type)).toContain('idea_received');
      expect(viaApi.map((n) => [n.type, n.user_id])).toEqual(
        (await notices(screen.body.code)).map((n) => [n.type, n.user_id]),
      );
    });

    it('CA-RN-127.9 os limites de tamanho são os da tela (título de 200 caracteres)', async () => {
      expect((await post(w, '/ideas', idea({ title: 'x'.repeat(200) }))).status).toBe(201);
      expect((await post(w, '/ideas', idea({ title: 'x'.repeat(201) }))).status).toBe(422);
      expect((await post(w, '/ideas', idea({ external_ref: 'x'.repeat(101) }))).status).toBe(422);
    });
  });

  describe('comentar (RN-128)', () => {
    it('CA-RN-128.1 e .4 o comentário é público, em nome da integração; a equipe e o autor o veem; nunca é interno', async () => {
      const res = await post<{ id: string; idea_code: string; created_at: string }>(w, `/ideas/${s.code.i1}/comments`, {
        body: 'Chamado atendido pela manutenção.',
      });
      expect(res.status).toBe(201);
      expect(res.body.idea_code).toBe(s.code.i1);
      const [row] = await rows<{ author_id: string | null; source_integration_id: string; visibility: string }>(
        'SELECT author_id, source_integration_id, visibility FROM comment WHERE id = $1',
        [res.body.id],
      );
      expect(row).toEqual({ author_id: null, source_integration_id: integrationW.id, visibility: 'public' });
      // Quem só vê comentários públicos (a autora) e a equipe enxergam, com o nome da integração.
      const maria = await login('maria@example.test');
      for (const c of [maria, admin]) {
        const list = await c.get<
          { body: string; author: unknown; viaIntegration: string | null; visibility: string }[]
        >(`/ideas/${s.code.i1}/comments`);
        expect(list.status).toBe(200);
        const mine = list.body.find((x) => x.body === 'Chamado atendido pela manutenção.');
        expect(mine).toMatchObject({ author: null, viaIntegration: integrationName, visibility: 'public' });
      }
    });

    it('CA-RN-128.2 fora do escopo → 404; texto vazio ou com mais de 5000 → 422; visibility → 422 (negativo)', async () => {
      const before = await count('SELECT count(*) AS n FROM comment');
      expect((await post(w, `/ideas/${s.code.i3}/comments`, { body: 'x' })).status).toBe(404);
      expect((await post(w, `/ideas/ITS-0000-0000/comments`, { body: 'x' })).status).toBe(404);
      expect((await post(w, `/ideas/${s.code.i1}/comments`, { body: '   ' })).status).toBe(422);
      expect((await post(w, `/ideas/${s.code.i1}/comments`, { body: 'x'.repeat(5001) })).status).toBe(422);
      expect((await post(w, `/ideas/${s.code.i1}/comments`, { body: 'x'.repeat(5000) })).status).toBe(201);
      for (const extra of [{ visibility: 'internal' }, { author_id: s.uid.pedro }]) {
        expect((await post(w, `/ideas/${s.code.i1}/comments`, { body: 'oi', ...extra })).status).toBe(422);
      }
      expect(await count('SELECT count(*) AS n FROM comment')).toBe(before + 1);
    });

    it('CA-RN-128.3 em ideia encerrada o comentário é aceito (como na tela)', async () => {
      expect((await post(w, `/ideas/${s.code.i2}/comments`, { body: 'Obrigado pelo resultado.' })).status).toBe(201);
    });
  });

  describe('referência externa (RN-129)', () => {
    it('CA-RN-129.1, .2 e .4 atualiza com histórico (de, para, origem); null limpa; a mesma referência não gera histórico', async () => {
      const path = `/ideas/${s.code.i1}/external-ref`;
      const set = await put<{ idea_code: string; external_ref: string }>(w, path, { external_ref: 'CHAMADO-77' });
      expect(set.status).toBe(200);
      expect(set.body).toEqual({ idea_code: s.code.i1, external_ref: 'CHAMADO-77' });
      const events = () =>
        rows<{ data: Record<string, unknown> }>(
          `SELECT e.data FROM idea_event e JOIN idea i ON i.id = e.idea_id WHERE i.code = $1 AND e.type = 'external_ref_changed' ORDER BY e.id`,
          [s.code.i1],
        );
      expect((await events()).at(-1)?.data).toMatchObject({
        from: null,
        to: 'CHAMADO-77',
        integrationId: integrationW.id,
      });
      const n = (await events()).length;
      expect((await put(w, path, { external_ref: 'CHAMADO-77' })).status).toBe(200);
      expect((await events()).length).toBe(n);
      expect((await put(w, path, { external_ref: null })).status).toBe(200);
      expect((await events()).at(-1)?.data).toMatchObject({ from: 'CHAMADO-77', to: null });
      expect((await put(w, path, { external_ref: 'x'.repeat(101) })).status).toBe(422);
      expect((await put(w, path, { external_ref: 'x'.repeat(100) })).status).toBe(200);
      expect((await put(w, path, { external_ref: 'a', status: 'approved' })).status).toBe(422);
    });

    it('CA-RN-129.3 ideia encerrada → 409 idea_closed; fora do escopo → 404 (negativo)', async () => {
      const closed = await put<Err>(w, `/ideas/${s.code.i2}/external-ref`, { external_ref: 'X' });
      expect(closed.status).toBe(409);
      expect(closed.body.code).toBe('idea_closed');
      expect((await put(w, `/ideas/${s.code.i3}/external-ref`, { external_ref: 'X' })).status).toBe(404);
      const [row] = await rows<{ external_ref: string | null }>('SELECT external_ref FROM idea WHERE code = $1', [
        s.code.i3,
      ]);
      expect(row?.external_ref).toBeNull();
    });
  });

  describe('ganho declarado (RN-130)', () => {
    it('CA-RN-130.1, .2 e .4 estimado só na triagem, realizado só depois de implementar; moeda padrão; resposta mínima', async () => {
      const path = `/ideas/${s.code.i1}/gain`;
      const ok = await put<{ idea_code: string; status: string }>(w, path, {
        periodicity: 'monthly',
        estimated: 5000,
        implementation_cost: 1000,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toEqual({ idea_code: s.code.i1, status: 'declared' });
      const [gain] = await rows<{ currency: string; estimated: string; status: string }>(
        'SELECT g.currency, g.estimated, g.status FROM financial_gain g JOIN idea i ON i.id = g.idea_id WHERE i.code = $1',
        [s.code.i1],
      );
      expect(gain).toMatchObject({ estimated: '5000.00', status: 'declared' });
      expect(gain?.currency).toMatch(/^[A-Z]{3}$/);
      const early = await put<Err>(w, path, { periodicity: 'monthly', realized: 100 });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('realized_not_yet');
      expect((await put(w, path, { periodicity: 'semanal' })).status).toBe(422);
      expect((await put(w, path, { periodicity: 'once', estimated: -1 })).status).toBe(422);
      expect((await put(w, path, { periodicity: 'once', status: 'validated' })).status).toBe(422);
      expect((await put(w, `/ideas/${s.code.i3}/gain`, { periodicity: 'once' })).status).toBe(404);
    });

    it('CA-RN-130.3 ganho já validado → 409 gain_validated; a integração nunca valida (negativo)', async () => {
      const [before] = await rows<{ status: string; realized: string }>(
        'SELECT g.status, g.realized FROM financial_gain g JOIN idea i ON i.id = g.idea_id WHERE i.code = $1',
        [s.code.i2],
      );
      expect(before?.status).toBe('validated');
      const res = await put<Err>(w, `/ideas/${s.code.i2}/gain`, { periodicity: 'once', realized: 1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('gain_validated');
      const [after] = await rows<{ status: string; realized: string }>(
        'SELECT g.status, g.realized FROM financial_gain g JOIN idea i ON i.id = g.idea_id WHERE i.code = $1',
        [s.code.i2],
      );
      expect(after).toEqual(before);
      for (const method of ['POST', 'PUT', 'PATCH']) {
        const r = await w.request(method, `/ideas/${s.code.i2}/gain/validate`, {
          body: {},
          headers: { 'idempotency-key': key() },
        });
        expect([404, 405], `${method} validate`).toContain(r.status);
      }
    });

    it('CA-RN-130.1 e .5 o realizado entra em ideia implementada e o ganho declarado fica fora dos indicadores e da lista de ganhos', async () => {
      // A i2 volta a "declarado" só para o teste (a validação é de uma pessoa).
      await rows(
        `UPDATE financial_gain SET status = 'declared', validated_by_id = NULL, validated_at = NULL WHERE idea_id = (SELECT id FROM idea WHERE code = $1)`,
        [s.code.i2],
      );
      const ok = await put(w, `/ideas/${s.code.i2}/gain`, {
        periodicity: 'once',
        realized: 15_000,
        implementation_cost: 3000,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const [gain] = await rows<{ realized: string; status: string }>(
        'SELECT g.realized, g.status FROM financial_gain g JOIN idea i ON i.id = g.idea_id WHERE i.code = $1',
        [s.code.i2],
      );
      expect(gain).toEqual({ realized: '15000.00', status: 'declared' });
      // A leitura só mostra ganho validado (CA-RN-108.3): este segue declarado, então não aparece.
      const reader = client(
        (
          await createIntegration(admin, {
            name: 'BI de ganhos',
            modules: ['indicators'],
            scope: [{ entityId: s.ent.A, includeChildren: true }],
            ratePerMinute: 600,
          })
        ).token,
      );
      const gains = await reader.get<{ data: { idea_code?: string; code?: string }[] }>('/gains');
      expect(gains.status).toBe(200);
      expect(JSON.stringify(gains.body)).not.toContain(s.code.i2);
      // Volta ao estado do cenário para os outros testes.
      await rows(
        `UPDATE financial_gain SET status = 'validated', realized = 12000, implementation_cost = 3000, validated_at = now(), validated_by_id = $2 WHERE idea_id = (SELECT id FROM idea WHERE code = $1)`,
        [s.code.i2, s.uid.analista],
      );
    });
  });

  describe('idempotência (RN-131)', () => {
    it('CA-RN-131.1 a chave tem de 1 a 64 caracteres entre letras, números, - e _; senão 422', async () => {
      for (const bad of ['a b', 'x'.repeat(65), 'áé', 'a/b', '', 'a.b']) {
        const res = await w.request('POST', '/ideas', { body: idea(), headers: { 'idempotency-key': bad } });
        expect(res.status, JSON.stringify(bad)).toBe(422);
      }
      for (const good of ['a', 'x'.repeat(64), 'A-b_9']) {
        const res = await post(w, '/ideas', idea({ title: `chave ${good.slice(0, 5)}` }), good);
        expect(res.status, good).toBe(201);
      }
    });

    it('CA-RN-131.2 e CA-T.19 mesma chave e mesmo corpo → a mesma resposta (Idempotent-Replay) e uma única ideia (negativo)', async () => {
      const k = key();
      const body = idea({ title: 'Repetida' });
      const first = await post<Submitted>(w, '/ideas', body, k);
      const again = await post<Submitted>(w, '/ideas', body, k);
      const third = await post<Submitted>(w, '/ideas', { ...body }, k);
      expect([first.status, again.status, third.status]).toEqual([201, 201, 201]);
      expect(again.body).toEqual(first.body);
      expect(third.body).toEqual(first.body);
      expect(first.headers.get('idempotent-replay')).toBeNull();
      expect(again.headers.get('idempotent-replay')).toBe('true');
      expect(await count(`SELECT count(*) AS n FROM idea WHERE title = 'Repetida'`)).toBe(1);
      expect(
        await count(
          `SELECT count(*) AS n FROM idea_event e JOIN idea i ON i.id = e.idea_id WHERE i.title = 'Repetida' AND e.type = 'created'`,
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*) AS n FROM notification n JOIN idea i ON i.id = n.idea_id WHERE i.title = 'Repetida'`,
        ),
      ).toBe(1);
      // A ordem das chaves do corpo não importa.
      const reordered = await post<Submitted>(w, '/ideas', Object.fromEntries(Object.entries(body).reverse()), k);
      expect(reordered.headers.get('idempotent-replay')).toBe('true');
    });

    it('CA-RN-131.3 mesma chave com corpo diferente → 422 idempotency_key_reused (negativo)', async () => {
      const k = key();
      expect((await post(w, '/ideas', idea({ title: 'Primeira' }), k)).status).toBe(201);
      const res = await post<Err>(w, '/ideas', idea({ title: 'Outra' }), k);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('idempotency_key_reused');
      expect(await count(`SELECT count(*) AS n FROM idea WHERE title = 'Outra'`)).toBe(0);
    });

    it('CA-RN-131.4 e CA-T.2 chamadas simultâneas com a mesma chave nunca gravam duas vezes (negativo)', async () => {
      const k = key();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => post<Submitted & Err>(w, '/ideas', idea({ title: 'Simultânea' }), k)),
      );
      const statuses = results.map((r) => r.status);
      expect(
        statuses.every((st) => st === 201 || st === 409),
        statuses.join(','),
      ).toBe(true);
      expect(statuses).toContain(201);
      for (const r of results.filter((x) => x.status === 409)) expect(r.body.code).toBe('request_in_progress');
      expect(await count(`SELECT count(*) AS n FROM idea WHERE title = 'Simultânea'`)).toBe(1);
      // Comentários simultâneos também.
      const kc = key();
      await Promise.all(
        Array.from({ length: 5 }, () => post(w, `/ideas/${s.code.i1}/comments`, { body: 'Comentário simultâneo' }, kc)),
      );
      expect(await count(`SELECT count(*) AS n FROM comment WHERE body = 'Comentário simultâneo'`)).toBe(1);
    });

    it('CA-RN-131.5 a chave vale por integração e por rota: outra integração ou outra ideia não colide', async () => {
      const k = key();
      const other = client(
        (
          await createIntegration(admin, {
            name: 'Outro sistema',
            modules: ['ideas_write'],
            scope: [{ entityId: s.ent.A, includeChildren: true }],
            ratePerMinute: 600,
          })
        ).token,
      );
      const a = await post<Submitted>(w, '/ideas', idea({ title: 'Chave compartilhada' }), k);
      const b = await post<Submitted>(other, '/ideas', idea({ title: 'Chave compartilhada' }), k);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.code).not.toBe(b.body.code);
      // Mesma chave em duas ideias diferentes (rotas diferentes): cada uma grava o seu comentário.
      const kc = key();
      expect((await post(w, `/ideas/${s.code.i1}/comments`, { body: 'um' }, kc)).status).toBe(201);
      const second = await post(w, `/ideas/${s.code.i4}/comments`, { body: 'um' }, kc);
      expect(second.status).toBe(201);
      expect(second.headers.get('idempotent-replay')).toBeNull();
    });

    it('CA-RN-131.6 erro de negócio (4xx) é repetido igual; 5xx libera a chave; passadas 24 horas a chave é esquecida e a limpeza é idempotente (CA-T.1)', async () => {
      // 4xx: a resposta de erro é guardada e repetida.
      const k = key();
      const first = await post<Err>(w, '/ideas', idea({ author_email: 'ninguem@example.test' }), k);
      const again = await post<Err>(w, '/ideas', idea({ author_email: 'ninguem@example.test' }), k);
      expect([first.status, again.status]).toEqual([422, 422]);
      expect(again.body).toEqual(first.body);
      expect(again.headers.get('idempotent-replay')).toBe('true');

      // 5xx e vencimento, no serviço.
      const service = t.app.get(IdempotencyService, { strict: false });
      const hash = requestHash({ a: 1 });
      const route = 'POST /integration/v1/ideas';
      const kk = key();
      expect((await service.reserve(integrationW.id, route, kk, hash)).kind).toBe('new');
      expect((await service.reserve(integrationW.id, route, kk, hash)).kind).toBe('busy');
      await service.release(integrationW.id, route, kk); // falha do servidor
      expect((await service.reserve(integrationW.id, route, kk, hash)).kind).toBe('new');
      await service.finish(integrationW.id, route, kk, 201, { ok: true });
      expect(await service.reserve(integrationW.id, route, kk, hash)).toEqual({
        kind: 'replay',
        status: 201,
        response: { ok: true },
      });
      await rows(`UPDATE integration_idempotency SET created_at = now() - interval '25 hours' WHERE key = $1`, [kk]);
      expect((await service.reserve(integrationW.id, route, kk, hash)).kind).toBe('new');

      await rows(`UPDATE integration_idempotency SET created_at = now() - interval '25 hours'`);
      const purged = await service.purge();
      expect(purged).toBeGreaterThan(0);
      expect(await service.purge()).toBe(0);
      expect(await count('SELECT count(*) AS n FROM integration_idempotency')).toBe(0);
    });

    it('CA-RN-131.7 o PUT aceita a chave também (repete a mesma resposta) e funciona sem ela', async () => {
      const k = key();
      const path = `/ideas/${s.code.i1}/external-ref`;
      const first = await put(w, path, { external_ref: 'PUT-1' }, k);
      const again = await put(w, path, { external_ref: 'PUT-1' }, k);
      expect([first.status, again.status]).toEqual([200, 200]);
      expect(again.headers.get('idempotent-replay')).toBe('true');
      expect((await put(w, path, { external_ref: 'PUT-2' }, null)).status).toBe(200);
      const reused = await put<Err>(w, path, { external_ref: 'PUT-3' }, k);
      expect(reused.body.code).toBe('idempotency_key_reused');
    });
  });

  describe('o que a escrita nunca faz (RN-132)', () => {
    it('CA-RN-132.1, CA-RN-132.2 e CA-T.18 tentar decidir, validar, arquivar, excluir, converger ou mexer em cadastros → 404 ou 405, e o banco não muda (negativo)', async () => {
      const snapshot = async () => ({
        ideas: await rows(
          `SELECT code, status, entity_id, category_id, author_id, archived_at, converged_into_id, assigned_to_id FROM idea ORDER BY code`,
        ),
        gains: await rows('SELECT idea_id, status, realized, estimated FROM financial_gain ORDER BY idea_id'),
        counts: await Promise.all(
          [
            '"user"',
            'role',
            'role_permission',
            'entity',
            'category',
            'setting',
            'highlight',
            'campaign',
            'step',
            'point_ledger',
          ].map((tb) => count(`SELECT count(*) AS n FROM ${tb}`)),
        ),
        settings: await rows('SELECT key, value FROM setting ORDER BY key'),
      });
      const before = await snapshot();
      const c = s.code.i1;
      const forbidden = [
        `/ideas/${c}/start-review`,
        `/ideas/${c}/approve`,
        `/ideas/${c}/reject`,
        `/ideas/${c}/interrupt`,
        `/ideas/${c}/implement`,
        `/ideas/${c}/reopen`,
        `/ideas/${c}/archive`,
        `/ideas/${c}/unarchive`,
        `/ideas/${c}/converge`,
        `/ideas/${c}/assign`,
        `/ideas/${c}/gain/validate`,
        `/ideas/${c}/steps`,
        `/ideas/${c}/attachments`,
        `/ideas/${c}`,
        '/ideas/batch',
        '/hall/highlights',
        '/campaigns',
        '/users',
        `/users/${s.uid.maria}`,
        '/roles',
        '/entities',
        `/entities/${s.ent.A1}`,
        '/categories',
        '/settings',
        '/admin/integrations',
        '/indicators/summary',
        '/gains',
      ];
      for (const path of forbidden) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          const res = await w.request(method, path, {
            body: { status: 'approved' },
            headers: { 'idempotency-key': key() },
          });
          const writeRoute =
            (method === 'POST' && (path.endsWith('/comments') || path === '/ideas')) ||
            (method === 'PUT' && (path.endsWith('/gain') || path.endsWith('/external-ref')));
          expect(writeRoute).toBe(false);
          expect([404, 405], `${method} ${path} → ${res.status}`).toContain(res.status);
        }
      }
      expect(await snapshot()).toEqual(before);
    });

    it('CA-RN-132.4 toda gravação confere o escopo: o que está fora dele → 404 e o banco não muda (negativo)', async () => {
      const before = await count('SELECT count(*) AS n FROM comment');
      const b = (code: string) => ({
        comment: () => post(wb, `/ideas/${code}/comments`, { body: 'x' }),
        ref: () => put(wb, `/ideas/${code}/external-ref`, { external_ref: 'x' }),
      });
      for (const code of [s.code.i1, s.code.i2, s.code.i4]) {
        expect((await b(code).comment()).status, code).toBe(404);
        expect((await b(code).ref()).status, code).toBe(404);
      }
      expect(await count('SELECT count(*) AS n FROM comment')).toBe(before);
      // Uma integração da B1 não envia para a A.
      expect(
        (await post<Err>(wb, '/ideas', idea({ author_email: 'pedro@example.test', entity_id: s.ent.A1 }))).body.code,
      ).toBe('entity_not_in_scope');
    });
  });

  describe('origem, auditoria e eco (RN-133)', () => {
    it('CA-RN-133.1 e .2 cada ação gera um registro integration.* com a integração e o código; sem autor; sem o texto nem o corpo (negativo)', async () => {
      const created = await submit({
        title: 'Título secreto da auditoria',
        description: 'Descrição secreta da auditoria.',
      });
      await post(w, `/ideas/${created.code}/comments`, { body: 'Texto secreto do comentário' });
      await put(w, `/ideas/${created.code}/external-ref`, { external_ref: 'REF-SECRETA-1' });
      await put(w, `/ideas/${created.code}/gain`, { periodicity: 'once', estimated: 98_765 });
      const log = await audits('integration.%');
      const mine = log.filter((a) => a.data.code === created.code);
      expect(mine.map((a) => a.action).sort()).toEqual([
        'integration.comment_added',
        'integration.external_ref_changed',
        'integration.gain_declared',
        'integration.idea_submitted',
      ]);
      for (const a of mine) {
        expect(a.actor_id).toBeNull();
        expect(a.data).toMatchObject({ integrationId: integrationW.id, integration: integrationName });
      }
      const dump = JSON.stringify(await audits('%'));
      for (const leak of [
        'Título secreto',
        'Descrição secreta',
        'Texto secreto',
        'REF-SECRETA-1',
        '98765',
        integrationW.token,
      ]) {
        expect(dump, leak).not.toContain(leak);
      }
    });

    it('CA-RN-133.3 a origem aparece na ideia, no comentário e no histórico', async () => {
      const created = await submit({ title: 'Com origem' });
      await post(w, `/ideas/${created.code}/comments`, { body: 'Comentário com origem' });
      const detail = await admin.get<{ viaIntegration: string | null }>(`/ideas/${created.code}`);
      expect(detail.body.viaIntegration).toBe(integrationName);
      const timeline = await admin.get<{ type: string; actor: unknown; data: Record<string, unknown> }[]>(
        `/ideas/${created.code}/timeline`,
      );
      const events = timeline.body.filter((e) => e.type === 'created' || e.type === 'comment_added');
      expect(events).toHaveLength(2);
      for (const e of events) expect(e.data.integrationName).toBe(integrationName);
      const comments = await admin.get<{ viaIntegration: string | null }[]>(`/ideas/${created.code}/comments`);
      expect(comments.body[0]?.viaIntegration).toBe(integrationName);
      // Uma ideia da tela não tem origem.
      expect(
        (await admin.get<{ viaIntegration: string | null }>(`/ideas/${s.code.i1}`)).body.viaIntegration,
      ).toBeNull();
    });

    it('CA-RN-133.4 o evento causado por uma integração não volta para as assinaturas dela, mas chega às das outras', async () => {
      const deps = t.app.get(SENDER_DEPS, { strict: false });
      expect(deps.allowLoopback).toBe(true);
      expect((await admin.put('/admin/webhooks/enabled', { enabled: true })).status).toBe(200);
      expect((await admin.put('/admin/webhooks/destinations', { destinations: ['127.0.0.1'] })).status).toBe(200);
      const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const mkSub = async (name: string, modules: string[]) => {
        const i = await createIntegration(admin, {
          name,
          modules,
          scope: [{ entityId: s.ent.A, includeChildren: true }],
          ratePerMinute: 600,
        });
        const res = await admin.post<{ subscription: { id: string } }>('/admin/webhooks', {
          integrationId: i.id,
          name: 'assinatura',
          url: 'http://127.0.0.1:9/hook',
          events: ['idea.submitted'],
          expiresAt,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        return { ...i, sub: res.body.subscription.id };
      };
      const writer = await mkSub('Escritor com aviso', ['ideas', 'ideas_write']);
      const other = await mkSub('Observador', ['ideas']);
      const created = await post<Submitted>(client(writer.token), '/ideas', idea({ title: 'Sem eco' }));
      expect(created.status).toBe(201);
      const delivered = async (sub: string) =>
        count(
          `SELECT count(*) AS n FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id WHERE d.subscription_id = $1 AND e.data->>'idea_code' = $2`,
          [sub, created.body.code],
        );
      expect(await delivered(writer.sub)).toBe(0);
      expect(await delivered(other.sub)).toBe(1);
      const [event] = await rows<{ origin_integration_id: string }>(
        `SELECT origin_integration_id FROM webhook_event WHERE data->>'idea_code' = $1`,
        [created.body.code],
      );
      expect(event?.origin_integration_id).toBe(writer.id);
      // Uma ideia da tela chega às duas.
      const maria = await login('maria@example.test');
      const screen = await maria.post<{ code: string }>('/ideas', {
        title: 'Pela tela',
        description: 'x',
        entityId: s.ent.A1,
        categoryId: s.cat.Qualidade,
      });
      const both = await count(
        `SELECT count(*) AS n FROM webhook_delivery d JOIN webhook_event e ON e.id = d.event_id WHERE e.data->>'idea_code' = $1 AND d.subscription_id = ANY($2)`,
        [screen.body.code, [writer.sub, other.sub]],
      );
      expect(both).toBe(2);
    });
  });

  describe('limites e consumo (RN-134)', () => {
    it('CA-RN-134.1 a 31ª chamada de escrita no minuto → 429 com Retry-After, mesmo com o limite geral livre; a leitura não gasta o limite da escrita', async () => {
      const limited = client(
        (
          await createIntegration(admin, {
            name: 'Limite de escrita',
            modules: ['ideas', 'ideas_write'],
            scope: [{ entityId: s.ent.A, includeChildren: true }],
            ratePerMinute: 600,
          })
        ).token,
      );
      // Leituras antes não consomem o limite da escrita.
      for (let i = 0; i < 5; i++) expect((await limited.get('/ideas?limit=1')).status).toBe(200);
      for (let i = 1; i <= 30; i++) {
        const res = await put(limited, `/ideas/${s.code.i1}/external-ref`, { external_ref: 'x'.repeat(101) });
        expect(res.status, `chamada ${i}`).toBe(422);
      }
      const blocked = await put<Err>(limited, `/ideas/${s.code.i1}/external-ref`, { external_ref: 'ok' });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(blocked.body.code).toBe('too_many_writes');
      // A leitura segue livre.
      expect((await limited.get('/ideas?limit=1')).status).toBe(200);
    });

    it('CA-RN-134.3 o consumo por hora conta os módulos de escrita', async () => {
      const created = await submit();
      expect((await put(w, `/ideas/${created.code}/gain`, { periodicity: 'once', estimated: 10 })).status).toBe(200);
      await t.app.get(IntegrationUsageService, { strict: false }).flush();
      const modules = (
        await rows<{ module: string }>(`SELECT DISTINCT module FROM integration_hour WHERE integration_id = $1`, [
          integrationW.id,
        ])
      ).map((r) => r.module);
      expect(modules).toContain('ideas_write');
      expect(modules).toContain('gains_write');
    });
  });
});
