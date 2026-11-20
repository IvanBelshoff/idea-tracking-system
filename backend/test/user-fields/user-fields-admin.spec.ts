import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { UserFieldValue } from '../../src/user-fields/entities.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Option {
  id: string;
  label: string;
  active: boolean;
  inUse: boolean;
}
interface Field {
  id: string;
  labelPt: string;
  labelEn: string | null;
  kind: string;
  config: Record<string, unknown>;
  searchable: boolean;
  sensitive: boolean;
  uniqueValues: boolean;
  active: boolean;
  inUse: boolean;
  options: Option[];
}
interface ErrorBody {
  code: string;
  details?: { path: string }[];
}

describe('Campos personalizados: administração dos campos (M25, RN-193 a RN-195, RN-199)', () => {
  let t: TestApp;
  let admin: Client;
  let analyst: Client;
  const users: string[] = [];

  const create = (body: Record<string, unknown>) => admin.post<Field & ErrorBody>('/user-fields', body);
  const update = (id: string, body: Record<string, unknown>) =>
    admin.request<Field & ErrorBody>('PATCH', `/user-fields/${id}`, body);
  /** Grava um valor direto no banco (a tela e a rota dos valores chegam na fatia 2). */
  const putValue = async (fieldId: string, userId: string, value: string | null, optionId: string | null = null) => {
    const repo = t.db.dataSource.getRepository(UserFieldValue);
    await repo.save(repo.create({ fieldId, userId, value, optionId }));
  };

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const entityId = (await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: 'analyst' });
    for (const key of ['ana', 'bia', 'caio']) {
      const u = await ds.getRepository(User).save(
        ds.getRepository(User).create({
          email: `${key}@empresa.com.br`,
          name: `Pessoa ${key}`,
          passwordHash: await hashPassword(STRONG_PASSWORD),
        }),
      );
      await ds
        .getRepository(UserRoleScope)
        .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId }));
      users.push(u.id);
    }
    analyst = new Client(t.baseUrl);
    expect((await analyst.post('/auth/login', { email: 'ana@empresa.com.br', password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-193.1 quem tem user.manage cria um campo aberto e um fechado; sem a permissão → 403; tudo na auditoria', async () => {
    const open = await create({
      labelPt: 'Matrícula',
      labelEn: 'Employee ID',
      kind: 'mask',
      config: { preset: 'custom', pattern: 'AA-9999' },
      uniqueValues: true,
    });
    expect(open.status, JSON.stringify(open.body)).toBe(201);
    expect(open.body).toMatchObject({ kind: 'mask', searchable: true, active: true, inUse: false });
    expect(open.body.config).toEqual({ preset: 'custom', pattern: 'AA-9999' });

    const closed = await create({ labelPt: 'Departamento', kind: 'choice', options: ['Manutenção', 'Produção'] });
    expect(closed.status).toBe(201);
    expect(closed.body.options.map((o) => o.label)).toEqual(['Manutenção', 'Produção']);
    expect(closed.body.searchable).toBe(false);

    expect((await analyst.post('/user-fields', { labelPt: 'X', kind: 'text' })).status).toBe(403);
    expect((await analyst.get('/user-fields')).status).toBe(403);

    expect((await update(closed.body.id, { labelPt: 'Setor de trabalho' })).status).toBe(200);
    expect((await update(closed.body.id, { active: false })).status).toBe(200);
    expect((await update(closed.body.id, { active: true })).status).toBe(200);
    const actions = (await t.db.dataSource.getRepository(AuditLog).findBy({ targetType: 'user_field' })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'user_field.created',
        'user_field.updated',
        'user_field.deactivated',
        'user_field.activated',
      ]),
    );
  });

  it('CA-RN-193.2 o 9º campo ativo → 422; desativar um libera a vaga', async () => {
    const current = (await admin.get<Field[]>('/user-fields')).body.filter((f) => f.active).length;
    const ids: string[] = [];
    for (let i = current; i < 8; i++) {
      const res = await create({ labelPt: `Extra ${i}`, kind: 'text' });
      expect(res.status).toBe(201);
      ids.push(res.body.id);
    }
    const ninth = await create({ labelPt: 'Nono', kind: 'text' });
    expect(ninth.status).toBe(422);
    expect(ninth.body.code).toBe('custom_field_limit');
    expect((await update(ids[0]!, { active: false })).status).toBe(200);
    const again = await create({ labelPt: 'Nono', kind: 'text' });
    expect(again.status).toBe(201);
    // Reativar com 8 ativos também é recusado.
    expect((await update(ids[0]!, { active: true })).body.code).toBe('custom_field_limit');
    // Limpa para os próximos testes.
    for (const id of [...ids.slice(1), again.body.id])
      expect((await admin.request('DELETE', `/user-fields/${id}`)).status).toBe(204);
    expect((await admin.request('DELETE', `/user-fields/${ids[0]}`)).status).toBe(204);
  });

  it('CA-RN-193.3 nome vazio ou acima de 60 e dica acima de 200 → 422; sem inglês, fica nulo', async () => {
    expect((await create({ labelPt: '', kind: 'text' })).status).toBe(422);
    expect((await create({ labelPt: 'x'.repeat(61), kind: 'text' })).status).toBe(422);
    expect((await create({ labelPt: 'Função', hintPt: 'x'.repeat(201), kind: 'text' })).status).toBe(422);
    const ok = await create({ labelPt: 'Função', kind: 'text' });
    expect(ok.body.labelEn).toBeNull();
    expect((await admin.request('DELETE', `/user-fields/${ok.body.id}`)).status).toBe(204);
  });

  it('a configuração errada de cada tipo e opções inválidas na criação → 422', async () => {
    const pattern = await create({ labelPt: 'Código', kind: 'mask', config: { preset: 'custom', pattern: '--' } });
    expect(pattern.status).toBe(422);
    expect(pattern.body.details?.[0]?.path).toBe('config.pattern');
    expect((await create({ labelPt: 'Faixa', kind: 'text', config: { min: 9, max: 3 } })).status).toBe(422);
    expect((await create({ labelPt: 'Turno', kind: 'choice', options: [] })).body.code).toBe(
      'custom_field_options_required',
    );
    expect((await create({ labelPt: 'Turno', kind: 'choice', options: ['A', 'a'] })).status).toBe(422);
    expect((await create({ labelPt: 'Turno', kind: 'choice', uniqueValues: true, options: ['A'] })).status).toBe(422);
    expect(
      (await create({ labelPt: 'CPF', kind: 'mask', config: { preset: 'cpf' }, sensitive: true, integration: true }))
        .status,
    ).toBe(422);
  });

  it('CA-RN-195.1 opções: mais de 100, repetida ou acima de 80 caracteres → 422', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `Opção ${i}`);
    expect((await create({ labelPt: 'Muitas', kind: 'choice', options: many })).status).toBe(422);
    const field = await create({ labelPt: 'Turno', kind: 'choice', options: ['Manhã'] });
    expect((await admin.post<ErrorBody>(`/user-fields/${field.body.id}/options`, { label: 'manhã' })).status).toBe(422);
    expect((await admin.post(`/user-fields/${field.body.id}/options`, { label: 'x'.repeat(81) })).status).toBe(422);
    const added = await admin.post<Field>(`/user-fields/${field.body.id}/options`, { label: 'Tarde' });
    expect(added.status).toBe(201);
    expect(added.body.options.map((o) => o.label)).toEqual(['Manhã', 'Tarde']);
    const [manha, tarde] = added.body.options;
    const order = await admin.request<Field>('PUT', `/user-fields/${field.body.id}/options/order`, {
      ids: [tarde!.id, manha!.id],
    });
    expect(order.body.options.map((o) => o.label)).toEqual(['Tarde', 'Manhã']);
    expect(
      (await admin.request('PUT', `/user-fields/${field.body.id}/options/order`, { ids: [tarde!.id] })).status,
    ).toBe(422);
    await admin.request('DELETE', `/user-fields/${field.body.id}`);
  });

  it('CA-RN-195.2 a opção escolhida não é excluída, só desativada, e a última ativa não sai', async () => {
    const field = await create({ labelPt: 'Unidade', kind: 'choice', options: ['Fábrica 1', 'Fábrica 2'] });
    const [f1, f2] = field.body.options;
    await putValue(field.body.id, users[0]!, null, f1!.id);
    const blocked = await admin.request<ErrorBody>('DELETE', `/user-fields/${field.body.id}/options/${f1!.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('custom_field_option_in_use');
    const off = await admin.request<Field>('PATCH', `/user-fields/${field.body.id}/options/${f1!.id}`, {
      active: false,
    });
    expect(off.body.options.find((o) => o.id === f1!.id)).toMatchObject({ active: false, inUse: true });
    const last = await admin.request<ErrorBody>('PATCH', `/user-fields/${field.body.id}/options/${f2!.id}`, {
      active: false,
    });
    expect(last.body.code).toBe('custom_field_options_required');
    // O valor de quem já tinha a opção continua lá.
    expect(await t.db.dataSource.getRepository(UserFieldValue).countBy({ optionId: f1!.id })).toBe(1);
  });

  it('a máscara livre aceita espaço no meio, como um telefone "(99) 99999-9999"', async () => {
    const phone = await create({
      labelPt: 'Celular',
      kind: 'mask',
      config: { preset: 'custom', pattern: '(99) 99999-9999' },
    });
    expect(phone.status, JSON.stringify(phone.body)).toBe(201);
    expect(phone.body.config).toEqual({ preset: 'custom', pattern: '(99) 99999-9999' });
    expect((await admin.request('DELETE', `/user-fields/${phone.body.id}`)).status).toBe(204);
  });

  it('CA-RN-194.3 ligar "valor único" com repetidos → 409; sem repetidos, liga (comparando sem pontuação)', async () => {
    const field = await create({ labelPt: 'Crachá', kind: 'mask', config: { preset: 'custom', pattern: 'AA-9999' } });
    await putValue(field.body.id, users[0]!, 'AB-1234');
    await putValue(field.body.id, users[1]!, 'ab-1234');
    const dup = await update(field.body.id, { uniqueValues: true });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('custom_field_duplicate');
    await t.db.dataSource
      .getRepository(UserFieldValue)
      .update({ userId: users[1]!, fieldId: field.body.id }, { value: 'CD-9999' });
    expect((await update(field.body.id, { uniqueValues: true })).status).toBe(200);
    const keys = (await t.db.dataSource.getRepository(UserFieldValue).findBy({ fieldId: field.body.id })).map(
      (v) => v.uniqueKey,
    );
    expect(keys.sort()).toEqual(['ab1234', 'cd9999']);
  });

  it('CA-RN-194.4 mudar a máscara ou os limites não apaga os valores que já existem', async () => {
    const field = await create({ labelPt: 'Ramal', kind: 'text', config: { max: 10 } });
    await putValue(field.body.id, users[0]!, '12345678');
    expect((await update(field.body.id, { config: { max: 4 } })).status).toBe(200);
    expect(await t.db.dataSource.getRepository(UserFieldValue).findOneBy({ fieldId: field.body.id })).toMatchObject({
      value: '12345678',
    });
  });

  it('CA-RN-199.4 desativar guarda os valores; excluir com valor → 409; mudar o tipo com valor → 409', async () => {
    const field = await create({ labelPt: 'Função', kind: 'text' });
    expect((await update(field.body.id, { kind: 'number' })).status).toBe(200);
    expect((await update(field.body.id, { kind: 'text' })).status).toBe(200);
    await putValue(field.body.id, users[2]!, 'Operador');
    const kind = await update(field.body.id, { kind: 'number' });
    expect(kind.status).toBe(409);
    expect(kind.body.code).toBe('custom_field_has_values');
    const del = await admin.request<ErrorBody>('DELETE', `/user-fields/${field.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('custom_field_in_use');
    expect((await update(field.body.id, { active: false })).body).toMatchObject({ active: false, inUse: true });
    expect(await t.db.dataSource.getRepository(UserFieldValue).countBy({ fieldId: field.body.id })).toBe(1);
    expect((await update(field.body.id, { active: true })).body.active).toBe(true);
  });

  it('a ordem dos campos precisa trazer todos, uma vez cada', async () => {
    const all = (await admin.get<Field[]>('/user-fields')).body;
    const reversed = all.map((f) => f.id).reverse();
    const ok = await admin.request<Field[]>('PUT', '/user-fields/order', { ids: reversed });
    expect(ok.status).toBe(200);
    expect(ok.body.map((f) => f.id)).toEqual(reversed);
    expect((await admin.request('PUT', '/user-fields/order', { ids: reversed.slice(1) })).status).toBe(422);
  });
});
