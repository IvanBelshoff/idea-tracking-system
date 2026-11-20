import { createTransport } from 'nodemailer';

/**
 * Envio de e-mail por adaptador (RN-90; docs/STACK-E-ARQUITETURA.md, §5). Na v1 só SMTP; outros
 * provedores entram como novos adaptadores desta mesma interface.
 */
export type SmtpSecurity = 'tls' | 'starttls' | 'none';

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  password: string | null;
}

/** Provedores de envio (RN-90, RN-99). Um provedor ativo por vez. */
export const MAIL_PROVIDER_TYPES = ['smtp', 'microsoft_graph', 'google_workspace'] as const;
export type MailProviderType = (typeof MAIL_PROVIDER_TYPES)[number];

/** Configuração do envio pelo Microsoft Graph (RN-99). O segredo só existe cifrado. */
export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** ID do objeto da caixa (`users/{id}`); sem ele vale o endereço remetente. */
  mailboxId: string | null;
  replyTo: string | null;
}

/** Configuração do envio pelo Google Workspace (RN-101). A chave privada só existe cifrada. */
export interface GoogleConfig {
  /** E-mail da conta de serviço (não é segredo). */
  clientEmail: string;
  privateKey: string;
  replyTo: string | null;
}

/** A configuração já lida, com o tipo que diz como usá-la. */
export type ProviderConfig =
  | { type: 'smtp'; config: SmtpConfig }
  | { type: 'microsoft_graph'; config: GraphConfig }
  | { type: 'google_workspace'; config: GoogleConfig };

/**
 * Códigos das falhas de envio (M28). A tela os traduz no idioma de quem lê; o detalhe técnico do
 * provedor (HTTP e código do protocolo, ou a resposta do servidor SMTP) vai depois de ": " e não se
 * traduz. É esse texto, `código` ou `código: detalhe`, que fica gravado no último teste e no envio.
 */
export const MAIL_ERROR_CODES = [
  'mail_disabled',
  'config_unreadable',
  'graph_network',
  'graph_token_rejected',
  'graph_token_unexpected',
  'graph_token_missing',
  'graph_send_failed',
  'google_network',
  'google_key_unusable',
  'google_token_rejected',
  'google_token_unexpected',
  'google_token_missing',
  'google_send_failed',
  'transport',
  'unknown',
] as const;
export type MailErrorCode = (typeof MAIL_ERROR_CODES)[number];

/** O texto gravado de uma falha: `código` ou `código: detalhe`. */
export const mailErrorText = (code: MailErrorCode, detail?: string | null): string =>
  detail ? `${code}: ${detail}` : code;

/**
 * Falha de envio. \`permanent\` = repetir não adianta (credencial recusada, sem permissão, caixa
 * inexistente): o e-mail fica \`failed\` na hora (CA-RN-99.7). Sem \`permanent\`, vale repetir (CA-RN-99.8).
 */
export class MailSendError extends Error {
  constructor(
    readonly code: MailErrorCode,
    readonly permanent: boolean,
    readonly detail: string | null = null,
  ) {
    super(mailErrorText(code, detail));
  }
}

/** Os segredos de uma configuração, para mascarar em mensagens de erro (nunca vão para tela, log ou auditoria). */
export function configSecrets(p: ProviderConfig): (string | null)[] {
  if (p.type === 'smtp') return [p.config.password, p.config.username];
  if (p.type === 'google_workspace') return [p.config.privateKey];
  return [p.config.clientSecret];
}

export interface MailMessage {
  from: { name: string | null; address: string };
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export function smtpTransport(config: SmtpConfig): MailTransport {
  return {
    async send(message) {
      const transporter = createTransport({
        host: config.host,
        port: config.port,
        secure: config.security === 'tls',
        requireTLS: config.security === 'starttls',
        ignoreTLS: config.security === 'none',
        auth: config.username ? { user: config.username, pass: config.password ?? '' } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
      try {
        await transporter.sendMail({
          from: message.from.name ? { name: message.from.name, address: message.from.address } : message.from.address,
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
      } finally {
        transporter.close();
      }
    },
  };
}

/**
 * Texto seguro da falha para mostrar e gravar: `código` ou `código: detalhe` (a tela traduz o código),
 * sem a senha, numa linha e com tamanho limitado. Erro que não é do ITS (a resposta do servidor SMTP,
 * por exemplo) vira `transport: <mensagem>`.
 */
export function safeErrorMessage(error: unknown, secrets: readonly (string | null | undefined)[]): string {
  const raw = error instanceof Error ? error.message : String(error);
  let message = error instanceof MailSendError ? raw : raw.trim() ? mailErrorText('transport', raw) : 'unknown';
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('***');
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, 500) || 'unknown';
}
