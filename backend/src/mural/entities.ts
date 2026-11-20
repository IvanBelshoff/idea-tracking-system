import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { CreatedEntity } from '../database/base.entity.js';
import type { ConsentStatus } from '../hall/entities.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { User } from '../identity-access/entities/user.entity.js';
import { MURAL_REACTIONS, type MuralReaction, REPORT_REASONS, type ReportReason } from './mural-rules.js';

export enum MuralStatus {
  Published = 'published',
  Withdrawn = 'withdrawn',
}

/**
 * Publicação de uma ideia no mural (M21, RN-149). Uma por ideia: retirar e publicar de novo reusam
 * a mesma linha, e reações, comentários e consentimentos (ligados à ideia) continuam guardados.
 * `withdrawn_by_id` nulo numa retirada = retirada automática (autor: o sistema).
 */
@Entity('mural_post')
@Check('ck_mural_post_withdrawn', `status <> 'withdrawn' OR withdrawn_reason IS NOT NULL`)
@Index('ix_mural_post_published', ['publishedAt'], { where: `status = 'published'` })
export class MuralPost {
  @PrimaryColumn({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @Column({ type: 'enum', enum: MuralStatus, enumName: 'mural_status', default: MuralStatus.Published })
  status!: MuralStatus;

  /** A publicação vigente (a mais recente); ordena o mural (RN-150). */
  @Column({ name: 'published_at', type: 'timestamptz' })
  publishedAt!: Date;

  @Column({ name: 'published_by_id', type: 'uuid', nullable: true })
  publishedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'published_by_id' })
  publishedBy!: User | null;

  @Column({ name: 'withdrawn_at', type: 'timestamptz', nullable: true })
  withdrawnAt!: Date | null;

  @Column({ name: 'withdrawn_by_id', type: 'uuid', nullable: true })
  withdrawnById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'withdrawn_by_id' })
  withdrawnBy!: User | null;

  @Column({ name: 'withdrawn_reason', type: 'text', nullable: true })
  withdrawnReason!: string | null;
}

/**
 * Consentimento de cada participante em mostrar o nome no mural (RN-151). Por ideia (não por
 * publicação): vale também depois de retirar e publicar de novo. Sem aceite, aparece sem nome.
 */
@Entity('mural_consent')
export class MuralConsent {
  @PrimaryColumn({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 20 })
  role!: 'author' | 'co_author';

  @Column({ type: 'enum', enum: ['pending', 'accepted', 'declined'], enumName: 'consent_status', default: 'pending' })
  status!: ConsentStatus;

  @Column({ name: 'answered_at', type: 'timestamptz', nullable: true })
  answeredAt!: Date | null;
}

/** Reação (RN-152): no máximo uma por pessoa e ideia; trocar substitui. */
@Entity('mural_reaction')
@Index('ix_mural_reaction_idea', ['ideaId', 'kind'])
export class MuralReactionRow {
  @PrimaryColumn({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: MURAL_REACTIONS, enumName: 'mural_reaction_kind' })
  kind!: MuralReaction;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Comentário da conversa do mural (RN-153), separado do comentário da ideia (RN-28). Resposta em um
 * nível só: `parent_id` aponta sempre para um comentário de primeiro nível.
 */
@Entity('mural_comment')
@Index('ix_mural_comment_idea', ['ideaId', 'createdAt'])
@Index('ix_mural_comment_author', ['authorId', 'createdAt'])
@Check('ck_mural_comment_hidden', 'hidden_at IS NULL OR hidden_reason IS NOT NULL')
export class MuralComment extends CreatedEntity {
  @Column({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => MuralComment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent!: MuralComment | null;

  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_id' })
  author!: User | null;

  @Column({ type: 'varchar', length: 2000 })
  body!: string;

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt!: Date | null;

  /** Apagado por quem escreveu: com respostas, fica "Comentário removido" no lugar. */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'hidden_at', type: 'timestamptz', nullable: true })
  hiddenAt!: Date | null;

  @Column({ name: 'hidden_by_id', type: 'uuid', nullable: true })
  hiddenById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'hidden_by_id' })
  hiddenBy!: User | null;

  @Column({ name: 'hidden_reason', type: 'text', nullable: true })
  hiddenReason!: string | null;
}

/** Texto anterior de um comentário editado (RN-153): só a equipe (`mural.manage`) lê. */
@Entity('mural_comment_revision')
export class MuralCommentRevision extends CreatedEntity {
  @Index()
  @Column({ name: 'comment_id', type: 'uuid' })
  commentId!: string;

  @ManyToOne(() => MuralComment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'comment_id' })
  comment!: MuralComment;

  @Column({ type: 'varchar', length: 2000 })
  body!: string;
}

export type ReportResolution = 'hidden' | 'dismissed';

/** Denúncia de um comentário (RN-154): uma por pessoa e comentário; a equipe oculta ou dispensa. */
@Entity('mural_report')
@Unique('uq_mural_report_reporter', ['commentId', 'reporterId'])
@Index('ix_mural_report_pending', ['createdAt'], { where: 'resolved_at IS NULL' })
export class MuralReport extends CreatedEntity {
  @Column({ name: 'comment_id', type: 'uuid' })
  commentId!: string;

  @ManyToOne(() => MuralComment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'comment_id' })
  comment!: MuralComment;

  @Column({ name: 'reporter_id', type: 'uuid' })
  reporterId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporter_id' })
  reporter!: User;

  @Column({ type: 'enum', enum: REPORT_REASONS, enumName: 'mural_report_reason' })
  reason!: ReportReason;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'resolved_by_id', type: 'uuid', nullable: true })
  resolvedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by_id' })
  resolvedBy!: User | null;

  @Column({
    type: 'enum',
    enum: ['hidden', 'dismissed'],
    enumName: 'mural_report_resolution',
    nullable: true,
  })
  resolution!: ReportResolution | null;
}

/** Ideia enviada a um colega (RN-155): o registro serve ao limite por hora e ao aviso. */
@Entity('mural_share')
@Index('ix_mural_share_sender', ['senderId', 'createdAt'])
export class MuralShare extends CreatedEntity {
  @Column({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender!: User;

  @Column({ name: 'recipient_id', type: 'uuid' })
  recipientId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_id' })
  recipient!: User;

  @Column({ type: 'varchar', length: 300, nullable: true })
  message!: string | null;
}
