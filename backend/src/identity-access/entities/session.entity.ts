import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { CreatedEntity } from '../../database/base.entity.js';
import { User } from './user.entity.js';

/**
 * Sessão no servidor (cookie httpOnly). Só o hash do token fica no banco.
 * Desativar o usuário revoga as sessões (CA-RN-41.1).
 */
@Entity('session')
export class Session extends CreatedEntity {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** SHA-256 do token, em hexadecimal. */
  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  userAgent!: string | null;
}
