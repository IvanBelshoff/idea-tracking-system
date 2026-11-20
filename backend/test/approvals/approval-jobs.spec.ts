import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { approvalLinkLimiter } from '../../src/approvals/approval-decisions.service.js';
import { reminderDue, runApprovalJobs } from '../../src/approvals/approval-jobs.js';
import { EmailLog, MailProvider, Notification } from '../../src/communication/entities.js';
import { open, seal } from '../../src/communication/secret-box.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { mapIdeaEvent } from '../../src/integration/webhooks/events.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

describe('Aprovação de outras áreas: lembretes (regra pura, RN-189)', () => {
  const base = { createdOn: '2026-11-01', dueOn: '2026-11-15', remindersSent: 0 };
  it('CA-RN-189.1 o primeiro 3 dias antes e o segundo no dia; no máximo dois', () => {
    expect(reminderDue({ ...base, today: '2026-11-11' })).toBeNull();
    expect(reminderDue({ ...base, today: '2026-11-12' })).toBe('soon');
    expect(reminderDue({ ...base, today: '2026-11-14' })).toBe('soon');
    expect(reminderDue({ ...base, today: '2026-11-14', remindersSent: 1 })).toBeNull();
    expect(reminderDue({ ...base, today: '2026-11-15', remindersSent: 1 })).toBe('due');
    expect(reminderDue({ ...base, today: '2026-11-15' })).toBe('due');
    expect(reminderDue({ ...base, today: '2026-11-15', remindersSent: 2 })).toBeNull();
  });
  it('prazo curto não recebe o "3 dias antes"; nada sai no mesmo dia do pedido', () => {
    expect(
      reminderDue({ createdOn: '2026-11-13', dueOn: '2026-11-15', remindersSent: 0, today: '2026-11-14' }),
    ).toBeNull();
    expect(
      reminderDue({ createdOn: '2026-11-15', dueOn: '2026-11-15', remindersSent: 0, today: '2026-11-15' }),
    ).toBeNull();
  });
  it('CA-RN-191.2 os webhooks levam só o código, a entidade, o pedido e a situação', () => {
    const idea = { code: 'ITS-2026-0001', entityId: 'e1' };
    expect(mapIdeaEvent('approval_requested', { requestId: 'r1', holds: 'approve' }, idea)).toEqual({
      type: 'approval.requested',
      data: { idea_code: 'ITS-2026-0001', entity_id: 'e1', request_id: 'r1', status: 'pending' },
    });
    expect(mapIdeaEvent('approval_completed', { requestId: 'r1', outcome: 'rejected' }, idea)?.data).toEqual({
      idea_code: 'ITS-2026-0001',
      entity_id: 'e1',
      request_id: 'r1',
      status: 'rejected',
    });
    expect(mapIdeaEvent('approval_expired', { requestId: 'r1' }, idea)?.data.status).toBe('expired');
    expect(mapIdeaEvent('approval_cancelled', { requestId: 'r1' }, idea)?.data.status).toBe('cancelled');
    // A decisão de cada aprovador (com nome e comentário) não vira webhook.
    expect(mapIdeaEvent('approval_decided', { name: 'Fulano', comment: 'x' }, idea)).toBeNull();
  });
});

