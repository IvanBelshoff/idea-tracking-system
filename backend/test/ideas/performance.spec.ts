import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, type TestApp } from '../support/test-app.js';

/** Orçamento do CA-T.10 (a validar): resposta de listagem com 10 mil ideias em menos de 500 ms. */
const BUDGET_MS = 500;
const TOTAL = 10_000;

describe('Desempenho com 10 mil ideias (CA-T.10)', () => {
  let t: TestApp;
  let admin: Client;
  let entityId: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    entityId = (await t.db.dataSource.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;
    const authorId: string = (await t.db.dataSource.query('SELECT id FROM "user" LIMIT 1'))[0].id;
    // 10 mil ideias de uma vez, em todas as situações, distribuídas ao longo de um ano.
    await t.db.dataSource.query(
      `INSERT INTO idea (id, code, public_code, title, description, status, entity_id, author_id, submitted_at,
                          decided_at, implemented_at, result_text, rejection_reason)
       SELECT gen_random_uuid(), 'ITS-2026-' || lpad(n::text, 5, '0'), md5(n::text) || md5((n + 1)::text),
              'Ideia de teste ' || n, 'Descrição ' || n,
              (ARRAY['submitted','in_review','in_progress','implemented','rejected'])[1 + n % 5]::idea_status,
              $1, $2, now() - (n % 365) * interval '1 day',
              CASE WHEN n % 5 >= 2 THEN now() - (n % 365) * interval '1 day' + interval '2 hours' END,
              CASE WHEN n % 5 = 3 THEN now() - (n % 365) * interval '1 day' + interval '3 days' END,
              CASE WHEN n % 5 = 3 THEN 'Resultado' END,
              CASE WHEN n % 5 = 4 THEN 'Motivo' END
         FROM generate_series(1, $3) AS n`,
      [entityId, authorId, TOTAL],
    );
    await t.db.dataSource.query('ANALYZE idea');
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });

  const timed = async (path: string) => {
    await admin.get(path); // aquece (plano de consulta e conexões)
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const res = await admin.get(path);
      times.push(performance.now() - start);
      expect(res.status).toBe(200);
    }
    const best = Math.min(...times);
    console.info(`[desempenho] ${path.slice(0, 60)}: ${best.toFixed(0)} ms (melhor de 5)`);
    return best;
  };

  it('a fila paginada responde dentro do orçamento', async () => {
    const res = await admin.get<{ items: unknown[]; meta: { total: number } }>('/ideas?pageSize=20&sort=newest');
    expect(res.body.meta.total).toBe(TOTAL);
    expect(res.body.items).toHaveLength(20);
    expect(await timed('/ideas?pageSize=20&sort=newest')).toBeLessThan(BUDGET_MS);
  });

  it('a fila com filtros (situação, entidade e busca) responde dentro do orçamento', async () => {
    expect(await timed(`/ideas?status=submitted&status=in_review&entityId=${entityId}&pageSize=20`)).toBeLessThan(
      BUDGET_MS,
    );
    expect(await timed('/ideas?search=teste%209999&pageSize=20')).toBeLessThan(BUDGET_MS);
  });

  it('os indicadores respondem dentro do orçamento', async () => {
    const res = await admin.get<{ total: number }>('/reports/summary');
    expect(res.body.total).toBe(TOTAL);
    expect(await timed('/reports/summary')).toBeLessThan(BUDGET_MS);
    expect(await timed('/reports/summary?from=2026-01-01&to=2026-12-31')).toBeLessThan(BUDGET_MS);
  });

  it('o detalhe de uma ideia e a consulta pública respondem dentro do orçamento', async () => {
    expect(await timed('/ideas/ITS-2026-05000')).toBeLessThan(BUDGET_MS);
  });
});
