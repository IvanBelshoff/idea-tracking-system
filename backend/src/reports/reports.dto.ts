import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');

export const ReportQuerySchema = z
  .object({
    from: day.optional(),
    to: day.optional(),
    entityId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    /** Opções de campos fechados, pelo valor gravado na ideia (RN-201). Repetido ou separado por vírgula. */
    options: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((v) =>
        v === undefined ? [] : (Array.isArray(v) ? v : v.split(',')).map((x) => x.trim()).filter(Boolean),
      )
      .pipe(z.array(z.uuid()).max(8)),
  })
  .refine((q) => !q.from || !q.to || q.to >= q.from, { path: ['to'], message: 'O fim não pode ser antes do início' });
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export class StatusCount {
  @ApiProperty({ enum: ['submitted', 'in_review', 'in_progress', 'implemented', 'rejected'] }) status!: string;
  @ApiProperty() count!: number;
}

export class CategoryCount {
  @ApiProperty({ type: String, nullable: true }) id!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) color!: string | null;
  @ApiProperty() count!: number;
}

export class EntityCount {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() count!: number;
}

/** Indicadores de processo (RN-45). Sem dados para calcular = `null` (a tela mostra "sem dados", não zero). */
export class ProcessIndicators {
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Média de (decisão − envio) das já decididas, em segundos',
  })
  avgTriageSeconds!: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Média de (implementação − decisão) das implementadas, em segundos',
  })
  avgExecutionSeconds!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Aprovadas ÷ decididas, de 0 a 1' }) approvalRate!:
    | number
    | null;
  @ApiProperty() decided!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Atrasadas ÷ em andamento, de 0 a 1' }) lateRate!:
    | number
    | null;
  @ApiProperty() inProgress!: number;
  @ApiProperty() late!: number;
  @ApiProperty() authors!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Ideias ÷ autores distintos' }) ideasPerAuthor!:
    | number
    | null;
}

export class FieldOptionCount {
  @ApiProperty({ type: String, nullable: true, description: 'Nulo = "Não informado"' }) optionId!: string | null;
  @ApiProperty({ type: String, nullable: true }) label!: string | null;
  @ApiProperty() count!: number;
}

/** Ideias por campo fechado do autor, pelo valor da hora do envio (RN-201). */
export class FieldBreakdown {
  @ApiProperty() fieldId!: string;
  @ApiProperty() labelPt!: string;
  @ApiProperty({ type: String, nullable: true }) labelEn!: string | null;
  @ApiProperty({ type: [FieldOptionCount] }) items!: FieldOptionCount[];
}

export class ReportSummary {
  @ApiProperty() total!: number;
  @ApiProperty({ type: [StatusCount], description: 'Sempre as 5 situações, mesmo com zero' }) byStatus!: StatusCount[];
  @ApiProperty({ type: ProcessIndicators }) process!: ProcessIndicators;
  @ApiProperty({ type: [CategoryCount] }) byCategory!: CategoryCount[];
  @ApiProperty({ type: [EntityCount] }) byEntity!: EntityCount[];
  @ApiProperty({ type: [FieldBreakdown], description: 'Um por campo fechado ativo' }) byField!: FieldBreakdown[];
}

export class EngagementMonth {
  @ApiProperty({ example: '2026-11', description: 'Mês (AAAA-MM) no fuso da instalação' }) month!: string;
  @ApiProperty({ description: 'Ideias enviadas no mês (sem as convergidas)' }) submitted!: number;
  @ApiProperty({ description: 'Das enviadas no mês, quantas já foram implementadas' }) implemented!: number;
  @ApiProperty({ description: 'Pessoas que enviaram ao menos uma ideia no mês' }) participants!: number;
}

/** Engajamento (RN-81). Denominador zero = `null` ("sem dados"; CA-RN-81.1). */
export class EngagementReport {
  @ApiProperty({ description: 'Pessoas ativas que podem enviar ideias nas entidades do relatório' })
  activeCollaborators!: number;
  @ApiProperty({ description: 'Dessas, quantas enviaram ao menos uma ideia no período' }) participants!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Participantes ÷ colaboradores ativos, de 0 a 1' })
  participationRate!: number | null;
  @ApiProperty({ description: 'Ideias enviadas no período (sem convergidas e arquivadas)' }) ideas!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Ideias ÷ colaboradores ativos' })
  ideasPerCollaborator!: number | null;
  @ApiProperty() implemented!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Implementadas ÷ enviadas, de 0 a 1' })
  implementationRate!: number | null;
  @ApiProperty({ type: [EngagementMonth], description: 'Evolução mensal (até 36 meses)' }) monthly!: EngagementMonth[];
}

/** Ganho por moeda (RN-46, RN-82). Só o validado é oficial (CA-RN-63.3); o declarado vem à parte. */
export class CurrencyResult {
  @ApiProperty({ example: 'BRL' }) currency!: string;
  @ApiProperty({ description: 'Soma do ganho realizado validado, anualizado' }) validatedAnnual!: number;
  @ApiProperty() validatedIdeas!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Média por ideia com ganho validado (sem ganho não entra como zero; CA-RN-46.1)',
  })
  avgPerIdea!: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Ganho validado anualizado ÷ custo, das que têm custo maior que zero',
  })
  roi!: number | null;
  @ApiProperty({ description: 'Realizado ainda não validado, anualizado (não é oficial)' }) declaredAnnual!: number;
  @ApiProperty() declaredIdeas!: number;
}

export class GainGroup {
  @ApiProperty({ type: String, nullable: true }) id!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) color!: string | null;
  @ApiProperty() currency!: string;
  @ApiProperty() validatedAnnual!: number;
  @ApiProperty() ideas!: number;
  @ApiProperty({ type: Number, nullable: true }) roi!: number | null;
}

export class ResultsReport {
  @ApiProperty({ type: [CurrencyResult], description: 'Uma linha por moeda (normalmente só a da instalação)' })
  currencies!: CurrencyResult[];
  @ApiProperty({ type: [GainGroup], description: 'Ganho validado por categoria' }) byCategory!: GainGroup[];
  @ApiProperty({ type: [GainGroup], description: 'Ganho validado por entidade' }) byEntity!: GainGroup[];
}
