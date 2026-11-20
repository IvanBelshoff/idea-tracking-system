import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildScenario,
  createIntegration,
  enableIntegration,
  IntegrationClient,
  type Scenario,
} from '../support/integration-support.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Field {
  id: string;
  options: { id: string; label: string }[];
}
interface Breakdown {
  fieldId: string;
  labelPt: string;
  items: { optionId: string | null; label: string | null; count: number }[];
}
interface Summary {
  total: number;
  byField: Breakdown[];
}
interface IntegrationUser {
  id: string;
  custom_fields: { field_id: string; label: string; value: string }[];
}

describe('Campos personalizados: relatórios pelo valor da hora do envio e integração (M25, RN-201, RN-202)', () => {
  let t: TestApp;
  let admin: Client;
  let s: Scenario;
  const c: Record<string, Client> = {};
  const f: Record<string, Field> = {};
  const opt = (field: string, label: string) => f[field]!.options.find((o) => o.label === label)!.id;

  const login = async (key: string) => {
    const client = new Client(t.baseUrl);
    expect((await client.post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(
      200,
    );
    c[key] = client;
  };
  const field = async (key: string, body: Record<string, unknown>) => {
    const res = await admin.post<Field>('/user-fields', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    f[key] = res.body;
  };
  const setDepto = async (userId: string, label: string) => {
    const res = await admin.request('PUT', `/users/${userId}/fields`, {
      values: [{ fieldId: f.depto!.id, optionId: opt('depto', label) }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  const snapshot = async (code: string) =>
    t.db.dataSource.query(
      `SELECT fv.label FROM idea_field_value fv JOIN idea i ON i.id = fv.idea_id WHERE i.code = $1 AND fv.field_id = $2`,
      [code, f.depto!.id],
    ) as Promise<{ label: string }[]>;
  const submit = async (who: string, title: string, extra: Record<string, unknown> = {}) => {
    const res = await c[who]!.post<{ code: string }>('/ideas', {
      title,
      description: `Antes: ${title}`,
      entityId: s.ent.A1,
      categoryId: s.cat.Qualidade,
      ...extra,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.code;
  };
  const deptoOf = (summary: Summary) => summary.byField.find((b) => b.fieldId === f.depto!.id)!;

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    s = await buildScenario(t, admin);
    await login('maria');
    await login('analista');
    await login('gestorb');
    await field('depto', {
      labelPt: 'Departamento',
      kind: 'choice',
      options: ['Manutenção', 'Produção', '=CMD()'],
      integration: true,
    });
    await field('matricula', {
      labelPt: 'Matrícula',
      kind: 'mask',
      config: { preset: 'custom', pattern: '9999' },
      integration: true,
    });
    await field('cpf', { labelPt: 'CPF', kind: 'mask', config: { preset: 'cpf' }, sensitive: true });
    await field('funcao', { labelPt: 'Função', kind: 'text' });
    expect(
      (
        await admin.request('PUT', `/users/${s.uid.maria}/fields`, {
          values: [
            { fieldId: f.depto!.id, optionId: opt('depto', 'Manutenção') },
            { fieldId: f.matricula!.id, value: '4521' },
            { fieldId: f.cpf!.id, value: '52998224725' },
            { fieldId: f.funcao!.id, value: 'Operadora de prensa' },
          ],
        })
      ).status,
    ).toBe(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-201.1 a ideia grava o departamento do autor; mudar depois não muda a ideia nem o indicador', async () => {
    const code = await submit('maria', 'Proteção da prensa');
    expect(await snapshot(code)).toEqual([{ label: 'Manutenção' }]);
    await setDepto(s.uid.maria, 'Produção');
    expect(await snapshot(code)).toEqual([{ label: 'Manutenção' }]);
    const summary = await admin.get<Summary>(`/reports/summary?options=${opt('depto', 'Manutenção')}`);
    expect(summary.body.total).toBe(1);
    expect(deptoOf(summary.body).items).toEqual([
      { optionId: opt('depto', 'Manutenção'), label: 'Manutenção', count: 1 },
    ]);
  });

  it('CA-RN-201.2 em nome de outra pessoa e pela API, grava os valores do autor', async () => {
    const onBehalf = await submit('analista', 'Cadastrada pela analista', { onBehalfOfUserId: s.uid.maria });
    expect(await snapshot(onBehalf)).toEqual([{ label: 'Produção' }]);

    await enableIntegration(t, admin, ['users', 'ideas_write']);
    const writer = await createIntegration(admin, {
      name: 'ERP',
      modules: ['ideas_write'],
      scope: [{ entityId: s.ent.org, includeChildren: true }],
    });
    const api = new IntegrationClient(t.baseUrl, writer.token);
    const res = await api.request<{ code: string }>('POST', '/ideas', {
      headers: { 'idempotency-key': `k-${randomUUID()}` },
      body: {
        author_email: 'maria@example.test',
        title: 'Enviada pelo ERP',
        description: 'Descrição fictícia.',
        entity_id: s.ent.A1,
        category_id: s.cat.Qualidade,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await snapshot(res.body.code)).toEqual([{ label: 'Produção' }]);
  });

  it('CA-RN-201.3 indicadores filtram e agrupam por campo fechado, no escopo; sem valor → "Não informado"', async () => {
    const all = await admin.get<Summary>('/reports/summary');
    const items = deptoOf(all.body).items;
    // As ideias do cenário (anteriores aos campos) e as de quem não tem departamento ficam em "Não informado".
    const none = items.find((i) => i.optionId === null);
    expect(none?.label).toBeNull();
    expect(none?.count).toBeGreaterThan(0);
    expect(items.find((i) => i.label === 'Produção')?.count).toBe(2);
    expect(items.at(-1)?.optionId).toBeNull();
    // Gil só vê a Unidade B: nenhuma ideia de Maria entra.
    const gil = await c.gestorb!.get<Summary>(`/reports/summary?options=${opt('depto', 'Produção')}`);
    expect(gil.status).toBe(200);
    expect(gil.body.total).toBe(0);
    expect((await admin.get('/reports/summary?options=nao-e-uuid')).status).toBe(400);
  });

  it('CA-RN-201.4 a exportação tem uma coluna por campo fechado, com a neutralização de fórmula', async () => {
    await setDepto(s.uid.maria, '=CMD()');
    const code = await submit('maria', 'Com fórmula no departamento');
    const res = await admin.raw('/ideas/export.csv');
    expect(res.status).toBe(200);
    const lines = (await res.text()).split('\r\n');
    expect(lines[0]).toContain(';Departamento');
    expect(lines.find((l) => l.startsWith(code))).toContain(";'=CMD()");
    expect(lines.find((l) => l.startsWith(s.code.i1))).toContain(';Não informado');
  });

  it('CA-RN-201.5 campo aberto nunca aparece nos indicadores nem na exportação', async () => {
    const summary = await admin.get<Summary>('/reports/summary');
    expect(summary.body.byField.map((b) => b.labelPt)).toEqual(['Departamento']);
    const csv = await (await admin.raw('/ideas/export.csv')).text();
    for (const forbidden of ['Matrícula', 'Função', 'CPF', '4521', 'Operadora', '529.982']) {
      expect(csv, forbidden).not.toContain(forbidden);
    }
  });

  it('CA-RN-202.1 o módulo Usuários traz só os campos marcados, nunca o sensível', async () => {
    const reader = await createIntegration(admin, {
      name: 'RH',
      modules: ['users'],
      scope: [{ entityId: s.ent.org, includeChildren: true }],
    });
    const api = new IntegrationClient(t.baseUrl, reader.token);
    const res = await api.get<{ data: IntegrationUser[] }>('/users?limit=100');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const maria = res.body.data.find((u) => u.id === s.uid.maria)!;
    expect(maria.custom_fields.map((x) => [x.label, x.value])).toEqual([
      ['Departamento', '=CMD()'],
      ['Matrícula', '4521'],
    ]);
    const pedro = res.body.data.find((u) => u.id === s.uid.pedro)!;
    expect(pedro.custom_fields).toEqual([]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('529.982');
    expect(text).not.toContain('Operadora');
  });
});
