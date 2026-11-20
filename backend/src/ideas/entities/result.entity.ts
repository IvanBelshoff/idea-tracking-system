import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CreatedEntity } from '../../database/base.entity.js';
import { numeric } from '../../database/numeric.js';
import { User } from '../../identity-access/entities/user.entity.js';
import type { Direction, Periodicity } from '../results-rules.js';
import { Idea } from './idea.entity.js';

/** Medição do resultado (RN-61): indicador, unidade, linha de base, meta e obtido. Uma por ideia. */
@Entity('measurement')
export class Measurement {
  @PrimaryColumn({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @OneToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @Column({ type: 'varchar', length: 200 })
  indicator!: string;

  @Column({ type: 'varchar', length: 40 })
  unit!: string;

  /** Sentido em que melhorar significa: aumentar (produção) ou diminuir (tempo, refugo). */
  @Column({ type: 'enum', enum: ['increase', 'decrease'], enumName: 'measurement_direction' })
  direction!: Direction;

  @Column({ type: 'numeric', precision: 18, scale: 4, transformer: numeric })
  baseline!: number;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true, transformer: numeric })
  target!: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true, transformer: numeric })
  achieved!: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export enum GainStatus {
  Declared = 'declared',
  Validated = 'validated',
}

/**
 * Ganho financeiro (RN-62, RN-63). Estimado na triagem; realizado na conclusão; custo opcional.
 * Só o validado (por quem tem `gain.validate`) entra nos indicadores oficiais e no ROI.
 */
@Entity('financial_gain')
@Check(
  'ck_gain_non_negative',
  '(estimated IS NULL OR estimated >= 0) AND (realized IS NULL OR realized >= 0) AND (implementation_cost IS NULL OR implementation_cost >= 0)',
)
@Check('ck_gain_validated', `status <> 'validated' OR (realized IS NOT NULL AND validated_at IS NOT NULL)`)
export class FinancialGain {
  @PrimaryColumn({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @OneToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  /** Código ISO 4217 (ex.: BRL). */
  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ type: 'enum', enum: ['once', 'monthly', 'yearly'], enumName: 'gain_periodicity' })
  periodicity!: Periodicity;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numeric })
  estimated!: number | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numeric })
  realized!: number | null;

  @Column({
    name: 'implementation_cost',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numeric,
  })
  implementationCost!: number | null;

  @Column({ type: 'enum', enum: GainStatus, enumName: 'gain_status', default: GainStatus.Declared })
  status!: GainStatus;

  @Column({ name: 'validated_by_id', type: 'uuid', nullable: true })
  validatedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'validated_by_id' })
  validatedBy!: User | null;

  @Column({ name: 'validated_at', type: 'timestamptz', nullable: true })
  validatedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export enum SustainmentStatus {
  Pending = 'pending',
  Confirmed = 'confirmed',
  Contested = 'contested',
}

/**
 * Revisão de sustentação (RN-65): N dias depois de implementar, o responsável confirma se o ganho
 * se mantém. Contestar fica no histórico e não reabre a ideia (CA-RN-65.1).
 */
@Entity('sustainment_review')
@Index('ix_sustainment_pending_due', ['dueOn'], { where: `status = 'pending'` })
export class SustainmentReview extends CreatedEntity {
  @Index()
  @Column({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  /** Dia da revisão (sem hora; no fuso da instalação). */
  @Column({ name: 'due_on', type: 'date' })
  dueOn!: string;

  @Column({ type: 'enum', enum: SustainmentStatus, enumName: 'sustainment_status', default: SustainmentStatus.Pending })
  status!: SustainmentStatus;

  @Column({ name: 'reviewed_by_id', type: 'uuid', nullable: true })
  reviewedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by_id' })
  reviewedBy!: User | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
