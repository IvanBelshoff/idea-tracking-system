import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysToDay, todayInZone } from '../../src/common/dates.js';
import { EmailLog, MailProvider, Notification } from '../../src/communication/entities.js';
import { seal } from '../../src/communication/secret-box.js';
import { SsoProvider } from '../../src/identity-access/entities/sso-provider.entity.js';
import { AlertService } from '../../src/observability/alert.service.js';
import { HealthService } from '../../src/observability/health.service.js';
import { emailSecretItem, ssoSecretItem } from '../../src/observability/health-rules.js';
import { writeHeartbeat } from '../../src/observability/heartbeat.js';
import { daysLeft, SECRET_LIMITS, secretVerdict, worstVerdict } from '../../src/observability/secret-expiry.js';
import { Client, createTestApp, INSTALL_INPUT, type TestApp } from '../support/test-app.js';

const SP = 'America/Sao_Paulo';
const NOW = new Date('2026-11-10T15:00:00Z'); // 12:00 em São Paulo
const TODAY = '2026-11-10';
const inDays = (n: number) => addDaysToDay(TODAY, n);

describe('Validade dos segredos: regras puras (M14, RN-100)', () => {
  it('CA-RN-100.1 os dias são contados no fuso da instalação (virada de dia) e data ilegível vale "sem data"', () => {
    // 23:30 do dia 10 em São Paulo já é 02:30 do dia 11 em UTC.
    const lateNight = new Date('2026-11-11T02:30:00Z');
    expect(daysLeft('2026-11-11', lateNight, SP)).toBe(1);
    expect(daysLeft('2026-11-11', lateNight, 'UTC')).toBe(0);
    expect(daysLeft('2026-11-10', NOW, SP)).toBe(0);
    expect(daysLeft('2026-11-09', NOW, SP)).toBe(-1);
    for (const bad of [null, undefined, '', 'abc', '10/11/2026', '2026-02-30', '2026-13-01', '2026-1-1']) {
      expect(daysLeft(bad, NOW, SP), String(bad)).toBeNull();
    }
  });

  it('CA-RN-100.2 estados nos limites: 31 dias ok; 30 e 8 atenção; 7 e 0 falha; vencido falha; sem data atenção', () => {
    const at = (n: number | null) => secretVerdict(n === null ? null : inDays(n), NOW, SP);
    expect(SECRET_LIMITS).toEqual({ warningDays: 30, failedDays: 7 });
    expect(at(31)).toEqual({ state: 'ok', code: 'ok', days: 31 });
    expect(at(30)).toEqual({ state: 'warning', code: 'expiring', days: 30 });
    expect(at(8)).toEqual({ state: 'warning', code: 'expiring', days: 8 });
    expect(at(7)).toEqual({ state: 'failed', code: 'expiring', days: 7 });
    expect(at(0)).toEqual({ state: 'failed', code: 'expiring', days: 0 });
    expect(at(-1)).toEqual({ state: 'failed', code: 'expired', days: -1 });
    expect(at(null)).toEqual({ state: 'warning', code: 'no_date', days: null });
  });

  it('CA-RN-100.4 o pior de vários: falha vence atenção vence ok; no empate, o que vence primeiro', () => {
    const v = (n: number | null) => secretVerdict(n === null ? null : inDays(n), NOW, SP);
    expect(worstVerdict([])).toBeNull();
    expect(worstVerdict([v(60), v(5), v(20)])).toMatchObject({ state: 'failed', days: 5 });
    expect(worstVerdict([v(60), v(20), v(10)])).toMatchObject({ state: 'warning', days: 10 });
    expect(worstVerdict([v(null), v(25)])).toMatchObject({ state: 'warning', days: 25 });
    expect(worstVerdict([v(60), v(90)])).toMatchObject({ state: 'ok', days: 60 });
  });

  it('CA-RN-100.3 os itens: segredo fora de uso é "não se aplica"; falha de coleta é "unavailable"', () => {
    expect(emailSecretItem({ ok: true, data: { applicable: false, expiresOn: inDays(1) } }, NOW, SP)).toMatchObject({
      key: 'email_secret',
      state: 'ok',
      code: 'not_applicable',
    });
    expect(emailSecretItem({ ok: true, data: { applicable: true, expiresOn: inDays(3) } }, NOW, SP)).toMatchObject({
      state: 'failed',
      code: 'expiring',
      value: 3,
    });
    expect(emailSecretItem({ ok: false }, NOW, SP)).toMatchObject({ state: 'failed', code: 'unavailable' });
    expect(ssoSecretItem({ ok: true, data: { providers: [] } }, NOW, SP)).toMatchObject({ code: 'not_applicable' });
    expect(
      ssoSecretItem({ ok: true, data: { providers: [{ expiresOn: inDays(50) }, { expiresOn: inDays(2) }] } }, NOW, SP),
    ).toMatchObject({ key: 'sso_secret', state: 'failed', code: 'expiring', value: 2 });
    expect(ssoSecretItem({ ok: false }, NOW, SP)).toMatchObject({ state: 'failed', code: 'unavailable' });
  });
});

