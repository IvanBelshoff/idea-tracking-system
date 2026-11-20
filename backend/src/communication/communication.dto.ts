import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { isValidTenant } from '../common/microsoft.js';
import { PageMeta, PageQuerySchema } from '../common/pagination.js';
import { TEMPLATE_KEYS, TEMPLATE_LOCALES } from './email-templates.js';
import { NOTIFICATION_TYPES } from './notification-rules.js';

// --- Notificações ---------------------------------------------------------------------------------

export const NotificationQuerySchema = PageQuerySchema.extend({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export class NotificationIdeaRef {
  @ApiProperty({ example: 'ITS-2026-0001' }) code!: string;
  @ApiProperty() title!: string;
}

export class NotificationView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NOTIFICATION_TYPES, enumName: 'NotificationType' }) type!: string;
  @ApiProperty({ type: NotificationIdeaRef, nullable: true }) idea!: NotificationIdeaRef | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Dados do aviso: etapa (position, name, dueDate), motivo (reason), situação (status)',
  })
  payload!: Record<string, unknown>;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) readAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class NotificationPage {
  @ApiProperty({ type: [NotificationView] }) items!: NotificationView[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
  @ApiProperty() unreadCount!: number;
}

export class UnreadCountView {
  @ApiProperty() count!: number;
}

export const PreferencesUpdateSchema = z.object({
  events: z
    .array(z.object({ type: z.enum(NOTIFICATION_TYPES), inApp: z.boolean(), email: z.boolean() }))
    .max(NOTIFICATION_TYPES.length),
  deadlineAlertDays: z.number().int().min(0).max(30).nullable(),
});

export class EventPreferenceView {
  @ApiProperty({ enum: NOTIFICATION_TYPES, enumName: 'NotificationType' }) type!: string;
  @ApiProperty({ enum: ['author', 'team', 'mural', 'store'] }) group!: 'author' | 'team' | 'mural' | 'store';
  @ApiProperty({ description: 'Decisão sobre a própria ideia: sempre enviada (RN-30)' }) mandatory!: boolean;
  @ApiProperty() inApp!: boolean;
  @ApiProperty() email!: boolean;
}

export class EventPreferenceInput {
  @ApiProperty({ enum: NOTIFICATION_TYPES, enumName: 'NotificationType' }) type!: string;
  @ApiProperty() inApp!: boolean;
  @ApiProperty() email!: boolean;
}

export class NotificationPreferencesView {
  @ApiProperty({ type: [EventPreferenceView] }) events!: EventPreferenceView[];
  @ApiProperty({ type: Number, nullable: true, description: 'Nulo = padrão da instalação' })
  deadlineAlertDays!: number | null;
  @ApiProperty() defaultDeadlineAlertDays!: number;
  @ApiProperty({ description: 'Envio de e-mail ligado na instalação' }) emailActive!: boolean;
}

export class NotificationPreferencesRequest {
  @ApiProperty({ type: [EventPreferenceInput] }) events!: EventPreferenceInput[];
  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 30 }) deadlineAlertDays!: number | null;
}

// --- Provedor de e-mail (RN-90) -------------------------------------------------------------------

const SmtpProviderSchema = z.object({
  type: z.literal('smtp'),
  host: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9.-]+$|^\[[0-9A-Fa-f:.]+\]$/, 'Servidor inválido'),
  port: z.number().int().min(1).max(65_535),
  security: z.enum(['tls', 'starttls', 'none']),
  username: z.string().trim().max(320).nullable(),
  /** Ausente = manter a senha atual; nulo = apagar. */
  password: z.string().max(500).nullable().optional(),
  fromAddress: z.email().max(320),
  fromName: z.string().trim().max(200).nullable(),
});

/** Validade do segredo do cliente (RN-100): `AAAA-MM-DD`; nulo ou ausente = sem data. */
const secretExpiresOn = z.iso.date().nullish();

