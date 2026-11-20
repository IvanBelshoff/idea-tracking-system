import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { FACTORY_ROLES } from '../../src/identity-access/factory-roles.js';
import { Client, createTestApp, INSTALL_INPUT, type TestApp } from '../support/test-app.js';

describe('Perfis de fábrica no idioma da instalação (RN-43, M28)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-43.4 instalação em inglês cria os perfis em inglês, sem tocar num perfil já editado', async () => {
    const roles = t.db.dataSource.getRepository(Role);
    // Antes do assistente, os perfis nascem em pt-BR com o banco.
    const before = await roles.findOneByOrFail({ systemKey: 'collaborator' });
    expect(before.name).toBe('Colaborador');
    // Um perfil editado (só a descrição) não é traduzido: o ITS nunca apaga uma edição.
    await roles.update({ systemKey: 'manager' }, { description: 'Descrição própria da organização.' });

    const res = await new Client(t.baseUrl).post('/install', { ...INSTALL_INPUT, locale: 'en' });
    expect(res.status).toBe(200);

    const byKey = Object.fromEntries((await roles.find()).map((r) => [r.systemKey, r]));
    for (const def of FACTORY_ROLES.filter((d) => d.key !== 'manager')) {
      expect(byKey[def.key]?.name).toBe(def.en.name);
      expect(byKey[def.key]?.description).toBe(def.en.description);
    }
    expect(byKey.manager?.name).toBe('Gestor');
    expect(byKey.manager?.description).toBe('Descrição própria da organização.');
    // As permissões não mudam com o idioma.
    const admin = await roles.findOneOrFail({ where: { systemKey: 'admin' }, relations: { permissions: true } });
    expect(admin.permissions.length).toBeGreaterThan(0);
  });
});
