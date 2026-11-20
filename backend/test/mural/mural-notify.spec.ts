import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MURAL_TYPES } from '../../src/communication/notification-rules.js';
import { describeNotification } from '../../src/communication/notification-text.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { eventModule, mapIdeaEvent } from '../../src/integration/webhooks/events.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { createIntegration, enableIntegration, IntegrationClient } from '../support/integration-support.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Detail {
  id: string;
  code: string;
}
interface Row {
  type: string;
  payload: Record<string, unknown>;
  read_at: Date | null;
}

describe('Mural: avisos e integração (M21, RN-156, RN-157)', () => {
  let t: TestApp;
  let admin: Client;
  const ent: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  let categoryId: string;

  async function user(key: string, roleKey: string, entityId: string) {
    const ds = t.db.dataSource;
    const repo = ds.getRepository(User);
    const u = await repo.save(
      repo.create({
        email: `${key}@example.test`,
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
    expect((await c[key].post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  }
  const settings = (values: Record<string, unknown>) => admin.request('PATCH', '/settings', { values });
  const published = async (who: string, title: string, coauthor?: string) => {
    const res = await c[who]!.post<Detail>('/ideas', {
      title,
      description: `Antes: ${title}`,
      entityId: ent.A,
      categoryId,
    });
    expect(res.status).toBe(201);
    if (coauthor) expect((await c[coauthor]!.post(`/ideas/${res.body.code}/support`, {})).status).toBe(200);
    await c.ana!.post(`/ideas/${res.body.code}/approve`, {
      stepName: 'Fazer',
      assigneeId: uid.ana,
      dueDate: '2099-12-31',
    });
    expect((await c.ana!.post(`/mural/ideas/${res.body.code}/publish`)).status).toBe(200);
    return res.body;
  };
  const notes = (userId: string, type: string, ideaId?: string): Promise<Row[]> =>
    t.db.dataSource.query(
      `SELECT type, payload, read_at FROM notification WHERE user_id = $1 AND type = $2
         AND ($3::uuid IS NULL OR idea_id = $3) ORDER BY created_at, id`,
      [userId, type, ideaId ?? null],
    );
  const comment = (who: Client, code: string, body: string, parentId?: string) =>
    who.post<{ id: string; body: string; replies: { id: string; body: string }[] }[]>(`/mural/ideas/${code}/comments`, {
      body,
      parentId,
    });

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    ent.A = (await tree.save(tree.create({ name: 'Unidade A', parent: org }))).id;
    ent.B = (await tree.save(tree.create({ name: 'Unidade B', parent: org }))).id;
    categoryId = (
      await ds.getRepository(Category).save(ds.getRepository(Category).create({ name: 'Qualidade', color: '#4f46e5' }))
    ).id;
    await user('ana', 'analyst', ent.A!);
    await user('anaB', 'analyst', ent.B!);
    await user('colab1', 'collaborator', ent.A!);
    await user('colab2', 'collaborator', ent.A!);
    for (const k of ['v1', 'v2', 'v3', 'v4', 'v5']) await user(k, 'collaborator', ent.B!);
    expect((await settings({ 'mural.enabled': true })).status).toBe(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('regras: textos do e-mail e mapeamento dos webhooks do mural', () => {
    for (const type of MURAL_TYPES) {
      expect(describeNotification(type, { code: 'ITS-2026-0001', title: 'X' }, 'pt-BR')).not.toContain(type);
      expect(describeNotification(type, { code: 'ITS-2026-0001', title: 'X' }, 'en')).not.toContain(type);
    }
    expect(describeNotification('mural_digest', { reactions: 5, comments: 2 }, 'pt-BR')).toBe(
      'hoje no mural: 5 reação(ões) e 2 comentário(s)',
    );
    expect(describeNotification('mural_shared', { senderName: null }, 'pt-BR')).toBe(
      'um colega enviou esta ideia do mural para você',
    );
    const idea = { code: 'ITS-2026-0001', entityId: 'e1' };
    expect(mapIdeaEvent('mural_published', {}, idea)).toEqual({
      type: 'mural.published',
      data: { idea_code: 'ITS-2026-0001', entity_id: 'e1' },
    });
    // O motivo da retirada nunca vai no aviso.
    expect(mapIdeaEvent('mural_withdrawn', { automatic: true, reason: 'x' }, idea)).toEqual({
      type: 'mural.withdrawn',
      data: { idea_code: 'ITS-2026-0001', entity_id: 'e1' },
    });
    expect(eventModule('mural.published')).toBe('ideas');
  });

  it('RN-156 publicar e retirar avisam os participantes (o resumo pede o consentimento)', async () => {
    const idea = await published('colab1', 'Avisos de publicação', 'colab2');
    for (const who of ['colab1', 'colab2']) {
      expect((await notes(uid[who]!, 'mural_published', idea.id)).map((n) => n.payload.code)).toEqual([idea.code]);
    }
    await c.ana!.post(`/mural/ideas/${idea.code}/withdraw`, { reason: 'Revisar o texto' });
    expect((await notes(uid.colab1!, 'mural_withdrawn', idea.id))[0]?.payload).toMatchObject({
      reason: 'Revisar o texto',
    });
    // Retirada automática: o aviso sai com a causa; com o módulo desligado, nenhum aviso (CA-RN-148.1).
    await c.ana!.post(`/mural/ideas/${idea.code}/publish`);
    await c.ana!.post(`/ideas/${idea.code}/interrupt`, { reason: 'Sem verba' });
    expect((await notes(uid.colab2!, 'mural_withdrawn', idea.id)).at(-1)?.payload).toMatchObject({
      automatic: 'idea_rejected',
    });
    const off = await published('colab1', 'Desligado na retirada');
    expect((await settings({ 'mural.enabled': false })).status).toBe(200);
    await c.ana!.post(`/ideas/${off.code}/archive`, { reason: 'Duplicada' });
    expect((await settings({ 'mural.enabled': true })).status).toBe(200);
    expect(await notes(uid.colab1!, 'mural_withdrawn', off.id)).toEqual([]);
  });

  it('CA-RN-156.1 cinco reações e dois comentários no dia viram um aviso só, atualizado; no dia seguinte, outro', async () => {
    const idea = await published('colab1', 'Resumo do dia', 'colab2');
    for (const k of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      await c[k]!.request('PUT', `/mural/ideas/${idea.code}/reaction`, { kind: 'like' });
    }
    // Trocar o tipo não conta de novo; tirar não desconta.
    await c.v1!.request('PUT', `/mural/ideas/${idea.code}/reaction`, { kind: 'brilliant' });
    await c.v2!.request('DELETE', `/mural/ideas/${idea.code}/reaction`);
    await comment(c.v1!, idea.code, 'Muito bom');
    await comment(c.colab1!, idea.code, 'Obrigado'); // o próprio autor não avisa a si mesmo
    for (const who of ['colab1', 'colab2']) {
      const rows = await notes(uid[who]!, 'mural_digest', idea.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.payload).toMatchObject({ reactions: 5, comments: who === 'colab1' ? 1 : 2 });
    }
    // Lido e atualizado de novo: volta a ficar não lido.
    await t.db.dataSource.query(
      `UPDATE notification SET read_at = now() WHERE type = 'mural_digest' AND idea_id = $1`,
      [idea.id],
    );
    await comment(c.v2!, idea.code, 'Mais um');
    expect((await notes(uid.colab2!, 'mural_digest', idea.id))[0]).toMatchObject({ read_at: null });
    // "Ontem" fica como está; hoje nasce outro.
    await t.db.dataSource.query(
      `UPDATE notification SET payload = jsonb_set(payload, '{day}', '"2000-01-01"') WHERE type = 'mural_digest' AND idea_id = $1`,
      [idea.id],
    );
    await comment(c.v3!, idea.code, 'Dia seguinte');
    const two = await notes(uid.colab2!, 'mural_digest', idea.id);
    expect(two.map((n) => [n.payload.day === '2000-01-01', n.payload.comments])).toEqual([
      [true, 3],
      [false, 1],
    ]);
    // Em paralelo, continua um aviso só por dia (CA-T.1).
    await Promise.all(['v4', 'v5'].map((k) => comment(c[k]!, idea.code, `Paralelo ${k}`)));
    expect(
      (await notes(uid.colab2!, 'mural_digest', idea.id)).filter((n) => n.payload.day !== '2000-01-01'),
    ).toHaveLength(1);
  });

  it('CA-RN-156.2 duas respostas ao mesmo comentário no dia: um aviso a quem escreveu', async () => {
    const idea = await published('colab1', 'Respostas');
    const list = (await comment(c.v1!, idea.code, 'Pergunta')).body;
    const q = list.find((x) => x.body === 'Pergunta')!;
    await comment(c.v2!, idea.code, 'Resposta 1', q.id);
    await comment(c.v3!, idea.code, 'Resposta 2', q.id);
    await comment(c.v1!, idea.code, 'Eu mesmo', q.id); // responder a si mesmo não avisa
    const rows = await notes(uid.v1!, 'mural_reply', idea.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({ replies: 2, group: q.id, code: idea.code });
  });

  it('CA-RN-156.3 cada aviso do mural se desliga nas preferências; o grupo só aparece com o módulo ligado', async () => {
    const prefs = await c.v4!.get<{ events: { type: string; group: string; mandatory: boolean }[] }>(
      '/notifications/preferences',
    );
    const mural = prefs.body.events.filter((e) => e.group === 'mural');
    expect(mural.map((e) => e.type).sort()).toEqual([...MURAL_TYPES].sort());
    expect(mural.every((e) => !e.mandatory)).toBe(true);
    expect(
      (
        await c.v4!.request('PUT', '/notifications/preferences', {
          events: [{ type: 'mural_shared', inApp: false, email: false }],
          deadlineAlertDays: null,
        })
      ).status,
    ).toBe(200);
    const idea = await published('colab1', 'Preferência');
    expect((await c.v5!.post(`/mural/ideas/${idea.code}/share`, { recipientId: uid.v4 })).status).toBe(204);
    expect(await notes(uid.v4!, 'mural_shared', idea.id)).toEqual([]);
    expect((await settings({ 'mural.enabled': false })).status).toBe(200);
    const hidden = await c.v4!.get<{ events: { group: string }[] }>('/notifications/preferences');
    expect(hidden.body.events.some((e) => e.group === 'mural')).toBe(false);
    expect((await settings({ 'mural.enabled': true })).status).toBe(200);
  });

  it('CA-RN-156.4 / 154.2 denúncias avisam, agrupadas, só a equipe da entidade; ocultar avisa quem escreveu', async () => {
    const idea = await published('colab1', 'Denúncias');
    const list = (await comment(c.v1!, idea.code, 'Comentário ruim')).body;
    const bad = list.find((x) => x.body === 'Comentário ruim')!;
    await c.v2!.post(`/mural/comments/${bad.id}/report`, { reason: 'offensive' });
    await c.v3!.post(`/mural/comments/${bad.id}/report`, { reason: 'off_topic' });
    const team = await notes(uid.ana!, 'mural_reports', idea.id);
    expect(team).toHaveLength(1);
    expect(team[0]?.payload).toMatchObject({ reports: 2 });
    expect(await notes(uid.anaB!, 'mural_reports', idea.id)).toEqual([]);
    expect(await notes(uid.v1!, 'mural_reports', idea.id)).toEqual([]);
    await c.ana!.post(`/mural/comments/${bad.id}/hide`, { reason: 'Linguagem imprópria' });
    const hidden = await notes(uid.v1!, 'mural_comment_hidden', idea.id);
    expect(hidden[0]?.payload).toMatchObject({ reason: 'Linguagem imprópria' });
    expect(JSON.stringify(hidden)).not.toContain(uid.v2!); // quem denunciou não aparece
  });

  it('CA-RN-155.1 / 151.5 o colega recebe o aviso com quem enviou; participante anônimo sai como "um colega"', async () => {
    const idea = await published('colab1', 'Compartilhar');
    await c.v1!.post(`/mural/ideas/${idea.code}/share`, { recipientId: uid.v2, message: 'Veja isto' });
    expect((await notes(uid.v2!, 'mural_shared', idea.id))[0]?.payload).toMatchObject({
      senderName: 'Pessoa v1',
      message: 'Veja isto',
      code: idea.code,
    });
    await c.colab1!.post(`/mural/ideas/${idea.code}/share`, { recipientId: uid.v3 });
    const anon = await notes(uid.v3!, 'mural_shared', idea.id);
    expect(anon[0]?.payload.senderName).toBeNull();
    expect(JSON.stringify(anon)).not.toContain('colab1');
    // Consentiu: aí o nome aparece (v5, porque v4 desligou este aviso no caso das preferências).
    await c.colab1!.request('PUT', `/mural/ideas/${idea.code}/consent`, { accept: true });
    await c.colab1!.post(`/mural/ideas/${idea.code}/share`, { recipientId: uid.v5 });
    expect((await notes(uid.v5!, 'mural_shared', idea.id))[0]?.payload.senderName).toBe('Pessoa colab1');
  });

  it('CA-RN-157.1 / 157.2 / 157.3 webhooks mínimos e campos na API de leitura; reações e conversa não saem', async () => {
    await enableIntegration(t, admin, ['ideas']);
    expect((await admin.put('/admin/webhooks/enabled', { enabled: true })).status).toBe(200);
    expect((await admin.put('/admin/webhooks/destinations', { destinations: ['127.0.0.1'] })).status).toBe(200);
    const integration = await createIntegration(admin, {
      name: 'BI do mural',
      modules: ['ideas'],
      scope: [{ entityId: ent.A!, includeChildren: true }],
      ratePerMinute: 600,
    });
    const sub = await admin.post<{ subscription: { id: string } }>('/admin/webhooks', {
      integrationId: integration.id,
      name: 'mural',
      url: 'http://127.0.0.1:9/hook',
      events: ['mural.published', 'mural.withdrawn'],
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const idea = await published('colab1', 'Integração');
    await comment(c.v1!, idea.code, 'Comentário que não sai');
    const api = new IntegrationClient(t.baseUrl, integration.token);
    const on = await api.get<Record<string, unknown>>(`/ideas/${idea.code}`);
    expect(on.status).toBe(200);
    expect(on.body.on_mural).toBe(true);
    expect(typeof on.body.mural_published_at).toBe('string');
    expect(JSON.stringify(on.body)).not.toContain('Comentário que não sai');
    await c.ana!.post(`/mural/ideas/${idea.code}/withdraw`, { reason: 'Motivo interno' });
    const off = await api.get<Record<string, unknown>>(`/ideas/${idea.code}`);
    expect([off.body.on_mural, off.body.mural_published_at]).toEqual([false, null]);
    const events: { type: string; data: Record<string, unknown> }[] = await t.db.dataSource.query(
      `SELECT e.type, e.data FROM webhook_event e JOIN webhook_delivery d ON d.event_id = e.id
        WHERE d.subscription_id = $1 ORDER BY e.created_at, e.id`,
      [sub.body.subscription.id],
    );
    expect(events).toEqual([
      { type: 'mural.published', data: { idea_code: idea.code, entity_id: ent.A } },
      { type: 'mural.withdrawn', data: { idea_code: idea.code, entity_id: ent.A } },
    ]);
    expect(JSON.stringify(events)).not.toContain('Motivo interno');
    // Nenhuma rota de integração fala de mural, reação, comentário ou denúncia.
    for (const path of ['/mural', '/ideas/reactions', `/ideas/${idea.code}/reactions`, `/ideas/${idea.code}/mural`]) {
      expect([404, 405]).toContain((await api.get(path)).status);
    }
  });
});
