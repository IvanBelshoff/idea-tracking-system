import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { CreatedEntity } from '../../database/base.entity.js';
import { User } from '../../identity-access/entities/user.entity.js';

/**
 * Filtro salvo da fila (RN-59): privado de quem criou. Guarda só os filtros; o escopo continua
 * sendo aplicado pelo servidor a cada consulta, então um filtro nunca amplia o que a pessoa vê
 * (CA-RN-59.3).
 */
@Entity('saved_filter')
export class SavedFilter extends CreatedEntity {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'jsonb' })
  definition!: Record<string, unknown>;
}
