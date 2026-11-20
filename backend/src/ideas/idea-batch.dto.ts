import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { IdeaStatus } from './entities/idea.entity.js';

export const BATCH_LIMIT = 100;

export const BatchSchema = z
  .object({
    action: z.enum(['assign', 'category', 'reject']),
    refs: z
      .array(z.string().trim().min(1).max(64))
      .min(1)
      .max(BATCH_LIMIT)
      .transform((refs) => [...new Set(refs)]),
    assigneeId: z.uuid().nullable().optional(),
    categoryId: z.uuid().nullable().optional(),
    reason: z.string().trim().max(5000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'assign' && v.assigneeId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['assigneeId'], message: 'Escolha a pessoa (ou nulo para a fila geral).' });
    }
    if (v.action === 'category' && v.categoryId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Escolha a categoria.' });
    }
    // Recusar em lote exige a justificativa, que vale para todas (CA-RN-59.2).
    if (v.action === 'reject' && !v.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Informe a justificativa.' });
    }
  });
export type BatchInput = z.infer<typeof BatchSchema>;

export class BatchRequest {
  @ApiProperty({ enum: ['assign', 'category', 'reject'] }) action!: string;
  @ApiProperty({ type: [String], description: `Códigos ou ids das ideias (até ${BATCH_LIMIT})` }) refs!: string[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true, required: false }) assigneeId?: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, required: false }) categoryId?: string | null;
  @ApiProperty({ required: false, description: 'Justificativa (obrigatória para recusar)' }) reason?: string;
}

export class BatchItemResult {
  @ApiProperty({ description: 'A referência enviada' }) ref!: string;
  @ApiProperty() ok!: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Código da ideia, quando deu certo' }) code!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Código do erro, quando falhou' }) error!: string | null;
  @ApiProperty({ type: String, nullable: true }) message!: string | null;
}

export class BatchResult {
  @ApiProperty({ type: [BatchItemResult] }) results!: BatchItemResult[];
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
}

// --- Filtros salvos (RN-59) -------------------------------------------------------------------

export const SAVED_FILTER_LIMIT = 30;

export const FilterDefinitionSchema = z.object({
  status: z.array(z.enum(IdeaStatus)).max(5).default([]),
  entityId: z.uuid().nullable().default(null),
  categoryId: z.uuid().nullable().default(null),
  search: z.string().trim().max(200).default(''),
  assignedToMe: z.boolean().default(false),
  sort: z.enum(['oldest', 'newest', 'priority']).default('oldest'),
});

export const SavedFilterSchema = z.object({
  name: z.string().trim().min(1).max(100),
  definition: FilterDefinitionSchema,
});

export class FilterDefinition {
  @ApiProperty({ enum: IdeaStatus, enumName: 'IdeaStatus', isArray: true }) status!: IdeaStatus[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) entityId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty() search!: string;
  @ApiProperty() assignedToMe!: boolean;
  @ApiProperty({ enum: ['oldest', 'newest', 'priority'] }) sort!: string;
}

export class SavedFilterView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: FilterDefinition }) definition!: FilterDefinition;
}

export class SavedFilterRequest {
  @ApiProperty() name!: string;
  @ApiProperty({ type: FilterDefinition }) definition!: FilterDefinition;
}
