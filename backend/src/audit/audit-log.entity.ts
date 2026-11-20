import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../identity-access/entities/user.entity.js';

/**
 * Log de auditoria do sistema (RN-39). Somente inserção: um trigger criado na migração recusa
 * UPDATE, DELETE e TRUNCATE (docs/MODELO-DE-DADOS.md, §9). Nunca guarde senha, token ou segredo
 * em `data` (CA-RN-39.2).
 */
@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  at!: Date;

  /** Nulo quando a ação é do sistema. Sem ação em cascata: o log não pode ser alterado. */
  @Index()
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'actor_id' })
  actor!: User | null;

  /** Ex.: `auth.login`, `auth.login_failed`, `user.created`, `setting.updated`. */
  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 64, nullable: true })
  targetType!: string | null;

  @Column({ name: 'target_id', type: 'varchar', length: 64, nullable: true })
  targetId!: string | null;

  /** Sempre preenchido pelo serviço de auditoria (`{}` quando não há detalhe). */
  @Column({ type: 'jsonb' })
  data!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;
}