describe('Validade dos segredos: saúde, tela e alerta (M14, RN-100)', () => {
  let t: TestApp;
  let admin: Client;
  let health: HealthService;
  let alert: AlertService;
  let today: string;

  const ds = () => t.db.dataSource;
  const dayFromNow = (n: number) => addDaysToDay(today, n);
  const item = async (key: 'email_secret' | 'sso_secret') => (await health.evaluate()).items.find((i) => i.key === key);

  async function graphProvider(over: Partial<MailProvider> = {}) {
    const repo = ds().getRepository(MailProvider);
    await repo.clear();
    return repo.save(
      repo.create({
        type: 'microsoft_graph',
        name: 'Microsoft 365',
        configEncrypted: seal(
          JSON.stringify({ tenantId: 't', clientId: 'c', clientSecret: 's', mailboxId: null, replyTo: null }),
        ),
        fromAddress: 'its@example.test',
        fromName: null,
        active: true,
        lastTestAt: null,
        lastTestOk: true,
        lastTestError: null,
        secretExpiresOn: null,
        updatedById: null,
        ...over,
      }),
    );
  }
  async function ssoProvider(provider: 'microsoft' | 'google', over: Partial<SsoProvider> = {}) {
    const repo = ds().getRepository(SsoProvider);
    await repo.delete({ provider });
    return repo.save(
      repo.create({
        provider,
        clientId: 'c',
        tenantId: provider === 'microsoft' ? 'tenant.example.test' : null,
        configEncrypted: seal(JSON.stringify({ clientSecret: 's' })),
        enabled: true,
        lastTestOk: true,
        lastTestAt: new Date(),
        lastTestError: null,
        secretExpiresOn: null,
        updatedById: null,
        ...over,
      }),
    );
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    // API e worker dão sinal: só os segredos mexem na saúde.
    await writeHeartbeat(ds(), { process: 'api', startedAt: new Date(), storageFreePct: 80 });
    await writeHeartbeat(ds(), { process: 'worker', startedAt: new Date() });
    health = new HealthService(ds());
    alert = new AlertService(ds(), health);
    today = todayInZone(new Date(), SP);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-101.9 Google: a chave não vence por padrão (sem data o item "não se aplica"); com data valem os mesmos limites', async () => {
    const google = (secretExpiresOn: string | null, active = true) =>
      graphProvider({ type: 'google_workspace', name: 'Google Workspace', secretExpiresOn, active });
    await google(null);
    expect(await item('email_secret')).toMatchObject({ state: 'ok', code: 'not_applicable' });
    await google(dayFromNow(31));
    expect(await item('email_secret')).toMatchObject({ state: 'ok', code: 'ok', value: 31 });
    await google(dayFromNow(30));
    expect(await item('email_secret')).toMatchObject({ state: 'warning', code: 'expiring', value: 30 });
    await google(dayFromNow(7));
    expect(await item('email_secret')).toMatchObject({ state: 'failed', code: 'expiring', value: 7 });
    await google(dayFromNow(-1));
    expect(await item('email_secret')).toMatchObject({ state: 'failed', code: 'expired', value: -1 });
    await google(dayFromNow(-1), false); // envio desligado
    expect(await item('email_secret')).toMatchObject({ code: 'not_applicable' });
  });

  it('CA-RN-100.3 de fábrica e com SMTP ou envio desligado, o item do e-mail "não se aplica"', async () => {
    expect(await item('email_secret')).toMatchObject({ state: 'ok', code: 'not_applicable' });
    await ds()
      .getRepository(MailProvider)
      .save(
        ds()
          .getRepository(MailProvider)
          .create({
            type: 'smtp',
            name: 'SMTP',
            configEncrypted: seal('{}'),
            fromAddress: 'a@example.test',
            fromName: null,
            active: true,
            lastTestAt: null,
            lastTestOk: true,
            lastTestError: null,
            secretExpiresOn: dayFromNow(1),
            updatedById: null,
          }),
      );
    expect(await item('email_secret')).toMatchObject({ code: 'not_applicable' });
    await graphProvider({ active: false, secretExpiresOn: dayFromNow(1) });
    expect(await item('email_secret')).toMatchObject({ code: 'not_applicable' });
  });

  it('CA-RN-100.2 com o envio Microsoft ligado, o item segue os limites e a tela da saúde o devolve', async () => {
    const expect_ = async (offset: number | null, state: string, code: string, value: number | null) => {
      await graphProvider({ secretExpiresOn: offset === null ? null : dayFromNow(offset) });
      expect(await item('email_secret'), String(offset)).toMatchObject({ state, code, value });
    };
    await expect_(31, 'ok', 'ok', 31);
    await expect_(30, 'warning', 'expiring', 30);
    await expect_(8, 'warning', 'expiring', 8);
    await expect_(7, 'failed', 'expiring', 7);
    await expect_(-1, 'failed', 'expired', -1);
    await expect_(null, 'warning', 'no_date', null);

    const api = await admin.get<{ items: { key: string; state: string; code: string }[] }>('/ops/health');
    expect(api.body.items.map((i) => i.key)).toContain('email_secret');
    expect(api.body.items.find((i) => i.key === 'sso_secret')).toMatchObject({ code: 'not_applicable' });
  });

  it('CA-RN-100.4 o item do login considera só os provedores ligados e mostra o pior', async () => {
    await ssoProvider('microsoft', { secretExpiresOn: dayFromNow(60) });
    await ssoProvider('google', { secretExpiresOn: dayFromNow(5), enabled: false });
    expect(await item('sso_secret')).toMatchObject({ state: 'ok', code: 'ok', value: 60 });
    await ssoProvider('google', { secretExpiresOn: dayFromNow(5) });
    expect(await item('sso_secret')).toMatchObject({ state: 'failed', code: 'expiring', value: 5 });
    await ssoProvider('google', { secretExpiresOn: null });
    await ssoProvider('microsoft', { secretExpiresOn: dayFromNow(60) });
    expect(await item('sso_secret')).toMatchObject({ state: 'warning', code: 'no_date' });
    await ds().query('UPDATE sso_provider SET enabled = false');
    expect(await item('sso_secret')).toMatchObject({ code: 'not_applicable' });
  });

  it('CA-RN-100.5 e 100.7 o login corporativo: trocar o segredo sem data apaga a antiga; a data vai à tela e à auditoria', async () => {
    const put = (body: Record<string, unknown>) =>
      admin.put<{
        sso: { providers: { provider: string; secretExpiresOn: string | null; clientSecretSet: boolean }[] };
      }>('/admin/access/providers/microsoft', { clientId: 'c', tenantId: 'tenant.example.test', ...body });
    const date = async (res: ReturnType<typeof put>) =>
      (await res).body.sso.providers.find((p) => p.provider === 'microsoft')?.secretExpiresOn;
    await ds().getRepository(SsoProvider).clear();
    expect(await date(put({ clientSecret: 'segredo-1', secretExpiresOn: '2031-05-01' }))).toBe('2031-05-01');
    expect(await date(put({}))).toBe('2031-05-01'); // mantém o segredo e a data
    expect(await date(put({ clientSecret: 'segredo-2' }))).toBeNull(); // segredo novo, sem data
    expect(await date(put({ secretExpiresOn: '2032-06-02' }))).toBe('2032-06-02'); // só a data
    expect(await date(put({ secretExpiresOn: null }))).toBeNull();
    expect((await put({ secretExpiresOn: '2031-13-01' })).status).toBe(400);
    // Só a data mudou: o provedor não é desligado nem o teste zerado.
    await ds().getRepository(SsoProvider).update({ provider: 'microsoft' }, { enabled: true, lastTestOk: true });
    await put({ secretExpiresOn: '2033-01-01' });
    expect(await ds().getRepository(SsoProvider).findOneByOrFail({ provider: 'microsoft' })).toMatchObject({
      enabled: true,
      lastTestOk: true,
      secretExpiresOn: '2033-01-01',
    });
    const audits = await ds().query(
      `SELECT data FROM audit_log WHERE action = 'sso.provider_updated' ORDER BY id DESC LIMIT 1`,
    );
    expect(audits[0].data).toMatchObject({ expiresOn: '2033-01-01' });
    expect(JSON.stringify(audits)).not.toContain('segredo-');
  });

  it('CA-RN-100.6 segredo a 7 dias dispara o alerta uma vez; a volta só depois de duas conferências com o segredo trocado', async () => {
    await ds().query('UPDATE sso_provider SET enabled = false');
    await ds().query('DELETE FROM ops_alert_state');
    await ds().query('DELETE FROM notification');
    await ds().query('DELETE FROM email_log');
    const notices = (type: string) => ds().getRepository(Notification).find({ where: { type } });

    await graphProvider({ secretExpiresOn: dayFromNow(3) });
    expect(await alert.check()).toMatchObject({ failed: ['email_secret'], recovered: [] });
    const failed = await notices('ops_failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]?.payload).toEqual({ items: ['email_secret'] });

    // Mesma falha na conferência seguinte: nada de aviso repetido.
    const before = (await notices('ops_failed')).length;
    await alert.check();
    expect((await notices('ops_failed')).length).toBe(before);

    // Segredo trocado (validade longe): a volta só vale depois de duas conferências limpas.
    await graphProvider({ secretExpiresOn: dayFromNow(120) });
    await alert.check();
    expect(await notices('ops_recovered')).toEqual([]);
    expect(await alert.check()).toMatchObject({ recovered: ['email_secret'] });
    expect((await notices('ops_recovered')).length).toBeGreaterThan(0);

    // Atenção (a 20 dias) não avisa.
    await ds().query('DELETE FROM notification');
    await graphProvider({ secretExpiresOn: dayFromNow(20) });
    await alert.check();
    expect(await notices('ops_failed')).toEqual([]);
    await ds().getRepository(EmailLog).clear();
  });
});
