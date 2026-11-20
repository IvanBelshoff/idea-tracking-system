import { createPublicKey, createVerify } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { googleEndpoints, parseServiceAccount } from '../../src/common/google.js';
import { clearGoogleTokenCache, googleTransport } from '../../src/communication/mail-google.js';
import { type GoogleConfig, MailSendError } from '../../src/communication/mail-transport.js';
import { makeServiceAccount } from '../support/fake-google.js';

const account = makeServiceAccount();
const config: GoogleConfig = { clientEmail: account.email, privateKey: account.privatePem, replyTo: null };
const message = {
  from: { name: 'ITS Ideias', address: 'its@example.test' },
  to: 'pessoa@example.test',
  subject: 'Olá, ação rápida',
  text: 'Olá, link: https://x.test/#abc',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const token = (n: number, expiresIn = 3599) => json(200, { access_token: `tok-${n}`, expires_in: expiresIn });
const sent = () => json(200, { id: 'm1' });

/** `fetch` roteirizado: devolve as respostas na ordem e guarda cada chamada. */
function script(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('chamada a mais do que o roteiro');
    if (next instanceof Error) throw next;
    return next;
  });
  return { http: http as unknown as typeof fetch, calls };
}

async function failure(fn: () => Promise<unknown>): Promise<MailSendError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MailSendError);
    return e as MailSendError;
  }
  throw new Error('era para falhar');
}

const claimsOf = (assertion: string) =>
  JSON.parse(Buffer.from(assertion.split('.')[1] as string, 'base64url').toString('utf8')) as Record<string, unknown>;

