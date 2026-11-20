import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Campaign } from '../../campaigns/entities.js';
import type { RichDoc } from '../../common/rich-text.js';
import { EditableEntity } from '../../database/base.entity.js';
import { User } from '../../identity-access/entities/user.entity.js';
import { Integration } from '../../integration/entities.js';
import { Category } from '../../organization/entities/category.entity.js';
import { OrgEntity } from '../../organization/entities/org-entity.entity.js';

/** Estados do ciclo de vida (§4 das regras). As transições ficam em `lifecycle.ts`. */
export enum IdeaStatus {
  Submitted = 'submitted',
  InReview = 'in_review',
  InProgress = 'in_progress',
  Implemented = 'implemented',
  Rejected = 'rejected',
}

/**
 * Ideia, do envio ao fim da execução. Campos das fases 2 e 3 (SLA,
 * impacto, convergência, campanha, consulta pública) entram por migração quando chegarem.
 * Restrições extras (CHECK, índice parcial da fila) ficam na migração escrita à mão.
 */
@Entity('idea')
// Criadas na migração IdeasGuards; declaradas aqui para o gerador reconhecê-las (compara pelo nome).
@Check('ck_idea_implemented', `status <> 'implemented' OR (implemented_at IS NOT NULL AND result_text IS NOT NULL)`)
@Check('ck_idea_rejected', `status <> 'rejected' OR rejection_reason IS NOT NULL`)
@Check('ck_idea_priority', '(impact IS NULL OR impact BETWEEN 1 AND 5) AND (effort IS NULL OR effort BETWEEN 1 AND 5)')
@Index('ix_idea_entity_status', ['entityId', 'status'])
@Index('ix_idea_assigned_status', ['assignedToId', 'status'])
@Index('ix_idea_queue', { synchronize: false })
/** Busca de semelhantes por trigramas, sobre título + descrição sem acento (RN-57; migração manual). */
@Index('ix_idea_search_trgm', { synchronize: false })
@Check('ck_idea_not_self_converged', 'converged_into_id IS NULL OR converged_into_id <> id')
export class Idea extends EditableEntity {
  /** `ITS-2026-0042` (RN-22): gerado, único e imutável. */
  @Column({ type: 'varchar', length: 30, unique: true, update: false })
  code!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** Problema ou situação atual (RN-03). */
  @Column({ type: 'text' })
  description!: string;

  /** O documento do editor (RN-136); a coluna de texto acima é a cópia em texto puro. Nulo = texto puro. */
  @Column({ name: 'description_rich', type: 'jsonb', nullable: true })
  descriptionRich!: RichDoc | null;

  @Column({ name: 'proposed_solution', type: 'text', nullable: true })
  proposedSolution!: string | null;

  /** O documento do editor (RN-136); a coluna de texto acima é a cópia em texto puro. Nulo = texto puro. */
  @Column({ name: 'proposed_solution_rich', type: 'jsonb', nullable: true })
  proposedSolutionRich!: RichDoc | null;

  @Column({ name: 'expected_gain', type: 'text', nullable: true })
  expectedGain!: string | null;

