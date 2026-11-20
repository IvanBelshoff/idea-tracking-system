import { ApiProperty } from '@nestjs/swagger';
import { FIELD_KINDS, type FieldKind } from './user-field-rules.js';
import { UserFieldConfigView } from './user-fields.dto.js';

/** Os valores dos campos de uma pessoa (M25, RN-196 a RN-199). */
export class UserFieldChoiceView {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ description: 'Falso: desativada, mas a pessoa ainda a tem' }) active!: boolean;
}

export class UserFieldValueView {
  @ApiProperty() id!: string;
  @ApiProperty() labelPt!: string;
  @ApiProperty({ type: String, nullable: true }) labelEn!: string | null;
  @ApiProperty({ type: String, nullable: true }) hintPt!: string | null;
  @ApiProperty({ type: String, nullable: true }) hintEn!: string | null;
  @ApiProperty({ enum: FIELD_KINDS, enumName: 'UserFieldKind' }) kind!: FieldKind;
  @ApiProperty({ type: UserFieldConfigView }) config!: UserFieldConfigView;
  @ApiProperty() required!: boolean;
  @ApiProperty({ description: 'Abre oculto, com o olho (RN-199)' }) sensitive!: boolean;
  @ApiProperty() adminLocked!: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Campos abertos: o valor formatado' }) value!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true, description: 'Campos fechados: a opção' }) optionId!: string | null;
  @ApiProperty({ type: String, nullable: true }) optionLabel!: string | null;
  @ApiProperty({ description: 'Quem pede pode alterar (falso: só a administração, depois de preenchido)' })
  editable!: boolean;
  @ApiProperty({ type: [UserFieldChoiceView] }) options!: UserFieldChoiceView[];
}

export class UserFieldFormView {
  @ApiProperty({ type: [String], description: 'Obrigatórios ainda vazios (RN-197)' }) missing!: string[];
  @ApiProperty({ type: [UserFieldValueView], description: 'Os campos ativos, na ordem' }) fields!: UserFieldValueView[];
}

export class UserFieldValueInput {
  @ApiProperty() fieldId!: string;
  @ApiProperty({ type: String, required: false, nullable: true, description: 'Abertos; vazio apaga' }) value?:
    | string
    | null;
  @ApiProperty({ type: String, required: false, nullable: true, description: 'Fechados; nulo apaga' })
  optionId?: string | null;
}

export class SaveUserFieldValuesRequest {
  @ApiProperty({ type: [UserFieldValueInput] }) values!: UserFieldValueInput[];
}
