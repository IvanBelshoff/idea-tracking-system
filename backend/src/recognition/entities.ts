import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { Campaign } from '../campaigns/entities.js';
import { CreatedEntity, EditableEntity } from '../database/base.entity.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { User } from '../identity-access/entities/user.entity.js';

/** Eventos que pontuam (RN-66). "Destacada no Hall" chega com o M9. */
export type PointEvent = 'idea_submitted' | 'idea_approved' | 'idea_implemented' | 'idea_highlighted';

/** Temporada (RN-66): o ranking da temporada recomeça na virada; o livro-razão guarda tudo. */
@Entity('season')
@Check('ck_season_period', 'ends_on >= starts_on')
export class Season extends EditableEntity {
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'starts_on', type: 'date' })
  startsOn!: string;

  @Column({ name: 'ends_on', type: 'date' })
  endsOn!: string;

  /** Temporada atrelada a uma campanha (opcional). */
  @Column({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId!: string | null;

  @ManyToOne(() => Campaign, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign | null;
}

/**
 * Livro-razão de pontos (RN-66, RN-89): só recebe inserções; o saldo é a soma. Um lançamento por
 * pessoa, ideia e evento (CA-RN-66.1): reprocessar ou reabrir e implementar de novo não pontua duas vezes.
 */
@Entity('point_ledger')
@Unique('uq_point_once', ['userId', 'ideaId', 'eventType'])
@Index('ix_point_season_user', ['seasonId', 'userId'])
export class PointLedger extends CreatedEntity {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'idea_id', type: 'uuid', nullable: true })
  ideaId!: string | null;

  @ManyToOne(() => Idea, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea | null;

  @Column({ name: 'event_type', type: 'varchar', length: 40 })
  eventType!: PointEvent;

  @Column({ type: 'int' })
  points!: number;

  @Column({ name: 'season_id', type: 'uuid', nullable: true })
  seasonId!: string | null;

  @ManyToOne(() => Season, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'season_id' })
  season!: Season | null;
}

/** Nível (RN-67): faixa a partir de `min_points` (o maior que a pessoa alcançou). */
@Entity('level')
@Check('ck_level_min', 'min_points >= 0')
export class Level extends EditableEntity {
  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ name: 'min_points', type: 'int', unique: true })
  minPoints!: number;
}

export type AchievementRuleType = 'ideas_submitted' | 'ideas_implemented' | 'points';

/** Conquista (RN-68): regra simples sobre a contagem da pessoa. Lista editável. */
@Entity('achievement')
export class Achievement extends EditableEntity {
  @Column({ type: 'varchar', length: 60, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    name: 'rule_type',
    type: 'enum',
    enum: ['ideas_submitted', 'ideas_implemented', 'points'],
    enumName: 'achievement_rule',
  })
  ruleType!: AchievementRuleType;

  @Column({ type: 'int' })
  threshold!: number;

  @Column({ type: 'boolean', default: true })
  active!: boolean;
}

@Entity('user_achievement')
export class UserAchievement {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ name: 'achievement_id', type: 'uuid' })
  achievementId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Achievement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'achievement_id' })
  achievement!: Achievement;

  @Column({ name: 'granted_at', type: 'timestamptz', default: () => 'now()' })
  grantedAt!: Date;
}

/** Recompensa concedida (RN-71): só um registro informativo; o sistema não paga nada. */
@Entity('reward_record')
export class RewardRecord extends CreatedEntity {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'idea_id', type: 'uuid', nullable: true })
  ideaId!: string | null;

  @ManyToOne(() => Idea, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea | null;

  @Column({ type: 'varchar', length: 500 })
  description!: string;

  @Column({ name: 'granted_on', type: 'date' })
  grantedOn!: string;

  @Column({ name: 'registered_by_id', type: 'uuid', nullable: true })
  registeredById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'registered_by_id' })
  registeredBy!: User | null;
}
