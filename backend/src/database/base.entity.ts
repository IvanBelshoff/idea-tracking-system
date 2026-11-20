import { BeforeInsert, CreateDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

/**
 * Chave primária UUID v7 (ordenável por tempo), gerada na aplicação (docs/MODELO-DE-DADOS.md, §12).
 * Atenção: o @BeforeInsert só roda em instâncias; salve sempre `repo.save(repo.create({...}))`,
 * nunca um objeto literal, senão o id vai nulo.
 */
export abstract class UuidEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @BeforeInsert()
  protected assignId(): void {
    this.id ??= uuidv7();
  }
}

/** UUID + `created_at` (todas as tabelas de negócio). */
export abstract class CreatedEntity extends UuidEntity {
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** UUID + `created_at` + `updated_at` (tabelas editáveis). */
export abstract class EditableEntity extends CreatedEntity {
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
