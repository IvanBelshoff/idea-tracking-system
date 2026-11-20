import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CreatedEntity, EditableEntity } from '../database/base.entity.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { User } from '../identity-access/entities/user.entity.js';

// --- Notificações internas (RN-27, RN-29, RN-30) -------------------------------------------------

/** O que acontece com a notificação no e-mail: nada, aguardando o resumo diário ou já resumida. */
export enum NotificationEmailState {
  None = 'none',
  Pending = 'pending',
  Digested = 'digested',
}

/**
 * Uma notificação para uma pessoa. `in_app = false` quando ela desligou o canal interno para o
 * evento, mas quer o e-mail: a linha existe só para entrar no resumo diário.
 */
@Entity('notification')
@Index('ix_notification_user_read', ['userId', 'readAt', 'createdAt'])
@Index('ix_notification_email_pending', ['userId'], { where: "email_state = 'pending'" })
export class Notification extends CreatedEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 40 })
  type!: string;

  @Index()
  @Column({ name: 'idea_id', type: 'uuid', nullable: true })
  ideaId!: string | null;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea | null;

  /** Dados para montar o texto no idioma de quem lê (código, título, etapa, motivo...). */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'in_app', type: 'boolean', default: true })
  inApp!: boolean;

  @Column({
    name: 'email_state',
    type: 'enum',
    enum: NotificationEmailState,
    enumName: 'notification_email_state',
    default: NotificationEmailState.None,
  })
  emailState!: NotificationEmailState;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;
}

export enum NotificationChannel {
  InApp = 'in_app',
  Email = 'email',
}

/** Escolha da pessoa por evento e canal (RN-30). Sem linha = ligado. */
@Entity('notification_preference')
export class NotificationPreference {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @PrimaryColumn({ name: 'event_type', type: 'varchar', length: 40 })
  eventType!: string;

  @PrimaryColumn({ type: 'enum', enum: NotificationChannel, enumName: 'notification_channel' })
  channel!: NotificationChannel;

  @Column({ type: 'boolean' })
  enabled!: boolean;
}

/**
 * Trava de idempotência dos jobs (CA-RN-29.2, CA-T.1): a chave primária impede o mesmo alerta (ou
 * o mesmo resumo diário) duas vezes, mesmo que o job rode de novo.
 */
@Entity('alert_dedup')
export class AlertDedup {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  kind!: string;

  @PrimaryColumn({ name: 'target_id', type: 'uuid' })
  targetId!: string;

  @PrimaryColumn({ type: 'date' })
  day!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

// --- E-mail (RN-31, RN-32, RN-90) ----------------------------------------------------------------

/**
 * Provedor de envio: SMTP ou Microsoft Graph (`type`, RN-99). A configuração (host, usuário e senha, ou
 * tenant, cliente e segredo) fica junta e cifrada em `config_encrypted`; a API nunca devolve a senha nem o segredo. Começa desligado e só liga depois de um teste
 * bem-sucedido (CA-RN-90.1).
 */
@Entity('mail_provider')
export class MailProvider extends EditableEntity {
  @Column({ type: 'varchar', length: 20, default: 'smtp' })
  type!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'config_encrypted', type: 'bytea' })
  configEncrypted!: Buffer;

  @Column({ name: 'from_address', type: 'varchar', length: 320 })
  fromAddress!: string;

  @Column({ name: 'from_name', type: 'varchar', length: 200, nullable: true })
  fromName!: string | null;

  @Column({ type: 'boolean', default: false })
  active!: boolean;

  @Column({ name: 'last_test_at', type: 'timestamptz', nullable: true })
  lastTestAt!: Date | null;

  @Column({ name: 'last_test_ok', type: 'boolean', nullable: true })
  lastTestOk!: boolean | null;

  @Column({ name: 'last_test_error', type: 'text', nullable: true })
  lastTestError!: string | null;

  /** Validade do segredo do cliente (RN-100), só no tipo Microsoft; `AAAA-MM-DD`. */
  @Column({ name: 'secret_expires_on', type: 'date', nullable: true })
  secretExpiresOn!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_id' })
  updatedBy!: User | null;
}

/** Modelo editado pelo administrador (RN-32). Sem linha = texto de fábrica. */
@Entity('email_template')
export class EmailTemplate {
  @PrimaryColumn({ type: 'varchar', length: 40 })
  key!: string;

  @PrimaryColumn({ type: 'varchar', length: 10 })
  locale!: string;

  @Column({ type: 'varchar', length: 300 })
  subject!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_id' })
  updatedBy!: User | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export enum EmailStatus {
  Pending = 'pending',
  Sent = 'sent',
  Failed = 'failed',
}

/**
 * Rastro de cada e-mail (fila de saída). O worker pega as linhas pendentes, cria o job no pg-boss e
 * registra tentativas e o último erro, que aparecem na tela "Envios com falha" (CA-RN-90.4).
 * O corpo fica cifrado: pode conter link de recuperação de senha.
 */
@Entity('email_log')
@Index('ix_email_log_status_created', ['status', 'createdAt'])
export class EmailLog extends CreatedEntity {
  /** `digest`, `password_reset`... (chave do modelo usado). */
  @Column({ type: 'varchar', length: 40 })
  kind!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  @Column({ name: 'to_address', type: 'varchar', length: 320 })
  toAddress!: string;

  @Column({ type: 'varchar', length: 300 })
  subject!: string;

  @Column({ name: 'body_encrypted', type: 'bytea' })
  bodyEncrypted!: Buffer;

  @Column({ type: 'enum', enum: EmailStatus, enumName: 'email_status', default: EmailStatus.Pending })
  status!: EmailStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  /** Quando virou job no pg-boss. Nulo = ainda na fila de saída. */
  @Column({ name: 'queued_at', type: 'timestamptz', nullable: true })
  queuedAt!: Date | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;
}
