import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { CreatedEntity } from '../../database/base.entity.js';
import { User } from './user.entity.js';

/** Recuperação de senha por link de uso único e com prazo (RN-42, CA-RN-42.3). */
@Entity('password_reset')
export class PasswordReset extends CreatedEntity {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** SHA-256 do token, em hexadecimal. O token em si só existe no link. */
  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;
}
