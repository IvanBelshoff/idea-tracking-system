import { Check, Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { CreatedEntity } from '../../database/base.entity.js';
import { type PhotoSource, User } from './user.entity.js';

/**
 * Foto do perfil (RN-91, RN-144). No máximo uma por usuário e por origem (enviada, Microsoft, Google). Em tabela própria para o
 * arquivo ter ciclo de vida claro: trocar apaga o anterior; anonimizar apaga registro e arquivo.
 */
@Entity('user_avatar')
@Unique('uq_user_avatar_user_source', ['userId', 'source'])
@Check('ck_user_avatar_source', "source IN ('upload', 'microsoft', 'google')")
export class UserAvatar extends CreatedEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** De onde veio (RN-144): enviada pela pessoa ou buscada no provedor do login corporativo. Uma por origem. */
  @Column({ type: 'varchar', length: 20, default: 'upload' })
  source!: PhotoSource;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** Nome GERADO no disco, nunca o nome enviado. */
  @Column({ name: 'stored_name', type: 'varchar', length: 60 })
  storedName!: string;

  /** Sempre `image/webp`: a imagem enviada é convertida. */
  @Column({ type: 'varchar', length: 30 })
  mime!: string;

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes!: number;

  @Column({ type: 'int' })
  width!: number;

  @Column({ type: 'int' })
  height!: number;
}
