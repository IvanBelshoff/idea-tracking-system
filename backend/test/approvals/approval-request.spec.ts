import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/approvals/approval-core.js';
import { EmailLog, MailProvider } from '../../src/communication/entities.js';
import { open, seal } from '../../src/communication/secret-box.js';
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
  status: string;
  steps: { id: string; name: string }[];
}
interface Recipient {
  id: string;
  kind: 'user' | 'external';
  userId: string | null;
  name: string;
  email: string | null;
  decision: string;
}
interface RequestView {
  id: string;
  status: string;
  holds: string;
  summary: string;
  ideaTitle: string;
  dueOn: string;
  recipients: Recipient[];
  attachments: { id: string }[];
  overrideReason: string | null;
}
interface View {
  state: string;
  canManage: boolean;
  full: boolean;
  onReject: string;
  requests: RequestView[];
  form: Record<string, unknown> | null;
}

describe('Aprovação de outras áreas: pedir, cancelar e segurar a transição (M24, RN-183, RN-188)', () => {
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
  const send = async (title: string) => {
    const res = await c.colab!.post<Detail>('/ideas', { title, description: `Antes: ${title}`, entityId, categoryId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const review = async (title: string) => {
    const idea = await send(title);
    expect((await c.ana!.post(`/ideas/${idea.code}/start-review`, {})).status).toBe(200);
    return idea;
  };
  const approveBody = { stepName: 'Fazer', assigneeId: '', dueDate: '2099-12-31' };
  const approve = (code: string) =>
    c.ana!.post<Detail & { code?: string }>(`/ideas/${code}/approve`, { ...approveBody, assigneeId: uid.ana });
  const ask = (code: string, body: Record<string, unknown>, who = 'ana') =>
    c[who]!.post<View & { code?: string; details?: unknown }>(`/ideas/${code}/approvals`, {
      holds: 'approve',
      summary: 'A mudança troca o turno da manutenção.',
      recipients: [{ name: 'Gerente da Manutenção', email: 'gerente@empresa.com.br', area: 'Manutenção' }],
      ...body,
    });

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
    // Envio de e-mail ligado (o worker não roda aqui: os e-mails ficam na fila).
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

  it('CA-RN-183.1 a equipe pede a aprovação de alguém do ITS e de alguém de fora; vai para o histórico e a auditoria', async () => {
    const idea = await review('Trocar o turno da manutenção');
    const res = await ask(idea.code, {
      recipients: [
        { userId: uid.gestor, area: 'Produção' },
        { name: 'Gerente da Manutenção', email: 'Gerente@Empresa.com.br', area: 'Manutenção' },
      ],
      days: 10,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.state).toBe('pending');
    const [req] = res.body.requests;
    expect(req?.status).toBe('pending');
    expect(req?.ideaTitle).toBe('Trocar o turno da manutenção');
    expect(req?.recipients.map((r) => r.kind)).toEqual(['user', 'external']);
    expect(req?.recipients[1]?.email).toBe('gerente@empresa.com.br');
    const events = await t.db.dataSource.query(
      `SELECT type FROM idea_event WHERE idea_id = $1 AND type LIKE 'approval_%'`,
      [idea.id],
    );
    expect(events).toEqual([{ type: 'approval_requested' }]);
    const audit = await t.db.dataSource.query(
      `SELECT data FROM audit_log WHERE action = 'approval.requested' AND target_id = $1`,
      [idea.id],
    );
    expect(audit[0].data).toMatchObject({ recipients: 2, external: 1, holds: 'approve' });
  });

  it('CA-RN-184.1 CA-T.28 quem é de fora recebe o link por e-mail; o banco guarda só o SHA-256', async () => {
    const rows = await t.db.dataSource.getRepository(EmailLog).findBy({ kind: 'approval_request' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toAddress).toBe('gerente@empresa.com.br');
    const body = open(rows[0]!.bodyEncrypted);
    const token = /\/aprovar#([A-Za-z0-9_-]+)/.exec(body)?.[1] ?? '';
    expect(token).toHaveLength(43);
    const [r] = await t.db.dataSource.query(
      `SELECT token_hash FROM approval_recipient WHERE email = 'gerente@empresa.com.br'`,
    );
    expect(r.token_hash).toBe(hashToken(token));
    const dump = JSON.stringify(await t.db.dataSource.query('SELECT * FROM approval_recipient'));
    expect(dump).not.toContain(token);
    // Quem é do ITS não recebe link (decide dentro do ITS, RN-186).
    const [u] = await t.db.dataSource.query(`SELECT token_hash FROM approval_recipient WHERE user_id = $1`, [
      uid.gestor,
    ]);
    expect(u.token_hash).toBeNull();
  });

  it('CA-RN-188.1 com o pedido pendente, aprovar a ideia → 409 approval_pending', async () => {
    const [row] = await t.db.dataSource.query(
      `SELECT i.code FROM approval_request r JOIN idea i ON i.id = r.idea_id WHERE r.status = 'pending'`,
    );
    const res = await approve(row.code);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('approval_pending');
  });

  it('CA-RN-183.4 um pedido aberto por vez; depois de cancelado, outro é aceito', async () => {
    const idea = await review('Ideia com dois pedidos');
    expect((await ask(idea.code, {})).status).toBe(201);
    const again = await ask(idea.code, {});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('approval_open');
    const view = await c.ana!.get<View>(`/ideas/${idea.code}/approvals`);
    const id = view.body.requests[0]!.id;
    expect((await c.ana!.post(`/ideas/${idea.code}/approvals/${id}/cancel`, {})).status).toBe(422);
    const cancelled = await c.ana!.post<View>(`/ideas/${idea.code}/approvals/${id}/cancel`, {
      reason: 'Mudou o escopo',
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.state).toBe('none');
    expect(cancelled.body.requests[0]?.status).toBe('cancelled');
    expect(cancelled.body.requests[0]?.recipients.every((r) => r.decision === 'void')).toBe(true);
    // Cancelado, a transição fica livre.
    expect((await approve(idea.code)).status).toBe(200);
  });

  it('CA-RN-183.6 cancelar de novo → 409; a auditoria guarda o motivo', async () => {
    const [row] = await t.db.dataSource.query(
      `SELECT r.id, i.code FROM approval_request r JOIN idea i ON i.id = r.idea_id WHERE r.status = 'cancelled' LIMIT 1`,
    );
    const res = await c.ana!.post<{ code: string }>(`/ideas/${row.code}/approvals/${row.id}/cancel`, {
      reason: 'De novo',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('approval_not_open');
    const audit = await t.db.dataSource.query(`SELECT data FROM audit_log WHERE action = 'approval.cancelled'`);
    expect(audit[0].data.reason).toBe('Mudou o escopo');
  });

  it('CA-RN-183.2 sem idea.triage → 403; ideia Enviada ou encerrada → 409', async () => {
    const idea = await send('Ideia ainda enviada');
    expect((await ask(idea.code, {}, 'colab')).status).toBe(403);
    const sent = await ask(idea.code, {});
    expect(sent.status).toBe(409);
    expect(sent.body.code).toBe('approval_invalid_state');
  });

  it('CA-RN-183.3 limites: sem aprovador, 11 aprovadores, resumo longo, prazo fora, 6 anexos → 422', async () => {
    const idea = await review('Limites do pedido');
    const many = Array.from({ length: 11 }, (_, i) => ({ name: `P${i}`, email: `p${i}@empresa.com.br`, area: 'A' }));
    for (const body of [
      { recipients: [] },
      { recipients: many },
      { summary: 'x'.repeat(2001) },
      { days: 0 },
      { days: 61 },
      { recipients: [{ name: 'Sem e-mail', email: 'invalido', area: 'A' }] },
      { attachmentIds: Array.from({ length: 6 }, () => '01a1e4c4-9df1-7383-b26e-30a72afdf091') },
      { attachmentIds: ['01a1e4c4-9df1-7383-b26e-30a72afdf091'] },
    ]) {
      expect((await ask(idea.code, body)).status, JSON.stringify(body).slice(0, 60)).toBe(422);
    }
  });

  it('quem pede não aprova o próprio pedido; o mesmo aprovador duas vezes → 422', async () => {
    const idea = await review('Sem autoaprovação');
    const self = await ask(idea.code, { recipients: [{ userId: uid.ana }] });
    expect(self.status).toBe(422);
    expect(self.body.code).toBe('approval_self');
    const twice = await ask(idea.code, {
      recipients: [
        { name: 'A', email: 'a@empresa.com.br', area: 'X' },
        { name: 'A de novo', email: 'A@empresa.com.br', area: 'Y' },
      ],
    });
    expect(twice.status).toBe(422);
  });

  it('e-mail de quem já tem usuário ativo vira aprovador do ITS (sem link)', async () => {
    const idea = await review('E-mail de quem tem usuário');
    const res = await ask(idea.code, {
      recipients: [{ name: 'Gestor', email: 'gestor@empresa.com.br', area: 'Produção' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.requests[0]?.recipients[0]).toMatchObject({ kind: 'user', userId: uid.gestor, email: null });
  });

  it('CA-RN-190.3 com domínios cadastrados e e-mail de fora proibido → 422 approval_outside_domain', async () => {
    const idea = await review('Domínio de fora');
    await admin.request('PATCH', '/settings', { values: { 'approval.allow_outside_domains': false } });
    await t.db.dataSource.query(
      `INSERT INTO setting (key, value) VALUES ('auth.email_domains', '["empresa.com.br"]') ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
    const res = await ask(idea.code, {
      recipients: [{ name: 'Fora', email: 'alguem@outra.com', area: 'Consultoria' }],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('approval_outside_domain');
    await admin.request('PATCH', '/settings', { values: { 'approval.allow_outside_domains': true } });
    expect(
      (await ask(idea.code, { recipients: [{ name: 'Fora', email: 'alguem@outra.com', area: 'Consultoria' }] })).status,
    ).toBe(201);
    await t.db.dataSource.query(`DELETE FROM setting WHERE key = 'auth.email_domains'`);
  });

  it('CA-RN-183.5 CA-RN-188.1 o pedido que segura a implementação não segura a aprovação; segura implementar', async () => {
    const idea = await review('Segura a implementação');
    expect((await ask(idea.code, { holds: 'implement' })).status).toBe(201);
    const approved = await approve(idea.code);
    expect(approved.status).toBe(200);
    const stepId = approved.body.steps[0]!.id;
    expect((await c.ana!.post(`/ideas/${idea.code}/steps/${stepId}/complete`, {})).status).toBe(200);
    const res = await c.ana!.post<{ code: string }>(`/ideas/${idea.code}/implement`, { resultText: 'Feito' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('approval_pending');
  });

  it('CA-RN-188.4 modo devolver: não aprovada segura até "seguir sem a aprovação", com justificativa', async () => {
    const idea = await review('Recusada e seguida');
    const created = await ask(idea.code, {});
    const id = created.body.requests[0]!.id;
    // A decisão chega na fatia 2; aqui o pedido é marcado como não aprovado direto no banco.
    await t.db.dataSource.query(`UPDATE approval_request SET status = 'rejected', closed_at = now() WHERE id = $1`, [
      id,
    ]);
    const held = await approve(idea.code);
    expect(held.status).toBe(409);
    expect(held.body.code).toBe('approval_not_obtained');
    expect((await c.ana!.post(`/ideas/${idea.code}/approvals/${id}/override`, {})).status).toBe(422);
    const ok = await c.ana!.post<View>(`/ideas/${idea.code}/approvals/${id}/override`, {
      reason: 'Diretoria liberou em reunião',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.requests[0]?.overrideReason).toBe('Diretoria liberou em reunião');
    expect((await approve(idea.code)).status).toBe(200);
    const events = await t.db.dataSource.query(
      `SELECT type, reason, visibility FROM idea_event WHERE idea_id = $1 AND type = 'approval_overridden'`,
      [idea.id],
    );
    expect(events).toEqual([
      { type: 'approval_overridden', reason: 'Diretoria liberou em reunião', visibility: 'internal' },
    ]);
  });

  it('CA-RN-188.5 modo bloquear: "seguir sem a aprovação" → 403 e a transição continua segura', async () => {
    await admin.request('PATCH', '/settings', { values: { 'approval.on_reject': 'block' } });
    const idea = await review('Recusada e bloqueada');
    const id = (await ask(idea.code, {})).body.requests[0]!.id;
    await t.db.dataSource.query(`UPDATE approval_request SET status = 'rejected', closed_at = now() WHERE id = $1`, [
      id,
    ]);
    const res = await c.ana!.post<{ code: string }>(`/ideas/${idea.code}/approvals/${id}/override`, {
      reason: 'Quero seguir',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('approval_override_blocked');
    expect((await approve(idea.code)).status).toBe(409);
    await admin.request('PATCH', '/settings', { values: { 'approval.on_reject': 'return' } });
  });

  it('não autorizar a ideia fecha o pedido aberto e invalida os links', async () => {
    const idea = await review('Fecha ao recusar');
    expect((await ask(idea.code, {})).status).toBe(201);
    expect((await c.ana!.post(`/ideas/${idea.code}/reject`, { reason: 'Fora do escopo' })).status).toBe(200);
    const [r] = await t.db.dataSource.query(`SELECT status, cancelled_by FROM approval_request WHERE idea_id = $1`, [
      idea.id,
    ]);
    expect(r).toEqual({ status: 'cancelled', cancelled_by: null });
    const decisions = await t.db.dataSource.query(
      `SELECT decision FROM approval_recipient WHERE request_id IN (SELECT id FROM approval_request WHERE idea_id = $1)`,
      [idea.id],
    );
    expect(decisions.every((d: { decision: string }) => d.decision === 'void')).toBe(true);
  });

  it('CA-RN-190.1 o autor vê só a situação; a equipe e o gestor veem os detalhes', async () => {
    const idea = await review('Quem vê o quê');
    expect((await ask(idea.code, {})).status).toBe(201);
    const author = await c.colab!.get<View>(`/ideas/${idea.code}/approvals`);
    expect(author.status).toBe(200);
    expect(author.body).toMatchObject({ state: 'pending', full: false, canManage: false, requests: [], form: null });
    expect(JSON.stringify(author.body)).not.toContain('gerente@');
    const team = await c.ana!.get<View>(`/ideas/${idea.code}/approvals`);
    expect(team.body.full).toBe(true);
    expect(Object.keys(team.body.form ?? {}).sort()).toEqual([
      'allowOutsideDomains',
      'defaultDays',
      'emailActive',
      'emailDomains',
    ]);
    expect(team.body.requests[0]?.recipients[0]?.email).toBe('gerente@empresa.com.br');
    const manager = await c.gestor!.get<View>(`/ideas/${idea.code}/approvals`);
    expect(manager.body).toMatchObject({ full: true, canManage: false });
  });

  it('um anexo mostrado num pedido aberto não pode ser removido', async () => {
    const idea = await review('Anexo no pedido');
    const up = await c.colab!.upload<{ id: string }>(
      `/ideas/${idea.code}/attachments`,
      'planta.pdf',
      Buffer.from('%PDF-1.4 teste'),
      'application/pdf',
    );
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const attachmentId =
      up.body.id ?? (await t.db.dataSource.query(`SELECT id FROM attachment WHERE idea_id = $1`, [idea.id]))[0].id;
    expect((await ask(idea.code, { attachmentIds: [attachmentId] })).status).toBe(201);
    const res = await c.ana!.request<{ code: string }>('DELETE', `/ideas/${idea.code}/attachments/${attachmentId}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('attachment_in_approval');
  });
});
