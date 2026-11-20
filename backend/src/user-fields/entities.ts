import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { CreatedEntity, EditableEntity } from '../database/base.entity.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { User } from '../identity-access/entities/user.entity.js';
import { FIELD_KINDS, type FieldConfig, type FieldKind } from './user-field-rules.js';

/**
 * Campo personalizado do usuário (M25, RN-193): criado pelo administrador, nenhum de fábrica. Até 8
 * ativos; desativar esconde e guarda os valores.
 */
@Entity('user_field')
@Check('ck_user_field_unique_open', `NOT unique_values OR kind <> 'choice'`)
@Check('ck_user_field_sensitive_integration', `NOT (sensitive AND integration)`)
export class UserField extends EditableEntity {
  @Column({ name: 'label_pt', type: 'varchar', length: 60 })
  labelPt!: string;

  @Column({ name: 'label_en', type: 'varchar', length: 60, nullable: true })
  labelEn!: string | null;

  @Column({ name: 'hint_pt', type: 'varchar', length: 200, nullable: true })
  hintPt!: string | null;

  @Column({ name: 'hint_en', type: 'varchar', length: 200, nullable: true })
  hintEn!: string | null;

  @Column({ type: 'enum', enum: FIELD_KINDS, enumName: 'user_field_kind' })
  kind!: FieldKind;

  /** Limites (texto e número) ou máscara (texto com máscara). */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  config!: FieldConfig;

  @Column({ type: 'boolean', default: false })
  required!: boolean;

  @Column({ type: 'boolean', default: false })
  searchable!: boolean;

  @Column({ type: 'boolean', default: false })
  sensitive!: boolean;

  /** "Só a administração altera depois de preenchido" (RN-196). */
  @Column({ name: 'admin_locked', type: 'boolean', default: false })
  adminLocked!: boolean;

  /** Sai no módulo Usuários da integração (RN-202). */
  @Column({ type: 'boolean', default: false })
  integration!: boolean;

  @Column({ name: 'unique_values', type: 'boolean', default: false })
  uniqueValues!: boolean;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}

/** Opção de um campo fechado (RN-195): desativada em vez de apagada quando alguém já a escolheu. */
@Entity('user_field_option')
@Index('uq_user_field_option_label', ['fieldId', 'label'], { unique: true })
export class UserFieldOption extends CreatedEntity {
  @Index()
  @Column({ name: 'field_id', type: 'uuid' })
  fieldId!: string;

  @ManyToOne(() => UserField, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'field_id' })
  field!: UserField;

  @Column({ type: 'varchar', length: 80 })
  label!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}

/**
 * O valor de uma pessoa num campo (RN-196): texto formatado (abertos) ou a opção (fechados). A chave de
 * valor único só existe nos campos com "valor único" (índice único parcial).
 */
@Entity('user_field_value')
@Index('uq_user_field_value_user', ['userId', 'fieldId'], { unique: true })
@Index('uq_user_field_value_unique', ['fieldId', 'uniqueKey'], { unique: true, where: 'unique_key IS NOT NULL' })
@Check('ck_user_field_value_one', `(value IS NULL) <> (option_id IS NULL)`)
export class UserFieldValue extends EditableEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Index()
  @Column({ name: 'field_id', type: 'uuid' })
  fieldId!: string;

  @ManyToOne(() => UserField, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'field_id' })
  field!: UserField;

  @Column({ type: 'varchar', length: 200, nullable: true })
  value!: string | null;

  @Index()
  @Column({ name: 'option_id', type: 'uuid', nullable: true })
  optionId!: string | null;

  @ManyToOne(() => UserFieldOption, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'option_id' })
  option!: UserFieldOption | null;

  @Column({ name: 'unique_key', type: 'varchar', length: 200, nullable: true })
  uniqueKey!: string | null;
}

/**
 * O valor de um campo fechado do autor, gravado na ideia ao enviar (RN-201): o relatório conta a ideia
 * pelo que o autor era naquele momento. Guarda a cópia do rótulo da opção.
 */
@Entity('idea_field_value')
@Index('uq_idea_field_value', ['ideaId', 'fieldId'], { unique: true })
export class IdeaFieldValue extends CreatedEntity {
  @Column({ name: 'idea_id', type: 'uuid' })
  ideaId!: string;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea!: Idea;

  @Index()
  @Column({ name: 'field_id', type: 'uuid' })
  fieldId!: string;

  @ManyToOne(() => UserField, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'field_id' })
  field!: UserField;

  @Index()
  @Column({ name: 'option_id', type: 'uuid' })
  optionId!: string;

  @ManyToOne(() => UserFieldOption, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'option_id' })
  option!: UserFieldOption;

  @Column({ type: 'varchar', length: 80 })
  label!: string;
}
