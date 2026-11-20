/**
 * Pontos comuns à Microsoft (login corporativo, M13, e envio de e-mail pelo Graph, M14).
 */

/** ID do tenant: GUID ou domínio verificado (ex.: empresa.onmicrosoft.com). */
const TENANT = /^(?:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|[a-z0-9][a-z0-9.-]{0,98}\.[a-z]{2,63})$/i;

export const isValidTenant = (value: string): boolean => TENANT.test(value);

export interface MicrosoftEndpoints {
  /** Entra ID: token do aplicativo (`/{tenant}/oauth2/v2.0/token`). */
  login: string;
  /** Microsoft Graph (`/v1.0/users/{caixa}/sendMail`). */
  graph: string;
}

const PRODUCTION: MicrosoftEndpoints = {
  login: 'https://login.microsoftonline.com',
  graph: 'https://graph.microsoft.com',
};

/**
 * Endereços da Microsoft para o envio de e-mail. Nos testes (`NODE_ENV=test`) podem ser trocados por
 * um Graph falso local em 127.0.0.1 (`MAIL_LOGIN_BASE_OVERRIDE`, `MAIL_GRAPH_BASE_OVERRIDE`); em
 * produção as variáveis são ignoradas e os endereços são sempre os da Microsoft, em https (CA-RN-99.10).
 */
export function microsoftEndpoints(): MicrosoftEndpoints {
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
    login: loopback(process.env.MAIL_LOGIN_BASE_OVERRIDE) ?? PRODUCTION.login,
    graph: loopback(process.env.MAIL_GRAPH_BASE_OVERRIDE) ?? PRODUCTION.graph,
  };
}
