import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { CreatedEntity } from '../../database/base.entity.js';
import { OrgEntity } from '../../organization/entities/org-entity.entity.js';
import { Role } from './role.entity.js';
import { User } from './user.entity.js';

/** "Perfil **em** entidade" (§3.2): um usuário pode ter perfis diferentes em entidades diferentes. */
@Entity('user_role_scope')
@Unique('uq_user_role_scope', ['userId', 'roleId', 'entityId'])
export class UserRoleScope extends CreatedEntity {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Index()
  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  /** Perfil em uso não pode ser apagado. */
  @ManyToOne(() => Role, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  @Index()
  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @ManyToOne(() => OrgEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entity_id' })
  entity!: OrgEntity;

  @Column({ name: 'include_children', type: 'boolean', default: true })
  includeChildren!: boolean;
}
