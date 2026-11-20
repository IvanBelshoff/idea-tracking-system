import { Check, Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { LoginMediaKind } from '../login-screen-rules.js';

/**
 * Arquivos do fundo da tela de login (M23, RN-177 e RN-178): a imagem, a capa do vídeo e o vídeo, um de
 * cada. Ficam no armazenamento do ITS e são servidos sem login, porque a tela de login é pública.
 */
@Entity('login_media')
@Check('ck_login_media_kind', "kind IN ('image', 'poster', 'video')")
export class LoginMedia {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  kind!: LoginMediaKind;

  /** Nome GERADO no disco, nunca o nome enviado. */
  @Column({ name: 'stored_name', type: 'varchar', length: 60 })
  storedName!: string;

  /** Tipo decidido pelo CONTEÚDO na hora do envio. */
  @Column({ name: 'content_type', type: 'varchar', length: 20 })
  contentType!: string;

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes!: number;

  @Column({ type: 'int', nullable: true })
  width!: number | null;

  @Column({ type: 'int', nullable: true })
  height!: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
