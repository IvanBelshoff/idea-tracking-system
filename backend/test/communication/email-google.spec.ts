import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { EmailLog, MailProvider } from '../../src/communication/entities.js';
import { deliverEmail, MAX_ATTEMPTS, queueEmail } from '../../src/communication/mail.js';
import { clearGoogleTokenCache } from '../../src/communication/mail-google.js';
import { open } from '../../src/communication/secret-box.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { FakeGoogle, makeServiceAccount } from '../support/fake-google.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

const MAILBOX = 'nao-responder@example.test';

interface ProviderView {
  configured: boolean;
  type: string;
  host: string | null;
  tenantId: string | null;
  serviceAccountEmail: string | null;
  serviceAccountKeySet: boolean;
  replyTo: string | null;
  secretExpiresOn: string | null;
  fromAddress: string | null;
  fromName: string | null;
  active: boolean;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}
interface Err {
  code: string;
}

describe('E-mail pelo Google Workspace (M15, integração com o Google falso)', () => {
  let t: TestApp;
  let admin: Client;
  let colab: Client;
  const fake = new FakeGoogle();
  const responses: unknown[] = [];
  const saved = {
    token: process.env.MAIL_GOOGLE_TOKEN_OVERRIDE,
    gmail: process.env.MAIL_GMAIL_BASE_OVERRIDE,
  };

  const googleInput = (over: Record<string, unknown> = {}) => ({
    type: 'google_workspace',
    serviceAccountJson: fake.account.json,
    fromAddress: MAILBOX,
    fromName: 'ITS Ideias',
    replyTo: 'contato@example.test',
    secretExpiresOn: '2030-06-30',
    ...over,
  });
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await admin.request<T>(method, path, body);
    responses.push(res.body);
    return res;
  };
  const view = async () => (await call<ProviderView>('GET', '/admin/email/provider')).body;
  const save = (over: Record<string, unknown> = {}) =>
    call<ProviderView & Err>('PUT', '/admin/email/provider', googleInput(over));
  const logs = () => t.db.dataSource.getRepository(EmailLog).find({ order: { createdAt: 'ASC' } });
  const enqueue = async (to = 'pessoa@example.test') =>
    (
      await queueEmail(t.db.dataSource.manager, {
        kind: 'test',
        userId: null,
        to,
        subject: 'Assunto',
        body: 'Texto do e-mail',
      })
    ).id;
  const logOf = (id: string) => t.db.dataSource.getRepository(EmailLog).findOneByOrFail({ id });

  beforeAll(async () => {
    await fake.start();
    process.env.MAIL_GOOGLE_TOKEN_OVERRIDE = fake.tokenUrl;
    process.env.MAIL_GMAIL_BASE_OVERRIDE = fake.base;
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    // Uma colaboradora, sem permissão de e-mail.
    const ds = t.db.dataSource;
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: 'collaborator' });
    const users = ds.getRepository(User);
    const u = await users.save(
      users.create({ email: 'colab@example.test', name: 'colab', passwordHash: await hashPassword(STRONG_PASSWORD) }),
    );
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId: org.id }));
    colab = new Client(t.baseUrl);
    expect((await colab.post('/auth/login', { email: 'colab@example.test', password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  });
  afterAll(async () => {
    for (const [key, value] of [
      ['MAIL_GOOGLE_TOKEN_OVERRIDE', saved.token],
      ['MAIL_GMAIL_BASE_OVERRIDE', saved.gmail],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await t?.close();
    await fake.stop();
  });
  beforeEach(() => {
    clearGoogleTokenCache();
    fake.reset();
  });

  it('CA-RN-101.1 cadastra o provedor Google; dado inválido → 400; sem a chave na primeira vez → 422', async () => {
    expect((await save({ fromAddress: 'sem-arroba' })).status).toBe(400);
    expect((await save({ secretExpiresOn: '2030-13-45' })).status).toBe(400);
    expect((await save({ replyTo: 'nao-e-email' })).status).toBe(400);
    const none = await save({ serviceAccountJson: undefined });
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('service_account_required');

    const ok = await save();
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      configured: true,
      type: 'google_workspace',
      host: null,
      tenantId: null,
      serviceAccountEmail: fake.account.email,
      serviceAccountKeySet: true,
      replyTo: 'contato@example.test',
      secretExpiresOn: '2030-06-30',
      fromAddress: MAILBOX,
      fromName: 'ITS Ideias',
      active: false,
      lastTestOk: null,
    });
  });

  it('CA-RN-101.2 JSON que não é chave de conta de serviço é recusado (422), sem repetir o conteúdo', async () => {
    const base = JSON.parse(fake.account.json) as Record<string, unknown>;
    for (const bad of [
      'isto não é json',
      JSON.stringify({ ...base, type: 'authorized_user' }),
      JSON.stringify({ ...base, private_key: 'chave-privada-falsa-123' }),
    ]) {
      const res = await save({ serviceAccountJson: bad });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('invalid_service_account');
      expect(JSON.stringify(res.body)).not.toContain('chave-privada-falsa-123');
    }
    // O provedor gravado antes continua intacto.
    expect(await view()).toMatchObject({ type: 'google_workspace', serviceAccountKeySet: true });
  });

  it('CA-RN-101.2 a chave fica cifrada e nunca volta pela API nem pela auditoria; só o e-mail da conta aparece', async () => {
    const row = await t.db.dataSource.getRepository(MailProvider).findOneByOrFail({ type: 'google_workspace' });
    expect(row.configEncrypted.includes(Buffer.from('PRIVATE KEY'))).toBe(false);
    const stored = JSON.parse(open(row.configEncrypted)) as Record<string, string>;
    expect(stored.privateKey).toBe(fake.account.privatePem);
    expect(Object.keys(stored).sort()).toEqual(['clientEmail', 'privateKey', 'replyTo']);
    const audits = await t.db.dataSource.getRepository(AuditLog).find({ where: { action: 'email.provider_updated' } });
    const text = JSON.stringify(audits.map((a) => a.data));
    expect(text).not.toContain('PRIVATE KEY');
    expect(text).toContain(fake.account.email);
    expect(audits.some((a) => (a.data as { expiresOn?: string }).expiresOn === '2030-06-30')).toBe(true);
    expect(JSON.stringify(await view())).not.toContain('PRIVATE KEY');
  });

  it('CA-RN-101.4 ligar sem teste bem-sucedido é recusado', async () => {
    const res = await call<Err>('POST', '/admin/email/provider/activate');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('email_test_required');
  });

  it('CA-RN-101.3 o e-mail de teste sai pelo Gmail: JWT assinado em nome da caixa, nome e "responder para" no cabeçalho', async () => {
    const res = await call<{ ok: boolean; error: string | null }>('POST', '/admin/email/provider/test', {
      to: 'admin@example.test',
    });
    expect(res.body).toEqual({ ok: true, error: null });
    expect(fake.lastClaims).toMatchObject({
      iss: fake.account.email,
      sub: MAILBOX,
      scope: 'https://www.googleapis.com/auth/gmail.send',
    });
    expect(fake.sent).toHaveLength(1);
    const mail = fake.sent[0]!;
    expect(mail.mailbox).toBe(MAILBOX);
    expect(mail.mime).toMatch(/^From: ITS Ideias <nao-responder@example\.test>$/m);
    expect(mail.mime).toMatch(/^To: admin@example\.test$/m);
    expect(mail.mime).toMatch(/^Reply-To: contato@example\.test$/m);
    expect(await view()).toMatchObject({ lastTestOk: true, lastTestError: null });
    const audit = await t.db.dataSource
      .getRepository(AuditLog)
      .find({ where: { action: 'email.test_sent' }, order: { id: 'DESC' }, take: 1 });
    expect(audit[0]?.data).toEqual({ ok: true, type: 'google_workspace' });
  });

  it('CA-RN-101.3 teste com a delegação recusada mostra o motivo sem a chave e não habilita ligar', async () => {
    await save(); // volta a exigir teste
    fake.tokenError = { status: 400, code: 'unauthorized_client' };
    const res = await call<{ ok: boolean; error: string }>('POST', '/admin/email/provider/test', {
      to: 'admin@example.test',
    });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('unauthorized_client');
    for (const leak of ['PRIVATE KEY', 'descricao-com']) expect(res.body.error).not.toContain(leak);
    expect(await view()).toMatchObject({ lastTestOk: false });
    expect((await call('POST', '/admin/email/provider/activate')).status).toBe(409);
  });

  it('CA-RN-101.4 liga depois de um teste certo e do endereço do sistema; mudar o provedor desliga e zera o teste', async () => {
    expect((await call('POST', '/admin/email/provider/test', { to: 'admin@example.test' })).status).toBe(200);
    expect((await call<Err>('POST', '/admin/email/provider/activate')).body.code).toBe('app_url_required');
    expect(
      (await admin.request('PATCH', '/settings', { values: { 'email.app_url': 'http://127.0.0.1:8080' } })).status,
    ).toBe(200);
    const on = await call<ProviderView>('POST', '/admin/email/provider/activate');
    expect(on.status).toBe(200);
    expect(on.body.active).toBe(true);

    const changed = await save({ replyTo: 'outro@example.test' });
    expect(changed.body).toMatchObject({ active: false, lastTestOk: null });
  });

  it('CA-RN-101.5 a entrega pela fila usa o Gmail, com o texto do e-mail', async () => {
    await call('POST', '/admin/email/provider/test', { to: 'admin@example.test' });
    await call('POST', '/admin/email/provider/activate');
    fake.reset();

    const id = await enqueue();
    expect(await deliverEmail(t.db.dataSource, id)).toBe('sent');
    expect(await deliverEmail(t.db.dataSource, id)).toBe('skipped');
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ mailbox: MAILBOX });
    expect(fake.sent[0]?.mime).toContain('Texto do e-mail');
    expect(await logOf(id)).toMatchObject({ status: 'sent', attempts: 1, lastError: null });
  });

  it('CA-RN-101.6 token revogado (401): renova e entrega; o token é reaproveitado entre envios', async () => {
    const a = await enqueue();
    const b = await enqueue();
    expect(await deliverEmail(t.db.dataSource, a)).toBe('sent');
    expect(await deliverEmail(t.db.dataSource, b)).toBe('sent');
    expect(fake.tokenRequests).toBe(1);

    fake.revokeAll();
    const c = await enqueue();
    expect(await deliverEmail(t.db.dataSource, c)).toBe('sent');
    expect(fake.tokenRequests).toBe(2);
    expect(fake.sent).toHaveLength(3);
  });

  it('CA-RN-101.7 caixa inexistente, delegação não autorizada ou sem permissão: falha na hora, sem repetir', async () => {
    fake.knownMailboxes = ['outra-caixa@example.test'];
    const missing = await enqueue();
    expect(await deliverEmail(t.db.dataSource, missing)).toBe('failed');
    const log = await logOf(missing);
    expect(log).toMatchObject({ status: 'failed', attempts: 1 });
    expect(log.lastError).toContain('invalid_grant');
    expect(fake.sent).toHaveLength(0);

    fake.knownMailboxes = [];
    clearGoogleTokenCache();
    fake.tokenError = { status: 400, code: 'unauthorized_client' };
    const unauthorized = await enqueue();
    expect(await deliverEmail(t.db.dataSource, unauthorized)).toBe('failed');
    expect((await logOf(unauthorized)).lastError).toContain('unauthorized_client');

    fake.tokenError = null;
    clearGoogleTokenCache();
    fake.sendError = { status: 403, code: 'PERMISSION_DENIED', reason: 'forbidden' };
    const denied = await enqueue();
    expect(await deliverEmail(t.db.dataSource, denied)).toBe('failed');
    const deniedLog = await logOf(denied);
    expect(deniedLog.attempts).toBe(1);
    expect(deniedLog.lastError).toContain('HTTP 403: PERMISSION_DENIED/forbidden');
    for (const leak of ['PRIVATE KEY', 'corpo-com-dado', 'detalhe-sensivel', 'descricao-com'])
      expect(deniedLog.lastError ?? '').not.toContain(leak);
  });

  it('CA-RN-101.8 limite de uso (429), cota (403 de limite) e indisponibilidade (503) são repetidos, e o limite de tentativas vale', async () => {
    fake.sendError = { status: 503, code: 'UNAVAILABLE' };
    const id = await enqueue();
    expect(await deliverEmail(t.db.dataSource, id)).toBe('retry');
    expect(await logOf(id)).toMatchObject({ status: 'pending', attempts: 1 });
    fake.sendError = null;
    expect(await deliverEmail(t.db.dataSource, id)).toBe('sent');

    fake.sendError = { status: 403, code: 'PERMISSION_DENIED', reason: 'userRateLimitExceeded' };
    const quota = await enqueue();
    expect(await deliverEmail(t.db.dataSource, quota)).toBe('retry');

    fake.sendError = { status: 429, code: 'RESOURCE_EXHAUSTED' };
    const stuck = await enqueue();
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) outcomes.push(await deliverEmail(t.db.dataSource, stuck));
    expect(outcomes.slice(0, -1).every((o) => o === 'retry')).toBe(true);
    expect(outcomes.at(-1)).toBe('failed');
    expect(await logOf(stuck)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
  });

  it('CA-RN-100.5 trocar a chave sem informar a data apaga a data antiga; informando, grava; mantendo a chave, mantém', async () => {
    expect((await save({ secretExpiresOn: '2031-01-15' })).body.secretExpiresOn).toBe('2031-01-15');
    // Mantém a chave (campo ausente) e não manda data: a data continua.
    expect((await save({ serviceAccountJson: undefined, secretExpiresOn: undefined })).body.secretExpiresOn).toBe(
      '2031-01-15',
    );
    // Chave nova sem data: a data antiga era da chave antiga.
    const other = makeServiceAccount(fake.account.email);
    expect(
      (await save({ serviceAccountJson: other.json, secretExpiresOn: undefined })).body.secretExpiresOn,
    ).toBeNull();
    // Chave nova com data nova.
    expect((await save({ serviceAccountJson: other.json, secretExpiresOn: '2032-02-01' })).body.secretExpiresOn).toBe(
      '2032-02-01',
    );
    // Data nula explícita apaga.
    expect((await save({ serviceAccountJson: undefined, secretExpiresOn: null })).body.secretExpiresOn).toBeNull();
    // Volta à chave que o Google falso conhece.
    await save();
  });

  it('CA-RN-101.12 trocar o tipo desliga; Google sem chave guardada de um SMTP anterior exige colar a chave de novo', async () => {
    const smtp = await call<ProviderView>('PUT', '/admin/email/provider', {
      host: '127.0.0.1',
      port: 2525,
      security: 'none',
      username: null,
      fromAddress: 'ideias@example.test',
      fromName: 'Ideias',
    });
    expect(smtp.status).toBe(200);
    expect(smtp.body).toMatchObject({
      type: 'smtp',
      serviceAccountKeySet: false,
      serviceAccountEmail: null,
      active: false,
    });
    const back = await save({ serviceAccountJson: undefined });
    expect(back.status).toBe(422);
    expect((await save()).body).toMatchObject({ type: 'google_workspace', host: null, serviceAccountKeySet: true });
  });

  it('CA-RN-101.11 só quem tem email.manage vê ou altera o provedor', async () => {
    expect((await colab.get('/admin/email/provider')).status).toBe(403);
    expect((await colab.put('/admin/email/provider', googleInput())).status).toBe(403);
    expect((await colab.post('/admin/email/provider/test', { to: 'x@example.test' })).status).toBe(403);
  });

  it('CA-T.12 nenhuma chave, JWT ou token do Google aparece em respostas, auditoria ou nos erros gravados', async () => {
    const audits = await t.db.dataSource.getRepository(AuditLog).find();
    const everything = JSON.stringify([
      responses,
      audits.map((a) => [a.action, a.data]),
      (await logs()).map((l) => l.lastError),
    ]);
    for (const leak of ['PRIVATE KEY', 'chave-privada', 'corpo-com-dado', 'detalhe-sensivel', 'descricao-com']) {
      expect(everything).not.toContain(leak);
    }
    expect(everything).not.toMatch(/fake-google-token-/);
    expect(everything).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
  });
});
