import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type LogoVariant = 'light' | 'dark';

/**
 * Logo da organização (identidade visual), exibido AO LADO do símbolo do ITS, que nunca é
 * substituído. Um por tema: o do escuro é opcional (sem ele, o claro vai sobre uma placa clara).
 */
@Entity('organization_logo')
export class OrganizationLogo {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  variant!: LogoVariant;

  /** Nome GERADO no disco, nunca o nome enviado. */
  @Column({ name: 'stored_name', type: 'varchar', length: 60 })
  storedName!: string;

  @Column({ type: 'int' })
  width!: number;

  @Column({ type: 'int' })
  height!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
