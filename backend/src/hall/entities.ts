import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { CreatedEntity } from '../database/base.entity.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { User } from '../identity-access/entities/user.entity.js';

export type HighlightScope = 'entity' | 'organization';
export enum HighlightStatus {
  Active = 'active',
  Expired = 'expired',
  Revoked = 'revoked',
}

/**
 * Destaque no Hall (RN-72, RN-78, RN-79): escolhido por curadoria (ou entrada automática, se o admin
 * ligar), com justificativa e período. Ao vencer vai para o Hall da fama; pode ser revogado com motivo.
 */
@Entity('highlight')
@Check('ck_highlight_period', 'ends_on >= starts_on')
@Check('ck_highlight_revoked', `status <> 'revoked' OR revoked_reason IS NOT NULL`)
@Index('ix_highlight_active_end', ['endsOn'], { where: `status = 'active'` })
export class Highlight extends CreatedEntity {
  @Index()
  @Column({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @Column({ type: 'enum', enum: ['entity', 'organization'], enumName: 'highlight_scope' })
  scope!: HighlightScope;

  @Column({ type: 'text' })
  justification!: string;

  @Column({ name: 'starts_on', type: 'date' })
  startsOn!: string;

  @Column({ name: 'ends_on', type: 'date' })
  endsOn!: string;

  @Column({ type: 'enum', enum: HighlightStatus, enumName: 'highlight_status', default: HighlightStatus.Active })
  status!: HighlightStatus;

  /** Nulo = entrada automática (RN-72). */
  @Column({ name: 'curated_by_id', type: 'uuid', nullable: true })
  curatedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'curated_by_id' })
  curatedBy!: User | null;

  @Column({ name: 'revoked_reason', type: 'text', nullable: true })
  revokedReason!: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}

export type ConsentStatus = 'pending' | 'accepted' | 'declined';

/** Consentimento de cada autor e co-autor (RN-74). Sem aceite, aparece sem nome. */
@Entity('highlight_consent')
export class HighlightConsent {
  @PrimaryColumn({ name: 'highlight_id', type: 'uuid' })
  highlightId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => Highlight, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'highlight_id' })
  highlight!: Highlight;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** Papel na ideia (autor ou co-autor), para o cartão. */
  @Column({ type: 'varchar', length: 20 })
  role!: 'author' | 'co_author';

  @Column({ type: 'enum', enum: ['pending', 'accepted', 'declined'], enumName: 'consent_status', default: 'pending' })
  status!: ConsentStatus;

  @Column({ name: 'answered_at', type: 'timestamptz', nullable: true })
  answeredAt!: Date | null;
}

/** Elogio público no destaque (RN-77), com moderação. */
@Entity('highlight_praise')
export class HighlightPraise extends CreatedEntity {
  @Index()
  @Column({ name: 'highlight_id', type: 'uuid' })
  highlightId!: string;

  @ManyToOne(() => Highlight, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'highlight_id' })
  highlight!: Highlight;

  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_id' })
  author!: User | null;

  @Column({ type: 'varchar', length: 1000 })
  body!: string;

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

/** Curtida (RN-76): uma por pessoa e ideia; mede interesse, nunca decide nada no fluxo. */
@Entity('idea_like')
export class IdeaLike {
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** Candidata recusada pelo curador (CA-RN-72.3): não volta a ser sugerida. */
@Entity('hall_dismissal')
export class HallDismissal {
  @PrimaryColumn({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @Column({ name: 'dismissed_by_id', type: 'uuid', nullable: true })
  dismissedById!: string | null;

  @CreateDateColumn({ name: 'dismissed_at', type: 'timestamptz' })
  dismissedAt!: Date;
}
