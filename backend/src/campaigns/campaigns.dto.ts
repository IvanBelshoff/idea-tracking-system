import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import type { RichDoc } from '../common/rich-text.js';

const isoDate = z.iso.date();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const CampaignSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome.').max(200),
    objective: z.string().trim().min(1, 'Informe o objetivo.').max(5000),
    objectiveRich: z
      .custom<RichDoc>((v) => v === null || (typeof v === 'object' && (v as { type?: string })?.type === 'doc'))
      .nullish(),
    startsOn: isoDate,
    endsOn: isoDate,
    goalType: z.enum(['ideas', 'gain', 'qualitative']),
    goalValue: z
      .number()
      .finite()
      .positive()
      .max(1e11)
      .nullish()
      .transform((v) => v ?? null),
    goalText: optionalText(500),
    rewardNote: optionalText(2000),
    entityIds: z.array(z.uuid()).max(200).default([]),
    categoryIds: z.array(z.uuid()).max(50).default([]),
  })
  .refine((c) => c.endsOn >= c.startsOn, { path: ['endsOn'], message: 'O fim não pode ser antes do início.' })
  .refine((c) => c.goalType === 'qualitative' || c.goalValue !== null, {
    path: ['goalValue'],
    message: 'Informe o valor da meta.',
  })
  .refine((c) => c.goalType !== 'qualitative' || c.goalText !== null, {
    path: ['goalText'],
    message: 'Descreva a meta.',
  });
export type CampaignInput = z.infer<typeof CampaignSchema>;

export const AvailableQuerySchema = z.object({
  entityId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
});

export class CampaignRequest {
  @ApiProperty() name!: string;
  @ApiProperty() objective!: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); o texto puro é derivado dele',
  })
  objectiveRich?: RichDoc | null;
  @ApiProperty({ format: 'date' }) startsOn!: string;
  @ApiProperty({ format: 'date' }) endsOn!: string;
  @ApiProperty({ enum: ['ideas', 'gain', 'qualitative'], description: 'Nº de ideias, ganho validado ou texto' })
  goalType!: string;
  @ApiProperty({ type: Number, nullable: true, required: false, description: 'Obrigatório se a meta é numérica' })
  goalValue?: number | null;
  @ApiProperty({ type: String, nullable: true, required: false, description: 'Como a meta é descrita' })
  goalText?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false }) rewardNote?: string | null;
  @ApiProperty({ type: [String], required: false, description: 'Entidades-alvo (vazio = todas)' }) entityIds?: string[];
  @ApiProperty({ type: [String], required: false, description: 'Categorias-alvo (vazio = todas)' })
  categoryIds?: string[];
}

export class CampaignTarget {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class CampaignView {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() objective!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); nulo = só o texto puro',
  })
  objectiveRich!: RichDoc | null;
  @ApiProperty({ format: 'date' }) startsOn!: string;
  @ApiProperty({ format: 'date' }) endsOn!: string;
  @ApiProperty({ enum: ['ideas', 'gain', 'qualitative'] }) goalType!: 'ideas' | 'gain' | 'qualitative';
  @ApiProperty({ type: Number, nullable: true }) goalValue!: number | null;
  @ApiProperty({ type: String, nullable: true }) goalText!: string | null;
  @ApiProperty({ type: String, nullable: true }) rewardNote!: string | null;
  @ApiProperty({ enum: ['draft', 'active', 'closed'] }) status!: 'draft' | 'active' | 'closed';
  @ApiProperty({ type: [CampaignTarget] }) entities!: CampaignTarget[];
  @ApiProperty({ type: [CampaignTarget] }) categories!: CampaignTarget[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closedAt!: string | null;
  @ApiProperty({ description: 'Quem chama pode editar, ativar, encerrar ou excluir' }) canManage!: boolean;
}

export class HallCandidate {
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) author!: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Ganho validado por ano' }) validatedAnnual!: number | null;
  @ApiProperty({ type: String, nullable: true }) currency!: string | null;
}

export class CampaignGain {
  @ApiProperty() currency!: string;
  @ApiProperty() validatedAnnual!: number;
}

export class CampaignDashboard {
  @ApiProperty({ type: CampaignView }) campaign!: CampaignView;
  @ApiProperty({ description: 'Ideias vinculadas (sem convergidas e arquivadas)' }) received!: number;
  @ApiProperty() approved!: number;
  @ApiProperty() implemented!: number;
  @ApiProperty({ description: 'Pessoas que enviaram ideias para a campanha' }) participants!: number;
  @ApiProperty({ type: [CampaignGain], description: 'Ganho validado por ano, por moeda' }) gains!: CampaignGain[];
  @ApiProperty({ type: Number, nullable: true, description: 'Atingimento da meta (sem teto); nulo se qualitativa' })
  goalProgress!: number | null;
  @ApiProperty({ type: [HallCandidate], description: 'Implementadas, sugeridas ao Hall (nada entra sozinho)' })
  hallCandidates!: HallCandidate[];
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Resumo gravado ao encerrar (RN-53)',
  })
  summary!: Record<string, unknown> | null;
}
