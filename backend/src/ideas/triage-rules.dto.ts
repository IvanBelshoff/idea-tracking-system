import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { NamedRef } from '../identity-access/users.dto.js';
import { CategoryRef } from './ideas.dto.js';

export const TriageRuleSchema = z
  .object({
    entityId: z.uuid().nullable(),
    categoryId: z.uuid().nullable(),
    assigneeId: z.uuid(),
    priority: z.number().int().min(-100).max(100).default(0),
    active: z.boolean().optional(),
  })
  .refine((r) => r.entityId !== null || r.categoryId !== null, {
    path: ['entityId'],
    message: 'Informe a entidade, a categoria ou as duas.',
  });
export type TriageRuleInput = z.infer<typeof TriageRuleSchema>;

export class TriageRuleView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: NamedRef, nullable: true, description: 'Nula = qualquer entidade' }) entity!: NamedRef | null;
  @ApiProperty({ type: CategoryRef, nullable: true, description: 'Nula = qualquer categoria' })
  category!: CategoryRef | null;
  @ApiProperty({ type: NamedRef }) assignee!: NamedRef;
  @ApiProperty({ description: 'Desempate entre regras igualmente específicas (maior vence)' }) priority!: number;
  @ApiProperty() active!: boolean;
}

export class TriageRuleRequest {
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) entityId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty({ format: 'uuid' }) assigneeId!: string;
  @ApiProperty({ required: false, default: 0 }) priority?: number;
  @ApiProperty({ required: false, default: true }) active?: boolean;
}
