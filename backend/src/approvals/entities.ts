import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { CreatedEntity } from '../database/base.entity.js';
import { Attachment } from '../ideas/entities/attachment.entity.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { User } from '../identity-access/entities/user.entity.js';
import {
  APPROVAL_HOLDS,
  APPROVAL_STATUSES,
  type ApprovalHold,
  type ApprovalStatus,
  DECISION_SOURCES,
  type DecisionSource,
  RECIPIENT_DECISIONS,
  type RecipientDecision,
} from './approval-rules.js';

/**
 * Pedido de aprovação (M24, RN-183): a equipe pede o aval de outras áreas para uma ideia. Guarda uma
 * CÓPIA do que o aprovador vê (código, título, resumo, ganho), para a ideia mudar sem mudar o pedido.
 * Um pedido aberto por ideia (índice único parcial).
 */
@Entity('approval_request')
@Index('uq_approval_request_open', ['ideaId'], { unique: true, where: `status = 'pending'` })
@Check('ck_approval_request_closed', `(status = 'pending') = (closed_at IS NULL)`)
export class ApprovalRequest extends CreatedEntity {
  @Index()
  @Column({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @Column({ type: 'enum', enum: APPROVAL_STATUSES, enumName: 'approval_status', default: 'pending' })
  status!: ApprovalStatus;

  /** A transição que o pedido segura (RN-188). */
  @Column({ type: 'enum', enum: APPROVAL_HOLDS, enumName: 'approval_hold' })
  holds!: ApprovalHold;

  @Column({ name: 'idea_code', type: 'varchar', length: 40 })
  ideaCode!: string;

  @Column({ name: 'idea_title', type: 'varchar', length: 200 })
  ideaTitle!: string;

  @Column({ type: 'varchar', length: 2000 })
  summary!: string;

  /** Ganho estimado congelado, só quando o analista marcou mostrar. */
  @Column({ name: 'gain_snapshot', type: 'jsonb', nullable: true })
  gainSnapshot!: { estimated: string; currency: string; periodicity: string } | null;

  /** Último dia para responder (no fuso da instalação) e o instante em que vence. */
  @Column({ name: 'due_on', type: 'date' })
  dueOn!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'requested_by', type: 'uuid' })
  requestedById!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requested_by' })
  requestedBy!: User;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  /** Cancelamento (RN-183): por quem (nulo = o próprio ITS, ao encerrar a ideia) e por quê. */
  @Column({ name: 'cancelled_by', type: 'uuid', nullable: true })
  cancelledById!: string | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 1000, nullable: true })
  cancelReason!: string | null;

  /** "Seguir sem a aprovação" (RN-188, só no modo devolver): quem, quando e a justificativa. */
  @Column({ name: 'overridden_at', type: 'timestamptz', nullable: true })
  overriddenAt!: Date | null;

  @Column({ name: 'overridden_by', type: 'uuid', nullable: true })
  overriddenById!: string | null;

  @Column({ name: 'override_reason', type: 'varchar', length: 1000, nullable: true })
  overrideReason!: string | null;
}

/**
 * Um aprovador do pedido (RN-183 a RN-187): alguém do ITS (`user_id`) ou de fora (nome, e-mail). Quem é
 * de fora decide por um link de uso único: o banco guarda só o SHA-256 do link (CA-T.28).
 */
@Entity('approval_recipient')
@Check('ck_approval_recipient_who', 'user_id IS NOT NULL OR email IS NOT NULL')
@Check('ck_approval_recipient_decided', `(decision IN ('approved', 'rejected')) = (decided_at IS NOT NULL)`)
export class ApprovalRecipient extends CreatedEntity {
  @Index()
  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @ManyToOne(() => ApprovalRequest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: ApprovalRequest;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  /** Nome mostrado (de quem é de fora, ou o do usuário na hora do pedido). */
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 254, nullable: true })
  email!: string | null;

  /** A área que a pessoa representa (ex.: "Manutenção"). */
  @Column({ type: 'varchar', length: 80, default: '' })
  area!: string;

  /** SHA-256 (hex) do link de uso único; nulo para quem é do ITS ou sem envio de e-mail. */
  @Index('uq_approval_recipient_token', { unique: true, where: 'token_hash IS NOT NULL' })
  @Column({ name: 'token_hash', type: 'char', length: 64, nullable: true })
  tokenHash!: string | null;

  @Column({ type: 'enum', enum: RECIPIENT_DECISIONS, enumName: 'approval_decision', default: 'pending' })
  decision!: RecipientDecision;

  @Column({ type: 'enum', enum: DECISION_SOURCES, enumName: 'approval_source', nullable: true })
  source!: DecisionSource | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  comment!: string | null;

  /** O nome que a pessoa confirmou ao decidir (ou o informado no registro manual). */
  @Column({ name: 'decided_name', type: 'varchar', length: 120, nullable: true })
  decidedName!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'decided_ip', type: 'varchar', length: 64, nullable: true })
  decidedIp!: string | null;

  /** Registro manual (RN-187): quem registrou e a data da decisão informada. */
  @Column({ name: 'recorded_by', type: 'uuid', nullable: true })
  recordedById!: string | null;

  @Column({ name: 'decided_on', type: 'date', nullable: true })
  decidedOn!: string | null;

  /** Código de confirmação (RN-185): só o SHA-256, a validade e as tentativas. */
  @Column({ name: 'code_hash', type: 'char', length: 64, nullable: true })
  codeHash!: string | null;

  @Column({ name: 'code_expires_at', type: 'timestamptz', nullable: true })
  codeExpiresAt!: Date | null;

  @Column({ name: 'code_attempts', type: 'int', default: 0 })
  codeAttempts!: number;

  /** Lembretes enviados (RN-189): no máximo dois. */
  @Column({ name: 'reminders_sent', type: 'int', default: 0 })
  remindersSent!: number;
}

/** Os anexos da ideia que o pedido mostra ao aprovador (até 5, RN-183). */
@Entity('approval_request_attachment')
export class ApprovalRequestAttachment {
  @PrimaryColumn({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @PrimaryColumn({ name: 'attachment_id', type: 'uuid' })
  attachmentId!: string;

  @ManyToOne(() => ApprovalRequest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: ApprovalRequest;

  @ManyToOne(() => Attachment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attachment_id' })
  attachment!: Attachment;
}

/** Evidência do registro manual (RN-187): o e-mail salvo, a ata. O arquivo fica no armazenamento. */
@Entity('approval_evidence')
export class ApprovalEvidence extends CreatedEntity {
  @Index()
  @Column({ name: 'recipient_id', type: 'uuid' })
  recipientId!: string;

  @ManyToOne(() => ApprovalRecipient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_id' })
  recipient!: ApprovalRecipient;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName!: string;

  @Column({ name: 'stored_name', type: 'varchar', length: 80, unique: true })
  storedName!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 120 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes!: number;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedById!: string;
}
