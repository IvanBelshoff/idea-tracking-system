import { Column, Entity, Index, JoinColumn, Tree, TreeChildren, TreeParent, Unique } from 'typeorm';
import { EditableEntity } from '../../database/base.entity.js';

/**
 * Entidade da organização (unidade, área, filial), em árvore (RN-25). Tabela `entity`; a classe
 * se chama OrgEntity para não confundir com o decorador @Entity do TypeORM.
 *
 * O caminho materializado (`mpath`) é gerido pelo TypeORM e NÃO é mapeado aqui; leia-o com
 * QueryBuilder (Spike 1). O índice por prefixo (`text_pattern_ops`) é criado na migração.
 */
@Entity('entity')
@Tree('materialized-path')
@Unique('uq_entity_parent_name', ['parent', 'name'])
@Index('ix_entity_mpath', { synchronize: false })
export class OrgEntity extends EditableEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  /** Inativa não aceita novas ideias, mas as antigas continuam visíveis (RN-26). */
  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @TreeParent({ onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parent_id' })
  parent!: OrgEntity | null;

  @TreeChildren()
  children!: OrgEntity[];
}