/** Microsoft 365 pelo Graph (RN-99). A caixa remetente é `fromAddress`; `mailboxId` (ID do objeto) é opcional. */
const GraphProviderSchema = z.object({
  type: z.literal('microsoft_graph'),
  tenantId: z.string().trim().min(1).max(100).refine(isValidTenant, 'Informe o ID do tenant (GUID) ou o domínio dele'),
  clientId: z.string().trim().min(1).max(200),
  /** Ausente = manter o segredo gravado; nulo ou vazio = apagar. */
  clientSecret: z.string().max(500).nullish(),
  mailboxId: z.string().trim().max(100).nullish(),
  replyTo: z.email().max(320).nullish(),
  fromAddress: z.email().max(320),
  secretExpiresOn,
});

/** Google Workspace pela Gmail API (RN-101). A caixa remetente é `fromAddress`; a chave vem do JSON da conta de serviço. */
const GoogleProviderSchema = z.object({
  type: z.literal('google_workspace'),
  /** Conteúdo do arquivo JSON da conta de serviço. Ausente = manter a chave gravada; nulo ou vazio = apagar. */
  serviceAccountJson: z.string().max(20_000).nullish(),
  replyTo: z.email().max(320).nullish(),
  fromAddress: z.email().max(320),
  fromName: z.string().trim().max(200).nullish(),
  secretExpiresOn,
});

/** Sem `type` o corpo vale como SMTP (compatível com quem já usa a API). */
export const ProviderSchema = z.preprocess(
  (value) =>
    value && typeof value === 'object' && !Array.isArray(value) && !('type' in value)
      ? { ...value, type: 'smtp' }
      : value,
  z.discriminatedUnion('type', [SmtpProviderSchema, GraphProviderSchema, GoogleProviderSchema]),
);
export type ProviderInput = z.infer<typeof ProviderSchema>;
export type GraphProviderInput = z.infer<typeof GraphProviderSchema>;
export type GoogleProviderInput = z.infer<typeof GoogleProviderSchema>;

export const TestEmailSchema = z.object({ to: z.email().max(320) });

export class ProviderView {
  @ApiProperty({ description: 'Já existe um provedor cadastrado' }) configured!: boolean;
  @ApiProperty({
    enum: ['smtp', 'microsoft_graph', 'google_workspace'],
    description: 'Tipo do provedor (RN-99, RN-101)',
  })
  type!: string;
  @ApiProperty({ type: String, nullable: true }) host!: string | null;
  @ApiProperty({ type: Number, nullable: true }) port!: number | null;
  @ApiProperty({ enum: ['tls', 'starttls', 'none'], nullable: true }) security!: string | null;
  @ApiProperty({ type: String, nullable: true }) username!: string | null;
  @ApiProperty({ description: 'Há senha gravada (ela nunca é devolvida)' }) passwordSet!: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Só Microsoft: tenant' }) tenantId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Só Microsoft: ID do cliente (aplicativo)' })
  clientId!: string | null;
  @ApiProperty({ description: 'Só Microsoft: há segredo gravado (ele nunca é devolvido)' }) clientSecretSet!: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Só Microsoft: ID do objeto da caixa' })
  mailboxId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Só Microsoft: "responder para"' }) replyTo!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Só Google: e-mail da conta de serviço' })
  serviceAccountEmail!: string | null;
  @ApiProperty({ description: 'Só Google: há chave gravada (ela nunca é devolvida)' }) serviceAccountKeySet!: boolean;
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Microsoft e Google: validade do segredo ou da chave (RN-100)',
  })
  secretExpiresOn!: string | null;
  @ApiProperty({ type: String, nullable: true }) fromAddress!: string | null;
  @ApiProperty({ type: String, nullable: true }) fromName!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastTestAt!: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) lastTestOk!: boolean | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Falha como `código` ou `código: detalhe` (códigos em MAIL_ERROR_CODES; a tela traduz o código), sem a senha',
  })
  lastTestError!: string | null;
  @ApiProperty({ description: 'APP_SECRET_KEY definida no servidor' }) secretKeyReady!: boolean;
  @ApiProperty({ description: 'Endereço do sistema para os links (configuração email.app_url)' })
  appUrl!: string;
}

