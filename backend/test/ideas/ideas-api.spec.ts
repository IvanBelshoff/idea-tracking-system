import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { Idea } from '../../src/ideas/entities/idea.entity.js';
import { IdeaEvent } from '../../src/ideas/entities/idea-related.entity.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User, UserStatus } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Detail {
  id: string;
  code: string;
  title: string;
  status: string;
  author: { id: string; name: string } | null;
  registeredBy: { id: string; name: string } | null;
  assignedTo: { id: string; name: string } | null;
  rejectionReason: string | null;
  externalRef: string | null;
  steps: { position: number; assignee: { id: string } }[];
  can: { edit: boolean; triage: boolean };
}
interface Page {
  items: { code: string; title: string; status: string }[];
  meta: { total: number };
}
interface Event {
  type: string;
  actor: { name: string } | null;
  reason: string | null;
  data: Record<string, unknown>;
  visibility: string;
}

describe('API de ideias (M2, fatia 2)', () => {
  let t: TestApp;
  let admin: Client;
  const ent: Record<string, string> = {};
  const cat: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  async function entity(name: string, parentId: string | null) {
    const repo = t.db.dataSource.getTreeRepository(OrgEntity);
    const parent = parentId ? await repo.findOneByOrFail({ id: parentId }) : null;
    return (await repo.save(repo.create({ name, parent }))).id;
  }
  async function user(key: string, grants: [string, string][]) {
    const ds = t.db.dataSource;
    const u = await ds
      .getRepository(User)
      .save(
        ds
          .getRepository(User)
          .create({ email: `${key}@example.test`, name: key, passwordHash: await hashPassword(STRONG_PASSWORD) }),
      );
    for (const [roleKey, entityId] of grants) {
      const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: roleKey });
      await ds
        .getRepository(UserRoleScope)
        .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId }));
    }
    uid[key] = u.id;
    const client = new Client(t.baseUrl);
    expect((await client.post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(
      200,
    );
    c[key] = client;
  }
  const submit = (who: string, body: Record<string, unknown>) =>
    c[who]!.post<Detail>('/ideas', {
      title: 'Reduzir retrabalho na linha 2',
      description: 'Muito retrabalho no turno da noite.',
      entityId: ent.A1,
      categoryId: cat.Qualidade,
      ...body,
    });
  const approveBody = (assignee: string) => ({ stepName: 'Planejar', assigneeId: uid[assignee], dueDate: tomorrow });

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    c.admin = admin;
    const ds = t.db.dataSource;
    ent.org = (await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;
    ent.A = await entity('Unidade A', ent.org);
    ent.A1 = await entity('Setor A1', ent.A);
    ent.B = await entity('Unidade B', ent.org);
    for (const name of ['Segurança', 'Qualidade']) {
      cat[name] = (
        await ds.getRepository(Category).save(ds.getRepository(Category).create({ name, color: '#4f46e5' }))
      ).id;
    }
    await user('colab1', [['collaborator', ent.A1]]);
    await user('colab2', [['collaborator', ent.A1]]);
    await user('colab3', [['collaborator', ent.B]]);
    await user('analista', [['analyst', ent.A]]);
    await user('gestor', [['manager', ent.A]]);
    await user('misto', [
      ['analyst', ent.A],
      ['collaborator', ent.B],
    ]);
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('envio (RN-02 a RN-04)', () => {
    it('CA-RN-02.1 colaborador envia: status Enviada, autor = ele, identificador gerado', async () => {
      const res = await submit('colab1', {});
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('submitted');
      expect(res.body.author?.id).toBe(uid.colab1);
      expect(res.body.code).toMatch(/^ITS-\d{4}-0001$/);
    });

    it('CA-RN-02.2 autor informado no corpo é ignorado', async () => {
      const res = await submit('colab1', { authorId: uid.colab2, author: uid.colab2 });
      expect(res.body.author?.id).toBe(uid.colab1);
    });

    it('CA-RN-02.3 usuário desativado não envia (sessão encerrada → 401)', async () => {
      await user('temporario', [['collaborator', ent.A1 as string]]);
      await t.db.dataSource.getRepository(User).update(uid.temporario!, { status: UserStatus.Disabled });
      expect((await submit('temporario', {})).status).toBe(401);
    });

    it('CA-RN-03.1 sem título, descrição ou entidade → 422 com o campo indicado', async () => {
      for (const field of ['title', 'description', 'entityId']) {
        const res = await submit('colab1', { [field]: undefined });
        expect(res.status).toBe(422);
        expect(JSON.stringify(res.body)).toContain(field);
      }
    });

    it('CA-RN-03.2 / CA-RN-24.3 categoria obrigatória quando configurado; desligado, aceita; secundárias opcionais', async () => {
      expect((await submit('colab1', { categoryId: null })).status).toBe(422);
      await admin.request('PATCH', '/settings', { values: { 'ideas.category_required': false } });
      expect((await submit('colab1', { categoryId: null })).status).toBe(201);
      await admin.request('PATCH', '/settings', { values: { 'ideas.category_required': true } });
      const withTags = await submit('colab1', { tagIds: [cat.Segurança] });
      expect(withTags.status).toBe(201);
    });

    it('CA-RN-03.3 enviar para entidade fora do escopo → 403', async () => {
      expect((await submit('colab1', { entityId: ent.B })).status).toBe(403);
    });

    it('CA-RN-04.1 analista cadastra em nome de colab2: autor = colab2, cadastrado por = analista, no histórico', async () => {
      const res = await submit('analista', { onBehalfOfUserId: uid.colab2 });
      expect(res.status).toBe(201);
      expect(res.body.author?.id).toBe(uid.colab2);
      expect(res.body.registeredBy?.id).toBe(uid.analista);
      const events = (await c.analista!.get<Event[]>(`/ideas/${res.body.code}/timeline`)).body;
      expect(events[0]).toMatchObject({
        type: 'created',
        actor: { name: 'analista' },
        data: { onBehalfOf: uid.colab2 },
      });
      // o autor vê a ideia como sua
      expect((await c.colab2!.get<Page>('/ideas/mine')).body.items.map((i) => i.code)).toContain(res.body.code);
    });

    it('CA-RN-04.2 colaborador não cadastra em nome de outro → 403', async () => {
      expect((await submit('colab1', { onBehalfOfUserId: uid.colab2 })).status).toBe(403);
    });

    it('CA-RN-04.3 analista cadastra "já aprovando": nasce Em andamento, com a 1ª etapa e as duas transições no histórico', async () => {
      const res = await submit('analista', { onBehalfOfUserId: uid.colab2, approveNow: approveBody('analista') });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('in_progress');
      expect(res.body.steps).toHaveLength(1);
      const types = (await c.analista!.get<Event[]>(`/ideas/${res.body.code}/timeline`)).body.map(
        (e) => `${e.type}:${e.data.to ?? ''}`,
      );
      expect(types).toEqual(['created:', 'status_changed:in_review', 'step_added:', 'status_changed:in_progress']);
    });

    it('CA-RN-26.1 entidade ou categoria inativa → 422; CA-RN-26.2 as antigas continuam listáveis e filtráveis', async () => {
      const old = await submit('colab1', { categoryId: cat.Segurança });
      await t.db.dataSource.getRepository(Category).update(cat.Segurança!, { active: false });
      expect((await submit('colab1', { categoryId: cat.Segurança })).status).toBe(422);
      const filtered = await c.analista!.get<Page>(`/ideas?categoryId=${cat.Segurança}&pageSize=100`);
      expect(filtered.body.items.map((i) => i.code)).toContain(old.body.code);
      await t.db.dataSource.getRepository(Category).update(cat.Segurança!, { active: true });

      const tmp = await entity('Setor temporário', ent.A as string);
      await t.db.dataSource.getRepository(OrgEntity).update(tmp, { active: false });
      expect((await submit('analista', { entityId: tmp })).status).toBe(422);
    });

    it('CA-RN-23.1 referência externa: opcional, até 100, não única, e serve na busca', async () => {
      const a = await submit('colab1', { externalRef: 'OS-7781' });
      const b = await submit('colab1', { externalRef: 'OS-7781' });
      expect([a.status, b.status]).toEqual([201, 201]);
      expect((await submit('colab1', { externalRef: 'x'.repeat(101) })).status).toBe(422);
      const found = await c.analista!.get<Page>('/ideas?search=OS-7781');
      expect(found.body.meta.total).toBe(2);
    });

    it('CA-RN-22.4 mudar o prefixo só afeta as novas ideias', async () => {
      const before = await submit('colab1', {});
      await admin.request('PATCH', '/settings', { values: { 'ideas.code_prefix': 'kzn' } });
      const after = await submit('colab1', {});
      await admin.request('PATCH', '/settings', { values: { 'ideas.code_prefix': 'ITS' } });
      expect(before.body.code.startsWith('ITS-')).toBe(true);
      expect(after.body.code.startsWith('KZN-')).toBe(true);
      expect((await c.colab1!.get<Detail>(`/ideas/${before.body.code}`)).body.code).toBe(before.body.code);
    });

    it('CA-T.4 texto com <script> e SQL é guardado e devolvido como texto', async () => {
      const evil = `<script>alert('x')</script>'; DROP TABLE idea; --`;
      const res = await submit('colab1', { title: evil, description: evil });
      expect(res.status).toBe(201);
      expect((await c.colab1!.get<Detail>(`/ideas/${res.body.code}`)).body.title).toBe(evil);
      expect(await t.db.dataSource.getRepository(Idea).count()).toBeGreaterThan(0);
    });
  });

  describe('escopo (RN-01) e listas', () => {
    let ideaB: Detail;
    beforeAll(async () => {
      ideaB = (
        await c.colab3!.post<Detail>('/ideas', {
          title: 'Ideia da B',
          description: 'x',
          entityId: ent.B,
          categoryId: cat.Qualidade,
        })
      ).body;
    });

    it('CA-RN-01.2 analista da Unidade A consultando ideia da B → 404 (não revela)', async () => {
      expect((await c.analista!.get(`/ideas/${ideaB.code}`)).status).toBe(404);
      expect((await c.analista!.get(`/ideas/${ideaB.id}`)).status).toBe(404);
      expect((await c.analista!.get(`/ideas/${ideaB.id}/timeline`)).status).toBe(404);
      expect((await c.analista!.post(`/ideas/${ideaB.id}/start-review`)).status).toBe(404);
    });

    it('CA-RN-01.3 analista em A (com sub-entidades) lista as de A e A1, e não as de B', async () => {
      const page = (await c.analista!.get<Page>('/ideas?pageSize=100')).body;
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.map((i) => i.code)).not.toContain(ideaB.code);
      expect((await admin.get<Page>('/ideas?pageSize=100')).body.items.map((i) => i.code)).toContain(ideaB.code);
    });

    it('CA-RN-25.2 filtrar pela entidade pai inclui as descendentes', async () => {
      const inA = (await c.analista!.get<Page>(`/ideas?entityId=${ent.A}&pageSize=100`)).body;
      const inA1 = (await c.analista!.get<Page>(`/ideas?entityId=${ent.A1}&pageSize=100`)).body;
      expect(inA.meta.total).toBeGreaterThanOrEqual(inA1.meta.total);
      expect(inA1.meta.total).toBeGreaterThan(0);
      expect((await admin.get<Page>(`/ideas?entityId=${ent.B}`)).body.items.map((i) => i.code)).toEqual([ideaB.code]);
    });

    it('CA-RN-01.4 autor com escopo reduzido ainda vê a própria ideia, e só ela', async () => {
      await t.db.dataSource.getRepository(UserRoleScope).delete({ userId: uid.colab3 });
      expect((await c.colab3!.get(`/ideas/${ideaB.code}`)).status).toBe(200);
      const mine = (await c.colab3!.get<Page>('/ideas/mine')).body;
      expect(mine.items.map((i) => i.code)).toEqual([ideaB.code]);
      const list = (await c.colab3!.get<Page>('/ideas')).body;
      expect(list.items.map((i) => i.code)).toEqual([ideaB.code]);
    });

    it('colaborador não vê ideias de outros colaboradores', async () => {
      const other = await submit('colab2', {});
      expect((await c.colab1!.get(`/ideas/${other.body.code}`)).status).toBe(404);
    });

    it('CA-RN-01.5 Analista em A e Colaborador em B: tria em A (200) e não em B (403)', async () => {
      const inB = (
        await c.misto!.post<Detail>('/ideas', {
          title: 'Do misto',
          description: 'x',
          entityId: ent.B,
          categoryId: cat.Qualidade,
        })
      ).body;
      expect((await c.misto!.post(`/ideas/${inB.code}/start-review`)).status).toBe(403);
      const inA = await submit('colab1', {});
      expect((await c.misto!.post(`/ideas/${inA.body.code}/start-review`)).status).toBe(200);
    });
  });

  describe('triagem e ciclo de vida', () => {
    it('assumir: Enviada → Em análise, com quem assumiu como responsável; gestor (sem triagem) recebe 403', async () => {
      const idea = (await submit('colab1', {})).body;
      expect((await c.gestor!.post(`/ideas/${idea.code}/start-review`)).status).toBe(403);
      const res = await c.analista!.post<Detail>(`/ideas/${idea.code}/start-review`);
      expect(res.body.status).toBe('in_review');
      expect(res.body.assignedTo?.id).toBe(uid.analista);
      expect((await c.analista!.post(`/ideas/${idea.code}/start-review`)).status).toBe(409);
    });

    it('CA-RN-05.1 recusar sem justificativa (vazia ou espaços) → 422 e o status não muda', async () => {
      const idea = (await submit('colab1', {})).body;
      for (const reason of ['', '   ']) {
        expect((await c.analista!.post(`/ideas/${idea.code}/reject`, { reason })).status).toBe(422);
      }
      expect((await c.analista!.get<Detail>(`/ideas/${idea.code}`)).body.status).toBe('submitted');
    });

    it('CA-RN-05.2 recusar com justificativa: Não autorizada, justificativa salva e visível ao autor na linha do tempo', async () => {
      const idea = (await submit('colab1', {})).body;
      const res = await c.analista!.post<Detail>(`/ideas/${idea.code}/reject`, {
        reason: 'Já existe projeto parecido.',
      });
      expect(res.body.status).toBe('rejected');
      expect(res.body.rejectionReason).toBe('Já existe projeto parecido.');
      const seen = (await c.colab1!.get<Event[]>(`/ideas/${idea.code}/timeline`)).body;
      expect(seen.at(-1)).toMatchObject({
        type: 'status_changed',
        reason: 'Já existe projeto parecido.',
        actor: { name: 'analista' },
      });
    });

    it('CA-RN-06.1 aprovar sem responsável → 422; CA-RN-06.2 com responsável: Em andamento e exatamente 1 etapa', async () => {
      const idea = (await submit('colab1', {})).body;
      await c.analista!.post(`/ideas/${idea.code}/start-review`);
      expect(
        (await c.analista!.post(`/ideas/${idea.code}/approve`, { stepName: 'Planejar', dueDate: tomorrow })).status,
      ).toBe(422);
      const res = await c.analista!.post<Detail>(`/ideas/${idea.code}/approve`, approveBody('colab1'));
      expect(res.body.status).toBe('in_progress');
      expect(res.body.steps).toEqual([
        expect.objectContaining({ position: 1, assignee: expect.objectContaining({ id: uid.colab1 }) }),
      ]);
    });

    it('CA-RN-06.3 aprovar direto de Enviada só com o atalho ligado; o histórico registra as duas transições', async () => {
      const idea = (await submit('colab1', {})).body;
      await admin.request('PATCH', '/settings', { values: { 'ideas.triage_shortcut': false } });
      expect((await c.analista!.post(`/ideas/${idea.code}/approve`, approveBody('analista'))).status).toBe(409);
      await admin.request('PATCH', '/settings', { values: { 'ideas.triage_shortcut': true } });
      expect((await c.analista!.post(`/ideas/${idea.code}/approve`, approveBody('analista'))).status).toBe(200);
      const statusEvents = (await c.analista!.get<Event[]>(`/ideas/${idea.code}/timeline`)).body.filter(
        (e) => e.type === 'status_changed',
      );
      expect(statusEvents.map((e) => e.data.to)).toEqual(['in_review', 'in_progress']);
    });

    it('RN-07 implementar com etapa aberta → 422 (as etapas concluídas chegam no M3)', async () => {
      const idea = (await submit('analista', { approveNow: approveBody('analista') })).body;
      const res = await c.analista!.post<{ code: string }>(`/ideas/${idea.code}/implement`, {
        resultText: 'Ganho de 10%',
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('open_steps');
    });

    it('CA-RN-08.1 encerrada não aceita edição, nem do admin (409); CA-RN-08.2 comentar continua permitido', async () => {
      const idea = (await submit('colab1', {})).body;
      await c.analista!.post(`/ideas/${idea.code}/reject`, { reason: 'Fora do escopo.' });
      expect((await admin.request('PATCH', `/ideas/${idea.code}`, { title: 'Novo título' })).status).toBe(409);
      expect((await c.colab1!.post(`/ideas/${idea.code}/comments`, { body: 'Entendi, obrigado.' })).status).toBe(201);
    });

    it('edição: autor edita enquanto Enviada; depois de assumida, só a equipe', async () => {
      const idea = (await submit('colab1', {})).body;
      expect(
        (await c.colab1!.request<Detail>('PATCH', `/ideas/${idea.code}`, { title: 'Título melhor' })).body.title,
      ).toBe('Título melhor');
      await c.analista!.post(`/ideas/${idea.code}/start-review`);
      expect((await c.colab1!.request('PATCH', `/ideas/${idea.code}`, { title: 'De novo' })).status).toBe(403);
      expect((await c.analista!.request('PATCH', `/ideas/${idea.code}`, { title: 'Ajuste da equipe' })).status).toBe(
        200,
      );
    });

    it('CA-RN-10.1 PATCH com o campo status é recusado (422) e o status não muda', async () => {
      const idea = (await submit('colab1', {})).body;
      const res = await c.analista!.request<{ code: string }>('PATCH', `/ideas/${idea.code}`, {
        status: 'implemented',
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('field_not_editable');
      expect((await c.analista!.get<Detail>(`/ideas/${idea.code}`)).body.status).toBe('submitted');
    });

    describe('reabrir (RN-09)', () => {
      let rejected: Detail;
      beforeAll(async () => {
        rejected = (await submit('colab1', {})).body;
        await c.analista!.post(`/ideas/${rejected.code}/reject`, { reason: 'Sem verba.' });
      });

      it('CA-RN-09.1 analista não reabre (403)', async () => {
        expect((await c.analista!.post(`/ideas/${rejected.code}/reopen`, { reason: 'Mudou a verba.' })).status).toBe(
          403,
        );
      });
      it('CA-RN-09.2 admin sem motivo → 422', async () => {
        expect((await admin.post(`/ideas/${rejected.code}/reopen`, { reason: ' ' })).status).toBe(422);
        expect((await admin.post(`/ideas/${rejected.code}/reopen`, {})).status).toBe(422);
      });
      it('CA-RN-09.3 admin com motivo: Não autorizada → Em análise, motivo no histórico visível ao autor', async () => {
        const res = await admin.post<Detail>(`/ideas/${rejected.code}/reopen`, { reason: 'A verba foi aprovada.' });
        expect(res.body.status).toBe('in_review');
        const last = (await c.colab1!.get<Event[]>(`/ideas/${rejected.code}/timeline`)).body.at(-1);
        expect(last).toMatchObject({
          type: 'reopened',
          reason: 'A verba foi aprovada.',
          data: { from: 'rejected', to: 'in_review' },
        });
      });
      it('CA-RN-09.4 reabrir ideia que não está encerrada → 409 (mesmo sem motivo)', async () => {
        expect((await admin.post(`/ideas/${rejected.code}/reopen`, { reason: 'De novo' })).status).toBe(409);
        expect((await admin.post(`/ideas/${rejected.code}/reopen`, {})).status).toBe(409);
      });
    });

    it('CA-T.2 aprovar e recusar ao mesmo tempo: só uma vale, a outra recebe 409', async () => {
      const idea = (await submit('colab1', {})).body;
      await c.analista!.post(`/ideas/${idea.code}/start-review`);
      const [a, b] = await Promise.all([
        c.analista!.post(`/ideas/${idea.code}/approve`, { ...approveBody('analista'), expectedStatus: 'in_review' }),
        admin.post(`/ideas/${idea.code}/reject`, { reason: 'Não.', expectedStatus: 'in_review' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const status = (await admin.get<Detail>(`/ideas/${idea.code}`)).body.status;
      expect(['in_progress', 'rejected']).toContain(status);
    });
  });

  describe('arquivar e excluir (RN-11)', () => {
    it('CA-RN-11.1 arquivar: some das listas, mas o registro e o histórico ficam', async () => {
      const idea = (await submit('colab1', {})).body;
      expect((await c.analista!.post(`/ideas/${idea.code}/archive`, { reason: 'Duplicada' })).status).toBe(200);
      expect((await c.analista!.get<Page>('/ideas?pageSize=100')).body.items.map((i) => i.code)).not.toContain(
        idea.code,
      );
      expect((await c.colab1!.get<Page>('/ideas/mine?pageSize=100')).body.items.map((i) => i.code)).not.toContain(
        idea.code,
      );
      const row = await t.db.dataSource.getRepository(Idea).findOneByOrFail({ id: idea.id });
      expect(row.archivedAt).not.toBeNull();
      expect(await t.db.dataSource.getRepository(IdeaEvent).countBy({ ideaId: idea.id })).toBeGreaterThan(1);
      expect((await c.analista!.post(`/ideas/${idea.code}/archive`)).status).toBe(409);
    });

    it('CA-RN-11.2 exclusão física: não admin → 403; admin → excluída e registrada na auditoria', async () => {
      const idea = (await submit('colab1', {})).body;
      await c.colab1!.post(`/ideas/${idea.code}/comments`, { body: 'oi' });
      expect((await c.analista!.request('DELETE', `/ideas/${idea.code}`)).status).toBe(403);
      expect((await admin.request('DELETE', `/ideas/${idea.code}`)).status).toBe(204);
      expect(await t.db.dataSource.getRepository(Idea).countBy({ id: idea.id })).toBe(0);
      const audit = await t.db.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'idea.deleted', targetId: idea.id });
      expect(audit.data).toMatchObject({ code: idea.code });
    });
  });

  describe('comentários e histórico (RN-28, RN-38, RN-58)', () => {
    let idea: Detail;
    beforeAll(async () => {
      idea = (await submit('colab1', {})).body;
      await c.analista!.post(`/ideas/${idea.code}/start-review`);
      await c.analista!.post(`/ideas/${idea.code}/comments`, {
        body: 'Ver custo com compras.',
        visibility: 'internal',
      });
      await c.analista!.post(`/ideas/${idea.code}/comments`, { body: 'Estamos avaliando.', visibility: 'public' });
    });

    it('CA-RN-28.1 comentário interno: o autor não vê, nem pela API', async () => {
      const forAuthor = (await c.colab1!.get<{ body: string; visibility: string }[]>(`/ideas/${idea.code}/comments`))
        .body;
      expect(forAuthor.map((x) => x.body)).toEqual(['Estamos avaliando.']);
      const forTeam = (await c.gestor!.get<{ body: string }[]>(`/ideas/${idea.code}/comments`)).body;
      expect(forTeam.map((x) => x.body)).toEqual(['Ver custo com compras.', 'Estamos avaliando.']);
    });

    it('CA-RN-28.2 público: autor e equipe veem; o autor também comenta', async () => {
      expect((await c.colab1!.post(`/ideas/${idea.code}/comments`, { body: 'Posso ajudar a testar.' })).status).toBe(
        201,
      );
      const forTeam = (await c.analista!.get<{ body: string }[]>(`/ideas/${idea.code}/comments`)).body;
      expect(forTeam.map((x) => x.body)).toContain('Posso ajudar a testar.');
    });

    it('CA-RN-28.3 colaborador não marca comentário como interno nem lê os de outras ideias', async () => {
      expect(
        (await c.colab1!.post(`/ideas/${idea.code}/comments`, { body: 'segredo', visibility: 'internal' })).status,
      ).toBe(403);
      const other = (await submit('colab2', {})).body;
      expect((await c.colab1!.get(`/ideas/${other.code}/comments`)).status).toBe(404);
    });

    it('CA-RN-38.1 mudança de status, atribuição e comentário interno geram registro com autor e data', async () => {
      const events = (await c.analista!.get<Event[]>(`/ideas/${idea.code}/timeline`)).body;
      expect(events.map((e) => e.type)).toEqual([
        'created',
        'status_changed',
        'comment_added',
        'comment_added',
        'comment_added',
      ]);
      expect(events.every((e) => e.actor !== null)).toBe(true);
      expect(events.find((e) => e.visibility === 'internal')?.type).toBe('comment_added');
    });

    it('CA-RN-38.3 / CA-RN-58.1 o autor vê cada mudança de status com quem fez, e não vê eventos internos', async () => {
      const events = (await c.colab1!.get<Event[]>(`/ideas/${idea.code}/timeline`)).body;
      expect(events.every((e) => e.visibility === 'public')).toBe(true);
      expect(events.find((e) => e.type === 'status_changed')).toMatchObject({
        actor: { name: 'analista' },
        data: { to: 'in_review' },
      });
    });
  });
});