describe('Adaptador do Google Workspace (M15, RN-101)', () => {
  beforeEach(() => clearGoogleTokenCache());

  it('CA-RN-101.3 assina o JWT com a chave da conta de serviço, em nome da caixa, com o escopo único', async () => {
    const { http, calls } = script(token(1), sent());
    await googleTransport(config, { http, now: () => 1_700_000_000_000 }).send(message);

    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    const form = calls[0]?.init.body as URLSearchParams;
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const assertion = form.get('assertion') as string;
    const [head, claims, signature] = assertion.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(head, 'base64url').toString('utf8'))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claimsOf(assertion)).toEqual({
      iss: account.email,
      sub: 'its@example.test',
      scope: 'https://www.googleapis.com/auth/gmail.send',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const valid = createVerify('RSA-SHA256')
      .update(`${head}.${claims}`)
      .verify(createPublicKey(account.publicPem), Buffer.from(signature, 'base64url'));
    expect(valid).toBe(true);
  });

  it('CA-RN-101.3 envia a mensagem pela Gmail API com o nome, o assunto com acento e o "responder para"', async () => {
    const { http, calls } = script(token(1), sent());
    await googleTransport({ ...config, replyTo: 'contato@example.test' }, { http }).send(message);

    expect(calls[1]?.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(((calls[1]?.init.headers ?? {}) as Record<string, string>).Authorization).toBe('Bearer tok-1');
    const { raw } = JSON.parse(calls[1]?.init.body as string) as { raw: string };
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toMatch(/^From: "?ITS Ideias"? <its@example\.test>$/m);
    expect(mime).toMatch(/^To: pessoa@example\.test$/m);
    expect(mime).toMatch(/^Reply-To: contato@example\.test$/m);
    expect(mime).toMatch(/^Subject: =\?UTF-8\?/m);
    expect(mime).toContain('Ol=C3=A1, link: https://x.test/#abc'); // corpo em quoted-printable (UTF-8)
  });

  it('sem nome nem "responder para" esses cabeçalhos não vão', async () => {
    const { http, calls } = script(token(1), sent());
    await googleTransport(config, { http }).send({ ...message, from: { name: null, address: 'its@example.test' } });
    const { raw } = JSON.parse(calls[1]?.init.body as string) as { raw: string };
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toMatch(/^From: its@example\.test$/m);
    expect(mime).not.toMatch(/^Reply-To:/m);
  });

  it('guarda o token por caixa e só pede outro perto de vencer (margem de 1 minuto)', async () => {
    let t = 1_000_000;
    const { http, calls } = script(token(1, 3600), sent(), sent(), token(2, 3600), sent());
    const transport = googleTransport(config, { http, now: () => t });
    await transport.send(message);
    await transport.send(message);
    expect(calls.map((c) => c.url.includes('/token'))).toEqual([true, false, false]);

    t += 3600_000 - 30_000; // falta menos de 1 minuto
    await transport.send(message);
    expect(calls.filter((c) => c.url.includes('/token'))).toHaveLength(2);
    expect(((calls[4]?.init.headers ?? {}) as Record<string, string>).Authorization).toBe('Bearer tok-2');
  });

  it('CA-RN-101.8 um 401 pede outro token e tenta uma vez mais', async () => {
    const { http, calls } = script(
      token(1),
      json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } }),
      token(2),
      sent(),
    );
    await googleTransport(config, { http }).send(message);
    expect(calls).toHaveLength(4);
    expect(((calls[3]?.init.headers ?? {}) as Record<string, string>).Authorization).toBe('Bearer tok-2');
  });

  it('CA-RN-101.7 erros permanentes: token recusado, escopo não autorizado, sem permissão, caixa ou pedido inválido', async () => {
    const cases: [Response[], RegExp][] = [
      [[json(400, { error: 'invalid_grant', error_description: 'segredo-do-google' })], /HTTP 400: invalid_grant/],
      [[json(400, { error: 'unauthorized_client' })], /HTTP 400: unauthorized_client/],
      [[json(401, { error: 'invalid_client' })], /HTTP 401: invalid_client/],
      [
        [token(1), json(403, { error: { status: 'PERMISSION_DENIED', errors: [{ reason: 'forbidden' }] } })],
        /HTTP 403: PERMISSION_DENIED\/forbidden/,
      ],
      [[token(1), json(404, { error: { status: 'NOT_FOUND' } })], /HTTP 404: NOT_FOUND/],
      [[token(1), json(400, { error: { status: 'INVALID_ARGUMENT' } })], /HTTP 400: INVALID_ARGUMENT/],
    ];
    for (const [responses, text] of cases) {
      clearGoogleTokenCache();
      const { http } = script(...responses);
      const error = await failure(() => googleTransport(config, { http }).send(message));
      expect(error.permanent).toBe(true);
      expect(error.message).toMatch(text);
    }
  });

  it('CA-RN-101.8 erros repetíveis: 429, 5xx, cota (403 de limite) e rede', async () => {
    const cases: Response[][] = [
      [token(1), json(429, { error: { status: 'RESOURCE_EXHAUSTED' } })],
      [token(1), json(503, { error: { status: 'UNAVAILABLE' } })],
      [token(1), json(403, { error: { status: 'PERMISSION_DENIED', errors: [{ reason: 'userRateLimitExceeded' }] } })],
      [json(503, {})],
    ];
    for (const responses of cases) {
      clearGoogleTokenCache();
      const { http } = script(...responses);
      expect((await failure(() => googleTransport(config, { http }).send(message))).permanent).toBe(false);
    }
    clearGoogleTokenCache();
    const { http } = script(new Error('ECONNREFUSED com-dado-interno'));
    const error = await failure(() => googleTransport(config, { http }).send(message));
    expect(error.permanent).toBe(false);
    expect(error.message).not.toContain('com-dado-interno');
  });

  it('CA-T.12 o erro só diz o código: nada do corpo da resposta, da chave ou do destinatário', async () => {
    const { http } = script(
      token(1),
      json(403, { error: { status: 'PERMISSION_DENIED', message: 'corpo-sensivel pessoa@example.test' } }),
    );
    const error = await failure(() => googleTransport(config, { http }).send(message));
    expect(error.message).not.toContain('corpo-sensivel');
    expect(error.message).not.toContain('pessoa@example.test');
    expect(error.message).not.toContain('PRIVATE KEY');
  });

  it('uma chave privada que não assina vira erro permanente, sem a chave na mensagem', async () => {
    const { http } = script();
    const bad = { ...config, privateKey: '-----BEGIN PRIVATE KEY-----\nlixo\n-----END PRIVATE KEY-----' };
    const error = await failure(() => googleTransport(bad, { http }).send(message));
    expect(error.permanent).toBe(true);
    expect(error.message).not.toContain('lixo');
  });

  it('CA-RN-101.10 fora do teste os endereços são sempre os do Google', () => {
    const before = { env: process.env.NODE_ENV, token: process.env.MAIL_GOOGLE_TOKEN_OVERRIDE };
    process.env.MAIL_GOOGLE_TOKEN_OVERRIDE = 'http://127.0.0.1:9/token';
    try {
      process.env.NODE_ENV = 'production';
      expect(googleEndpoints()).toEqual({
        token: 'https://oauth2.googleapis.com/token',
        gmail: 'https://gmail.googleapis.com',
      });
      process.env.NODE_ENV = 'test';
      expect(googleEndpoints().token).toBe('http://127.0.0.1:9/token');
      process.env.MAIL_GOOGLE_TOKEN_OVERRIDE = 'https://example.com/token'; // fora do loopback
      expect(googleEndpoints().token).toBe('https://oauth2.googleapis.com/token');
    } finally {
      process.env.NODE_ENV = before.env;
      if (before.token === undefined) delete process.env.MAIL_GOOGLE_TOKEN_OVERRIDE;
      else process.env.MAIL_GOOGLE_TOKEN_OVERRIDE = before.token;
    }
  });
});

describe('Chave JSON da conta de serviço (M15)', () => {
  it('CA-RN-101.2 aceita a chave do Google Cloud e guarda só o e-mail e a chave privada', () => {
    expect(parseServiceAccount(account.json)).toEqual({ clientEmail: account.email, privateKey: account.privatePem });
  });

  it('CA-RN-101.2 recusa o que não é uma chave de conta de serviço utilizável', () => {
    const base = JSON.parse(account.json) as Record<string, unknown>;
    const variants: unknown[] = [
      'isto não é json',
      '[]',
      JSON.stringify({ ...base, type: 'authorized_user' }),
      JSON.stringify({ ...base, client_email: 'sem-arroba' }),
      JSON.stringify({ ...base, private_key: 'nao-e-pem' }),
      JSON.stringify({ ...base, private_key: undefined }),
    ];
    for (const v of variants) expect(parseServiceAccount(String(v))).toBeNull();
  });
});
