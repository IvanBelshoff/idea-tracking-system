import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysToDay, todayInZone } from '../../src/common/dates.js';
import { Notification } from '../../src/communication/entities.js';
import { splitPoints } from '../../src/ideas/convergence-rules.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { awardPoints } from '../../src/recognition/award.js';
import { achievementMet, levelIndex, pointEventFor } from '../../src/recognition/recognition-rules.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Detail {
  id: string;
  code: string;
  steps: { id: string }[];
}
interface Me {
  totalPoints: number;
  seasonPoints: number | null;
  level: { name: string } | null;
  nextLevel: { name: string } | null;
  achievements: { code: string; grantedAt: string | null }[];
  rewards: { description: string }[];
  nameVisible: boolean;
}
interface Ranking {
  period: string;
  rows: { name: string | null; points: number; isMe: boolean }[];
}

describe('Reconhecimento (M8, RN-66 a RN-71, RN-89)', () => {
  let t: TestApp;
  let admin: Client;
  let entityId: string;
  let categoryId: string;
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  const today = todayInZone(new Date(), 'America/Sao_Paulo');

  async function user(key: string, roleKey: string) {
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
  const send = async (who: string, title: string) => {
    const res = await c[who]!.post<Detail>('/ideas', { title, description: 'Descrição.', entityId, categoryId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const approve = async (code: string) => {
    const res = await c.ana!.post<Detail>(`/ideas/${code}/approve`, {
      stepName: 'Fazer',
      assigneeId: uid.ana,
      dueDate: '2099-12-31',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  };
  const implement = async (code: string) => {
    const d = await approve(code);
    await c.ana!.post(`/ideas/${code}/steps/${d.steps[0]!.id}/complete`);
    expect((await c.ana!.post(`/ideas/${code}/implement`, { resultText: 'Feito' })).status).toBe(200);
  };
  const ledger = (ideaId: string): Promise<{ user_id: string; event_type: string; points: number }[]> =>
    t.db.dataSource.query(
      'SELECT user_id, event_type, points FROM point_ledger WHERE idea_id = $1 ORDER BY points DESC',
      [ideaId],
    );
  const pointsOf = (ideaId: string, event: string, who: string) =>
    ledger(ideaId).then((rows) =>
      rows.filter((r) => r.event_type === event && r.user_id === uid[who]).map((r) => r.points),
    );
  const notes = (userId: string, type: string) => t.db.dataSource.getRepository(Notification).findBy({ userId, type });

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    entityId = (await tree.save(tree.create({ name: 'Unidade A', parent: org }))).id;
    categoryId = (
      await ds.getRepository(Category).save(ds.getRepository(Category).create({ name: 'Qualidade', color: '#4f46e5' }))
    ).id;
    await user('ana', 'analyst');
    for (const k of ['colab1', 'colab2', 'colab3']) await user(k, 'collaborator');
    await user('gestor', 'manager');
  });
  afterAll(async () => {
    await t?.close();
  });

  it('regras: divisão sem perda (CA-RN-89.1, CA-RN-69.2), níveis (CA-RN-67.1), conquistas e eventos que pontuam', () => {
    expect(splitPoints(100, 50, 2)).toEqual({ author: 50, coAuthors: [25, 25] });
    const odd = splitPoints(101, 50, 2);
    expect(odd.author + odd.coAuthors.reduce((a, b) => a + b, 0)).toBe(101);
    expect(splitPoints(50, 50, 0)).toEqual({ author: 50, coAuthors: [] });
    const levels = [
      { name: 'N1', minPoints: 0 },
      { name: 'N3', minPoints: 300 },
      { name: 'N2', minPoints: 100 },
    ];
    expect([99, 100, 300].map((p) => levelIndex(p, levels))).toEqual([0, 1, 2]);
    expect(
      achievementMet(
        { ruleType: 'ideas_submitted', threshold: 1 },
        { ideasSubmitted: 1, ideasImplemented: 0, points: 0 },
      ),
    ).toBe(true);
    expect(
      achievementMet({ ruleType: 'points', threshold: 500 }, { ideasSubmitted: 9, ideasImplemented: 9, points: 499 }),
    ).toBe(false);
    expect(pointEventFor('created', {})).toBe('idea_submitted');
    expect(pointEventFor('status_changed', { to: 'in_progress' })).toBe('idea_approved');
    expect(pointEventFor('status_changed', { to: 'implemented' })).toBe('idea_implemented');
    expect(pointEventFor('status_changed', { to: 'in_review' })).toBeNull();
    expect(pointEventFor('comment_added', {})).toBeNull();
  });

  it('CA-RN-66.2 desligado (padrão): nenhum ponto é registrado nem exibido', async () => {
    const idea = await send('colab1', 'Antes de ligar');
    expect(await ledger(idea.id)).toEqual([]);
    expect((await c.colab1!.get('/recognition/me')).status).toBe(404);
    expect((await c.colab1!.get('/recognition/ranking')).status).toBe(404);
    expect(
      (await c.colab1!.get<{ recognition: { enabled: boolean } }>('/settings/public')).body.recognition.enabled,
    ).toBe(false);
  });

  it('CA-RN-66.1 / 68.1 cada evento pontua uma vez; "Primeira ideia" sai uma vez, depois do primeiro envio', async () => {
    expect((await settings({ 'recognition.enabled': true })).status).toBe(200);
    const idea = await send('colab2', 'Primeira da colab2');
    expect(await pointsOf(idea.id, 'idea_submitted', 'colab2')).toEqual([10]);
    await t.db.dataSource.transaction((m) => awardPoints(m, idea.id, 'idea_submitted')); // reprocessar
    expect(await pointsOf(idea.id, 'idea_submitted', 'colab2')).toEqual([10]);
    const me = (await c.colab2!.get<Me>('/recognition/me')).body;
    expect(me.totalPoints).toBe(10);
    expect(me.level?.name).toBe('Iniciante');
    expect(me.nextLevel?.name).toBe('Colaborador');
    expect(me.achievements.find((a) => a.code === 'first_idea')?.grantedAt).toBeTruthy();
    await send('colab2', 'Segunda da colab2');
    expect(await notes(uid.colab2!, 'achievement_granted')).toHaveLength(1);
  });

  it('CA-RN-89.1 aprovação e implementação divididas entre autor e co-autores, fechando no total', async () => {
    const idea = await send('colab1', 'Com apoio');
    for (const who of ['colab2', 'colab3'])
      expect((await c[who]!.post(`/ideas/${idea.code}/support`, {})).status).toBe(200);
    await implement(idea.code);
    expect(await pointsOf(idea.id, 'idea_approved', 'colab1')).toEqual([10]);
    expect(await pointsOf(idea.id, 'idea_approved', 'colab2')).toEqual([5]);
    expect(await pointsOf(idea.id, 'idea_approved', 'colab3')).toEqual([5]);
    const implemented = (await ledger(idea.id)).filter((r) => r.event_type === 'idea_implemented');
    expect(implemented.reduce((a, r) => a + r.points, 0)).toBe(50);
    expect(await pointsOf(idea.id, 'idea_implemented', 'colab1')).toEqual([25]);
    // Reabrir e implementar de novo não pontua outra vez.
    expect((await admin.post(`/ideas/${idea.code}/reopen`, { reason: 'Ajuste' })).status).toBe(200);
    const d = (await c.ana!.get<Detail>(`/ideas/${idea.code}`)).body;
    await c.ana!.post(`/ideas/${idea.code}/steps`, { name: 'Ajustar', assigneeId: uid.ana, dueDate: '2099-12-31' });
    const after = (await c.ana!.get<Detail>(`/ideas/${idea.code}`)).body;
    await c.ana!.post(`/ideas/${idea.code}/steps/${after.steps.at(-1)!.id}/complete`);
    expect((await c.ana!.post(`/ideas/${idea.code}/implement`, { resultText: 'De novo' })).status).toBe(200);
    expect((await ledger(idea.id)).filter((r) => r.event_type === 'idea_implemented')).toHaveLength(3);
    expect(d.code).toBe(idea.code);
  });

  it('CA-RN-66.1 peso novo vale daqui para frente; CA-RN-67.2 subir de nível avisa a pessoa', async () => {
    const before = (await c.colab1!.get<Me>('/recognition/me')).body.totalPoints;
    expect((await settings({ 'recognition.points_implemented': 100 })).status).toBe(200);
    const old = await t.db.dataSource.query(
      `SELECT points FROM point_ledger WHERE event_type = 'idea_implemented' AND user_id = $1`,
      [uid.colab1],
    );
    expect(old.map((r: { points: number }) => r.points)).toEqual([25]); // passado não muda
    const idea = await send('colab1', 'Sozinha');
    await implement(idea.code);
    expect(await pointsOf(idea.id, 'idea_implemented', 'colab1')).toEqual([100]);
    const me = (await c.colab1!.get<Me>('/recognition/me')).body;
    expect(me.totalPoints).toBe(before + 10 + 20 + 100);
    expect(me.level?.name).toBe('Colaborador');
    const levelUps = await notes(uid.colab1!, 'level_up');
    expect(levelUps.map((n) => (n.payload as { level: string }).level)).toEqual(['Colaborador']);
  });

  it('CA-RN-89.2 com "convergência concede co-autoria" desligada, quem convergiu não ganha pontos', async () => {
    expect((await settings({ 'recognition.converged_coauthorship': false })).status).toBe(200);
    const principal = await send('colab1', 'Principal');
    const child = await send('colab3', 'Convergida');
    expect(
      (await c.ana!.post(`/ideas/${child.code}/converge`, { targetRef: principal.code, reason: 'Igual' })).status,
    ).toBe(200);
    await approve(principal.code);
    expect(await pointsOf(principal.id, 'idea_approved', 'colab3')).toEqual([]);
    expect(await pointsOf(principal.id, 'idea_approved', 'colab1')).toEqual([20]);
    expect((await settings({ 'recognition.converged_coauthorship': true })).status).toBe(200);
  });

  it('CA-RN-66.3 temporada: o ranking da temporada começa do zero e o histórico fica', async () => {
    const overlap = { name: 'Outra', startsOn: today, endsOn: addDaysToDay(today, 10) };
    const created = await admin.post<{ id: string; current: boolean }[]>('/recognition/seasons', {
      name: '2026',
      startsOn: addDaysToDay(today, -1),
      endsOn: addDaysToDay(today, 60),
    });
    expect(created.status).toBe(201);
    expect(created.body[0]?.current).toBe(true);
    expect((await admin.post('/recognition/seasons', overlap)).status).toBe(409);
    const season = (await c.colab2!.get<Ranking>('/recognition/ranking?period=season')).body;
    expect([season.period, season.rows]).toEqual(['season', []]);
    const all = (await c.colab2!.get<Ranking>('/recognition/ranking?period=all')).body;
    expect(all.rows.length).toBeGreaterThan(0);
    await send('colab2', 'Na temporada');
    const now = (await c.colab2!.get<Ranking>('/recognition/ranking?period=season')).body;
    expect(now.rows).toEqual([
      { position: 1, name: 'Pessoa colab2', userId: uid.colab2, photoVersion: null, points: 10, isMe: true },
    ]);
    expect((await c.colab2!.get<Me>('/recognition/me')).body.seasonPoints).toBe(10);
  });

  it('CA-RN-70.1 / 70.2 opt-out tira o nome do ranking; ranking individual desligado some, o por entidade fica', async () => {
    const pref = await c.colab2!.request<{ hideName: boolean }>('PATCH', '/auth/me/preferences', { hideName: true });
    expect([pref.status, pref.body.hideName]).toEqual([200, true]);
    const r = (await c.colab1!.get<Ranking>('/recognition/ranking?period=season')).body;
    // CA-RN-142.4: opt-out sem nome, sem id e sem foto.
    expect(r.rows).toEqual([{ position: 1, name: null, userId: null, photoVersion: null, points: 10, isMe: false }]);
    expect((await c.colab2!.get<Me>('/recognition/me')).body.nameVisible).toBe(false);
    expect((await settings({ 'recognition.individual_ranking': false })).status).toBe(200);
    expect((await c.colab1!.get('/recognition/ranking?scope=individual')).status).toBe(404);
    const byEntity = (await c.colab1!.get<Ranking>('/recognition/ranking?scope=entity&period=all')).body;
    expect(byEntity.rows[0]?.name).toBe('Unidade A');
  });

  it('CA-RN-68.1 conquista nova não é dada ao passado sozinha; só pelo "conceder agora" do admin, uma vez', async () => {
    const list = await admin.post<{ id: string; code: string; holders: number }[]>('/recognition/achievements', {
      code: 'duas_ideias',
      name: 'Duas ideias',
      ruleType: 'ideas_submitted',
      threshold: 2,
    });
    expect(list.status).toBe(201);
    const ach = list.body.find((a) => a.code === 'duas_ideias');
    expect(ach?.holders).toBe(0);
    expect(
      (
        await admin.post('/recognition/achievements', {
          code: 'duas_ideias',
          name: 'x',
          ruleType: 'points',
          threshold: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (await c.colab1!.post('/recognition/achievements', { code: 'x', name: 'x', ruleType: 'points', threshold: 1 }))
        .status,
    ).toBe(403);
    const granted = await admin.post<{ granted: number }>(`/recognition/achievements/${ach?.id}/grant`);
    expect(granted.body.granted).toBeGreaterThanOrEqual(2); // colab1 e colab2
    expect((await admin.post<{ granted: number }>(`/recognition/achievements/${ach?.id}/grant`)).body.granted).toBe(0);
  });

  it('CA-RN-67.1 níveis editáveis exigem um nível em 0 e faixas diferentes', async () => {
    expect((await admin.request('PUT', '/recognition/levels', { levels: [{ name: 'A', minPoints: 10 }] })).status).toBe(
      422,
    );
    expect(
      (
        await admin.request('PUT', '/recognition/levels', {
          levels: [
            { name: 'A', minPoints: 0 },
            { name: 'B', minPoints: 0 },
          ],
        })
      ).status,
    ).toBe(422);
    const ok = await admin.request<{ name: string }[]>('PUT', '/recognition/levels', {
      levels: [
        { name: 'Faixa branca', minPoints: 0 },
        { name: 'Faixa preta', minPoints: 150 },
      ],
    });
    expect(ok.body.map((l) => l.name)).toEqual(['Faixa branca', 'Faixa preta']);
    expect((await c.colab1!.get<Me>('/recognition/me')).body.level?.name).toBe('Faixa preta');
  });

  it('CA-RN-71.1 recompensa é só um registro informativo (texto e data), por quem tem reward.register', async () => {
    const res = await admin.post<{ description: string; ideaCode: string | null }[]>('/recognition/rewards', {
      userId: uid.colab1,
      description: 'Vale-cultura e certificado',
      grantedOn: today,
    });
    expect(res.status).toBe(201);
    expect(res.body[0]).toMatchObject({ description: 'Vale-cultura e certificado', ideaCode: null });
    expect(
      (await c.colab1!.post('/recognition/rewards', { userId: uid.colab1, description: 'x', grantedOn: today })).status,
    ).toBe(403);
    expect(
      (await admin.post('/recognition/rewards', { userId: uid.colab1, description: '', grantedOn: today })).status,
    ).toBe(422);
    expect((await c.colab1!.get<Me>('/recognition/me')).body.rewards.map((r) => r.description)).toEqual([
      'Vale-cultura e certificado',
    ]);
    // O gestor registra recompensas: precisa achar a pessoa no seletor (busca de pessoas).
    const people = await c.gestor!.get<{ name: string }[]>('/ideas/people?search=colab1');
    expect([people.status, people.body.map((x) => x.name)]).toEqual([200, ['Pessoa colab1']]);
    expect(
      (await c.gestor!.post('/recognition/rewards', { userId: uid.colab1, description: 'Folga', grantedOn: today }))
        .status,
    ).toBe(201);
  });
});
