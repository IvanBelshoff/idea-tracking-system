import { createHash, createSign } from 'node:crypto';
import { createTransport } from 'nodemailer';
import { GMAIL_SEND_SCOPE, googleEndpoints } from '../common/google.js';
import { type GoogleConfig, type MailMessage, MailSendError, type MailTransport } from './mail-transport.js';

/**
 * Envio pelo Google Workspace (M15, RN-101): conta de serviço com delegação em todo o domínio. O ITS
 * assina um JWT com a chave privada, em nome da caixa remetente, troca por um token e envia com
 * `POST /gmail/v1/users/me/messages/send`. O escopo é só `gmail.send`. Erros só dizem o código (nunca o
 * corpo da resposta, a chave ou o destinatário).
 */

const TIMEOUT_MS = 10_000;
/** Renova o token um minuto antes de vencer. */
const TOKEN_MARGIN_MS = 60_000;
/** Motivos de `403` que são limite de cota (passam sozinhos): valem repetir. */
const QUOTA_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

interface CachedToken {
  value: string;
  expiresAt: number;
}

/** O ITS cria um transporte por envio, então o token fica no módulo (só na memória do processo). */
const tokens = new Map<string, CachedToken>();

/** Esquece os tokens guardados (testes e troca de provedor). */
export function clearGoogleTokenCache(): void {
  tokens.clear();
}

export interface GoogleTransportOptions {
  /** Para os testes do adaptador sem rede. */
  http?: typeof fetch;
  now?: () => number;
}

const b64url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

/** Código do erro (`invalid_grant`, `PERMISSION_DENIED`…), nunca o corpo inteiro. */
async function errorInfo(response: Response): Promise<{ text: string; reason: string | null }> {
  try {
    const data = (await response.json()) as {
      error?: string | { status?: string; errors?: { reason?: string }[] };
    };
    const safe = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(v) ? v : null);
    const code = typeof data.error === 'string' ? safe(data.error) : safe(data.error?.status);
    const reason = typeof data.error === 'object' ? safe(data.error?.errors?.[0]?.reason) : null;
    const shown = [code, reason].filter((v): v is string => v !== null);
    return { text: shown.length > 0 ? `: ${shown.join('/')}` : '', reason };
  } catch {
    return { text: '', reason: null };
  }
}

/** `429` e `5xx` valem repetir; o resto (credencial recusada, sem permissão, caixa inexistente) não. */
const isTransient = (status: number): boolean => status === 429 || status >= 500;

export function googleTransport(config: GoogleConfig, opts: GoogleTransportOptions = {}): MailTransport {
  const http = opts.http ?? fetch;
  const now = opts.now ?? Date.now;

  const call = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await http(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      // Rede, DNS ou limite de tempo: pode ser passageiro, então vale repetir.
      throw new MailSendError('google_network', false);
    }
  };

  /** JWT da conta de serviço (RS256), em nome da caixa (`sub`). */
  function assertion(mailbox: string, audience: string): string {
    const iat = Math.floor(now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(
      JSON.stringify({
        iss: config.clientEmail,
        sub: mailbox,
        scope: GMAIL_SEND_SCOPE,
        aud: audience,
        iat,
        exp: iat + 3600,
      }),
    );
    try {
      const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(config.privateKey);
      return `${head}.${claims}.${b64url(signature)}`;
    } catch {
      throw new MailSendError('google_key_unusable', true);
    }
  }

  async function accessToken(mailbox: string, force = false): Promise<string> {
    const cacheKey = [
      config.clientEmail,
      mailbox,
      createHash('sha256').update(config.privateKey).digest('hex').slice(0, 16),
    ].join('|');
    const hit = tokens.get(cacheKey);
    if (!force && hit && hit.expiresAt - TOKEN_MARGIN_MS > now()) return hit.value;

    const { token } = googleEndpoints();
    const response = await call(token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: assertion(mailbox, token),
      }),
    });
    if (!response.ok) {
      throw new MailSendError(
        'google_token_rejected',
        !isTransient(response.status),
        `HTTP ${response.status}${(await errorInfo(response)).text}`,
      );
    }
    let data: { access_token?: string; expires_in?: number };
    try {
      data = (await response.json()) as { access_token?: string; expires_in?: number };
    } catch {
      throw new MailSendError('google_token_unexpected', false);
    }
    if (!data.access_token) throw new MailSendError('google_token_missing', false);
    const cached = { value: data.access_token, expiresAt: now() + (data.expires_in ?? 3600) * 1000 };
    tokens.set(cacheKey, cached);
    return cached.value;
  }

  return {
    async send(message: MailMessage): Promise<void> {
      const mailbox = message.from.address;
      const { gmail } = googleEndpoints();
      const url = `${gmail}/gmail/v1/users/me/messages/send`;

      // A mensagem completa (RFC 5322) é montada pelo nodemailer, que cuida dos cabeçalhos com acentos.
      const built = (await createTransport({ streamTransport: true, buffer: true, newline: 'unix' }).sendMail({
        from: message.from.name ? { name: message.from.name, address: mailbox } : mailbox,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(config.replyTo ? { replyTo: config.replyTo } : {}),
      })) as { message: Buffer };
      const body = JSON.stringify({ raw: b64url(built.message) });

      const post = async (token: string) =>
        call(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body,
        });

      let response = await post(await accessToken(mailbox));
      // Token revogado ou vencido antes da hora: pede outro e tenta uma vez mais.
      if (response.status === 401) response = await post(await accessToken(mailbox, true));

      if (!response.ok) {
        const info = await errorInfo(response);
        const quota = response.status === 403 && info.reason !== null && QUOTA_REASONS.has(info.reason);
        throw new MailSendError(
          'google_send_failed',
          !(isTransient(response.status) || quota),
          `HTTP ${response.status}${info.text}`,
        );
      }
    },
  };
}
