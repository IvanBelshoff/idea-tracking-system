import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import type { CategorySetKey } from './category-sets.js';
import type { Category } from './entities/category.entity.js';

// --- Entidades (RN-25, RN-26) -------------------------------------------------------------------

const entityName = z.string().trim().min(1).max(200);

export const CreateEntitySchema = z.object({ name: entityName, parentId: z.uuid() });
export const UpdateEntitySchema = z
  .object({ name: entityName, parentId: z.uuid(), active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo');

export class EntityView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Nulo só na raiz (a organização)' })
  parentId!: string | null;
  @ApiProperty({ description: 'Inativa não aceita ideias novas; as antigas continuam visíveis (RN-26)' })
  active!: boolean;
  @ApiProperty({ description: 'Profundidade a partir da raiz (raiz = 0)' }) depth!: number;
  @ApiProperty({ description: 'Quem chama pode administrar esta entidade (entity.manage)' }) canManage!: boolean;
  @ApiProperty({ description: 'Quem chama pode enviar ideias para esta entidade (idea.submit)' }) canSubmit!: boolean;
}

export class CreateEntityRequest {
  @ApiProperty({ example: 'Unidade Norte' }) name!: string;
  @ApiProperty({ format: 'uuid' }) parentId!: string;
}

export class UpdateEntityRequest {
  @ApiProperty({ required: false }) name?: string;
  @ApiProperty({ required: false, format: 'uuid', description: 'Mover para debaixo de outra entidade' })
  parentId?: string;
  @ApiProperty({ required: false }) active?: boolean;
}

// --- Categorias (RN-24, RN-26) ------------------------------------------------------------------

const categoryName = z.string().trim().min(1).max(100);
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #rrggbb')
  .transform((c) => c.toLowerCase());

export const CategoryListQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export const CreateCategorySchema = z.object({
  name: categoryName,
  color,
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export const UpdateCategorySchema = z
  .object({ name: categoryName, color, sortOrder: z.number().int().min(0).max(9999), active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo');
/** A ordem das categorias (M19, RN-137): a lista COMPLETA de ids (ativas e inativas), na ordem nova. */
export const ReorderCategoriesSchema = z.object({ ids: z.array(z.uuid()).min(1).max(900) });
export const ImportCategoriesSchema = z.object({ set: z.enum(['safety_qdcep', 'generic']) });

export class ReorderCategoriesRequest {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Todas as categorias (ativas e inativas), na ordem nova. Lista incompleta ou com id desconhecido → 422.',
  })
  ids!: string[];
}

export class CategoryView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '#4f46e5' }) color!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() sortOrder!: number;

  static from(c: Category): CategoryView {
    return { id: c.id, name: c.name, color: c.color, active: c.active, sortOrder: c.sortOrder };
  }
}

export class CreateCategoryRequest {
  @ApiProperty({ example: 'Qualidade' }) name!: string;
  @ApiProperty({ example: '#4f46e5' }) color!: string;
  @ApiProperty({ required: false, default: 0 }) sortOrder?: number;
}

export class UpdateCategoryRequest {
  @ApiProperty({ required: false }) name?: string;
  @ApiProperty({ required: false }) color?: string;
  @ApiProperty({ required: false }) sortOrder?: number;
  @ApiProperty({ required: false }) active?: boolean;
}

export class ImportCategoriesRequest {
  @ApiProperty({ enum: ['safety_qdcep', 'generic'], enumName: 'CategorySet' }) set!: CategorySetKey;
}

export class ImportCategoriesResponse {
  @ApiProperty({ type: [CategoryView], description: 'Categorias criadas nesta importação' }) created!: CategoryView[];
  @ApiProperty({ description: 'Quantas já existiam (pelo nome) e foram mantidas' }) skipped!: number;
}
