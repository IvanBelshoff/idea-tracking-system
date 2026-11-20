import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { INTEGRATION_LIMITS, INTEGRATION_MODULES, INTEGRATION_STATUSES } from '../modules.js';

const scope = z
  .array(z.object({ entityId: z.uuid(), includeChildren: z.boolean() }))
  .max(500)
  .refine((list) => new Set(list.map((s) => s.entityId)).size === list.length, 'Entidade repetida no escopo');

const expiresAt = z.iso.datetime({ offset: true });

/** Os campos de uma integração (criar e alterar). Validações de negócio (módulo ligado, IP, entidade) ficam no serviço. */
const fields = {
  name: z.string().trim().min(1).max(120),
  owner: z.string().trim().max(200).default(''),
  modules: z.array(z.string().max(30)).max(20),
  scope,
  ratePerMinute: z
    .number()
    .int()
    .min(1)
    .max(INTEGRATION_LIMITS.maxRatePerMinute)
    .default(INTEGRATION_LIMITS.defaultRatePerMinute),
  ipAllowlist: z.array(z.string().trim().max(60)).max(100).default([]),
  includeEmail: z.boolean().default(false),
};

export const IntegrationCreateSchema = z.object({ ...fields, expiresAt });
export const IntegrationUpdateSchema = z.object(fields);
export const IntegrationEnabledSchema = z.object({ enabled: z.boolean() });
export const IntegrationModulesSchema = z.object({ modules: z.array(z.string().max(30)).max(20) });
export const TokenRotateSchema = z.object({
  expiresAt,
  overlapHours: z
    .number()
    .int()
    .min(0)
    .max(INTEGRATION_LIMITS.maxOverlapHours)
    .default(INTEGRATION_LIMITS.defaultOverlapHours),
});

export type IntegrationCreateInput = z.infer<typeof IntegrationCreateSchema>;
export type IntegrationUpdateInput = z.infer<typeof IntegrationUpdateSchema>;

export class ScopeEntryInput {
  @ApiProperty({ format: 'uuid' }) entityId!: string;
  @ApiProperty({ description: 'Inclui as subentidades' }) includeChildren!: boolean;
}

class IntegrationFieldsRequest {
  @ApiProperty({ description: 'Nome único (sem diferenciar maiúsculas)', maxLength: 120 }) name!: string;
  @ApiProperty({ required: false, description: 'Quem responde por esta integração (texto livre)' }) owner?: string;
  @ApiProperty({ enum: INTEGRATION_MODULES, isArray: true, description: 'Subconjunto dos módulos ligados' })
  modules!: string[];
  @ApiProperty({ type: [ScopeEntryInput], description: 'Entidades que ela enxerga; vazio = não vê nada' })
  scope!: ScopeEntryInput[];
  @ApiProperty({ required: false, minimum: 1, maximum: INTEGRATION_LIMITS.maxRatePerMinute, example: 60 })
  ratePerMinute?: number;
  @ApiProperty({ type: [String], required: false, description: 'IPs ou faixas CIDR (até 20); vazio = qualquer origem' })
  ipAllowlist?: string[];
  @ApiProperty({ required: false, description: 'Módulo Usuários devolve o e-mail (sensível)' }) includeEmail?: boolean;
}

export class IntegrationCreateRequest extends IntegrationFieldsRequest {
  @ApiProperty({ format: 'date-time', description: 'Validade do primeiro token (obrigatória, até 365 dias)' })
  expiresAt!: string;
}

export class IntegrationUpdateRequest extends IntegrationFieldsRequest {}

export class IntegrationEnabledRequest {
  @ApiProperty() enabled!: boolean;
}

export class IntegrationModulesRequest {
  @ApiProperty({ enum: INTEGRATION_MODULES, isArray: true }) modules!: string[];
}

export class TokenRotateRequest {
  @ApiProperty({ format: 'date-time', description: 'Validade do novo token (obrigatória, até 365 dias)' })
  expiresAt!: string;
  @ApiProperty({
    required: false,
    minimum: 0,
    maximum: INTEGRATION_LIMITS.maxOverlapHours,
    description: 'Horas em que o token antigo ainda vale (padrão 24)',
  })
  overlapHours?: number;
}

export class IntegrationTokenView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: '`its_` mais 4 caracteres, só para reconhecer o token' }) prefix!: string;
  @ApiProperty({ enum: ['active', 'retiring', 'retired', 'expired', 'revoked'] }) state!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) retireAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revokedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastUsedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class IntegrationScopeView {
  @ApiProperty({ format: 'uuid' }) entityId!: string;
  @ApiProperty() entityName!: string;
  @ApiProperty() includeChildren!: boolean;
}

