import 'reflect-metadata';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Attachment } from '../../src/ideas/entities/attachment.entity.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Detail {
  id: string;
  code: string;
  steps: { id: string; position: number; attachmentsCount: number }[];
}
interface AttachmentView {
  id: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  deletable: boolean;
}

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const storageDir = () => join(process.env.STORAGE_DIR as string, 'attachments');
const storedFiles = () => (existsSync(storageDir()) ? readdirSync(storageDir()) : []);

describe('Anexos de etapa (M3, fatia 2; RN-21)', () => {
  let t: TestApp;
  let admin: Client;
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  let entityA1: string;
  let categoryId: string;

  async function user(key: string, roleKey: string, entityId: string) {
    const ds = t.db.dataSource;
    const u = await ds
      .getRepository(User)
      .save(
        ds
          .getRepository(User)
          .create({ email: `${key}@example.test`, name: key, passwordHash: await hashPassword(STRONG_PASSWORD) }),
      );
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: roleKey });
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId }));
    uid[key] = u.id;
    c[key] = new Client(t.baseUrl);
    expect((await c[key].post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  }

  async function approvedIdea(assignee = 'analista'): Promise<Detail> {
    const res = await c.analista!.post<Detail>('/ideas', {
      title: 'Ideia',
      description: 'x',
      entityId: entityA1,
      categoryId,
      approveNow: { stepName: 'Planejar', assigneeId: uid[assignee], dueDate: day(10) },
    });
    expect(res.status).toBe(201);
    return res.body;
  }
  const upload = (who: string, d: Detail, name: string, content: Buffer, type?: string) =>
    c[who]!.upload<AttachmentView>(`/ideas/${d.code}/steps/${d.steps[0]!.id}/attachments`, name, content, type);

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    const a = await tree.save(tree.create({ name: 'Unidade A', parent: org }));
    entityA1 = (await tree.save(tree.create({ name: 'Setor A1', parent: a }))).id;
    const b = (await tree.save(tree.create({ name: 'Unidade B', parent: org }))).id;
    categoryId = (
      await ds.getRepository(Category).save(ds.getRepository(Category).create({ name: 'Qualidade', color: '#4f46e5' }))
    ).id;
    await user('analista', 'analyst', a.id);
    await user('analistaB', 'analyst', b);
    await user('colab1', 'collaborator', entityA1);
    await user('gestor', 'manager', a.id);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('envia, lista e conta o anexo na etapa', async () => {
    const idea = await approvedIdea();
    const res = await upload('analista', idea, 'relatorio.pdf', Buffer.from('%PDF-1.4 conteúdo'));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ originalName: 'relatorio.pdf', mime: 'application/pdf', deletable: true });
    const list = await c.analista!.get<AttachmentView[]>(`/ideas/${idea.code}/steps/${idea.steps[0]!.id}/attachments`);
    expect(list.body.map((a) => a.originalName)).toEqual(['relatorio.pdf']);
    expect((await c.analista!.get<Detail>(`/ideas/${idea.code}`)).body.steps[0]!.attachmentsCount).toBe(1);
  });

  it('CA-RN-21.1 tipo fora da lista → 415; acima do tamanho máximo → 413', async () => {
    const idea = await approvedIdea();
    expect((await upload('analista', idea, 'virus.exe', Buffer.from('MZ'))).status).toBe(415);
    expect((await upload('analista', idea, 'sem-extensao', Buffer.from('x'))).status).toBe(415);
    await admin.request('PATCH', '/settings', { values: { 'attachments.max_mb': 1 } });
    expect((await upload('analista', idea, 'grande.pdf', Buffer.alloc(1024 * 1024 + 10))).status).toBe(413);
  });

  it('CA-RN-21.2 alterar o limite vale na requisição seguinte; extensões executáveis nunca entram na lista', async () => {
    const idea = await approvedIdea();
    await admin.request('PATCH', '/settings', { values: { 'attachments.max_mb': 1 } });
    expect((await upload('analista', idea, 'medio.pdf', Buffer.alloc(1536 * 1024))).status).toBe(413);
    await admin.request('PATCH', '/settings', { values: { 'attachments.max_mb': 2 } });
    expect((await upload('analista', idea, 'medio.pdf', Buffer.alloc(1536 * 1024))).status).toBe(201);

    await admin.request('PATCH', '/settings', { values: { 'attachments.allowed_extensions': ['pdf'] } });
    expect((await upload('analista', idea, 'foto.png', Buffer.from('png'))).status).toBe(415);
    expect(
      (await admin.request('PATCH', '/settings', { values: { 'attachments.allowed_extensions': ['pdf', 'exe'] } }))
        .status,
    ).toBe(400);
    await admin.request('PATCH', '/settings', {
      values: {
        'attachments.allowed_extensions': ['pdf', 'png', 'jpg', 'txt', 'csv', 'xlsx', 'docx', 'zip'],
        'attachments.max_mb': 10,
      },
    });
  });

  it('CA-RN-21.3 remover: etapa aberta com step.manage → ok; sem permissão → 403; etapa concluída → 409', async () => {
    const idea = await approvedIdea('colab1');
    // o responsável (colab1) anexa, mas não vê a ideia como equipe: só pela equipe ou se for o autor
    const first = await upload('analista', idea, 'a.pdf', Buffer.from('a'));
    const second = await upload('analista', idea, 'b.pdf', Buffer.from('b'));
    expect((await c.gestor!.request('DELETE', `/ideas/${idea.code}/attachments/${first.body.id}`)).status).toBe(403);
    expect((await c.analista!.request('DELETE', `/ideas/${idea.code}/attachments/${first.body.id}`)).status).toBe(204);
    await c.analista!.post(`/ideas/${idea.code}/steps/${idea.steps[0]!.id}/complete`);
    expect((await c.analista!.request('DELETE', `/ideas/${idea.code}/attachments/${second.body.id}`)).status).toBe(409);
    expect((await upload('analista', idea, 'depois.pdf', Buffer.from('c'))).status).toBe(409);
  });

  it('CA-RN-21.4 download respeita o escopo e nunca é público', async () => {
    const idea = await approvedIdea();
    const att = (await upload('analista', idea, 'planilha.csv', Buffer.from('a;b\n1;2'))).body;
    const path = `/ideas/${idea.code}/attachments/${att.id}/download`;
    const ok = await c.gestor!.raw(path);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('a;b\n1;2');
    expect((await c.analistaB!.raw(path)).status).toBe(404);
    expect((await c.colab1!.raw(path)).status).toBe(404);
    expect((await new Client(t.baseUrl).raw(path)).status).toBe(401);
  });

  it('CA-RN-21.5 nome normalizado no armazenamento; download sempre como arquivo, sem execução', async () => {
    const idea = await approvedIdea();
    const before = new Set(storedFiles());
    const res = await upload(
      'analista',
      idea,
      '../../etc/<script>passwd.txt',
      Buffer.from('<html><script>alert(1)</script>'),
      'text/html',
    );
    expect(res.status).toBe(201);
    expect(res.body.originalName).toBe('<script>passwd.txt');
    expect(res.body.mime).toBe('text/plain'); // pela extensão, não pelo que o navegador declarou
    const created = storedFiles().filter((f) => !before.has(f));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatch(/^[0-9a-f-]{36}\.txt$/);
    const row = await t.db.dataSource.getRepository(Attachment).findOneByOrFail({ id: res.body.id });
    expect(row.storedName).toBe(created[0]);

    const dl = await c.analista!.raw(`/ideas/${idea.code}/attachments/${res.body.id}/download`);
    expect(dl.headers.get('content-disposition')).toMatch(
      /^attachment; filename="_script_passwd\.txt"; filename\*=UTF-8''/,
    );
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(dl.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('excluir a etapa ou a ideia apaga também os arquivos', async () => {
    const idea = await approvedIdea();
    await c.analista!.post(`/ideas/${idea.code}/steps/${idea.steps[0]!.id}/complete`);
    const withSecond = (
      await c.analista!.post<Detail>(`/ideas/${idea.code}/steps`, {
        name: 'Executar',
        assigneeId: uid.analista,
        dueDate: day(20),
      })
    ).body;
    const second = withSecond.steps[1]!;
    const att = await c.analista!.upload<AttachmentView>(
      `/ideas/${idea.code}/steps/${second.id}/attachments`,
      'x.pdf',
      Buffer.from('x'),
    );
    const stored = (await t.db.dataSource.getRepository(Attachment).findOneByOrFail({ id: att.body.id })).storedName;
    expect(storedFiles()).toContain(stored);
    expect((await c.analista!.request('DELETE', `/ideas/${idea.code}/steps/${second.id}`)).status).toBe(200);
    expect(storedFiles()).not.toContain(stored);

    const other = await approvedIdea();
    const a2 = await upload('analista', other, 'y.pdf', Buffer.from('y'));
    const stored2 = (await t.db.dataSource.getRepository(Attachment).findOneByOrFail({ id: a2.body.id })).storedName;
    expect((await admin.request('DELETE', `/ideas/${other.code}`)).status).toBe(204);
    expect(storedFiles()).not.toContain(stored2);
  });
});
