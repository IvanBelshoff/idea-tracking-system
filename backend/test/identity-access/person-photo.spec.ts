import 'reflect-metadata';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScenario, type Scenario } from '../support/integration-support.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Person {
  id: string;
  name: string;
  photoVersion: string | null;
}
interface Comment {
  author: Person | null;
}

const jpeg = () =>
  sharp({ create: { width: 80, height: 80, channels: 3, background: '#b45309' } })
    .jpeg()
    .toBuffer();

describe('Avatar único: a versão da foto onde a pessoa aparece (M20, RN-142)', () => {
  let t: TestApp;
  let admin: Client;
  let maria: Client;
  let analista: Client;
  let s: Scenario;
  let version = '';

  const login = async (email: string) => {
    const client = new Client(t.baseUrl);
    expect((await client.post('/auth/login', { email, password: STRONG_PASSWORD })).status).toBe(200);
    return client;
  };

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    s = await buildScenario(t, admin);
    maria = await login('maria@example.test');
    analista = await login('analista@example.test');
    const up = await maria.upload<{ version: string }>(
      `/users/${s.uid.maria}/photo`,
      'maria.jpg',
      await jpeg(),
      'image/jpeg',
      'PUT',
    );
    expect(up.status).toBe(200);
    version = up.body.version;
  }, 180_000);
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-142.2 a lista e o detalhe de Usuários trazem a versão da foto (nula para quem não tem)', async () => {
    const list = await admin.get<{ items: Person[] }>('/users?pageSize=100');
    expect(list.status).toBe(200);
    const byId = new Map(list.body.items.map((u) => [u.id, u]));
    expect(byId.get(s.uid.maria as string)?.photoVersion).toBe(version);
    expect(byId.get(s.uid.pedro as string)?.photoVersion).toBeNull();
    expect((await admin.get<Person>(`/users/${s.uid.maria}`)).body.photoVersion).toBe(version);
  });

  it('CA-RN-142.2 o autor do comentário vem com a foto; ao comentar, a resposta já traz a versão', async () => {
    const made = await maria.post<Comment>(`/ideas/${s.code.i1}/comments`, { body: 'Com foto', visibility: 'public' });
    expect(made.status).toBe(201);
    expect(made.body.author?.photoVersion).toBe(version);
    const seen = (await analista.get<Comment[]>(`/ideas/${s.code.i1}/comments`)).body;
    expect(seen.find((c) => c.author?.id === s.uid.maria)?.author?.photoVersion).toBe(version);
  });

  it('CA-RN-142.4 com o opt-out de nome, a foto do comentário some para os outros, mas não para ela nem para quem administra (negativo)', async () => {
    expect((await maria.request('PATCH', '/auth/me/preferences', { hideName: true })).status).toBe(200);
    const of = async (who: Client) =>
      (await who.get<Comment[]>(`/ideas/${s.code.i1}/comments`)).body.find((c) => c.author?.id === s.uid.maria)?.author
        ?.photoVersion;
    expect(await of(analista)).toBeNull();
    expect(await of(maria)).toBe(version);
    expect(await of(admin)).toBe(version);
    // A rota da foto segue a mesma regra (CA-RN-91.5): a tela nunca pede uma foto que vai falhar.
    expect((await analista.raw(`/users/${s.uid.maria}/photo`)).status).toBe(404);
    expect((await maria.request('PATCH', '/auth/me/preferences', { hideName: false })).status).toBe(200);
    expect(await of(analista)).toBe(version);
  });
});
