import { beforeEach, describe, expect, it, vi } from 'vitest';
import { microsoftEndpoints } from '../../src/common/microsoft.js';
import { clearGraphTokenCache, graphTransport } from '../../src/communication/mail-graph.js';
import { type GraphConfig, MailSendError } from '../../src/communication/mail-transport.js';

const SECRET = 'segredo-do-cliente-0123';
const config: GraphConfig = {
  tenantId: '11111111-2222-3333-4444-555555555555',
  clientId: 'client-id',
  clientSecret: SECRET,
  mailboxId: null,
  replyTo: null,
};
const message = {
  from: { name: 'ITS', address: 'its@example.test' },
  to: 'pessoa@example.test',
  subject: 'Assunto',
  text: 'Olá, link: https://x.test/#abc',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const token = (n: number, expiresIn = 3600) => json(200, { access_token: `tok-${n}`, expires_in: expiresIn });

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

describe('Adaptador do Microsoft Graph (M14, RN-99)', () => {
  beforeEach(() => clearGraphTokenCache());

  it('CA-RN-99.3 pede o token com as credenciais do aplicativo e envia pela caixa, sem guardar nos enviados', async () => {
    const { http, calls } = script(token(1), new Response(null, { status: 202 }));
    await graphTransport({ ...config, replyTo: 'contato@example.test' }, { http }).send(message);

    expect(calls[0]?.url).toBe(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`);
    const form = calls[0]?.init.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      client_id: 'client-id',
      client_secret: SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    expect(calls[1]?.url).toBe('https://graph.microsoft.com/v1.0/users/its%40example.test/sendMail');
    expect(((calls[1]?.init.headers ?? {}) as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({
      message: {
        subject: 'Assunto',
        body: { contentType: 'Text', content: message.text },
        toRecipients: [{ emailAddress: { address: 'pessoa@example.test' } }],
        replyTo: [{ emailAddress: { address: 'contato@example.test' } }],
      },
      saveToSentItems: false,
    });
  });

  it('o ID do objeto da caixa vale no lugar do endereço; sem "responder para" nada é enviado', async () => {
    const { http, calls } = script(token(1), new Response(null, { status: 202 }));
    await graphTransport({ ...config, mailboxId: 'dc2b4937-b4b2-4d1e-9dc6-b3e2ccb9c422' }, { http }).send(message);
    expect(calls[1]?.url).toBe('https://graph.microsoft.com/v1.0/users/dc2b4937-b4b2-4d1e-9dc6-b3e2ccb9c422/sendMail');
    expect(JSON.parse(calls[1]?.init.body as string).message.replyTo).toBeUndefined();
  });

  it('CA-RN-99.6 reaproveita o token entre envios, mesmo com transportes novos', async () => {
    const { http, calls } = script(token(1), new Response(null, { status: 202 }), new Response(null, { status: 202 }));
    await graphTransport(config, { http }).send(message);
    await graphTransport(config, { http }).send(message);
    expect(calls.filter((c) => c.url.includes('/oauth2/')).length).toBe(1);
  });

  it('CA-RN-99.6 renova o token quando ele está perto de vencer; outro segredo não reaproveita o token', async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const first = script(
      token(1, 120),
      new Response(null, { status: 202 }),
      token(2, 120),
      new Response(null, { status: 202 }),
    );
    const transport = graphTransport(config, { http: first.http, now });
    await transport.send(message);
    clock += 30_000; // ainda dentro da margem de 1 minuto
    await transport.send(message).catch(() => undefined);
    clock = 1_000_000;
    // Vencendo em menos de 60 s: pede outro.
    clearGraphTokenCache();
    const second = script(
      token(3, 50),
      new Response(null, { status: 202 }),
      token(4, 3600),
      new Response(null, { status: 202 }),
    );
    const t2 = graphTransport(config, { http: second.http, now });
    await t2.send(message);
    await t2.send(message);
    expect(second.calls.filter((c) => c.url.includes('/oauth2/')).length).toBe(2);

    clearGraphTokenCache();
    const third = script(token(5), new Response(null, { status: 202 }), token(6), new Response(null, { status: 202 }));
    await graphTransport(config, { http: third.http }).send(message);
    await graphTransport({ ...config, clientSecret: 'outro-segredo-9999' }, { http: third.http }).send(message);
    expect(third.calls.filter((c) => c.url.includes('/oauth2/')).length).toBe(2);
  });

  it('CA-RN-99.6 um 401 do Graph renova o token e tenta de novo uma vez', async () => {
    const { http, calls } = script(
      token(1),
      json(401, { error: { code: 'InvalidAuthenticationToken' } }),
      token(2),
      new Response(null, { status: 202 }),
    );
    await graphTransport(config, { http }).send(message);
    const sends = calls.filter((c) => c.url.includes('/sendMail'));
    expect(sends.map((c) => (c.init.headers as Record<string, string>).Authorization)).toEqual([
      'Bearer tok-1',
      'Bearer tok-2',
    ]);
  });

  it('CA-RN-99.7 continuar com 401 depois da renovação é permanente', async () => {
    const { http } = script(
      token(1),
      json(401, {}),
      token(2),
      json(401, { error: { code: 'InvalidAuthenticationToken' } }),
    );
    const error = await failure(() => graphTransport(config, { http }).send(message));
    expect(error.permanent).toBe(true);
    expect(error.message).toContain('HTTP 401: InvalidAuthenticationToken');
  });

  it('CA-RN-99.9 o erro leva só o código: nunca o segredo, o corpo da resposta nem o destinatário', async () => {
    const { http } = script(
      token(1),
      json(403, { error: { code: 'ErrorAccessDenied', message: `corpo com ${SECRET} e pessoa@example.test` } }),
    );
    const error = await failure(() => graphTransport(config, { http }).send(message));
    expect(error.code).toBe('graph_send_failed');
    expect(error.message).toBe('graph_send_failed: HTTP 403: ErrorAccessDenied');
    for (const leak of [SECRET, 'pessoa@example.test', 'corpo com', message.subject, message.text]) {
      expect(error.message).not.toContain(leak);
    }
  });

  it('CA-RN-99.7 credencial recusada pela Microsoft é permanente e diz só o código', async () => {
    const { http } = script(json(401, { error: 'invalid_client', error_description: `AADSTS7000215 ${SECRET}` }));
    const error = await failure(() => graphTransport(config, { http }).send(message));
    expect(error.permanent).toBe(true);
    expect(error.message).toBe('graph_token_rejected: HTTP 401: invalid_client');
    expect(error.message).not.toContain(SECRET);
  });

  it('CA-RN-99.7 e 99.8 403, 404 e 400 são permanentes; 429, 500 e 503 valem repetir', async () => {
    for (const [status, permanent] of [
      [403, true],
      [404, true],
      [400, true],
      [429, false],
      [500, false],
      [503, false],
    ] as const) {
      clearGraphTokenCache();
      const { http } = script(token(1), json(status, { error: { code: 'X' } }));
      const error = await failure(() => graphTransport(config, { http }).send(message));
      expect(error.permanent, String(status)).toBe(permanent);
    }
  });

  it('CA-RN-99.8 falha de rede ou tempo esgotado vale repetir; erro de token do Graph com 5xx também', async () => {
    const net = script(new TypeError('fetch failed'));
    const error = await failure(() => graphTransport(config, { http: net.http }).send(message));
    expect(error.permanent).toBe(false);
    expect(error.message).not.toContain('fetch failed');

    clearGraphTokenCache();
    const down = script(json(503, {}));
    expect((await failure(() => graphTransport(config, { http: down.http }).send(message))).permanent).toBe(false);
  });

  it('CA-RN-99.10 em produção os endereços são sempre os da Microsoft, mesmo com a variável de teste', () => {
    const before = {
      env: process.env.NODE_ENV,
      login: process.env.MAIL_LOGIN_BASE_OVERRIDE,
      graph: process.env.MAIL_GRAPH_BASE_OVERRIDE,
    };
    try {
      process.env.MAIL_LOGIN_BASE_OVERRIDE = 'http://127.0.0.1:9999';
      process.env.MAIL_GRAPH_BASE_OVERRIDE = 'http://127.0.0.1:9998/';
      process.env.NODE_ENV = 'test';
      expect(microsoftEndpoints()).toEqual({ login: 'http://127.0.0.1:9999', graph: 'http://127.0.0.1:9998' });
      // Em teste, só se aceita o endereço local.
      process.env.MAIL_GRAPH_BASE_OVERRIDE = 'https://evil.example';
      expect(microsoftEndpoints().graph).toBe('https://graph.microsoft.com');
      process.env.MAIL_GRAPH_BASE_OVERRIDE = 'http://127.0.0.1:9998';
      process.env.NODE_ENV = 'production';
      expect(microsoftEndpoints()).toEqual({
        login: 'https://login.microsoftonline.com',
        graph: 'https://graph.microsoft.com',
      });
    } finally {
      for (const [key, value] of [
        ['NODE_ENV', before.env],
        ['MAIL_LOGIN_BASE_OVERRIDE', before.login],
        ['MAIL_GRAPH_BASE_OVERRIDE', before.graph],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
