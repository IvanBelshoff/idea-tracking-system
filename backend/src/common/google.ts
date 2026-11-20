import { createPrivateKey } from 'node:crypto';

/**
 * Pontos comuns ao envio de e-mail pelo Google Workspace (M15, RN-101): endereços e leitura da chave
 * JSON da conta de serviço.
 */

export interface GoogleEndpoints {
  /** Token da conta de serviço (`urn:ietf:params:oauth:grant-type:jwt-bearer`). */
  token: string;
  /** Gmail API (`/gmail/v1/users/me/messages/send`). */
  gmail: string;
}

const PRODUCTION: GoogleEndpoints = {
  token: 'https://oauth2.googleapis.com/token',
  gmail: 'https://gmail.googleapis.com',
};

/**
 * Endereços do Google para o envio de e-mail. Nos testes (`NODE_ENV=test`) podem ser trocados por um
 * Google falso local em 127.0.0.1 (`MAIL_GOOGLE_TOKEN_OVERRIDE`, `MAIL_GMAIL_BASE_OVERRIDE`); em
 * produção as variáveis são ignoradas e os endereços são sempre os do Google, em https (CA-RN-101.10).
 */
export function googleEndpoints(): GoogleEndpoints {
  if (process.env.NODE_ENV !== 'test') return PRODUCTION;
  const loopback = (raw: string | undefined): string | null => {
    if (!raw) return null;
    try {
      const url = new URL(raw);
      return url.hostname === '127.0.0.1' || url.hostname === 'localhost' ? raw.replace(/\/+$/, '') : null;
    } catch {
      return null;
    }
  };
  return {
    token: loopback(process.env.MAIL_GOOGLE_TOKEN_OVERRIDE) ?? PRODUCTION.token,
    gmail: loopback(process.env.MAIL_GMAIL_BASE_OVERRIDE) ?? PRODUCTION.gmail,
  };
}

/** Escopo único do envio: só enviar (nunca ler a caixa). */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
}

const EMAIL = /^[^\s@]{1,64}@[A-Za-z0-9.-]{1,255}$/;

/**
 * Lê a chave JSON baixada do Google Cloud e guarda só o necessário (e-mail da conta de serviço e a
 * chave privada). Devolve `null` se não for uma chave de conta de serviço utilizável. Nunca inclui
 * trechos do conteúdo em erros.
 */
export function parseServiceAccount(json: string): ServiceAccountKey | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { type, client_email: clientEmail, private_key: privateKey } = data as Record<string, unknown>;
  if (type !== 'service_account') return null;
  if (typeof clientEmail !== 'string' || !EMAIL.test(clientEmail)) return null;
  if (typeof privateKey !== 'string' || privateKey.length > 10_000) return null;
  try {
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== 'rsa') return null;
  } catch {
    return null;
  }
  return { clientEmail, privateKey };
}
