import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorBody, apiError, parseInput } from '../common/api-error.js';
import { AccessService } from '../identity-access/access.service.js';
import {
  type AuthContext,
  CurrentAuth,
  type RequestWithAuth,
  RequirePermission,
  requestMeta,
} from '../identity-access/auth-context.js';
import { CategoriesService } from './categories.service.js';
import { EntitiesService } from './entities.service.js';
import {
  CategoryListQuerySchema,
  CategoryView,
  CreateCategoryRequest,
  CreateCategorySchema,
  CreateEntityRequest,
  CreateEntitySchema,
  EntityView,
  ImportCategoriesRequest,
  ImportCategoriesResponse,
  ImportCategoriesSchema,
  ReorderCategoriesRequest,
  ReorderCategoriesSchema,
  UpdateCategoryRequest,
  UpdateCategorySchema,
  UpdateEntityRequest,
  UpdateEntitySchema,
} from './organization.dto.js';

const entityId = new ParseUUIDPipe({ exceptionFactory: () => apiError(404, 'not_found', 'Entidade não encontrada.') });
const categoryId = new ParseUUIDPipe({
  exceptionFactory: () => apiError(404, 'not_found', 'Categoria não encontrada.'),
});

@ApiTags('entities')
@ApiCookieAuth()
@Controller('entities')
export class EntitiesController {
  constructor(
    private readonly entities: EntitiesService,
    private readonly access: AccessService,
  ) {}

  /** Estrutura da organização, para qualquer usuário logado (escolher a entidade da ideia). */
  @Get()
  @ApiOkResponse({ type: [EntityView] })
  async list(@Req() req: RequestWithAuth): Promise<EntityView[]> {
    return this.entities.list(await this.access.forRequest(req));
  }

  @Post()
  @RequirePermission('entity.manage')
  @ApiBody({ type: CreateEntityRequest })
  @ApiCreatedResponse({ type: EntityView })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Sem entity.manage na entidade-pai.' })
  @ApiConflictResponse({ type: ApiErrorBody })
  async create(@Req() req: RequestWithAuth, @Body() body: unknown): Promise<EntityView> {
    return this.entities.create(
      await this.access.forRequest(req),
      requestMeta(req),
      parseInput(CreateEntitySchema, body),
    );
  }

  @Patch(':id')
  @RequirePermission('entity.manage')
  @ApiBody({ type: UpdateEntityRequest })
  @ApiOkResponse({ type: EntityView })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Ciclo, nome repetido ou alteração da raiz.' })
  async update(
    @Req() req: RequestWithAuth,
    @Param('id', entityId) id: string,
    @Body() body: unknown,
  ): Promise<EntityView> {
    return this.entities.update(
      await this.access.forRequest(req),
      requestMeta(req),
      id,
      parseInput(UpdateEntitySchema, body),
    );
  }

  @Delete(':id')
  @RequirePermission('entity.manage')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ApiErrorBody })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Em uso: inative em vez de apagar.' })
  async remove(@Req() req: RequestWithAuth, @Param('id', entityId) id: string): Promise<void> {
    await this.entities.remove(await this.access.forRequest(req), requestMeta(req), id);
  }
}

@ApiTags('categories')
@ApiCookieAuth()
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly access: AccessService,
  ) {}

  /** Categorias ativas para qualquer usuário logado; as inativas só para quem as administra. */
  @Get()
  @ApiQuery({ name: 'includeInactive', required: false, enum: ['true', 'false'] })
  @ApiOkResponse({ type: [CategoryView] })
  async list(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<CategoryView[]> {
    const { includeInactive } = parseInput(CategoryListQuerySchema, query);
    const canManage = (await this.access.forRequest(req)).has('category.manage');
    return this.categories.list(includeInactive && canManage);
  }

  @Post()
  @RequirePermission('category.manage')
  @ApiBody({ type: CreateCategoryRequest })
  @ApiCreatedResponse({ type: CategoryView })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  @ApiConflictResponse({ type: ApiErrorBody })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<CategoryView> {
    return this.categories.create(auth.user.id, requestMeta(req), parseInput(CreateCategorySchema, body));
  }

  @Post('import')
  @RequirePermission('category.manage')
  @HttpCode(200)
  @ApiBody({ type: ImportCategoriesRequest })
  @ApiOkResponse({ type: ImportCategoriesResponse })
  importSet(
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<ImportCategoriesResponse> {
    return this.categories.importSet(auth.user.id, requestMeta(req), parseInput(ImportCategoriesSchema, body).set);
  }

  @Put('order')
  @RequirePermission('category.manage')
  @HttpCode(200)
  @ApiBody({ type: ReorderCategoriesRequest })
  @ApiOkResponse({ type: [CategoryView], description: 'A lista inteira, já na ordem nova.' })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'A ordem não traz todas as categorias.' })
  reorder(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<CategoryView[]> {
    return this.categories.reorder(auth.user.id, requestMeta(req), parseInput(ReorderCategoriesSchema, body, 422).ids);
  }

  @Patch(':id')
  @RequirePermission('category.manage')
  @ApiBody({ type: UpdateCategoryRequest })
  @ApiOkResponse({ type: CategoryView })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  @ApiConflictResponse({ type: ApiErrorBody })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', categoryId) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.categories.update(auth.user.id, requestMeta(req), id, parseInput(UpdateCategorySchema, body));
  }
}
