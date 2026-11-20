import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { RichDoc } from '../common/rich-text.js';
import { EditableEntity } from '../database/base.entity.js';
import { numeric } from '../database/numeric.js';
import { User } from '../identity-access/entities/user.entity.js';
import { Category } from '../organization/entities/category.entity.js';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';

export enum CampaignStatus {
  Draft = 'draft',
  Active = 'active',
  Closed = 'closed',
}

export type GoalType = 'ideas' | 'gain' | 'qualitative';

/**
 * Campanha / desafio (RN-50): foco por período, com entidades e categorias-alvo (vazio = todas) e
 * uma meta: número de ideias, ganho validado ou um texto (meta qualitativa).
 */
@Entity('campaign')
@Check('ck_campaign_period', 'ends_on >= starts_on')
@Check('ck_campaign_goal', `goal_type = 'qualitative' OR goal_value > 0`)
export class Campaign extends EditableEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text' })
  objective!: string;

  /** O documento do editor (RN-136); a coluna de texto acima é a cópia em texto puro. Nulo = texto puro. */
  @Column({ name: 'objective_rich', type: 'jsonb', nullable: true })
  objectiveRich!: RichDoc | null;

  @Column({ name: 'starts_on', type: 'date' })
  startsOn!: string;

  @Column({ name: 'ends_on', type: 'date' })
  endsOn!: string;

  @Column({ name: 'goal_type', type: 'enum', enum: ['ideas', 'gain', 'qualitative'], enumName: 'campaign_goal_type' })
  goalType!: GoalType;

  @Column({ name: 'goal_value', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numeric })
  goalValue!: number | null;

  /** Como a meta é descrita para as pessoas (ex.: "reduzir 15% do tempo de entrega"). */
  @Column({ name: 'goal_text', type: 'varchar', length: 500, nullable: true })
  goalText!: string | null;

  /** Recompensa informativa (o sistema não paga nada). */
  @Column({ name: 'reward_note', type: 'text', nullable: true })
  rewardNote!: string | null;

  @Column({ type: 'enum', enum: CampaignStatus, enumName: 'campaign_status', default: CampaignStatus.Draft })
  status!: CampaignStatus;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: User | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  /** Resumo gravado ao encerrar (RN-53): números do painel e candidatas ao Hall naquele momento. */
  @Column({ type: 'jsonb', nullable: true })
  summary!: object | null;
}

@Entity('campaign_entity')
export class CampaignEntity {
  @PrimaryColumn({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string;

  @PrimaryColumn({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign;

  @ManyToOne(() => OrgEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entity_id' })
  entity!: OrgEntity;
}

@Entity('campaign_category')
export class CampaignCategory {
  @PrimaryColumn({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string;

  @PrimaryColumn({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign;

  @ManyToOne(() => Category, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category!: Category;
}
