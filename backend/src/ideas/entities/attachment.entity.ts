import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { CreatedEntity } from '../../database/base.entity.js';
import { User } from '../../identity-access/entities/user.entity.js';
import { Idea } from './idea.entity.js';
import { Step } from './idea-related.entity.js';

/**
 * Anexo de etapa (RN-21). O arquivo fica no armazenamento com um nome GERADO (`stored_name`),
 * nunca o nome enviado; o nome original só aparece no download (CA-RN-21.5).
 */
@Entity('attachment')
export class Attachment extends CreatedEntity {
  @Index()
  @Column({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @Index()
  @Column({ name: 'step_id', type: 'uuid', nullable: true })
  stepId!: string | null;

  @ManyToOne(() => Step, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'step_id' })
  step!: Step | null;

  /** Nome enviado, já limpo (sem caminho nem caracteres de controle); só para exibir e baixar. */
  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName!: string;

  @Column({ name: 'stored_name', type: 'varchar', length: 80, unique: true })
  storedName!: string;

  @Column({ type: 'varchar', length: 100 })
  mime!: string;

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes!: number;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedById!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploaded_by' })
  uploadedBy!: User;
}