  @Column({ type: 'enum', enum: IdeaStatus, enumName: 'idea_status', default: IdeaStatus.Submitted })
  status!: IdeaStatus;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @ManyToOne(() => OrgEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entity_id' })
  entity!: OrgEntity;

  /** Categoria principal (RN-24); as secundárias ficam em `idea_category`. */
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category!: Category | null;

  /** Referência externa livre (RN-23): até 100 caracteres, não única. */
  @Column({ name: 'external_ref', type: 'varchar', length: 100, nullable: true })
  externalRef!: string | null;

  /** Autor real (RN-02). Nunca escolhido no envio; no cadastro em nome de outro, é o indicado (RN-04). */
  @Index()
  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'author_id' })
  author!: User | null;

  /** Quem cadastrou em nome do autor (RN-04); nulo quando o próprio autor enviou. */
  @Column({ name: 'registered_by_id', type: 'uuid', nullable: true })
  registeredById!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'registered_by_id' })
  registeredBy!: User | null;

  /** Analista responsável pela triagem (quem assumiu). */
  @Column({ name: 'assigned_to_id', type: 'uuid', nullable: true })
  assignedToId!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assigned_to_id' })
  assignedTo!: User | null;

  /** Base da regra "a mais antiga vigora" (RN-84, fase 2) e da fila. */
  @Column({ name: 'submitted_at', type: 'timestamptz' })
  submittedAt!: Date;

  @Column({ name: 'review_started_at', type: 'timestamptz', nullable: true })
  reviewStartedAt!: Date | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'implemented_at', type: 'timestamptz', nullable: true })
  implementedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  /** Resultado obtido, obrigatório para implementar (RN-07). */
  @Column({ name: 'result_text', type: 'text', nullable: true })
  resultText!: string | null;

  /** O documento do editor (RN-136); a coluna de texto acima é a cópia em texto puro. Nulo = texto puro. */
  @Column({ name: 'result_text_rich', type: 'jsonb', nullable: true })
  resultTextRich!: RichDoc | null;

  /** Priorização (RN-56): impacto e esforço de 1 a 5, informados na triagem. Apoio à decisão, nunca decide. */
  @Column({ type: 'smallint', nullable: true })
  impact!: number | null;

  @Column({ type: 'smallint', nullable: true })
  effort!: number | null;

  /**
   * Impacto ÷ esforço, gravado junto com a avaliação (para ordenar a fila com paginação).
   * Nulo enquanto faltar um dos dois: essas ideias aparecem depois das avaliadas (CA-RN-56.2).
   */
  @Column({ name: 'priority_score', type: 'real', nullable: true })
  priorityScore!: number | null;

  /**
   * Convergência (RN-84): esta ideia foi unida a uma principal (a mais antiga) e não tem fluxo
   * próprio; mostra a situação da principal. Nulo = ideia independente.
   */
  @Index()
  @Column({ name: 'converged_into_id', type: 'uuid', nullable: true })
  convergedIntoId!: string | null;

  @ManyToOne(() => Idea, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'converged_into_id' })
  convergedInto!: Idea | null;

  @Column({ name: 'converged_at', type: 'timestamptz', nullable: true })
  convergedAt!: Date | null;

  @Column({ name: 'converged_by_id', type: 'uuid', nullable: true })
  convergedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'converged_by_id' })
  convergedBy!: User | null;

  /** Justificativa da equipe (obrigatória quando é o analista que converge; RN-85). */
  @Column({ name: 'converged_reason', type: 'text', nullable: true })
  convergedReason!: string | null;

  /** Código de acompanhamento da consulta pública (RN-34): aleatório, 256 bits, único. */
  @Column({ name: 'public_code', type: 'varchar', length: 64, unique: true, update: false })
  publicCode!: string;

  /** O autor pode desativar a consulta pública da própria ideia (RN-37). */
  @Column({ name: 'public_enabled', type: 'boolean', default: true })
  publicEnabled!: boolean;

  /** Arquivamento lógico (RN-11): some das listas, continua no histórico. */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  /** Modelo das etapas escolhido ao aprovar (RN-60): livres ou PDCA (só rotula as etapas). */
  @Column({ name: 'step_model', type: 'enum', enum: ['free', 'pdca'], enumName: 'step_model', default: 'free' })
  stepModel!: 'free' | 'pdca';

  /** Lição aprendida (RN-64): o padrão adotado ao implementar. */
  @Column({ name: 'standard_adopted', type: 'text', nullable: true })
  standardAdopted!: string | null;

  /** O documento do editor (RN-136); a coluna de texto acima é a cópia em texto puro. Nulo = texto puro. */
  @Column({ name: 'standard_adopted_rich', type: 'jsonb', nullable: true })
  standardAdoptedRich!: RichDoc | null;

  /** A solução pode ser replicada em outras entidades (RN-64). */
  @Column({ name: 'is_replicable', type: 'boolean', default: false })
  isReplicable!: boolean;

  /** Ideia de origem, quando esta é uma réplica (RN-64). */
  @Index()
  @Column({ name: 'origin_idea_id', type: 'uuid', nullable: true })
  originIdeaId!: string | null;

  @ManyToOne(() => Idea, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'origin_idea_id' })
  originIdea!: Idea | null;

  /** A integração que enviou a ideia pela API, quando foi o caso: "via Integração X" (M18, RN-133). */
  @Column({ name: 'source_integration_id', type: 'uuid', nullable: true })
  sourceIntegrationId!: string | null;

  @ManyToOne(() => Integration, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_integration_id' })
  sourceIntegration!: Integration | null;

  /** Campanha à qual a ideia foi vinculada no envio (RN-51). */
  @Index()
  @Column({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId!: string | null;

  @ManyToOne(() => Campaign, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign | null;
}

/** Categorias secundárias (tags) da ideia (RN-24, D6). */
@Entity('idea_category')
export class IdeaCategory {
  @PrimaryColumn({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @PrimaryColumn({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category!: Category;
}

/** Contador do identificador por ano (RN-22). Incrementado na mesma transação que cria a ideia. */
@Entity('idea_sequence')
export class IdeaSequence {
  @PrimaryColumn({ type: 'int' })
  year!: number;

  @Column({ name: 'last_value', type: 'int' })
  lastValue!: number;
}
