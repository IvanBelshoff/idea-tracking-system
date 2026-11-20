import { Column, Entity } from 'typeorm';
import { EditableEntity } from '../../database/base.entity.js';

/** Categoria configurável pelo administrador (RN-24). Inativa não aceita novas ideias (RN-26). */
@Entity('category')
export class Category extends EditableEntity {
  @Column({ type: 'varchar', length: 100, unique: true })
  name!: string;

  /** Cor em hexadecimal (`#rrggbb`). */
  @Column({ type: 'varchar', length: 7 })
  color!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}
