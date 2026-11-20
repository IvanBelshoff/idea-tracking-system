import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { approvalLinkLimiter } from '../../src/approvals/approval-decisions.service.js';
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
  steps: { id: string }[];
}
interface Recipient {
  id: string;
  kind: string;
  decision: string;
  source: string | null;
  decidedName: string | null;
  recordedBy: string | null;
  evidence: { id: string; originalName: string }[];
}
interface View {
  state: string;
  requests: { id: string; status: string; recipients: Recipient[] }[];
}
interface LinkView {
  state: string;
  request: Record<string, unknown> | null;
  codeRequired: boolean;
  decision: string | null;
}

describe('Aprovação de outras áreas: decidir pelo link, no ITS e pelo registro manual (M24, RN-184 a RN-188)', () => {
  let t: TestApp;
  let admin: Client;
  let entityId: string;
  let categoryId: string;
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  const anon = () => new Client(t.baseUrl);

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
    if (roleKey) {
      const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: roleKey });
      await ds
        .getRepository(UserRoleScope)
        .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId }));
    }
    uid[key] = u.id;
    c[key] = new Client(t.baseUrl);
    expect(
      (await c[key].post('/auth/login', { email: `${key}@empresa.com.br`, password: STRONG_PASSWORD })).status,
    ).toBe(200);
  }
  const review = async (title: string) => {
    const res = await c.colab!.post<Detail>('/ideas', {
      title,
      description: 'Descrição secreta da ideia',
      entityId,
      categoryId,
    });
    expect(res.status).toBe(201);
    expect((await c.ana!.post(`/ideas/${res.body.code}/start-review`, {})).status).toBe(200);
    return res.body;
  };
  const ask = async (code: string, recipients: Record<string, unknown>[], extra: Record<string, unknown> = {}) => {
    const res = await c.ana!.post<View>(`/ideas/${code}/approvals`, {
      holds: 'approve',
      summary: 'Resumo escrito para o aprovador.',
      recipients,
      ...extra,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  /** O link sai do e-mail cifrado na fila (o banco não guarda o link). */
  const linkFor = async (email: string): Promise<string> => {
    const rows = await t.db.dataSource.getRepository(EmailLog).find({
      where: { kind: 'approval_request', toAddress: email },
      order: { createdAt: 'DESC' },
    });
    const body = open(rows[0]!.bodyEncrypted);
    return /\/aprovar#([A-Za-z0-9_-]+)/.exec(body)?.[1] ?? '';
  };
  const view = (token: string) => anon().post<LinkView & { code?: string }>('/approvals/link/view', { token });
  const decide = (token: string, body: Record<string, unknown>) =>
    anon().post<LinkView & { code?: string }>('/approvals/link/decide', { token, name: 'Gerente Fulano', ...body });
  const approveIdea = (code: string) =>
    c.ana!.post<{ code?: string }>(`/ideas/${code}/approve`, {
      stepName: 'Fazer',
      assigneeId: uid.ana,
      dueDate: '2099-12-31',
    });
  const ext = (n: string) => ({ name: `Gerente ${n}`, email: `${n}@empresa.com.br`, area: `Área ${n}` });

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
    await person('fora', '');
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
  // O arquivo inteiro roda de um IP só: cada caso começa com a janela do limite zerada.
  beforeEach(() => approvalLinkLimiter.clear());

  it('o link tem limite por IP: a 31ª tentativa no mesmo minuto → 429', async () => {
    for (let i = 0; i < 30; i++) expect((await view('y'.repeat(43))).status).toBe(404);
    expect((await view('y'.repeat(43))).status).toBe(429);
  });

  it('CA-RN-184.1 CA-RN-184.2 o link abre sem login e mostra só o que o pedido congelou', async () => {
    const idea = await review('Ideia do link');
    await ask(idea.code, [ext('um')]);
    const token = await linkFor('um@empresa.com.br');
    const res = await view(token);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('open');
    expect(Object.keys(res.body.request ?? {}).sort()).toEqual(
      ['area', 'attachments', 'dueOn', 'gain', 'ideaCode', 'ideaTitle', 'name', 'requestedBy', 'summary'].sort(),
    );
    expect(res.body.request).toMatchObject({ ideaTitle: 'Ideia do link', summary: 'Resumo escrito para o aprovador.' });
    expect(JSON.stringify(res.body)).not.toContain('Descrição secreta');
    const raw = await fetch(`${t.baseUrl}/api/approvals/link/view`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(raw.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('CA-RN-184.1 CA-T.28 link inventado ou alterado → 404, sem dizer mais nada', async () => {
    const token = await linkFor('um@empresa.com.br');
    const altered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect((await view(altered)).status).toBe(404);
    expect((await view('x'.repeat(43))).status).toBe(404);
    expect((await view('curto')).status).toBe(404);
  });

  it('CA-RN-184.5 mudar a ideia depois do pedido não muda o que a página mostra', async () => {
    const [row] = await t.db.dataSource.query(`SELECT i.code FROM idea i WHERE i.title = 'Ideia do link'`);
    expect((await c.ana!.request('PATCH', `/ideas/${row.code}`, { title: 'Título novo' })).status).toBe(200);
    const res = await view(await linkFor('um@empresa.com.br'));
    expect(res.body.request?.ideaTitle).toBe('Ideia do link');
  });

  it('CA-RN-184.3 não aprovar sem motivo → 422; aprovar grava nome, data e IP; o link não aceita outra decisão', async () => {
    const token = await linkFor('um@empresa.com.br');
    const noReason = await decide(token, { decision: 'rejected' });
    expect(noReason.status).toBe(422);
    const ok = await decide(token, { decision: 'approved', comment: 'Pode seguir' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ state: 'decided', decision: 'approved', request: null });
    const [r] = await t.db.dataSource.query(
      `SELECT decision, source, decided_name, decided_ip, decided_at FROM approval_recipient WHERE email = 'um@empresa.com.br'`,
    );
    expect(r).toMatchObject({ decision: 'approved', source: 'link', decided_name: 'Gerente Fulano' });
    expect(r.decided_ip).toBeTruthy();
    expect(r.decided_at).toBeTruthy();
    const again = await decide(token, { decision: 'rejected', comment: 'Mudei de ideia' });
    expect(again.status).toBe(409);
    expect((await view(token)).body).toMatchObject({ state: 'decided', request: null });
  });

  it('CA-RN-188.2 com o "sim" de todos, o pedido fica aprovado e a transição é liberada', async () => {
    const [row] = await t.db.dataSource.query(`SELECT i.code FROM idea i WHERE i.title = 'Título novo'`);
    const v = await c.ana!.get<View>(`/ideas/${row.code}/approvals`);
    expect(v.body.state).toBe('approved');
    expect(v.body.requests[0]?.status).toBe('approved');
    expect((await approveIdea(row.code)).status).toBe(200);
    const events = await t.db.dataSource.query(
      `SELECT type, visibility FROM idea_event WHERE type IN ('approval_decided', 'approval_completed') ORDER BY id`,
    );
    expect(events.map((e: { type: string }) => e.type)).toEqual(['approval_decided', 'approval_completed']);
    // A decisão (com nome e comentário) é interna; o resultado é público (o autor vê só o resultado).
    expect(events[0].visibility).toBe('internal');
    expect(events[1].visibility).toBe('public');
  });

  it('CA-RN-188.3 uma recusa fecha o pedido como não aprovado; o link de quem faltava passa a dizer "encerrado"', async () => {
    const idea = await review('Ideia recusada');
    await ask(idea.code, [ext('dois'), ext('tres')]);
    const a = await linkFor('dois@empresa.com.br');
    const b = await linkFor('tres@empresa.com.br');
    expect((await decide(a, { decision: 'approved' })).status).toBe(200);
    expect((await approveIdea(idea.code)).body.code).toBe('approval_pending');
    expect((await decide(b, { decision: 'rejected', comment: 'Afeta a segurança' })).status).toBe(200);
    const v = await c.ana!.get<View>(`/ideas/${idea.code}/approvals`);
    expect(v.body.requests[0]?.status).toBe('rejected');
    expect((await approveIdea(idea.code)).body.code).toBe('approval_not_obtained');
    // Nenhuma decisão muda a situação da ideia sozinha (CA-RN-188.6).
    const [i] = await t.db.dataSource.query(`SELECT status FROM idea WHERE id = $1`, [idea.id]);
    expect(i.status).toBe('in_review');
  });

  it('CA-RN-184.4 link de pedido cancelado ou vencido não aceita decisão', async () => {
    const idea = await review('Ideia cancelada');
    const created = await ask(idea.code, [ext('quatro')]);
    const token = await linkFor('quatro@empresa.com.br');
    await c.ana!.post(`/ideas/${idea.code}/approvals/${created.requests[0]!.id}/cancel`, { reason: 'Desistimos' });
    expect((await view(token)).body).toMatchObject({ state: 'cancelled', request: null });
    expect((await decide(token, { decision: 'approved' })).status).toBe(409);

    const late = await review('Ideia vencida');
    await ask(late.code, [ext('cinco')]);
    const lateToken = await linkFor('cinco@empresa.com.br');
    await t.db.dataSource.query(
      `UPDATE approval_request SET expires_at = now() - interval '1 minute' WHERE idea_id = $1`,
      [late.id],
    );
    expect((await view(lateToken)).body.state).toBe('expired');
    expect((await decide(lateToken, { decision: 'approved' })).status).toBe(409);
  });

  it('anexos pelo link: só os escolhidos e só com o link aberto', async () => {
    const idea = await review('Ideia com anexo');
    const up = await c.colab!.upload<{ id: string }>(
      `/ideas/${idea.code}/attachments`,
      'planta.pdf',
      Buffer.from('%PDF-1.4 conteúdo da planta'),
      'application/pdf',
    );
    expect(up.status).toBe(201);
    const other = await c.colab!.upload<{ id: string }>(
      `/ideas/${idea.code}/attachments`,
      'interno.pdf',
      Buffer.from('%PDF-1.4 não escolhido'),
      'application/pdf',
    );
    await ask(idea.code, [ext('seis')], { attachmentIds: [up.body.id] });
    const token = await linkFor('seis@empresa.com.br');
    const file = await fetch(`${t.baseUrl}/api/approvals/link/attachment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, attachmentId: up.body.id }),
    });
    expect(file.status).toBe(200);
    expect(await file.text()).toContain('conteúdo da planta');
    const notChosen = await anon().post('/approvals/link/attachment', { token, attachmentId: other.body.id });
    expect(notChosen.status).toBe(404);
    await decide(token, { decision: 'approved' });
    expect((await anon().post('/approvals/link/attachment', { token, attachmentId: up.body.id })).status).toBe(404);
  });

  it('CA-RN-185.1 CA-RN-185.2 com o código ligado: sem código → 422; o código vai por e-mail; errar 5 vezes esgota', async () => {
    await admin.request('PATCH', '/settings', { values: { 'approval.email_code': true } });
    const idea = await review('Ideia com código');
    await ask(idea.code, [ext('sete')]);
    const token = await linkFor('sete@empresa.com.br');
    expect((await view(token)).body.codeRequired).toBe(true);
    const without = await decide(token, { decision: 'approved' });
    expect(without.status).toBe(422);
    expect(without.body.code).toBe('approval_code_required');
    expect((await anon().post('/approvals/link/code', { token })).status).toBe(202);
    const mail = await t.db.dataSource.getRepository(EmailLog).findOne({
      where: { kind: 'approval_code', toAddress: 'sete@empresa.com.br' },
      order: { createdAt: 'DESC' },
    });
    const code = /\b(\d{6})\b/.exec(open(mail!.bodyEncrypted))?.[1] ?? '';
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await decide(token, { decision: 'approved', code: wrong });
      expect(res.body.code).toBe('approval_code_invalid');
    }
    const exhausted = await decide(token, { decision: 'approved', code });
    expect(exhausted.body.code).toBe('approval_code_expired');
    // Um código novo destrava.
    expect((await anon().post('/approvals/link/code', { token })).status).toBe(202);
    const fresh = await t.db.dataSource.getRepository(EmailLog).findOne({
      where: { kind: 'approval_code', toAddress: 'sete@empresa.com.br' },
      order: { createdAt: 'DESC' },
    });
    const code2 = /\b(\d{6})\b/.exec(open(fresh!.bodyEncrypted))?.[1] ?? '';
    const ok = await decide(token, { decision: 'approved', code: code2 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await admin.request('PATCH', '/settings', { values: { 'approval.email_code': false } });
  });

  it('CA-RN-185.3 o código nunca aparece na auditoria nem no banco em texto', async () => {
    const audit = JSON.stringify(
      await t.db.dataSource.query(`SELECT data FROM audit_log WHERE action LIKE 'approval.%'`),
    );
    expect(audit).not.toMatch(/code_hash|"code"/);
    const [r] = await t.db.dataSource.query(
      `SELECT code_hash FROM approval_recipient WHERE email = 'sete@empresa.com.br'`,
    );
    expect(r.code_hash).toBeNull();
  });

  it('CA-RN-186.1 CA-RN-186.2 quem tem usuário vê em Aprovações pendentes e só ele decide a parte dele', async () => {
    const idea = await review('Ideia para o gestor e para alguém sem acesso');
    await ask(idea.code, [{ userId: uid.gestor }, { userId: uid.fora }]);
    const mine =
      await c.gestor!.get<{ recipientId: string; ideaTitle: string; canOpenIdea: boolean }[]>('/approvals/pending');
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({
      ideaTitle: 'Ideia para o gestor e para alguém sem acesso',
      canOpenIdea: true,
    });
    const outsider = await c.fora!.get<{ recipientId: string; canOpenIdea: boolean }[]>('/approvals/pending');
    expect(outsider.body[0]?.canOpenIdea).toBe(false);
    const stranger = await c.ana!.post(`/approvals/recipients/${mine.body[0]!.recipientId}/decide`, {
      decision: 'approved',
    });
    expect(stranger.status).toBe(403);
    expect(
      (await c.gestor!.post(`/approvals/recipients/${mine.body[0]!.recipientId}/decide`, { decision: 'approved' }))
        .status,
    ).toBe(200);
    expect((await c.gestor!.get<unknown[]>('/approvals/pending')).body).toHaveLength(0);
    const v = await c.ana!.get<View>(`/ideas/${idea.code}/approvals`);
    expect(v.body.requests[0]?.recipients.find((r) => r.kind === 'user' && r.decision === 'approved')?.source).toBe(
      'its',
    );
  });

  it('CA-RN-187.1 CA-RN-187.3 registro manual: sem evidência → 422; tipo proibido → 415; com evidência, marcado como registrado', async () => {
    const idea = await review('Ideia aprovada em reunião');
    const created = await ask(idea.code, [ext('oito')]);
    const req = created.requests[0]!;
    const path = `/ideas/${idea.code}/approvals/${req.id}/recipients/${req.recipients[0]!.id}/record`;
    const fields = { decision: 'approved', decidedName: 'Diretor Beltrano', decidedOn: '2026-11-10' };
    const form = (files: { name: string; content: string }[]) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.append(k, v);
      for (const file of files) f.append('files', new Blob([file.content]), file.name);
      return f;
    };
    const send = (f: FormData) =>
      fetch(`${t.baseUrl}/api${path}`, { method: 'POST', headers: { cookie: c.ana!.cookie ?? '' }, body: f });
    const none = await send(form([]));
    expect(none.status).toBe(422);
    expect((await none.json()).code).toBe('approval_evidence_required');
    expect((await send(form([{ name: 'virus.exe', content: 'MZ' }]))).status).toBe(415);
    const ok = await send(form([{ name: 'ata.pdf', content: '%PDF-1.4 ata da reunião' }]));
    expect(ok.status, await ok.clone().text()).toBe(200);
    const v = await c.ana!.get<View>(`/ideas/${idea.code}/approvals`);
    const r = v.body.requests[0]!.recipients[0]!;
    expect(r).toMatchObject({
      decision: 'approved',
      source: 'manual',
      decidedName: 'Diretor Beltrano',
      recordedBy: 'Pessoa ana',
    });
    expect(r.evidence[0]?.originalName).toBe('ata.pdf');
    // A evidência: a equipe baixa; o autor não.
    const evidencePath = `/ideas/${idea.code}/approvals/evidence/${r.evidence[0]!.id}`;
    expect((await c.ana!.raw(evidencePath)).status).toBe(200);
    expect((await c.colab!.raw(evidencePath)).status).toBe(404);
    // Data no futuro é recusada.
    const future = await review('Data no futuro');
    const f2 = await ask(future.code, [ext('nove')]);
    const p2 = `/ideas/${future.code}/approvals/${f2.requests[0]!.id}/recipients/${f2.requests[0]!.recipients[0]!.id}/record`;
    const fd = new FormData();
    fd.append('decision', 'approved');
    fd.append('decidedName', 'Alguém');
    fd.append('decidedOn', '2099-01-01');
    fd.append('files', new Blob(['%PDF-1.4']), 'ata.pdf');
    expect(
      (await fetch(`${t.baseUrl}/api${p2}`, { method: 'POST', headers: { cookie: c.ana!.cookie ?? '' }, body: fd }))
        .status,
    ).toBe(422);
  });

  it('CA-RN-187.2 com o envio de e-mail desligado, quem é de fora não recebe link; o registro manual continua', async () => {
    await t.db.dataSource.query('UPDATE mail_provider SET active = false');
    const idea = await review('Sem e-mail');
    const created = await ask(idea.code, [ext('dez')]);
    const [r] = await t.db.dataSource.query(
      `SELECT token_hash FROM approval_recipient WHERE email = 'dez@empresa.com.br'`,
    );
    expect(r.token_hash).toBeNull();
    expect(await t.db.dataSource.getRepository(EmailLog).countBy({ toAddress: 'dez@empresa.com.br' })).toBe(0);
    const req = created.requests[0]!;
    const fd = new FormData();
    fd.append('decision', 'rejected');
    fd.append('decidedName', 'Gerente Dez');
    fd.append('decidedOn', '2026-11-15');
    fd.append('comment', 'Não neste ano');
    fd.append('files', new Blob(['e-mail salvo']), 'resposta.eml');
    const path = `/ideas/${idea.code}/approvals/${req.id}/recipients/${req.recipients[0]!.id}/record`;
    // .eml não está na lista de fábrica: a regra de anexos da instalação vale (RN-21).
    expect(
      (await fetch(`${t.baseUrl}/api${path}`, { method: 'POST', headers: { cookie: c.ana!.cookie ?? '' }, body: fd }))
        .status,
    ).toBe(415);
    const fd2 = new FormData();
    for (const [k, v] of [
      ['decision', 'rejected'],
      ['decidedName', 'Gerente Dez'],
      ['decidedOn', '2026-11-15'],
      ['comment', 'Não neste ano'],
    ]) {
      fd2.append(k as string, v as string);
    }
    fd2.append('files', new Blob(['%PDF-1.4 e-mail impresso']), 'resposta.pdf');
    expect(
      (await fetch(`${t.baseUrl}/api${path}`, { method: 'POST', headers: { cookie: c.ana!.cookie ?? '' }, body: fd2 }))
        .status,
    ).toBe(200);
    await t.db.dataSource.query('UPDATE mail_provider SET active = true');
  });

  it('CA-T.28 nenhum link aparece no banco; o resumo do link de um não abre o pedido de outro', async () => {
    const dump = JSON.stringify(await t.db.dataSource.query('SELECT * FROM approval_recipient'));
    for (const email of ['um@empresa.com.br', 'dois@empresa.com.br', 'seis@empresa.com.br']) {
      expect(dump).not.toContain(await linkFor(email));
    }
    const [row] = await t.db.dataSource.query(
      `SELECT token_hash FROM approval_recipient WHERE token_hash IS NOT NULL LIMIT 1`,
    );
    // O próprio resumo usado como link não abre nada.
    expect((await view(row.token_hash)).status).toBe(404);
  });
});
