import { createHash } from 'node:crypto';
import { microsoftEndpoints } from '../common/microsoft.js';
import { type GraphConfig, type MailMessage, MailSendError, type MailTransport } from './mail-transport.js';

/**
 * Envio pelo Microsoft Graph (M14, RN-99), com credenciais do aplicativo (`client_credentials`) e `POST /users/{caixa}/sendMail`. O aplicativo não
 * tem permissão de API no Entra; quem permite o envio é o RBAC for Applications do Exchange, restrito
 * a uma caixa. Erros só dizem o código (nunca o corpo da resposta, o segredo ou o destinatário).
 */

const TIMEOUT_MS = 10_000;
/** Renova o token um minuto antes de vencer. */
const TOKEN_MARGIN_MS = 60_000;

interface CachedToken {
  value: string;
  expiresAt: number;
}

/** O ITS cria um transporte por envio, então o token fica no módulo (só na memória do processo). */
const tokens = new Map<string, CachedToken>();

/** Esquece os tokens guardados (testes e troca de provedor). */
export function clearGraphTokenCache(): void {
  tokens.clear();
}

export interface GraphTransportOptions {
  /** Para os testes do adaptador sem rede. */
  http?: typeof fetch;
  now?: () => number;
}

/** Código do erro do protocolo (`invalid_client`, `ErrorAccessDenied`…), nunca o corpo inteiro. */
async function errorCode(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string | { code?: string } };
    const code = typeof data.error === 'string' ? data.error : data.error?.code;
    return code && /^[A-Za-z0-9_.-]{1,60}$/.test(code) ? `: ${code}` : '';
  } catch {
    return '';
  }
}

/** `429` e `5xx` valem repetir; o resto (credencial recusada, sem permissão, caixa inexistente) não. */
const isTransient = (status: number): boolean => status === 429 || status >= 500;

export function graphTransport(config: GraphConfig, opts: GraphTransportOptions = {}): MailTransport {
  const http = opts.http ?? fetch;
  const now = opts.now ?? Date.now;
  const cacheKey = [
    config.tenantId,
    config.clientId,
    createHash('sha256').update(config.clientSecret).digest('hex').slice(0, 16),
  ].join('|');

  const call = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await http(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      // Rede, DNS ou limite de tempo: pode ser passageiro, então vale repetir.
      throw new MailSendError('graph_network', false);
    }
  };

  async function accessToken(force = false): Promise<string> {
    const hit = tokens.get(cacheKey);
    if (!force && hit && hit.expiresAt - TOKEN_MARGIN_MS > now()) return hit.value;

    const { login } = microsoftEndpoints();
    const response = await call(`${login}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });
    if (!response.ok) {
      throw new MailSendError(
        'graph_token_rejected',
        !isTransient(response.status),
        `HTTP ${response.status}${await errorCode(response)}`,
      );
    }
    let data: { access_token?: string; expires_in?: number };
    try {
      data = (await response.json()) as { access_token?: string; expires_in?: number };
    } catch {
      throw new MailSendError('graph_token_unexpected', false);
    }
    if (!data.access_token) throw new MailSendError('graph_token_missing', false);
    const token = { value: data.access_token, expiresAt: now() + (data.expires_in ?? 3600) * 1000 };
    tokens.set(cacheKey, token);
    return token.value;
  }

  return {
    async send(message: MailMessage): Promise<void> {
      const { graph } = microsoftEndpoints();
      const mailbox = config.mailboxId || message.from.address;
      const url = `${graph}/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`;
      const body = JSON.stringify({
        message: {
          subject: message.subject,
          body: { contentType: 'Text', content: message.text },
          toRecipients: [{ emailAddress: { address: message.to } }],
          ...(config.replyTo ? { replyTo: [{ emailAddress: { address: config.replyTo } }] } : {}),
        },
        // O e-mail (pode ter link de recuperação de senha) não fica na caixa de enviados.
        saveToSentItems: false,
      });
      const post = async (token: string) =>
        call(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body,
        });

      let response = await post(await accessToken());
      // Token revogado ou vencido antes da hora: pede outro e tenta uma vez mais.
      if (response.status === 401) response = await post(await accessToken(true));

      // 202 Accepted: o Graph aceitou; a entrega depende dos limites do Exchange.
      if (response.status !== 202) {
        throw new MailSendError(
          'graph_send_failed',
          !isTransient(response.status),
          `HTTP ${response.status}${await errorCode(response)}`,
        );
      }
    },
  };
}