export class ProviderRequest {
  @ApiProperty({
    enum: ['smtp', 'microsoft_graph', 'google_workspace'],
    required: false,
    default: 'smtp',
    description: 'Sem o campo vale SMTP',
  })
  type?: string;
  @ApiProperty({ example: 'smtp.example.test', required: false, description: 'SMTP' }) host?: string;
  @ApiProperty({ example: 587, required: false, description: 'SMTP' }) port?: number;
  @ApiProperty({ enum: ['tls', 'starttls', 'none'], required: false, description: 'SMTP' }) security?: string;
  @ApiProperty({ type: String, nullable: true, required: false, description: 'SMTP' }) username?: string | null;
  @ApiProperty({ type: String, required: false, description: 'Microsoft: ID do tenant (GUID) ou domínio dele' })
  tenantId?: string;
  @ApiProperty({ type: String, required: false, description: 'Microsoft: ID do cliente (aplicativo)' })
  clientId?: string;
  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    description: 'Microsoft: omitir mantém o segredo gravado; nulo apaga. Nunca volta pela API',
  })
  clientSecret?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false, description: 'Microsoft: ID do objeto da caixa' })
  mailboxId?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false, description: 'Microsoft: "responder para"' })
  replyTo?: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    description:
      'Google: conteúdo do JSON da conta de serviço; omitir mantém a chave gravada; nulo apaga. Nunca volta pela API',
  })
  serviceAccountJson?: string | null;
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    required: false,
    description: 'Microsoft e Google: validade do segredo ou da chave (AAAA-MM-DD)',
  })
  secretExpiresOn?: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    description: 'Omitir mantém a senha gravada; nulo apaga',
  })
  password?: string | null;
  @ApiProperty({ example: 'ideias@example.test', description: 'Remetente (no Microsoft e no Google, a caixa)' })
  fromAddress!: string;
  @ApiProperty({ type: String, nullable: true, required: false, description: 'SMTP e Google; sem efeito no Microsoft' })
  fromName?: string | null;
}

export class TestEmailRequest {
  @ApiProperty({ example: 'admin@example.test' }) to!: string;
}

export class TestEmailResult {
  @ApiProperty() ok!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Falha como `código` ou `código: detalhe` (códigos em MAIL_ERROR_CODES; a tela traduz o código), sem a senha',
  })
  error!: string | null;
}

// --- Modelos (RN-32) ------------------------------------------------------------------------------

export const TemplateSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(10_000),
});

export class TemplateView {
  @ApiProperty({ enum: TEMPLATE_KEYS, enumName: 'EmailTemplateKey' }) key!: string;
  @ApiProperty({ enum: TEMPLATE_LOCALES }) locale!: string;
  @ApiProperty() subject!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ description: 'Editado pelo admin (falso = texto de fábrica)' }) customized!: boolean;
  @ApiProperty({ type: [String] }) variables!: string[];
}

export class TemplateRequest {
  @ApiProperty() subject!: string;
  @ApiProperty() body!: string;
}

// --- Envios (CA-RN-90.4) --------------------------------------------------------------------------

export const EmailLogQuerySchema = PageQuerySchema.extend({
  status: z.enum(['pending', 'sent', 'failed']).optional(),
});

export class EmailLogView {
  @ApiProperty() id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() toAddress!: string;
  @ApiProperty() subject!: string;
  @ApiProperty({ enum: ['pending', 'sent', 'failed'] }) status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Falha como `código` ou `código: detalhe` (códigos em MAIL_ERROR_CODES; a tela traduz o código), sem a senha',
  })
  lastError!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) sentAt!: string | null;
}

export class EmailLogPage {
  @ApiProperty({ type: [EmailLogView] }) items!: EmailLogView[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}

// --- Recuperação de senha por e-mail (RN-42) ------------------------------------------------------

export const ForgotPasswordSchema = z.object({ email: z.email().max(320) });

export class ForgotPasswordRequest {
  @ApiProperty({ example: 'pessoa@example.test' }) email!: string;
}
