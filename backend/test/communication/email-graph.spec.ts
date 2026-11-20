import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { EmailLog, MailProvider } from '../../src/communication/entities.js';
import { deliverEmail, MAX_ATTEMPTS, queueEmail } from '../../src/communication/mail.js';
import { clearGraphTokenCache } from '../../src/communication/mail-graph.js';
import { open } from '../../src/communication/secret-box.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { FakeGraph } from '../support/fake-graph.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

const TENANT = '11111111-2222-3333-4444-555555555555';
const MAILBOX = 'nao-responder@example.test';
const OBJECT_ID = 'dc2b4937-b4b2-4d1e-9dc6-b3e2ccb9c422';
const CLIENT = { id: 'mail-client-id', secret: 'mail-client-secret' };

interface ProviderView {
  configured: boolean;
  type: string;
  host: string | null;
  tenantId: string | null;
  clientId: string | null;
  clientSecretSet: boolean;
  mailboxId: string | null;
  replyTo: string | null;
  secretExpiresOn: string | null;
  fromAddress: string | null;
  active: boolean;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}
interface Err {
  code: string;
}

describe('E-mail pela Microsoft Graph (M14, integração com o Graph falso)', () => {
  let t: TestApp;
  let admin: Client;
  let colab: Client;
  const fake = new FakeGraph();
  const responses: unknown[] = [];
  const saved = {
    login: process.env.MAIL_LOGIN_BASE_OVERRIDE,
    graph: process.env.MAIL_GRAPH_BASE_OVERRIDE,
  };

  const graphInput = (over: Record<string, unknown> = {}) => ({
    type: 'microsoft_graph',
    tenantId: TENANT,
    clientId: CLIENT.id,
    clientSecret: CLIENT.secret,
    fromAddress: MAILBOX,
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
    call<ProviderView & Err>('PUT', '/admin/email/provider', graphInput(over));
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
    process.env.MAIL_LOGIN_BASE_OVERRIDE = fake.base;
    process.env.MAIL_GRAPH_BASE_OVERRIDE = fake.base;
    fake.expectClient = CLIENT;
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
      ['MAIL_LOGIN_BASE_OVERRIDE', saved.login],
      ['MAIL_GRAPH_BASE_OVERRIDE', saved.graph],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await t?.close();
    await fake.stop();
  });
  beforeEach(() => {
    clearGraphTokenCache();
    fake.reset();
  });

  it('CA-RN-99.1 cadastra o provedor Microsoft; dado inválido → 400; sem o segredo na primeira vez → 422', async () => {
    expect((await save({ tenantId: 'isto não é tenant' })).status).toBe(400);
    expect((await save({ fromAddress: 'sem-arroba' })).status).toBe(400);
    expect((await save({ secretExpiresOn: '2030-13-45' })).status).toBe(400);
    expect((await save({ replyTo: 'nao-e-email' })).status).toBe(400);
    const none = await save({ clientSecret: undefined });
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('client_secret_required');

    const ok = await save();
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      configured: true,
      type: 'microsoft_graph',
      host: null,
      tenantId: TENANT,
      clientId: CLIENT.id,
      clientSecretSet: true,
      mailboxId: null,
      replyTo: 'contato@example.test',
      secretExpiresOn: '2030-06-30',
      fromAddress: MAILBOX,
      active: false,
      lastTestOk: null,
    });
  });

  it('CA-RN-99.2 o segredo fica cifrado e nunca volta pela API nem pela auditoria', async () => {
    const row = await t.db.dataSource.getRepository(MailProvider).findOneByOrFail({ type: 'microsoft_graph' });
    expect(row.configEncrypted.includes(Buffer.from(CLIENT.secret))).toBe(false);
    expect(JSON.parse(open(row.configEncrypted))).toMatchObject({ tenantId: TENANT, clientSecret: CLIENT.secret });
    const audits = await t.db.dataSource.getRepository(AuditLog).find({ where: { action: 'email.provider_updated' } });
    expect(JSON.stringify(audits.map((a) => a.data))).not.toContain(CLIENT.secret);
    // A validade vai à auditoria como dado comum (CA-RN-100.7), com chave sem "secret" no nome.
    expect(audits.some((a) => (a.data as { expiresOn?: string }).expiresOn === '2030-06-30')).toBe(true);
    expect(JSON.stringify(await view())).not.toContain(CLIENT.secret);
  });

  it('CA-RN-99.4 ligar sem teste bem-sucedido é recusado', async () => {
    const res = await call<Err>('POST', '/admin/email/provider/activate');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('email_test_required');
  });

  it('CA-RN-99.3 o e-mail de teste sai pelo Graph: token com o cliente e o segredo, caixa certa, sem guardar nos enviados', async () => {
    const res = await call<{ ok: boolean; error: string | null }>('POST', '/admin/email/provider/test', {
      to: 'admin@example.test',
    });
    expect(res.body).toEqual({ ok: true, error: null });
    expect(fake.lastTokenPath).toBe(`/${TENANT}/oauth2/v2.0/token`);
    expect(fake.sent).toHaveLength(1);
    const mail = fake.sent[0]!;
    expect(mail.mailbox).toBe(MAILBOX);
    expect(mail.saveToSentItems).toBe(false);
    expect(mail.message.body.contentType).toBe('Text');
    expect(mail.message.toRecipients).toEqual([{ emailAddress: { address: 'admin@example.test' } }]);
    expect(mail.message.replyTo).toEqual([{ emailAddress: { address: 'contato@example.test' } }]);
    expect(await view()).toMatchObject({ lastTestOk: true, lastTestError: null });
    const audit = await t.db.dataSource
      .getRepository(AuditLog)
      .find({ where: { action: 'email.test_sent' }, order: { id: 'DESC' }, take: 1 });
    expect(audit[0]?.data).toEqual({ ok: true, type: 'microsoft_graph' });
  });

  it('CA-RN-99.3 teste com a credencial recusada mostra o motivo sem o segredo e não habilita ligar', async () => {
    await save(); // volta a exigir teste
    fake.tokenError = 'invalid_client';
    const res = await call<{ ok: boolean; error: string }>('POST', '/admin/email/provider/test', {
      to: 'admin@example.test',
    });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('invalid_client');
    for (const leak of [CLIENT.secret, 'segredo-secreto', 'descricao-com']) expect(res.body.error).not.toContain(leak);
    expect(await view()).toMatchObject({ lastTestOk: false });
    expect((await call('POST', '/admin/email/provider/activate')).status).toBe(409);
  });

  it('CA-RN-99.4 liga depois de um teste certo e do endereço do sistema; mudar o provedor desliga e zera o teste', async () => {
    expect((await call('POST', '/admin/email/provider/test', { to: 'admin@example.test' })).status).toBe(200);
    expect(fake.sent).toHaveLength(1);
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

  it('CA-RN-99.5 a entrega pela fila usa o Graph, e o ID do objeto da caixa vale no lugar do endereço', async () => {
    await save({ mailboxId: OBJECT_ID });
    await call('POST', '/admin/email/provider/test', { to: 'admin@example.test' });
    expect(fake.sent[0]?.mailbox).toBe(OBJECT_ID);
    await call('POST', '/admin/email/provider/activate');
    fake.reset();

    const id = await enqueue();
    expect(await deliverEmail(t.db.dataSource, id)).toBe('sent');
    expect(await deliverEmail(t.db.dataSource, id)).toBe('skipped');
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ mailbox: OBJECT_ID });
    expect(fake.sent[0]?.message.body.content).toBe('Texto do e-mail');
    expect(await logOf(id)).toMatchObject({ status: 'sent', attempts: 1, lastError: null });
  });

  it('CA-RN-99.6 token revogado (401): renova e entrega; o token é reaproveitado entre envios', async () => {
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

  it('CA-RN-99.7 sem permissão na caixa (RBAC do Exchange) ou credencial recusada: falha na hora, sem repetir', async () => {
    fake.allowedMailboxes = ['outra-caixa@example.test'];
    const denied = await enqueue();
    expect(await deliverEmail(t.db.dataSource, denied)).toBe('failed');
    const log = await logOf(denied);
    expect(log).toMatchObject({ status: 'failed', attempts: 1 });
    expect(log.lastError).toContain('HTTP 403: ErrorAccessDenied');
    expect(fake.sent).toHaveLength(0);

    fake.allowedMailboxes = [];
    fake.sendError = { status: 404, code: 'ErrorInvalidUser' };
    const missing = await enqueue();
    expect(await deliverEmail(t.db.dataSource, missing)).toBe('failed');
    expect((await logOf(missing)).lastError).toContain('HTTP 404: ErrorInvalidUser');

    fake.sendError = null;
    clearGraphTokenCache();
    fake.tokenError = 'invalid_client';
    const bad = await enqueue();
    expect(await deliverEmail(t.db.dataSource, bad)).toBe('failed');
    const badLog = await logOf(bad);
    expect(badLog.attempts).toBe(1);
    expect(badLog.lastError).toContain('invalid_client');
    for (const leak of [CLIENT.secret, 'segredo-secreto', 'corpo-com-dado'])
      expect(badLog.lastError ?? '').not.toContain(leak);
  });

  it('CA-RN-99.8 limite de uso (429) e indisponibilidade (503) são repetidos, e o limite de tentativas vale', async () => {
    fake.sendError = { status: 503, code: 'ServiceNotAvailable' };
    const id = await enqueue();
    expect(await deliverEmail(t.db.dataSource, id)).toBe('retry');
    expect(await logOf(id)).toMatchObject({ status: 'pending', attempts: 1 });
    fake.sendError = null;
    expect(await deliverEmail(t.db.dataSource, id)).toBe('sent');

    fake.sendError = { status: 429, code: 'ApplicationThrottled' };
    const stuck = await enqueue();
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) outcomes.push(await deliverEmail(t.db.dataSource, stuck));
    expect(outcomes.slice(0, -1).every((o) => o === 'retry')).toBe(true);
    expect(outcomes.at(-1)).toBe('failed');
    expect(await logOf(stuck)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
  });

  it('CA-RN-100.5 trocar o segredo sem informar a data apaga a data antiga; informando, grava; mantendo o segredo, mantém', async () => {
    expect((await save({ secretExpiresOn: '2031-01-15' })).body.secretExpiresOn).toBe('2031-01-15');
    // Mantém o segredo (campo ausente) e não manda data: a data continua.
    expect((await save({ clientSecret: undefined, secretExpiresOn: undefined })).body.secretExpiresOn).toBe(
      '2031-01-15',
    );
    // Segredo novo sem data: a data antiga era do segredo antigo.
    expect(
      (await save({ clientSecret: 'segredo-novo-9999', secretExpiresOn: undefined })).body.secretExpiresOn,
    ).toBeNull();
    // Segredo novo com data nova.
    expect(
      (await save({ clientSecret: 'segredo-novo-8888', secretExpiresOn: '2032-02-01' })).body.secretExpiresOn,
    ).toBe('2032-02-01');
    // Data nula explícita apaga.
    expect((await save({ clientSecret: undefined, secretExpiresOn: null })).body.secretExpiresOn).toBeNull();
    // Volta ao segredo que o Graph falso conhece.
    await save();
  });

  it('CA-RN-99.12 um corpo sem `type` continua valendo como SMTP; trocar o tipo desliga e exige o segredo da Microsoft de novo', async () => {
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
      host: '127.0.0.1',
      tenantId: null,
      clientSecretSet: false,
      active: false,
    });
    // Voltar à Microsoft sem segredo: a configuração anterior era de SMTP, não há segredo para manter.
    const back = await save({ clientSecret: undefined });
    expect(back.status).toBe(422);
    expect((await save()).body).toMatchObject({ type: 'microsoft_graph', host: null, clientSecretSet: true });
  });

  it('CA-RN-99.11 só quem tem email.manage vê ou altera o provedor', async () => {
    expect((await colab.get('/admin/email/provider')).status).toBe(403);
    expect((await colab.put('/admin/email/provider', graphInput())).status).toBe(403);
    expect((await colab.post('/admin/email/provider/test', { to: 'x@example.test' })).status).toBe(403);
    expect((await new Client(t.baseUrl).get('/admin/email/provider')).status).toBe(401);
  });

  it('CA-T.12 nenhum segredo nem token do Graph aparece em respostas, auditoria ou nos erros gravados', async () => {
    expect(fake.issuedTokens.length + 1).toBeGreaterThan(0);
    const audits = await t.db.dataSource.getRepository(AuditLog).find();
    const everything = JSON.stringify([
      responses,
      audits.map((a) => [a.action, a.data]),
      (await logs()).map((l) => l.lastError),
    ]);
    for (const secret of [
      CLIENT.secret,
      'segredo-novo-9999',
      'segredo-novo-8888',
      'segredo-secreto',
      'corpo-com-dado',
    ]) {
      expect(everything).not.toContain(secret);
    }
    expect(everything).not.toMatch(/fake-graph-token-/);
  });
});
