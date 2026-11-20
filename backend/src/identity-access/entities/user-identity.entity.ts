import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { CreatedEntity } from '../../database/base.entity.js';
import type { SsoProviderId } from './sso-provider.entity.js';
import { User } from './user.entity.js';

/**
 * Vínculo entre um usuário do ITS e a conta dele num provedor de login corporativo (RN-96).
 * Depois do primeiro vínculo o login é achado por (provedor, emissor, identificador), nunca só
 * pelo e-mail. Não guarda token nem claims do provedor.
 */
@Entity('user_identity')
@Check('ck_user_identity_provider', "provider IN ('microsoft', 'google')")
@Index('ux_user_identity_subject', ['provider', 'issuer', 'subject'], { unique: true })
@Index('ux_user_identity_user_provider', ['userId', 'provider'], { unique: true })
export class UserIdentity extends CreatedEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 20 })
  provider!: SsoProviderId;

  @Column({ type: 'varchar', length: 300 })
  issuer!: string;

  /** Na Microsoft, `tid:oid`; no Google, `sub`. */
  @Column({ type: 'varchar', length: 300 })
  subject!: string;

  /** O e-mail do provedor no momento do vínculo, só para consulta. */
  @Column({ name: 'email_at_link', type: 'varchar', length: 320 })
  emailAtLink!: string;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;
}
