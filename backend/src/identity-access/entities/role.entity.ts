import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm';
import { EditableEntity } from '../../database/base.entity.js';

/**
 * Perfil = conjunto de permissões (§3.2). Os perfis de fábrica têm `system_key` estável, para o
 * seed reconhecê-los mesmo se o administrador mudar o nome; eles não podem ser apagados.
 */
@Entity('role')
export class Role extends EditableEntity {
  @Column({ type: 'varchar', length: 100, unique: true })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  /** Chave dos perfis de fábrica (`collaborator`, `analyst`…); nula nos criados pelo admin. */
  @Column({ name: 'system_key', type: 'varchar', length: 50, nullable: true, unique: true })
  systemKey!: string | null;

  @OneToMany(
    () => RolePermission,
    (p) => p.role,
  )
  permissions!: RolePermission[];
}

/** Permissão concedida a um perfil. Os códigos vivem no backend (`permissions.ts`), sem tabela própria. */
@Entity('role_permission')
export class RolePermission {
  @PrimaryColumn({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  permission!: string;

  @ManyToOne(
    () => Role,
    (r) => r.permissions,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'role_id' })
  role!: Role;
}
