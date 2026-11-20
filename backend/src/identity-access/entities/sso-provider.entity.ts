import { Check, Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { EditableEntity } from '../../database/base.entity.js';
import { User } from './user.entity.js';

/** Provedores de login corporativo aceitos (M13). O desenho admite outros no futuro. */
export const SSO_PROVIDERS = ['microsoft', 'google'] as const;
export type SsoProviderId = (typeof SSO_PROVIDERS)[number];

export function isSsoProvider(value: string): value is SsoProviderId {
  return (SSO_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Configuração de um provedor de login corporativo (RN-96, RN-97). Uma linha por provedor. O
 * segredo do cliente só existe cifrado (`config_encrypted`, mesmo mecanismo do SMTP) e nunca sai
 * pela API. Mudar cliente, segredo ou tenant desliga o provedor até um novo teste de conexão.
 */
@Entity('sso_provider')
@Check('ck_sso_provider_provider', "provider IN ('microsoft', 'google')")
export class SsoProvider extends EditableEntity {
  @Column({ type: 'varchar', length: 20, unique: true })
  provider!: SsoProviderId;

  @Column({ name: 'client_id', type: 'varchar', length: 200 })
  clientId!: string;

  /** Só na Microsoft (app de um tenant só); nulo no Google. */
  @Column({ name: 'tenant_id', type: 'varchar', length: 100, nullable: true })
  tenantId!: string | null;

  /** JSON `{ clientSecret }` cifrado em AES-256-GCM (chave derivada da `APP_SECRET_KEY`). */
  @Column({ name: 'config_encrypted', type: 'bytea', nullable: true })
  configEncrypted!: Buffer | null;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /** Oferecer a foto do perfil do provedor (RN-144); desligado de fábrica. */
  @Column({ name: 'photo_enabled', type: 'boolean', default: false })
  photoEnabled!: boolean;

  @Column({ name: 'last_test_at', type: 'timestamptz', nullable: true })
  lastTestAt!: Date | null;

  @Column({ name: 'last_test_ok', type: 'boolean', nullable: true })
  lastTestOk!: boolean | null;

  @Column({ name: 'last_test_error', type: 'text', nullable: true })
  lastTestError!: string | null;

  /** Validade do segredo do cliente (RN-100); `AAAA-MM-DD`. */
  @Column({ name: 'secret_expires_on', type: 'date', nullable: true })
  secretExpiresOn!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_id' })
  updatedBy!: User | null;
}
