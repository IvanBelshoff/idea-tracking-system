import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIntegrationOpenApiDocument, buildOpenApiDocument } from '../../src/app.factory.js';
import { breakingChanges } from '../../src/integration/contract-compat.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

type Json = Record<string, unknown>;
const doc = (paths: Json, schemas: Json = {}) => ({ openapi: '3.0.0', paths, components: { schemas } });

describe('Contrato da API de integração (M16, RN-106)', () => {
  let t: TestApp;
  let current: Json;
  beforeAll(async () => {
    t = await createTestApp();
    current = buildIntegrationOpenApiDocument(t.app) as unknown as Json;
  }, 60_000);
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-106.9 o OpenAPI da integração versionado está em dia com o código', () => {
    const file = JSON.parse(readFileSync(join(process.cwd(), 'openapi-integration.json'), 'utf8'));
    expect(JSON.parse(JSON.stringify(current)), 'rode `pnpm openapi:export` e revise a diferença').toEqual(file);
  });

  it('CA-RN-106.9 e CA-T.15 os dois contratos não se misturam', () => {
    const internal = buildOpenApiDocument(t.app) as unknown as { paths: Json };
    expect(Object.keys(internal.paths).filter((p) => p.startsWith('/integration'))).toEqual([]);
    const own = Object.keys((current as { paths: Json }).paths);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((p) => p.startsWith('/integration/v1/'))).toBe(true);
  });

  it('CA-RN-106.10 contrato congelado: acréscimo passa; remover ou mudar o que existe quebra', () => {
    const page = { $ref: '#/components/schemas/Page' };
    const base = doc(
      {
        '/integration/v1/ideas': {
          get: {
            parameters: [{ name: 'limit', in: 'query', required: false }],
            responses: { 200: { content: { 'application/json': { schema: page } } } },
          },
        },
      },
      {
        Page: {
          type: 'object',
          required: ['data'],
          properties: {
            data: { type: 'array', items: { type: 'string' } },
            next_cursor: { type: 'string', nullable: true },
          },
        },
      },
    );
    expect(breakingChanges(base, base)).toEqual([]);
    // Só acréscimos: rota nova, parâmetro opcional novo e campo novo.
    const added = structuredClone(base) as ReturnType<typeof doc> & { paths: Json };
    added.paths['/integration/v1/novo'] = { get: { responses: {} } };
    (added.paths['/integration/v1/ideas'] as { get: { parameters: unknown[] } }).get.parameters.push({
      name: 'x',
      in: 'query',
      required: false,
    });
    (added.components.schemas.Page as { properties: Json }).properties.extra = { type: 'string' };
    expect(breakingChanges(base, added)).toEqual([]);

    const removedRoute = doc({}, base.components.schemas);
    expect(breakingChanges(base, removedRoute)).toEqual(['Rota removida: /integration/v1/ideas']);

    const removedField = structuredClone(base) as ReturnType<typeof doc>;
    delete (removedField.components.schemas.Page as { properties: Json }).properties.next_cursor;
    expect(breakingChanges(base, removedField)).toEqual(['Campo removido: GET /integration/v1/ideas.next_cursor']);

    const changedType = structuredClone(base) as ReturnType<typeof doc>;
    (changedType.components.schemas.Page as { properties: Json }).properties.next_cursor = {
      type: 'integer',
      nullable: true,
    };
    expect(breakingChanges(base, changedType)).toEqual([
      'Tipo mudou em GET /integration/v1/ideas.next_cursor: string? → integer?',
    ]);

    const requiredParam = structuredClone(base) as ReturnType<typeof doc>;
    (requiredParam.paths['/integration/v1/ideas'] as { get: { parameters: unknown[] } }).get.parameters.push({
      name: 'y',
      in: 'query',
      required: true,
    });
    expect(breakingChanges(base, requiredParam)).toEqual([
      'Parâmetro novo obrigatório: GET /integration/v1/ideas query:y',
    ]);

    const droppedParam = structuredClone(base) as ReturnType<typeof doc>;
    (droppedParam.paths['/integration/v1/ideas'] as { get: { parameters: unknown[] } }).get.parameters = [];
    expect(breakingChanges(base, droppedParam)).toEqual(['Parâmetro removido: GET /integration/v1/ideas query:limit']);
  });

  it('CA-RN-106.10 o contrato atual não quebra o de referência', () => {
    const file = JSON.parse(readFileSync(join(process.cwd(), 'openapi-integration.json'), 'utf8'));
    expect(breakingChanges(file, current)).toEqual([]);
  });

  it('CA-RN-115.11 toda rota, parâmetro e campo do contrato tem descrição em inglês e em pt-BR', () => {
    const missing: string[] = [];
    const both = (node: Json, where: string) => {
      if (typeof node.description !== 'string' || node.description.trim() === '')
        missing.push(`${where}: falta description (en)`);
      if (typeof node['x-description-pt-BR'] !== 'string' || (node['x-description-pt-BR'] as string).trim() === '') {
        missing.push(`${where}: falta x-description-pt-BR`);
      }
    };
    const paths = (current as { paths: Record<string, Record<string, Json>> }).paths;
    for (const [path, item] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(item)) {
        both(op, `${method.toUpperCase()} ${path}`);
        for (const p of (op.parameters as Json[] | undefined) ?? [])
          both(p, `${method.toUpperCase()} ${path} ${String(p.in)}:${String(p.name)}`);
      }
    }
    const schemas = (current as { components: { schemas: Record<string, Json> } }).components.schemas ?? {};
    for (const [name, schema] of Object.entries(schemas)) {
      if (name === 'ApiErrorBody') continue; // formato de erro, o mesmo da API interna
      for (const [field, prop] of Object.entries((schema.properties as Record<string, Json> | undefined) ?? {})) {
        both(prop, `${name}.${field}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
