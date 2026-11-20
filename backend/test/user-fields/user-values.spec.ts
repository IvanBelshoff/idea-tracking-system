import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User, UserStatus } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { UserFieldValue } from '../../src/user-fields/entities.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface FieldValue {
  id: string;
  value: string | null;
  optionId: string | null;
  editable: boolean;
  options: { id: string; label: string; active: boolean }[];
}
interface Form {
  missing: string[];
  fields: FieldValue[];
}
interface Field {
  id: string;
  options: { id: string; label: string }[];
}
interface ErrorBody {
  code: string;
  details?: { path: string; message: string }[];
}
interface UserPage {
  items: { id: string; name: string; incomplete: boolean }[];
  incompleteTotal: number;
}
interface Person {
  id: string;
  name: string;
  fields: { labelPt: string; value: string }[];
}

describe('Campos personalizados: valores, trava, obrigatório, busca e privacidade (M25, RN-196 a RN-200)', () => {
  let t: TestApp;
  let admin: Client;
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  const f: Record<string, Field> = {};
  let entityId: string;

  async function person(key: string, roleKey: string) {
    const ds = t.db.dataSource;
    const u = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `${key}@empresa.com.br`,
        name: `Pessoa ${key}`,
        passwordHash: await hashPassword(STRONG_PASSWORD),
      }),
    );
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: roleKey });
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId }));
    uid[key] = u.id;
    c[key] = new Client(t.baseUrl);
    expect(
      (await c[key].post('/auth/login', { email: `${key}@empresa.com.br`, password: STRONG_PASSWORD })).status,
    ).toBe(200);
  }
  const field = async (key: string, body: Record<string, unknown>) => {
    const res = await admin.post<Field>('/user-fields', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    f[key] = res.body;
    return res.body;
  };
  const saveMine = (who: string, values: Record<string, unknown>[]) =>
    c[who]!.request<Form & ErrorBody>('PUT', '/me/fields', { values });
  const saveFor = (who: string, values: Record<string, unknown>[]) =>
    admin.request<Form & ErrorBody>('PUT', `/users/${uid[who]}/fields`, { values });

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    entityId = (await t.db.dataSource.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;
    await person('colab', 'collaborator');
    await person('bia', 'collaborator');
    await person('ana', 'analyst');
    await field('matricula', {
      labelPt: 'Matrícula',
      kind: 'mask',
      config: { preset: 'custom', pattern: '9999' },
      uniqueValues: true,
      adminLocked: true,
    });
    await field('cpf', { labelPt: 'CPF', kind: 'mask', config: { preset: 'cpf' }, sensitive: true, searchable: true });
    await field('depto', { labelPt: 'Departamento', kind: 'choice', options: ['Manutenção', 'Produção', 'Logística'] });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-196.1 a pessoa altera os próprios valores; os de outra pessoa → 403', async () => {
    const res = await saveMine('colab', [
      { fieldId: f.matricula!.id, value: '4521' },
      { fieldId: f.cpf!.id, value: '52998224725' },
      { fieldId: f.depto!.id, optionId: f.depto!.options[0]!.id },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byId = new Map(res.body.fields.map((x) => [x.id, x]));
    expect(byId.get(f.cpf!.id)?.value).toBe('529.982.247-25');
    expect(byId.get(f.depto!.id)?.optionId).toBe(f.depto!.options[0]!.id);
    expect((await c.colab!.get(`/users/${uid.bia}/fields`)).status).toBe(403);
    expect((await c.colab!.request('PUT', `/users/${uid.bia}/fields`, { values: [] })).status).toBe(403);
  });

  it('CA-RN-194.2 valor fora do tipo → 422 apontando o campo; opção de outro campo → 422', async () => {
    const bad = await saveMine('bia', [{ fieldId: f.cpf!.id, value: '111.111.111-11' }]);
    expect(bad.status).toBe(422);
    expect(bad.body.details?.[0]?.path).toBe('values.0');
    expect((await saveMine('bia', [{ fieldId: f.matricula!.id, value: '45A1' }])).status).toBe(422);
    expect((await saveMine('bia', [{ fieldId: f.depto!.id, optionId: f.cpf!.id }])).status).toBe(422);
  });

  it('CA-RN-194.3 valor único: outra pessoa com a mesma matrícula → 409', async () => {
    const dup = await saveMine('bia', [{ fieldId: f.matricula!.id, value: '4521' }]);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('custom_field_duplicate');
    expect((await saveMine('bia', [{ fieldId: f.matricula!.id, value: '7788' }])).status).toBe(200);
  });

  it('CA-RN-196.3 só a administração altera depois de preenchido; CA-RN-196.2 com auditoria e sem o valor', async () => {
    const mine = await c.colab!.get<Form>('/me/fields');
    expect(mine.body.fields.find((x) => x.id === f.matricula!.id)?.editable).toBe(false);
    const locked = await saveMine('colab', [{ fieldId: f.matricula!.id, value: '9999' }]);
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe('custom_field_locked');
    const byAdmin = await saveFor('colab', [
      { fieldId: f.matricula!.id, value: '4522' },
      { fieldId: f.cpf!.id, value: '390.533.447-05' },
    ]);
    expect(byAdmin.status, JSON.stringify(byAdmin.body)).toBe(200);
    expect(byAdmin.body.fields.find((x) => x.id === f.matricula!.id)?.editable).toBe(true);
    const audit = await t.db.dataSource
      .getRepository(AuditLog)
      .findOneByOrFail({ action: 'user_field.values_changed', targetId: uid.colab });
    expect(audit.data).toEqual({ fields: ['Matrícula', 'CPF'] });
    // CA-T.29: o valor do campo sensível nunca vai para a auditoria.
    const all = JSON.stringify(await t.db.dataSource.getRepository(AuditLog).find());
    expect(all).not.toContain('390.533.447-05');
    expect(all).not.toContain('39053344705');
  });

  it('CA-RN-195.2 a opção desativada continua com quem a tem, mas ninguém a escolhe de novo', async () => {
    const logistica = f.depto!.options[2]!;
    expect((await saveMine('bia', [{ fieldId: f.depto!.id, optionId: logistica.id }])).status).toBe(200);
    await admin.request('PATCH', `/user-fields/${f.depto!.id}/options/${logistica.id}`, { active: false });
    const bia = await c.bia!.get<Form>('/me/fields');
    const depto = bia.body.fields.find((x) => x.id === f.depto!.id);
    expect(depto?.optionId).toBe(logistica.id);
    expect(depto?.options.find((o) => o.id === logistica.id)).toMatchObject({ active: false });
    const colab = await c.colab!.get<Form>('/me/fields');
    expect(colab.body.fields.find((x) => x.id === f.depto!.id)?.options.map((o) => o.label)).toEqual([
      'Manutenção',
      'Produção',
    ]);
    // CA-RN-195.3: escolher a desativada sem tê-la → 422.
    expect((await saveMine('colab', [{ fieldId: f.depto!.id, optionId: logistica.id }])).status).toBe(422);
  });

  it('CA-RN-200.1 e 200.2 o seletor de pessoas acha pela matrícula e mostra o valor; o CPF (sensível) fica fora', async () => {
    const found = await c.ana!.get<Person[]>('/ideas/people?search=4522');
    expect(found.status).toBe(200);
    expect(found.body.map((p) => p.id)).toEqual([uid.colab]);
    expect(found.body[0]?.fields).toEqual([{ labelPt: 'Matrícula', labelEn: null, value: '4522' }]);
    expect((await c.ana!.get<Person[]>('/ideas/people?search=390.533')).body).toEqual([]);
    expect((await c.ana!.get<Person[]>('/ideas/people?search=39053344705')).body).toEqual([]);
    expect(JSON.stringify((await c.ana!.get<Person[]>('/ideas/people?search=Pessoa')).body)).not.toContain('390.533');
  });

  it('CA-RN-200.3 na lista de usuários: busca pelo CPF (sensível, com user.manage) e filtro por opção', async () => {
    const byCpf = await admin.get<UserPage>('/users?search=39053344705');
    expect(byCpf.body.items.map((u) => u.id)).toEqual([uid.colab]);
    const byOption = await admin.get<UserPage>(`/users?options=${f.depto!.options[0]!.id}`);
    expect(byOption.body.items.map((u) => u.id)).toEqual([uid.colab]);
    expect((await admin.get<UserPage>(`/users?options=${f.depto!.options[1]!.id}`)).body.items).toEqual([]);
  });

  it('CA-RN-199.1 sem user.manage, os valores de outra pessoa não saem', async () => {
    expect((await c.ana!.get(`/users/${uid.colab}/fields`)).status).toBe(403);
    expect((await c.ana!.get(`/users?search=4522`)).status).toBe(403);
  });

  it('CA-RN-197.2 com obrigatório vazio: 428 nas outras rotas; a própria conta, os campos e sair respondem', async () => {
    await admin.request('PATCH', `/user-fields/${f.depto!.id}`, { required: true });
    // ana não tem departamento.
    const blocked = await c.ana!.get<ErrorBody & { details: { missing: string[] } }>('/ideas/mine');
    expect(blocked.status).toBe(428);
    expect(blocked.body.code).toBe('profile_incomplete');
    const me = await c.ana!.get<{ missingFields: number }>('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.missingFields).toBe(1);
    expect((await c.ana!.get<Form>('/me/fields')).body.missing).toEqual([f.depto!.id]);
    expect((await c.ana!.get('/settings/public')).status).toBe(200);
    // Quem já preencheu segue normal.
    expect((await c.colab!.get('/ideas/mine')).status).toBe(200);
    // Não dá para apagar o obrigatório.
    expect((await saveMine('colab', [{ fieldId: f.depto!.id, optionId: null }])).status).toBe(422);
  });

  it('CA-RN-197.3 preencher libera na hora', async () => {
    expect((await saveMine('ana', [{ fieldId: f.depto!.id, optionId: f.depto!.options[1]!.id }])).status).toBe(200);
    expect((await c.ana!.get('/ideas/mine')).status).toBe(200);
    expect((await c.ana!.get<{ missingFields: number }>('/auth/me')).body.missingFields).toBe(0);
  });

  it('CA-RN-197.4 quem tem setting.manage não recebe o 428', async () => {
    const me = await admin.get<{ missingFields: number }>('/auth/me');
    expect(me.body.missingFields).toBe(1);
    expect((await admin.get('/users')).status).toBe(200);
  });

  it('CA-RN-197.5 criar um usuário pela administração sem os obrigatórios é aceito', async () => {
    const res = await admin.post('/users', { name: 'Nova Pessoa', email: 'nova@empresa.com.br' });
    expect(res.status).toBe(201);
  });

  it('CA-RN-198.1 e 198.2 a lista marca os incompletos, filtra e conta; anonimizado não conta', async () => {
    const page = await admin.get<UserPage>('/users?pageSize=100');
    const incomplete = page.body.items.filter((u) => u.incomplete).map((u) => u.name);
    expect(incomplete).toEqual(expect.arrayContaining(['Nova Pessoa']));
    expect(incomplete).not.toContain('Pessoa colab');
    const only = await admin.get<UserPage>('/users?incomplete=true&pageSize=100');
    expect(only.body.items.every((u) => u.incomplete)).toBe(true);
    expect(only.body.incompleteTotal).toBe(only.body.items.length);
    const before = only.body.incompleteTotal;
    // Anonimizar quem estava incompleto tira da contagem e apaga os valores (CA-RN-199.3).
    const nova = only.body.items.find((u) => u.name === 'Nova Pessoa')!;
    await t.db.dataSource.getRepository(User).update(nova.id, { status: UserStatus.Disabled });
    expect((await admin.post(`/users/${nova.id}/anonymize`, {})).status).toBe(200);
    expect((await admin.get<UserPage>('/users?incomplete=true')).body.incompleteTotal).toBe(before - 1);
  });

  it('CA-RN-199.3 anonimizar apaga todos os valores da pessoa', async () => {
    expect(await t.db.dataSource.getRepository(UserFieldValue).countBy({ userId: uid.bia })).toBeGreaterThan(0);
    await t.db.dataSource.getRepository(User).update(uid.bia!, { status: UserStatus.Disabled });
    expect((await admin.post(`/users/${uid.bia}/anonymize`, {})).status).toBe(200);
    expect(await t.db.dataSource.getRepository(UserFieldValue).countBy({ userId: uid.bia })).toBe(0);
  });
});