describe('Aprovação de outras áreas: avisos, lembretes e vencimento (M24, RN-189, RN-191)', () => {
  let t: TestApp;
  let admin: Client;
  let entityId: string;
  let categoryId: string;
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};

  async function person(key: string, roleKey: string) {
    const ds = t.db.dataSource;
    const repo = ds.getRepository(User);
    const u = await repo.save(
      repo.create({
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
  const notices = (userId: string, type: string) =>
    t.db.dataSource.getRepository(Notification).countBy({ userId, type: type as never });
  const review = async (title: string) => {
    const res = await c.colab!.post<{ id: string; code: string }>('/ideas', {
      title,
      description: 'D',
      entityId,
      categoryId,
    });
    expect((await c.ana!.post(`/ideas/${res.body.code}/start-review`, {})).status).toBe(200);
    return res.body;
  };
  const ask = async (code: string, recipients: Record<string, unknown>[], days = 10) => {
    const res = await c.ana!.post<{ requests: { id: string; recipients: { id: string }[] }[] }>(
      `/ideas/${code}/approvals`,
      {
        holds: 'approve',
        summary: 'Resumo.',
        recipients,
        days,
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.requests[0]!;
  };
  const tokenOf = async (email: string, kind = 'approval_request') => {
    const rows = await t.db.dataSource
      .getRepository(EmailLog)
      .find({ where: { kind, toAddress: email }, order: { createdAt: 'DESC' } });
    return /\/aprovar#([A-Za-z0-9_-]+)/.exec(open(rows[0]!.bodyEncrypted))?.[1] ?? '';
  };
  const linkView = (token: string) => new Client(t.baseUrl).post<{ state: string }>('/approvals/link/view', { token });
  /** Move o pedido no tempo: criado há `ago` dias e com o prazo daqui a `left` dias. */
  const shift = (requestId: string, ago: number, left: number) =>
    t.db.dataSource.query(
      `UPDATE approval_request SET created_at = now() - make_interval(days => $2::int),
              due_on = (now() AT TIME ZONE 'America/Sao_Paulo')::date + $3::int,
              expires_at = ((now() AT TIME ZONE 'America/Sao_Paulo')::date + $3::int + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'
        WHERE id = $1`,
      [requestId, ago, left],
    );

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    entityId = (await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;
    categoryId = (
      await ds.getRepository(Category).save(ds.getRepository(Category).create({ name: 'Qualidade', color: '#4f46e5' }))
    ).id;
    await person('ana', 'analyst');
    await person('colab', 'collaborator');
    await person('gestor', 'manager');
    await admin.request('PATCH', '/settings', { values: { 'email.app_url': 'https://its.empresa.com.br' } });
    const mail = ds.getRepository(MailProvider);
    await mail.save(
      mail.create({
        type: 'smtp',
        name: 'teste',
        configEncrypted: seal('{}'),
        fromAddress: 'its@empresa.com.br',
        active: true,
      }),
    );
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(() => approvalLinkLimiter.clear());

  it('CA-RN-186.1 CA-RN-191.1 o aprovador do ITS recebe o aviso no sino, que não pode ser desligado', async () => {
    // Tentar desligar não adianta: o pedido ao aprovador é obrigatório (como as decisões da RN-30).
    const prefs = await c.gestor!.request('PUT', '/notifications/preferences', {
      events: [{ type: 'approval_requested', inApp: false, email: false }],
      deadlineAlertDays: null,
    });
    expect(prefs.status).toBe(200);
    const listed = await c.gestor!.get<{ events: { type: string; group: string; mandatory: boolean }[] }>(
      '/notifications/preferences',
    );
    expect(listed.body.events.find((e) => e.type === 'approval_requested')).toMatchObject({
      group: 'team',
      mandatory: true,
    });
    const idea = await review('Aviso ao gestor');
    await ask(idea.code, [{ userId: uid.gestor }]);
    expect(await notices(uid.gestor!, 'approval_requested')).toBe(1);
  });

  it('CA-RN-191.1 a resposta e o resultado avisam quem pediu (e não quem agiu)', async () => {
    const idea = await review('Resposta e resultado');
    const req = await ask(idea.code, [{ userId: uid.gestor }]);
    const before = await notices(uid.ana!, 'approval_completed');
    expect(
      (await c.gestor!.post(`/approvals/recipients/${req.recipients[0]!.id}/decide`, { decision: 'approved' })).status,
    ).toBe(200);
    expect(await notices(uid.ana!, 'approval_answered')).toBeGreaterThanOrEqual(1);
    expect(await notices(uid.ana!, 'approval_completed')).toBe(before + 1);
    expect(await notices(uid.gestor!, 'approval_answered')).toBe(0);
  });

  it('CA-RN-189.1 CA-RN-189.3 lembretes: o "3 dias antes" e o do dia, sem repetir; quem já respondeu não recebe', async () => {
    const idea = await review('Lembretes');
    const req = await ask(idea.code, [
      { userId: uid.gestor },
      { name: 'Gerente Fora', email: 'fora@empresa.com.br', area: 'Manutenção' },
    ]);
    const oldToken = await tokenOf('fora@empresa.com.br');
    await shift(req.id, 7, 3);
    const first = await runApprovalJobs(t.db.dataSource);
    expect(first.reminders).toBe(2);
    expect(await notices(uid.gestor!, 'approval_reminder')).toBe(1);
    // Quem é de fora recebe um link novo, que substitui o anterior.
    const newToken = await tokenOf('fora@empresa.com.br', 'approval_reminder');
    expect(newToken).not.toBe(oldToken);
    expect((await linkView(oldToken)).status).toBe(404);
    expect((await linkView(newToken)).body.state).toBe('open');
    // Rodar de novo no mesmo dia não repete (CA-T.1).
    expect((await runApprovalJobs(t.db.dataSource)).reminders).toBe(0);
    // O gestor responde; no dia do prazo, só quem falta recebe.
    expect(
      (await c.gestor!.post(`/approvals/recipients/${req.recipients[0]!.id}/decide`, { decision: 'approved' })).status,
    ).toBe(200);
    await shift(req.id, 10, 0);
    const due = await runApprovalJobs(t.db.dataSource);
    expect(due.reminders).toBe(1);
    expect(await notices(uid.gestor!, 'approval_reminder')).toBe(1);
    expect(
      await t.db.dataSource
        .getRepository(EmailLog)
        .countBy({ kind: 'approval_reminder', toAddress: 'fora@empresa.com.br' }),
    ).toBe(2);
    expect((await runApprovalJobs(t.db.dataSource)).reminders).toBe(0);
  });

  it('CA-RN-189.2 no fim do prazo, o pedido vence, os links morrem e quem pediu é avisado', async () => {
    const idea = await review('Vencimento');
    const req = await ask(idea.code, [{ name: 'Gerente Tarde', email: 'tarde@empresa.com.br', area: 'Compras' }]);
    const token = await tokenOf('tarde@empresa.com.br');
    await t.db.dataSource.query(`UPDATE approval_request SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      req.id,
    ]);
    const before = await notices(uid.ana!, 'approval_expired');
    const run = await runApprovalJobs(t.db.dataSource);
    expect(run.expired).toBe(1);
    const [r] = await t.db.dataSource.query(`SELECT status FROM approval_request WHERE id = $1`, [req.id]);
    expect(r.status).toBe('expired');
    expect((await linkView(token)).body.state).toBe('expired');
    expect(await notices(uid.ana!, 'approval_expired')).toBe(before + 1);
    const events = await t.db.dataSource.query(
      `SELECT type FROM idea_event WHERE idea_id = $1 AND type = 'approval_expired'`,
      [idea.id],
    );
    expect(events).toHaveLength(1);
    // Vencido, a aprovação não foi obtida: a transição continua segura.
    const approve = await c.ana!.post<{ code: string }>(`/ideas/${idea.code}/approve`, {
      stepName: 'F',
      assigneeId: uid.ana,
      dueDate: '2099-12-31',
    });
    expect(approve.body.code).toBe('approval_not_obtained');
    expect((await runApprovalJobs(t.db.dataSource)).expired).toBe(0);
  });
});