export class IntegrationExpiryView {
  @ApiProperty({ enum: ['ok', 'warning', 'failed'] }) state!: string;
  @ApiProperty({ enum: ['ok', 'expiring', 'expired'] }) code!: string;
  @ApiProperty({ type: Number, nullable: true, description: 'Dias até vencer o token de maior validade' })
  days!: number | null;
}

export class IntegrationView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() owner!: string;
  @ApiProperty({ enum: INTEGRATION_STATUSES }) status!: string;
  @ApiProperty({ enum: INTEGRATION_MODULES, isArray: true }) modules!: string[];
  @ApiProperty() includeEmail!: boolean;
  @ApiProperty() ratePerMinute!: number;
  @ApiProperty({ type: [String] }) ipAllowlist!: string[];
  @ApiProperty({ type: [IntegrationScopeView] }) scope!: IntegrationScopeView[];
  @ApiProperty({ type: [IntegrationTokenView] }) tokens!: IntegrationTokenView[];
  @ApiProperty({ type: IntegrationExpiryView, nullable: true }) expiry!: IntegrationExpiryView | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Última chamada de qualquer token' })
  lastUsedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revokedAt!: string | null;
}

export class IntegrationModuleView {
  @ApiProperty({ enum: INTEGRATION_MODULES }) id!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ description: 'Leva dado pessoal (módulo Usuários)' }) sensitive!: boolean;
  @ApiProperty({ description: 'Grava no ITS (módulos de escrita, M18): a tela os marca como "grava"' })
  writes!: boolean;
}

export class IntegrationLimitsView {
  @ApiProperty() maxTokenDays!: number;
  @ApiProperty() defaultRatePerMinute!: number;
  @ApiProperty() maxRatePerMinute!: number;
  @ApiProperty() maxIpEntries!: number;
  @ApiProperty() maxActiveTokens!: number;
  @ApiProperty() defaultOverlapHours!: number;
  @ApiProperty() maxOverlapHours!: number;
  @ApiProperty({ description: 'Validade sugerida para um token novo, em dias' }) suggestedTokenDays!: number;
}

export class IntegrationEntityOption {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) parentId!: string | null;
}

export class IntegrationsView {
  @ApiProperty({ description: 'Chave geral da API de integração' }) enabled!: boolean;
  @ApiProperty({ description: 'Endereço do sistema (`email.app_url`); vazio = ainda não definido' }) appUrl!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Endereço base da API de integração, para o `curl` e a documentação',
  })
  baseUrl!: string | null;
  @ApiProperty({ type: [String], description: 'O que impede ligar a chave: app_url_required, https_required' })
  blockers!: string[];
  @ApiProperty({ type: [IntegrationModuleView] }) modules!: IntegrationModuleView[];
  @ApiProperty({ type: [IntegrationView] }) integrations!: IntegrationView[];
  @ApiProperty({ type: IntegrationLimitsView }) limits!: IntegrationLimitsView;
  @ApiProperty({ type: [IntegrationEntityOption], description: 'Entidades para montar o escopo' })
  entityOptions!: IntegrationEntityOption[];
}

export class IntegrationWithToken {
  @ApiProperty({ type: IntegrationView }) integration!: IntegrationView;
  @ApiProperty({ description: 'O token completo. Aparece UMA ÚNICA VEZ; não há como recuperá-lo.' }) token!: string;
}

export class UsageByModule {
  @ApiProperty({ enum: INTEGRATION_MODULES }) module!: string;
  @ApiProperty() requests!: number;
  @ApiProperty() errors4xx!: number;
  @ApiProperty() errors5xx!: number;
  @ApiProperty() rateLimited!: number;
}

export class UsageHour {
  @ApiProperty({ format: 'date-time' }) hour!: string;
  @ApiProperty() requests!: number;
  @ApiProperty() errors4xx!: number;
  @ApiProperty() errors5xx!: number;
  @ApiProperty() rateLimited!: number;
}

export class IntegrationUsageView {
  @ApiProperty({ format: 'date-time' }) since!: string;
  @ApiProperty({ type: [UsageByModule] }) byModule!: UsageByModule[];
  @ApiProperty({ type: [UsageHour], description: 'Soma de todos os módulos, hora a hora' }) hours!: UsageHour[];
}
