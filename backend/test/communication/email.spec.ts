import 'reflect-metadata';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { EmailLog, EmailStatus, MailProvider, Notification } from '../../src/communication/entities.js';
import { runDailyDigest } from '../../src/communication/jobs.js';
import { deliverEmail, MAX_ATTEMPTS } from '../../src/communication/mail.js';
import { open } from '../../src/communication/secret-box.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { pgBossTypeormAdapter } from '../../src/jobs/pg-boss-typeorm.adapter.js';
import { EMAIL_QUEUE, enqueuePendingEmails, setupQueues } from '../../src/jobs/queues.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { FakeSmtp } from '../support/fake-smtp.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface ProviderView {
  configured: boolean;
  host: string | null;
  port: number | null;
  username: string | null;
  passwordSet: boolean;
  active: boolean;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  secretKeyReady: boolean;
  appUrl: string;
}
interface Detail {
  code: string;
}
interface TemplateView {
  key: string;
  locale: string;
  subject: string;
  customized: boolean;
}

const SMTP_USER = 'its-smtp';
const SMTP_PASS = 'S3nha-do-SMTP!-xyz';
// 07:00 em São Paulo (fuso da instalação nos testes) = 10:00 UTC.
const AT_0659 = new Date('2030-01-10T09:59:00Z');
const AT_0701 = new Date('2030-01-10T10:01:00Z');
const NEXT_DAY_0701 = new Date('2030-01-11T10:01:00Z');

