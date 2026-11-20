import { Controller, Get, Injectable } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { CurrentIntegration, type IntegrationPrincipal } from '../principal.js';
import { bi } from './bilingual.js';
import { IntegrationApi } from './decorators.js';

// --- Contrato -----------------------------------------------------------------------------------

export class EntityNode {
  @ApiProperty({ format: 'uuid', ...bi('Identifier.', 'Identificador.') }) id!: string;
  @ApiProperty({ example: 'Expedição', ...bi('Name.', 'Nome.') }) name!: string;
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    ...bi('Parent entity; null at the top of the scope.', 'Entidade pai; nulo no topo do escopo.'),
  })
  parent_id!: string | null;
  @ApiProperty({
    example: true,
    ...bi(
      'Inactive entities do not accept new ideas but stay visible.',
      'Entidade inativa não aceita novas ideias, mas segue visível.',
    ),
  })
  active!: boolean;
}

export class EntityList {
  @ApiProperty({ type: [EntityNode], ...bi('The entities of the scope.', 'As entidades do escopo.') })
  data!: EntityNode[];
  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    ...bi('Always null: this list is not paginated.', 'Sempre nulo: esta lista não é paginada.'),
  })
  next_cursor!: string | null;
}

export class CategoryNode {
  @ApiProperty({ format: 'uuid', ...bi('Identifier.', 'Identificador.') }) id!: string;
  @ApiProperty({ example: 'Segurança', ...bi('Name.', 'Nome.') }) name!: string;
  @ApiProperty({ example: '#2563eb', ...bi('Color (#rrggbb).', 'Cor (#rrggbb).') }) color!: string;
  @ApiProperty({
    example: true,
    ...bi(
      'Inactive categories do not accept new ideas but stay visible.',
      'Categoria inativa não aceita novas ideias, mas segue visível.',
    ),
  })
  active!: boolean;
}

export class CategoryList {
  @ApiProperty({ type: [CategoryNode], ...bi('All categories.', 'Todas as categorias.') }) data!: CategoryNode[];
  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    ...bi('Always null: this list is not paginated.', 'Sempre nulo: esta lista não é paginada.'),
  })
  next_cursor!: string | null;
}

// --- Leitura ------------------------------------------------------------------------------------

@Injectable()
export class EntitiesReader {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** A árvore cortada ao escopo: o pai que fica fora dele vem nulo (RN-111). */
  async entities(principal: IntegrationPrincipal): Promise<EntityList> {
    const rows: { id: string; name: string; parent_id: string | null; active: boolean }[] = await this.dataSource.query(
      'SELECT id, name, parent_id, active FROM entity WHERE id = ANY($1::uuid[]) ORDER BY name, id',
      [principal.scopeEntityIds],
    );
    const inScope = new Set(rows.map((r) => r.id));
    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        parent_id: r.parent_id && inScope.has(r.parent_id) ? r.parent_id : null,
        active: r.active,
      })),
      next_cursor: null,
    };
  }

  async categories(): Promise<CategoryList> {
    const rows: { id: string; name: string; color: string; active: boolean }[] = await this.dataSource.query(
      'SELECT id, name, color, active FROM category ORDER BY sort_order, name',
    );
    return { data: rows.map((r) => ({ id: r.id, name: r.name, color: r.color, active: r.active })), next_cursor: null };
  }
}

@Controller('integration/v1')
@IntegrationApi('entities')
export class EntitiesApiController {
  constructor(private readonly reader: EntitiesReader) {}

  @Get('entities')
  @ApiOperation({
    summary: 'List entities',
    ...bi(
      'The entity tree of the integration scope (a parent outside the scope shows as null).',
      'A árvore de entidades do escopo da integração (o pai fora do escopo vem nulo).',
    ),
  })
  @ApiOkResponse({ type: EntityList })
  entities(@CurrentIntegration() principal: IntegrationPrincipal): Promise<EntityList> {
    return this.reader.entities(principal);
  }

  @Get('categories')
  @ApiOperation({
    summary: 'List categories',
    ...bi(
      'All categories, including inactive ones. They carry no personal data.',
      'Todas as categorias, inclusive as inativas. Não levam dado pessoal.',
    ),
  })
  @ApiOkResponse({ type: CategoryList })
  categories(): Promise<CategoryList> {
    return this.reader.categories();
  }
}
