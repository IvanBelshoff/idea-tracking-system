import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { PageMeta, PageQuerySchema } from '../common/pagination.js';
import { NamedRef } from '../identity-access/users.dto.js';

export const AuditQuerySchema = PageQuerySchema.extend({
  action: z.string().trim().max(64).optional(),
  actorId: z.uuid().optional(),
  targetType: z.string().trim().max(64).optional(),
  targetId: z.string().trim().max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export class AuditEntryView {
  @ApiProperty({ description: 'Sequencial (ordem estrita)' }) id!: string;
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiProperty({ example: 'auth.login' }) action!: string;
  @ApiProperty({ type: NamedRef, nullable: true, description: 'Nulo quando a ação é do sistema' })
  actor!: NamedRef | null;
  @ApiProperty({ type: String, nullable: true }) targetType!: string | null;
  @ApiProperty({ type: String, nullable: true }) targetId!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Detalhes, sem segredos' })
  data!: Record<string, unknown>;
  @ApiProperty({ type: String, nullable: true }) ip!: string | null;
}

export class AuditPage {
  @ApiProperty({ type: [AuditEntryView] }) items!: AuditEntryView[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