describe('E-mail: provedor, resumo diário, modelos e envios (M4)', () => {
  let t: TestApp;
  let smtp: FakeSmtp;
  let admin: Client;
  const uid: Record<string, string> = {};
  const c: Record<string, Client> = {};
  let entityId: string;
  let categoryId: string;
  const responses: unknown[] = [];

  async function user(key: string, roleKey: string, locale = 'pt-BR') {
    const ds = t.db.dataSource;
    const repo = ds.getRepository(User);
    const u = await repo.save(
      repo.create({
        email: `${key}@example.test`,
        name: key,
        locale,
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

  const providerInput = (password?: string | null) => ({
    host: '127.0.0.1',
    port: smtp.port,
    security: 'none',
    username: SMTP_USER,
    ...(password === undefined ? {} : { password }),
    fromAddress: 'ideias@example.test',
    fromName: 'Ideias Org',
  });
  const adminCall = async <T>(method: string, path: string, body?: unknown) => {
    const res = await admin.request<T>(method, path, body);
    responses.push(res.body);
    return res;
  };
  const logs = () => t.db.dataSource.getRepository(EmailLog).find({ order: { createdAt: 'ASC' } });
  /** Três eventos para o autor: envio, início da triagem e aprovação. */
  async function threeEvents(author: string) {
    const idea = await c[author]!.post<Detail>('/ideas', { title: 'Faixa', description: 'x', entityId, categoryId });
    expect(idea.status).toBe(201);
    await c.analista!.post(`/ideas/${idea.body.code}/start-review`);
    const approved = await c.analista!.post(`/ideas/${idea.body.code}/approve`, {
      stepName: 'Planejar',
      assigneeId: uid.analista,
      dueDate: '2099-12-31',
    });
    expect(approved.status).toBe(200);
    return idea.body.code;
  }

  beforeAll(async () => {
    smtp = new FakeSmtp({ user: SMTP_USER, pass: SMTP_PASS });
    await smtp.start();
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    entityId = (await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' })).id;
    categoryId = (
      await ds.getRepository(Category).save(ds.getRepository(Category).create({ name: 'Qualidade', color: '#4f46e5' }))
    ).id;
    await user('analista', 'analyst');
    await user('colab1', 'collaborator');
    await user('colab2', 'collaborator', 'en');
  });
  afterAll(async () => {
    await t?.close();
    await smtp?.stop();
  });

  it('CA-RN-90.1 instalação nova: envio desligado; ligar sem provedor ou sem teste → recusa', async () => {
    const view = await adminCall<ProviderView>('GET', '/admin/email/provider');
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ configured: false, active: false, secretKeyReady: true, appUrl: '' });
    expect((await adminCall('POST', '/admin/email/provider/activate')).status).toBe(409);

    const saved = await adminCall<ProviderView>('PUT', '/admin/email/provider', providerInput('senha-errada-123'));
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ configured: true, active: false, passwordSet: true, username: SMTP_USER });
    const refused = await adminCall<{ code: string }>('POST', '/admin/email/provider/activate');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('email_test_required');
    expect((await admin.get<{ emailEnabled: boolean }>('/settings/public')).body.emailEnabled).toBe(false);
  });

  it('CA-RN-90.5 só quem tem email.manage vê ou altera o provedor', async () => {
    for (const who of ['analista', 'colab1']) {
      expect((await c[who]!.get('/admin/email/provider')).status).toBe(403);
      expect((await c[who]!.request('PUT', '/admin/email/provider', providerInput('x'))).status).toBe(403);
      expect((await c[who]!.get('/admin/email/log')).status).toBe(403);
      expect((await c[who]!.get('/admin/email/templates')).status).toBe(403);
    }
  });

  it('CA-RN-30.2 com o envio desligado, nenhum envio é tentado (o SMTP falso não recebe conexão)', async () => {
    await threeEvents('colab1');
    const pending = await t.db.dataSource.getRepository(Notification).countBy({ emailState: 'pending' as never });
    expect(pending).toBe(0);
    expect(await runDailyDigest(t.db.dataSource, AT_0701)).toBe(0);
    expect((await c.analista!.post('/auth/password-reset/request', { email: 'colab1@example.test' })).status).toBe(202);
    expect(await logs()).toEqual([]);
    expect(smtp.connections).toBe(0);
  });

  it('CA-RN-90.2 teste com falha mostra o motivo sem a senha; com sucesso, habilita ligar', async () => {
    const failed = await adminCall<{ ok: boolean; error: string }>('POST', '/admin/email/provider/test', {
      to: 'admin@example.test',
    });
    expect(failed.status).toBe(200);
    expect(failed.body.ok).toBe(false);
    expect(failed.body.error).toMatch(/535|auth/i);
    expect(failed.body.error).not.toContain('senha-errada-123');
    expect((await adminCall('POST', '/admin/email/provider/activate')).status).toBe(409);

    await adminCall('PUT', '/admin/email/provider', providerInput(SMTP_PASS));
    const ok = await adminCall<{ ok: boolean; error: string | null }>('POST', '/admin/email/provider/test', {
      to: 'admin@example.test',
    });
    expect(ok.body).toEqual({ ok: true, error: null });
    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]).toMatchObject({ to: ['admin@example.test'], subject: 'E-mail de teste | Org' });
    expect(smtp.messages[0]!.text).toContain('Enviado por Admin Teste.');

    // Sem o endereço do sistema não liga (os links dos e-mails dependem dele).
    const noUrl = await adminCall<{ code: string }>('POST', '/admin/email/provider/activate');
    expect(noUrl.body.code).toBe('app_url_required');
    const url = await admin.request('PATCH', '/settings', { values: { 'email.app_url': 'http://127.0.0.1:8080/' } });
    expect(url.status).toBe(200);
    const on = await adminCall<ProviderView>('POST', '/admin/email/provider/activate');
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ active: true, lastTestOk: true, appUrl: 'http://127.0.0.1:8080' });
    expect((await admin.get<{ emailEnabled: boolean }>('/settings/public')).body.emailEnabled).toBe(true);
  });

  it('CA-RN-90.3 a senha fica cifrada no banco e nenhuma rota a devolve; regravar sem senha mantém a atual', async () => {
    const row = await t.db.dataSource.getRepository(MailProvider).findOneOrFail({ where: {} });
    expect(row.configEncrypted.toString('latin1')).not.toContain(SMTP_PASS);
    expect(row.configEncrypted.toString('latin1')).not.toContain(SMTP_USER);
    expect(JSON.parse(open(row.configEncrypted)).password).toBe(SMTP_PASS);

    const all = JSON.stringify(responses);
    expect(all).not.toContain(SMTP_PASS);
    expect(all).not.toContain('senha-errada-123');
    expect(all).not.toMatch(/"password"/);

    // Regravar sem mandar a senha mantém a gravada, mas desliga até novo teste.
    const resaved = await adminCall<ProviderView>('PUT', '/admin/email/provider', providerInput());
    expect(resaved.body).toMatchObject({ passwordSet: true, active: false, lastTestOk: null });
    expect(
      (await adminCall<{ ok: boolean }>('POST', '/admin/email/provider/test', { to: 'a@example.test' })).body.ok,
    ).toBe(true);
    expect((await adminCall<ProviderView>('POST', '/admin/email/provider/activate')).body.active).toBe(true);
  });

  it('CA-RN-90.5 / CA-RN-39.2 as credenciais não aparecem no log de auditoria', async () => {
    const rows = await t.db.dataSource.getRepository(AuditLog).find();
    const text = JSON.stringify(rows);
    expect(rows.some((r) => r.action === 'email.provider_updated')).toBe(true);
    expect(rows.some((r) => r.action === 'email.activated')).toBe(true);
    expect(text).not.toContain(SMTP_PASS);
    expect(text).not.toContain('senha-errada-123');
  });

  it('CA-RN-31.1 três eventos no mesmo dia viram 1 e-mail no horário configurado; CA-T.1 rodar de novo não repete', async () => {
    smtp.reset();
    expect((await admin.request('PATCH', '/settings', { values: { 'email.digest_time': '07:00' } })).status).toBe(200);
    const code = await threeEvents('colab1');

    expect(await runDailyDigest(t.db.dataSource, AT_0659)).toBe(0);
    expect(await runDailyDigest(t.db.dataSource, AT_0701)).toBe(1);
    expect(await runDailyDigest(t.db.dataSource, AT_0701)).toBe(0);

    const queued = (await logs()).filter((l) => l.kind === 'digest');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ toAddress: 'colab1@example.test', status: 'pending', userId: uid.colab1 });
    // O corpo fica cifrado no banco.
    expect(queued[0]!.bodyEncrypted.toString('latin1')).not.toContain(code);

    expect(await deliverEmail(t.db.dataSource, queued[0]!.id)).toBe('sent');
    expect(await deliverEmail(t.db.dataSource, queued[0]!.id)).toBe('skipped');
    expect(smtp.messages).toHaveLength(1);
    const mail = smtp.messages[0]!;
    expect(mail.subject).toBe('Resumo do dia: 3 aviso(s) | Org');
    expect(mail.text).toContain('Olá, colab1.');
    expect(mail.text).toContain(`${code} · Faixa: recebemos a sua ideia`);
    expect(mail.text).toContain(`${code} · Faixa: a sua ideia entrou em análise`);
    expect(mail.text).toContain(`${code} · Faixa: a sua ideia foi aprovada`);
    expect(mail.text).toContain(`http://127.0.0.1:8080/ideias/${code}`);
    expect(mail.text).toContain('http://127.0.0.1:8080/notificacoes');
  });

  it('CA-RN-31.2 sem eventos no dia, nenhum e-mail', async () => {
    expect(await runDailyDigest(t.db.dataSource, NEXT_DAY_0701)).toBe(0);
    expect((await logs()).filter((l) => l.kind === 'digest')).toHaveLength(1);
  });

  it('CA-RN-32.1 o admin edita o modelo e o próximo envio usa o novo texto; variável inexistente é recusada', async () => {
    const list = await adminCall<TemplateView[]>('GET', '/admin/email/templates');
    expect(list.body).toHaveLength(12); // 6 modelos (pedido, código e lembrete da aprovação, M24) × 2 línguas
    expect(list.body.every((x) => !x.customized)).toBe(true);

    const bad = await adminCall<{ code: string }>('PUT', '/admin/email/templates/digest/pt-BR', {
      subject: 'Resumo {{senha}}',
      body: '{{items}}',
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('unknown_variable');
    expect(
      (await adminCall('PUT', '/admin/email/templates/nao-existe/pt-BR', { subject: 'a', body: 'b' })).status,
    ).toBe(404);

    const saved = await adminCall<TemplateView[]>('PUT', '/admin/email/templates/digest/pt-BR', {
      subject: 'Novidades de {{organization}}\r\nBcc: x@example.test',
      body: 'Oi {{name}}, {{count}} novidade(s):\n{{items}}',
    });
    expect(saved.status).toBe(200);
    const edited = saved.body.find((x) => x.key === 'digest' && x.locale === 'pt-BR')!;
    expect(edited).toMatchObject({ customized: true, subject: 'Novidades de {{organization}} Bcc: x@example.test' });

    smtp.reset();
    await threeEvents('colab1');
    await threeEvents('colab2'); // inglês: continua no modelo de fábrica em inglês
    expect(await runDailyDigest(t.db.dataSource, NEXT_DAY_0701)).toBe(2);
    for (const l of (await logs()).filter((x) => x.status === 'pending')) await deliverEmail(t.db.dataSource, l.id);
    const pt = smtp.messages.find((m) => m.to[0] === 'colab1@example.test')!;
    const en = smtp.messages.find((m) => m.to[0] === 'colab2@example.test')!;
    expect(pt.subject).toBe('Novidades de Org Bcc: x@example.test');
    expect(pt.text).toMatch(/^Oi colab1, 3 novidade\(s\):/);
    expect(en.subject).toBe('Daily summary: 3 notice(s) | Org');
    expect(en.text).toContain('your idea was approved');

    const reset = await adminCall<TemplateView[]>('DELETE', '/admin/email/templates/digest/pt-BR');
    expect(reset.body.find((x) => x.key === 'digest' && x.locale === 'pt-BR')?.customized).toBe(false);
  });

  it('esqueci minha senha: a resposta é sempre igual; o link vai por e-mail e funciona', async () => {
    smtp.reset();
    // Um link gerado pelo administrador agora há pouco não impede o pedido por e-mail.
    expect((await admin.post(`/users/${uid.colab1}/password-link`)).status).toBe(200);
    const before = (await logs()).length;
    const anon = new Client(t.baseUrl);
    expect((await anon.post('/auth/password-reset/request', { email: 'ninguem@example.test' })).status).toBe(202);
    expect((await anon.post('/auth/password-reset/request', { email: 'colab1@example.test' })).status).toBe(202);
    expect((await anon.post('/auth/password-reset/request', { email: 'colab1@example.test' })).status).toBe(202);
    const created = (await logs()).slice(before);
    expect(created).toHaveLength(1); // conta inexistente não gera; o segundo pedido em 2 min também não
    expect(created[0]).toMatchObject({ kind: 'password_reset', toAddress: 'colab1@example.test' });
    expect(created[0]!.bodyEncrypted.toString('latin1')).not.toContain('definir-senha');
    expect(smtp.connections).toBe(0); // a API só enfileira; quem envia é o worker

    expect(await deliverEmail(t.db.dataSource, created[0]!.id)).toBe('sent');
    const mail = smtp.messages[0]!;
    expect(mail.subject).toBe('Redefinir sua senha | Org');
    const token = /http:\/\/127\.0\.0\.1:8080\/definir-senha#([\w-]+)/.exec(mail.text)?.[1];
    expect(token).toBeTruthy();
    const next = 'Outra-Senha-Boa-2026';
    expect((await anon.post('/auth/password-reset/redeem', { token, newPassword: next })).status).toBe(204);
    expect((await anon.post('/auth/login', { email: 'colab1@example.test', password: next })).status).toBe(200);
    const audit = JSON.stringify(await t.db.dataSource.getRepository(AuditLog).find());
    expect(audit).not.toContain(token);
  });

  it('CA-RN-90.4 falha → novas tentativas até o limite; depois "failed" com o erro visível; "tentar de novo" reenvia', async () => {
    smtp.reset();
    smtp.failWith = '451 4.3.0 Caixa temporariamente indisponível';
    const idOf = async () => (await logs()).at(-1)!.id;
    await new Client(t.baseUrl).post('/auth/password-reset/request', { email: 'colab2@example.test' });
    const id = await idOf();

    const outcomes: string[] = [];
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) outcomes.push(await deliverEmail(t.db.dataSource, id));
    expect(outcomes).toEqual(['retry', 'retry', 'retry', 'retry', 'failed', 'skipped']);
    const failed = await t.db.dataSource.getRepository(EmailLog).findOneByOrFail({ id });
    expect(failed).toMatchObject({ status: EmailStatus.Failed, attempts: MAX_ATTEMPTS });
    expect(failed.lastError).toContain('451');
    expect(failed.lastError).not.toContain(SMTP_PASS);

    const page = await adminCall<{ items: { id: string; lastError: string; attempts: number }[] }>(
      'GET',
      '/admin/email/log?status=failed',
    );
    expect(page.body.items.map((x) => x.id)).toEqual([id]);
    expect(page.body.items[0]!.lastError).toContain('451');

    expect((await adminCall('POST', `/admin/email/log/${id}/retry`)).status).toBe(204);
    expect((await adminCall('POST', `/admin/email/log/${id}/retry`)).status).toBe(409);
    smtp.failWith = null;
    expect(await deliverEmail(t.db.dataSource, id)).toBe('sent');
    expect(smtp.messages.at(-1)!.to).toEqual(['colab2@example.test']);
    expect(smtp.messages.at(-1)!.subject).toBe('Reset your password | Org');
  });

  it('a fila de saída vira job no pg-boss uma única vez, com novas tentativas configuradas', async () => {
    const boss = new PgBoss({ db: pgBossTypeormAdapter(t.db.dataSource), schema: 'pgboss' });
    await boss.start();
    try {
      await setupQueues(boss);
      await new Client(t.baseUrl).post('/auth/password-reset/request', { email: 'analista@example.test' });
      const [n1, n2] = await Promise.all([
        enqueuePendingEmails(t.db.dataSource, boss),
        enqueuePendingEmails(t.db.dataSource, boss),
      ]);
      expect(n1 + n2).toBe(1);
      expect(await enqueuePendingEmails(t.db.dataSource, boss)).toBe(0);
      const queued = (await logs()).at(-1)!;
      expect(queued.queuedAt).not.toBeNull();
      const jobs: { data: { emailId: string }; retry_limit: number; retry_backoff: boolean }[] =
        await t.db.dataSource.query('SELECT data, retry_limit, retry_backoff FROM pgboss.job WHERE name = $1', [
          EMAIL_QUEUE,
        ]);
      expect(jobs.map((j) => j.data.emailId)).toEqual([queued.id]);
      expect(jobs[0]).toMatchObject({ retry_limit: MAX_ATTEMPTS - 1, retry_backoff: true });
    } finally {
      await boss.stop({ graceful: true });
    }
  });

  it('desligar o envio: o que estava na fila falha com motivo claro e o "Esqueci minha senha" some', async () => {
    await new Client(t.baseUrl).post('/auth/password-reset/request', { email: 'admin@example.test' });
    const id = (await logs()).at(-1)!.id;
    expect((await adminCall<ProviderView>('POST', '/admin/email/provider/deactivate')).body.active).toBe(false);
    expect(await deliverEmail(t.db.dataSource, id)).toBe('failed');
    // Grava o código; a tela traduz no idioma de quem lê (M28).
    expect((await t.db.dataSource.getRepository(EmailLog).findOneByOrFail({ id })).lastError).toBe('mail_disabled');
    expect((await admin.get<{ emailEnabled: boolean }>('/settings/public')).body.emailEnabled).toBe(false);
  });
});
