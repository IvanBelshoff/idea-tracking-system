import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildOpenApiDocument } from '../src/app.factory.js';
import { Client, createTestApp, type TestApp } from './support/test-app.js';

describe('Esqueleto da API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-93.3 GET /api/health responde 200 com status e banco, sem mais nada (mesmo antes da instalação)', async () => {
    const res = await new Client(t.baseUrl).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('CA-RN-93.4 com o banco fora, GET /api/health responde 503 com db "down"', async () => {
    const spy = vi.spyOn(t.app.get(DataSource), 'query').mockRejectedValue(new Error('conexão recusada'));
    const res = await new Client(t.baseUrl).get('/health');
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', db: 'down' });
    expect((await new Client(t.baseUrl).get('/health')).status).toBe(200);
  });

  it('o contrato OpenAPI descreve health, instalação, autenticação e a saúde operacional', () => {
    const document = buildOpenApiDocument(t.app);
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/health',
        '/api/install',
        '/api/install/status',
        '/api/auth/login',
        '/api/auth/me',
        '/api/ops/health',
      ]),
    );
    expect(document.components?.schemas).toHaveProperty('HealthResponse');
    expect(document.components?.schemas).toHaveProperty('MeResponse');
    expect(document.components?.schemas).toHaveProperty('OpsHealthReport');
  });
});
