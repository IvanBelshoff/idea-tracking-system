import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { isValidDomain, normalizeDomains } from './domain-policy.js';
import { SSO_PROVIDERS, type SsoProviderId } from './entities/sso-provider.entity.js';

/** Lista de domínios: normaliza (minúsculas, sem `@`, sem repetição) e confere o formato (CA-RN-95.1). */
const domains = z
  .array(z.string().trim().min(1).max(253))
  .max(50)
  .transform(normalizeDomains)
  .refine((list) => list.every(isValidDomain), 'Informe domínios válidos, como empresa.com.br');

export const AccessPolicySchema = z.object({ domains, allowExternal: z.boolean() });

export { isValidTenant } from '../common/microsoft.js';

export const SsoProviderSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  /** Só a Microsoft usa; o formato é conferido no serviço (o Google ignora o campo). */
  tenantId: z.string().trim().max(100).nullish(),
  /** Ausente = manter o segredo gravado; nulo ou vazio = apagar. */
  clientSecret: z.string().max(500).nullish(),
  /** Validade do segredo, `AAAA-MM-DD` (RN-100); ausente = manter (apaga se o segredo mudou). */
  secretExpiresOn: z.iso.date().nullish(),
});

export const SsoModeSchema = z.object({ mode: z.enum(['password', 'password_sso', 'sso']) });

/** Oferecer a foto do perfil do provedor (RN-144). */
export const SsoPhotoSchema = z.object({ enabled: z.boolean() });

export const ProvisioningSchema = z.object({
  autoCreate: z.boolean(),
  roleId: z.uuid().nullable(),
  entityId: z.uuid().nullable(),
});

export class AccessPolicyRequest {
  @ApiProperty({ type: [String], example: ['empresa.com.br'], description: 'Vazio = sem restrição' })
  domains!: string[];
  @ApiProperty({ description: 'Aceita cadastrar e-mail fora dos domínios' }) allowExternal!: boolean;
}

export class SsoProviderRequest {
  @ApiProperty({ description: 'ID do aplicativo (cliente) registrado no provedor' }) clientId!: string;
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    description: 'Só Microsoft: ID do tenant (GUID) ou domínio dele',
  })
  tenantId?: string | null;
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    description: 'Segredo do cliente. Ausente = manter o gravado; nulo ou vazio = apagar. Nunca volta pela API.',
  })
  clientSecret?: string | null;
  @ApiProperty({
    type: String,
    format: 'date',
    required: false,
    nullable: true,
    description: 'Validade do segredo (AAAA-MM-DD). Ausente = manter; apaga se o segredo mudou sem data nova.',
  })
  secretExpiresOn?: string | null;
}

export class SsoPhotoRequest {
  @ApiProperty({ description: 'Oferecer a foto do perfil do provedor (RN-144); a Microsoft passa a pedir `User.Read`' })
  enabled!: boolean;
}

export class SsoModeRequest {
  @ApiProperty({ enum: ['password', 'password_sso', 'sso'], description: 'Só senha, senha ou SSO, ou só SSO' })
  mode!: 'password' | 'password_sso' | 'sso';
}

export class ProvisioningRequest {
  @ApiProperty({ description: 'Cria a conta no primeiro login corporativo' }) autoCreate!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Perfil inicial (nunca administrativo)' })
  roleId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Entidade inicial' })
  entityId!: string | null;
}

export class AccessPolicyView {
  @ApiProperty({ type: [String] }) domains!: string[];
  @ApiProperty() allowExternal!: boolean;
}

export class OutsideUser {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
}

export class SsoProviderView {
  @ApiProperty({ enum: SSO_PROVIDERS, enumName: 'SsoProviderId' }) provider!: SsoProviderId;
  @ApiProperty({ description: 'Cliente, segredo e (Microsoft) tenant preenchidos' }) configured!: boolean;
  @ApiProperty() clientId!: string;
  @ApiProperty({ type: String, nullable: true }) tenantId!: string | null;
  @ApiProperty({ description: 'O segredo está gravado (nunca é devolvido)' }) clientSecretSet!: boolean;
  @ApiProperty({ type: String, format: 'date', nullable: true, description: 'Validade do segredo (RN-100)' })
  secretExpiresOn!: string | null;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ description: 'Oferece a foto do perfil do provedor (RN-144)' }) photoEnabled!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastTestAt!: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) lastTestOk!: boolean | null;
  @ApiProperty({ type: String, nullable: true, description: 'Código do motivo da falha do último teste' })
  lastTestError!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Endereço de retorno a registrar no provedor' })
  redirectUri!: string | null;
  @ApiProperty({
    type: [String],
    description:
      'O que falta para ligar: app_url_required, https_required, secret_key_missing, provider_incomplete, domains_required, test_required',
  })
  blockers!: string[];
}

export class RoleOption {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Perfil administrativo: não pode ser o perfil inicial' }) administrative!: boolean;
}

export class EntityOption {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class SsoView {
  @ApiProperty({ description: 'Endereço do sistema (e-mail.app_url); vazio = ainda não definido' }) appUrl!: string;
  @ApiProperty({ description: 'O servidor tem a chave APP_SECRET_KEY para cifrar o segredo' }) secretKeyReady!: boolean;
  @ApiProperty({ enum: ['password', 'password_sso', 'sso'] }) mode!: 'password' | 'password_sso' | 'sso';
  @ApiProperty({ type: [String], description: 'O que impede cada modo diferente de "Só senha"' })
  modeBlockers!: string[];
  @ApiProperty({ description: 'A pessoa logada já tem a conta de um provedor vinculada' }) actorLinked!: boolean;
  @ApiProperty() autoCreate!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) defaultRoleId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) defaultEntityId!: string | null;
  @ApiProperty({ type: [SsoProviderView] }) providers!: SsoProviderView[];
  @ApiProperty({ type: [RoleOption] }) roleOptions!: RoleOption[];
  @ApiProperty({ type: [EntityOption] }) entityOptions!: EntityOption[];
}

export class AccessView {
  @ApiProperty({ type: AccessPolicyView }) policy!: AccessPolicyView;
  @ApiProperty({ type: [OutsideUser], description: 'Usuários fora dos domínios (até 50), que entram só com senha' })
  outsideUsers!: OutsideUser[];
  @ApiProperty({ description: 'Quantos usuários estão fora dos domínios, no total' }) outsideTotal!: number;
  @ApiProperty({ type: SsoView }) sso!: SsoView;
}

export class SsoTestAddressResult {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Código do erro (sso_network, sso_provider_error…)' })
  error!: string | null;
}
