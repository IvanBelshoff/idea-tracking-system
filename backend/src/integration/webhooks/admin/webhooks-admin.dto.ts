import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { INTEGRATION_MODULES } from '../../modules.js';
import { WEBHOOK_EVENT_TYPES } from '../events.js';
import { WEBHOOK_LIMITS } from '../rules.js';

const expiresAt = z.iso.datetime({ offset: true });
const name = z.string().trim().min(1).max(120);
const url = z.string().trim().min(1).max(2000);
const events = z.array(z.string().max(40)).max(20);

export const WebhooksEnabledSchema = z.object({ enabled: z.boolean() });
export const DestinationsSchema = z.object({ destinations: z.array(z.string().max(253)).max(200) });
export const SubscriptionCreateSchema = z.object({ integrationId: z.uuid(), name, url, events, expiresAt });
export const SubscriptionUpdateSchema = z.object({ name, url, events });
export const SecretRotateSchema = z.object({
  expiresAt,
  overlapHours: z.number().int().min(0).max(WEBHOOK_LIMITS.maxOverlapHours).default(WEBHOOK_LIMITS.defaultOverlapHours),
});

export type SubscriptionCreateInput = z.infer<typeof SubscriptionCreateSchema>;
export type SubscriptionUpdateInput = z.infer<typeof SubscriptionUpdateSchema>;

export class WebhooksEnabledRequest {
  @ApiProperty() enabled!: boolean;
}

export class DestinationsRequest {
  @ApiProperty({
    type: [String],
    example: ['erp.empresa.local', '*.empresa.com.br', '10.20.0.0/16'],
    description: 'Nomes, domínios com curinga, IPs e faixas (até 50)',
  })
  destinations!: string[];
}

export class SubscriptionCreateRequest {
  @ApiProperty({ format: 'uuid' }) integrationId!: string;
  @ApiProperty({ maxLength: 120 }) name!: string;
  @ApiProperty({
    example: 'https://erp.empresa.local/its/webhook',
    description: 'https (http só para rede interna da lista)',
  })
  url!: string;
  @ApiProperty({ type: [String], enum: WEBHOOK_EVENT_TYPES, description: 'Eventos de módulos que a integração tem' })
  events!: string[];
  @ApiProperty({ format: 'date-time', description: 'Validade do segredo (obrigatória, até 365 dias)' })
  expiresAt!: string;
}

export class SubscriptionUpdateRequest {
  @ApiProperty({ maxLength: 120 }) name!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ type: [String], enum: WEBHOOK_EVENT_TYPES }) events!: string[];
}

export class SecretRotateRequest {
  @ApiProperty({ format: 'date-time', description: 'Validade do novo segredo (obrigatória, até 365 dias)' })
  expiresAt!: string;
  @ApiProperty({
    required: false,
    minimum: 0,
    maximum: WEBHOOK_LIMITS.maxOverlapHours,
    description: 'Horas em que o segredo antigo ainda assina (padrão 24)',
  })
  overlapHours?: number;
}

export class WebhookSecretView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: '`whsec_` mais 4 caracteres, só para reconhecer o segredo' }) prefix!: string;
  @ApiProperty({ enum: ['active', 'retiring', 'retired', 'expired', 'revoked'] }) state!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) retireAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revokedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class WebhookSubscriptionView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) integrationId!: string;
  @ApiProperty() integrationName!: string;
  @ApiProperty() name!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ type: [String], enum: WEBHOOK_EVENT_TYPES }) events!: string[];
  @ApiProperty({ enum: ['active', 'suspended'] }) status!: string;
  @ApiProperty({ type: String, enum: ['admin', 'failures'], nullable: true }) suspendedReason!: string | null;
  @ApiProperty() consecutiveFailures!: number;
  @ApiProperty({ type: [WebhookSecretView] }) secrets!: WebhookSecretView[];
  @ApiProperty({ description: 'Entregas pendentes' }) pending!: number;
  @ApiProperty({ description: 'Entregas em falha (na retenção)' }) failed!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class WebhookEventOption {
  @ApiProperty({ enum: WEBHOOK_EVENT_TYPES }) type!: string;
  @ApiProperty({ enum: INTEGRATION_MODULES }) module!: string;
}

export class WebhookIntegrationOption {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['active', 'suspended', 'revoked'] }) status!: string;
  @ApiProperty({ type: [String], enum: INTEGRATION_MODULES }) modules!: string[];
}

export class WebhookLimitsView {
  @ApiProperty() maxSubscriptions!: number;
  @ApiProperty() maxDestinations!: number;
  @ApiProperty() maxSecretDays!: number;
  @ApiProperty() maxActiveSecrets!: number;
  @ApiProperty() defaultOverlapHours!: number;
  @ApiProperty() maxOverlapHours!: number;
  @ApiProperty({ description: 'Validade sugerida para um segredo novo, em dias' }) suggestedSecretDays!: number;
}

export class WebhooksView {
  @ApiProperty({ description: 'Chave dos webhooks' }) enabled!: boolean;
  @ApiProperty({ description: 'A chave geral da API de integração está ligada' }) integrationEnabled!: boolean;
  @ApiProperty({ type: [String], description: 'Destinos permitidos (nomes, curingas, IPs e faixas)' })
  destinations!: string[];
  @ApiProperty({ type: [WebhookEventOption] }) events!: WebhookEventOption[];
  @ApiProperty({ type: [WebhookIntegrationOption], description: 'Integrações para criar uma assinatura' })
  integrations!: WebhookIntegrationOption[];
  @ApiProperty({ type: [WebhookSubscriptionView] }) subscriptions!: WebhookSubscriptionView[];
  @ApiProperty({ type: WebhookLimitsView }) limits!: WebhookLimitsView;
}

export class WebhookWithSecret {
  @ApiProperty({ type: WebhookSubscriptionView }) subscription!: WebhookSubscriptionView;
  @ApiProperty({ description: 'O segredo completo. Aparece UMA ÚNICA VEZ; não há como recuperá-lo.' }) secret!: string;
}

export class WebhookDeliveryView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty() eventType!: string;
  @ApiProperty({ enum: ['pending', 'delivered', 'failed'] }) state!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty({ format: 'date-time' }) nextAttemptAt!: string;
  @ApiProperty({ type: Number, nullable: true }) lastStatus!: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Código curto: timeout, connection, blocked_destination, redirect...',
  })
  lastError!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deliveredAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class WebhookPingResult {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ type: Number, nullable: true }) status!: number | null;
  @ApiProperty({ type: String, nullable: true }) error!: string | null;
}
