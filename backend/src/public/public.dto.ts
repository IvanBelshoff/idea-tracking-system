import { ApiProperty } from '@nestjs/swagger';

export class PublicCategoryView {
  @ApiProperty() name!: string;
  @ApiProperty() color!: string;
}

export class PublicStepView {
  @ApiProperty() position!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Previsão (AAAA-MM-DD)' }) dueDate!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) completedAt!: string | null;
}

/** Tudo o que a consulta pública mostra (RN-35). Qualquer campo novo aqui é decisão de privacidade. */
export class PublicIdeaView {
  @ApiProperty() title!: string;
  @ApiProperty({ type: PublicCategoryView, nullable: true }) category!: PublicCategoryView | null;
  @ApiProperty({ enum: ['submitted', 'in_review', 'in_progress', 'implemented', 'rejected'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) submittedAt!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Prazo = previsão da última etapa (AAAA-MM-DD)' })
  deadline!: string | null;
  @ApiProperty() late!: boolean;
  @ApiProperty({ type: [PublicStepView] }) steps!: PublicStepView[];
}
