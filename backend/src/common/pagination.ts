import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

/** Paginação padrão das listagens (CA-T.10). */
export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

export class PageMeta {
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
}

export function pageMeta(query: PageQuery, total: number): PageMeta {
  return { page: query.page, pageSize: query.pageSize, total };
}
