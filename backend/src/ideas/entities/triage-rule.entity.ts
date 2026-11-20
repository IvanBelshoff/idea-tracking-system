import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { EditableEntity } from '../../database/base.entity.js';
import { User } from '../../identity-access/entities/user.entity.js';
import { Category } from '../../organization/entities/category.entity.js';
import { OrgEntity } from '../../organization/entities/org-entity.entity.js';

/**
 * Regra de atribuição automática da triagem (RN-55): entidade e/ou categoria → analista.
 * Campo vazio vale para qualquer valor. A escolha entre regras está em `triage-rules.ts`.
 */
@Entity('triage_rule')
export class TriageRule extends EditableEntity {
  /** Vale para esta entidade e as sub-entidades. Nulo = qualquer entidade. */
  @Index()
  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId!: string | null;

  @ManyToOne(() => OrgEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entity_id' })
  entity!: OrgEntity | null;

  /** Nulo = qualquer categoria. */
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category!: Category | null;

  @Column({ name: 'assignee_id', type: 'uuid' })
  assigneeId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignee_id' })
  assignee!: User;

  /** Desempate entre regras igualmente específicas: maior vence. */
  @Column({ type: 'int', default: 0 })
  priority!: number;

  @Column({ type: 'boolean', default: true })
  active!: boolean;
}
