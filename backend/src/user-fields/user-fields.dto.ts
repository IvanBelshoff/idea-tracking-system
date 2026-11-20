import { ApiProperty } from '@nestjs/swagger';
import {
  FIELD_KINDS,
  type FieldKind,
  HINT_MAX,
  LABEL_MAX,
  MASK_PRESETS,
  type MaskPreset,
  OPTION_MAX,
  OPTIONS_MAX,
} from './user-field-rules.js';

/** Campos personalizados do usuário (M25, RN-193 a RN-202): o contrato da administração. */
export class UserFieldConfigView {
  @ApiProperty({
    type: Number,
    required: false,
    nullable: true,
    description: 'Texto: tamanho mínimo. Número: valor mínimo.',
  })
  min?: number | null;
  @ApiProperty({
    type: Number,
    required: false,
    nullable: true,
    description: 'Texto: tamanho máximo. Número: valor máximo.',
  })
  max?: number | null;
  @ApiProperty({ required: false, description: 'Número: só inteiros' }) integer?: boolean;
  @ApiProperty({ enum: MASK_PRESETS, required: false, description: 'Texto com máscara' }) preset?: MaskPreset;
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    example: 'AA-9999',
    description: 'Máscara livre: 9 dígito, A letra, * letra ou dígito',
  })
  pattern?: string | null;
}

export class UserFieldOptionView {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ description: 'Alguém já escolheu (ou uma ideia guardou) esta opção' }) inUse!: boolean;
}

export class UserFieldView {
  @ApiProperty() id!: string;
  @ApiProperty() labelPt!: string;
  @ApiProperty({ type: String, nullable: true }) labelEn!: string | null;
  @ApiProperty({ type: String, nullable: true }) hintPt!: string | null;
  @ApiProperty({ type: String, nullable: true }) hintEn!: string | null;
  @ApiProperty({ enum: FIELD_KINDS, enumName: 'UserFieldKind' }) kind!: FieldKind;
  @ApiProperty({ type: UserFieldConfigView }) config!: UserFieldConfigView;
  @ApiProperty() required!: boolean;
  @ApiProperty() searchable!: boolean;
  @ApiProperty() sensitive!: boolean;
  @ApiProperty({ description: 'Só a administração altera depois de preenchido' }) adminLocked!: boolean;
  @ApiProperty({ description: 'Sai no módulo Usuários da integração' }) integration!: boolean;
  @ApiProperty() uniqueValues!: boolean;
  @ApiProperty() active!: boolean;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ description: 'Há valor gravado (o tipo não muda e o campo não é excluído)' }) inUse!: boolean;
  @ApiProperty({ type: [UserFieldOptionView] }) options!: UserFieldOptionView[];
}

export class CreateUserFieldRequest {
  @ApiProperty({ maxLength: LABEL_MAX }) labelPt!: string;
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: LABEL_MAX }) labelEn?: string | null;
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: HINT_MAX }) hintPt?: string | null;
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: HINT_MAX }) hintEn?: string | null;
  @ApiProperty({ enum: FIELD_KINDS, enumName: 'UserFieldKind' }) kind!: FieldKind;
  @ApiProperty({ type: UserFieldConfigView, required: false }) config?: UserFieldConfigView;
  @ApiProperty({ type: [String], required: false, maxItems: OPTIONS_MAX, description: 'Campo fechado: as opções' })
  options?: string[];
  @ApiProperty({ required: false }) required?: boolean;
  @ApiProperty({ required: false, description: 'De fábrica: ligado em texto e máscara que não são sensíveis' })
  searchable?: boolean;
  @ApiProperty({ required: false }) sensitive?: boolean;
  @ApiProperty({ required: false }) adminLocked?: boolean;
  @ApiProperty({ required: false }) integration?: boolean;
  @ApiProperty({ required: false, description: 'Só campos abertos' }) uniqueValues?: boolean;
}

export class UpdateUserFieldRequest {
  @ApiProperty({ required: false, maxLength: LABEL_MAX }) labelPt?: string;
  @ApiProperty({ type: String, required: false, nullable: true }) labelEn?: string | null;
  @ApiProperty({ type: String, required: false, nullable: true }) hintPt?: string | null;
  @ApiProperty({ type: String, required: false, nullable: true }) hintEn?: string | null;
  @ApiProperty({ enum: FIELD_KINDS, enumName: 'UserFieldKind', required: false, description: 'Só sem valores' })
  kind?: FieldKind;
  @ApiProperty({ type: UserFieldConfigView, required: false }) config?: UserFieldConfigView;
  @ApiProperty({ required: false }) active?: boolean;
  @ApiProperty({ required: false }) required?: boolean;
  @ApiProperty({ required: false }) searchable?: boolean;
  @ApiProperty({ required: false }) sensitive?: boolean;
  @ApiProperty({ required: false }) adminLocked?: boolean;
  @ApiProperty({ required: false }) integration?: boolean;
  @ApiProperty({ required: false }) uniqueValues?: boolean;
}

export class UserFieldOptionRequest {
  @ApiProperty({ maxLength: OPTION_MAX }) label!: string;
}

export class UpdateUserFieldOptionRequest {
  @ApiProperty({ required: false, maxLength: OPTION_MAX }) label?: string;
  @ApiProperty({ required: false }) active?: boolean;
}

export class UserFieldOrderRequest {
  @ApiProperty({ type: [String], description: 'Todos os itens, na ordem nova' }) ids!: string[];
}
