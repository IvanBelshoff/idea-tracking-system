import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { RichDoc } from '../../common/rich-text.js';
import { CreatedEntity, EditableEntity } from '../../database/base.entity.js';
import { User } from '../../identity-access/entities/user.entity.js';
import { Integration } from '../../integration/entities.js';
import { Idea } from './idea.entity.js';

// --- Participantes (RN-69, RN-86) ----------------------------------------------------------------

export enum ParticipantRole {
  Author = 'author',
  Executor = 'executor',
  CoAuthor = 'co_author',
}

export enum ParticipantOrigin {
  Original = 'original',
  Support = 'support',
  Converged = 'converged',
  Manual = 'manual',
}

/** Quem participa da ideia. O autor original é uma linha com `role = author` (M2). */
@Entity('idea_participant')
@Unique('uq_idea_participant', ['ideaId', 'userId', 'role'])
export class IdeaParticipant extends CreatedEntity {
  @Index()
  @Column({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: ParticipantRole, enumName: 'participant_role' })
  role!: ParticipantRole;

  @Column({
    type: 'enum',
    enum: ParticipantOrigin,
    enumName: 'participant_origin',
    default: ParticipantOrigin.Original,
  })
  origin!: ParticipantOrigin;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** De que ideia veio esta co-autoria (convergência); desfazer remove só as que vieram dela (RN-88). */
  @Column({ name: 'source_idea_id', type: 'uuid', nullable: true })
  sourceIdeaId!: string | null;

  @ManyToOne(() => Idea, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_idea_id' })
  sourceIdea!: Idea | null;

  @Column({ name: 'added_by', type: 'uuid', nullable: true })
  addedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'added_by' })
  addedBy!: User | null;
}

// --- Etapas (RN-12 a RN-17; no M2 só a primeira, criada ao aprovar) --------------------------------

/** Etapa da ideia. Posição única por ideia; prevista ≥ início (CHECK na migração). */
@Entity('step')
@Check('ck_step_position', 'position >= 1')
@Check('ck_step_dates', 'due_date >= start_date')
/** Alertas de prazo leem só etapas abertas por vencimento (RN-29). */
@Index('ix_step_open_due', ['dueDate'], { where: 'completed_at IS NULL' })
@Unique('uq_step_position', ['ideaId', 'position'])
export class Step extends EditableEntity {
  @Column({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @Column({ type: 'int' })
  position!: number;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** O documento do editor (RN-136); a coluna de texto acima é a cópia em texto puro. Nulo = texto puro. */
  @Column({ name: 'description_rich', type: 'jsonb', nullable: true })
  descriptionRich!: RichDoc | null;

  @Index()
  @Column({ name: 'assignee_id', type: 'uuid' })
  assigneeId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assignee_id' })
  assignee!: User;

  /** Datas sem hora, no fuso da instalação (CA-T.3). */
  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  /** Fase do ciclo PDCA, quando a ideia usa esse modelo (RN-60). Só um rótulo. */
  @Column({
    name: 'pdca_phase',
    type: 'enum',
    enum: ['plan', 'do', 'check', 'act'],
    enumName: 'pdca_phase',
    nullable: true,
  })
  pdcaPhase!: 'plan' | 'do' | 'check' | 'act' | null;
}

// --- Comentários (RN-28) --------------------------------------------------------------------------

export enum Visibility {
  Public = 'public',
  Internal = 'internal',
}

/** Público: autor e equipe; interno: só a equipe (quem tem `idea.comment_internal`). */
@Entity('comment')
@Index('ix_comment_idea_created', ['ideaId', 'createdAt'])
export class Comment extends CreatedEntity {
  @Column({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  /** Nulo no comentário de uma integração (M18, RN-128): quem comentou foi o sistema, não uma pessoa. */
  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_id' })
  author!: User | null;

  /** A integração que comentou pela API: "via Integração X" (M18, RN-133). */
  @Column({ name: 'source_integration_id', type: 'uuid', nullable: true })
  sourceIntegrationId!: string | null;

  @ManyToOne(() => Integration, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_integration_id' })
  sourceIntegration!: Integration | null;

  @Column({ type: 'text' })
  body!: string;

  /** O documento do editor (RN-136); a coluna de texto acima é a cópia em texto puro. Nulo = texto puro. */
  @Column({ name: 'body_rich', type: 'jsonb', nullable: true })
  bodyRich!: RichDoc | null;

  @Column({ type: 'enum', enum: Visibility, enumName: 'visibility' })
  visibility!: Visibility;
}

// --- Histórico (RN-38, RN-58) ---------------------------------------------------------------------

/**
 * Histórico imutável da ideia. Um trigger recusa UPDATE sempre e DELETE fora da exclusão física
 * autorizada pelo administrador (RN-11), que fica registrada na auditoria.
 */
@Entity('idea_event')
@Index('ix_idea_event_idea_at', ['ideaId', 'at'])
export class IdeaEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  /** `created`, `status_changed`, `assigned`, `step_added`, `comment_added`, `reopened`, `archived`… */
  @Column({ type: 'varchar', length: 40 })
  type!: string;

  /** Nulo quando é o sistema. */
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'actor_id' })
  actor!: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  at!: Date;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  /** Detalhes (ex.: `{ from, to }`); sempre preenchido pelo serviço. */
  @Column({ type: 'jsonb' })
  data!: Record<string, unknown>;

  @Column({ type: 'enum', enum: Visibility, enumName: 'visibility' })
  visibility!: Visibility;
}
