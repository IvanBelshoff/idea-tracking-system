import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ApiErrorBody, apiError, parseInput } from '../common/api-error.js';
import { type AuthContext, CurrentAuth } from '../identity-access/auth-context.js';
import { SavedFilter } from './entities/saved-filter.entity.js';
import {
  type FilterDefinition,
  SAVED_FILTER_LIMIT,
  SavedFilterRequest,
  SavedFilterSchema,
  SavedFilterView,
} from './idea-batch.dto.js';

const view = (f: SavedFilter): SavedFilterView => ({
  id: f.id,
  name: f.name,
  definition: f.definition as unknown as FilterDefinition,
});

/**
 * Filtros salvos da fila (RN-59): cada pessoa só vê, cria e apaga os seus (o filtro de outra pessoa
 * responde 404). Só guardam filtros: o escopo é aplicado de novo em cada consulta (CA-RN-59.3).
 */
@ApiTags('saved-filters')
@ApiCookieAuth()
@Controller('saved-filters')
export class SavedFiltersController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private get repo() {
    return this.dataSource.getRepository(SavedFilter);
  }

  @Get()
  @ApiOkResponse({ type: [SavedFilterView] })
  async list(@CurrentAuth() auth: AuthContext): Promise<SavedFilterView[]> {
    return (await this.repo.find({ where: { userId: auth.user.id }, order: { name: 'ASC' } })).map(view);
  }

  @Post()
  @ApiBody({ type: SavedFilterRequest })
  @ApiCreatedResponse({ type: SavedFilterView })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: `Até ${SAVED_FILTER_LIMIT} filtros por pessoa.` })
  async create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<SavedFilterView> {
    const input = parseInput(SavedFilterSchema, body, 422);
    if ((await this.repo.countBy({ userId: auth.user.id })) >= SAVED_FILTER_LIMIT) {
      throw apiError(422, 'too_many_filters', `Você já tem ${SAVED_FILTER_LIMIT} filtros salvos. Apague algum antes.`);
    }
    const saved = await this.repo.save(
      this.repo.create({ userId: auth.user.id, name: input.name, definition: input.definition }),
    );
    return view(saved);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Filtro apagado.' })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Não existe ou é de outra pessoa.' })
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const result = await this.repo.delete({ id, userId: auth.user.id });
    if (!result.affected) throw apiError(404, 'not_found', 'Filtro não encontrado.');
  }
}
