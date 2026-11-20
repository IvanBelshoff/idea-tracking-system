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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorBody, apiError, parseInput } from '../common/api-error.js';
import type { Access } from './access.js';
import { CurrentAccess, RequirePermission, requestMeta } from './auth-context.js';
import { UserStatus } from './entities/user.entity.js';
import {
  CreateUserRequest,
  CreateUserResponse,
  CreateUserSchema,
  PasswordLink,
  SetScopesRequest,
  SetScopesSchema,
  UpdateUserRequest,
  UpdateUserSchema,
  UserDetail,
  UserListQuerySchema,
  UserPage,
} from './users.dto.js';
import { UsersService } from './users.service.js';

/** Id inválido responde como inexistente (não revela nada; CA-T.5). */
const uuid = new ParseUUIDPipe({ exceptionFactory: () => apiError(404, 'not_found', 'Usuário não encontrado.') });

@ApiTags('users')
@ApiCookieAuth()
@ApiForbiddenResponse({ type: ApiErrorBody, description: 'Sem a permissão user.manage.' })
@Controller('users')
@RequirePermission('user.manage')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false, enum: UserStatus, enumName: 'UserStatus' })
  @ApiQuery({ name: 'incomplete', required: false, enum: ['true', 'false'], description: 'Só cadastros incompletos' })
  @ApiQuery({ name: 'options', required: false, type: [String], description: 'Opções de campos fechados (todas)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: UserPage })
  list(@CurrentAccess() access: Access, @Query() query: unknown): Promise<UserPage> {
    return this.users.list(access, parseInput(UserListQuerySchema, query));
  }

  @Post()
  @ApiBody({ type: CreateUserRequest })
  @ApiCreatedResponse({ type: CreateUserResponse })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'E-mail já cadastrado.' })
  create(@CurrentAccess() access: Access, @Body() body: unknown, @Req() req: Request): Promise<CreateUserResponse> {
    return this.users.create({ access, meta: requestMeta(req) }, parseInput(CreateUserSchema, body));
  }

  @Get(':id')
  @ApiOkResponse({ type: UserDetail })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  get(@CurrentAccess() access: Access, @Param('id', uuid) id: string): Promise<UserDetail> {
    return this.users.get(access, id);
  }

  @Patch(':id')
  @ApiBody({ type: UpdateUserRequest })
  @ApiOkResponse({ type: UserDetail })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  @ApiConflictResponse({ type: ApiErrorBody })
  update(@CurrentAccess() access: Access, @Param('id', uuid) id: string, @Body() body: unknown, @Req() req: Request) {
    return this.users.update({ access, meta: requestMeta(req) }, id, parseInput(UpdateUserSchema, body));
  }

  @Put(':id/scopes')
  @ApiBody({ type: SetScopesRequest })
  @ApiOkResponse({ type: UserDetail })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Deixaria o sistema sem administrador.' })
  setScopes(
    @CurrentAccess() access: Access,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const { scopes } = parseInput(SetScopesSchema, body);
    return this.users.setScopes({ access, meta: requestMeta(req) }, id, scopes);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @ApiOkResponse({ type: UserDetail })
  @ApiConflictResponse({ type: ApiErrorBody })
  disable(@CurrentAccess() access: Access, @Param('id', uuid) id: string, @Req() req: Request) {
    return this.users.disable({ access, meta: requestMeta(req) }, id);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @ApiOkResponse({ type: UserDetail })
  @ApiConflictResponse({ type: ApiErrorBody })
  enable(@CurrentAccess() access: Access, @Param('id', uuid) id: string, @Req() req: Request) {
    return this.users.enable({ access, meta: requestMeta(req) }, id);
  }

  @Post(':id/anonymize')
  @HttpCode(200)
  @ApiOkResponse({ type: UserDetail, description: 'Irreversível. Só para usuário desativado (RN-40).' })
  @ApiConflictResponse({ type: ApiErrorBody })
  anonymize(@CurrentAccess() access: Access, @Param('id', uuid) id: string, @Req() req: Request) {
    return this.users.anonymize({ access, meta: requestMeta(req) }, id);
  }

  @Delete(':id/identities/:provider')
  @ApiOkResponse({ type: UserDetail, description: 'Desfaz o vínculo com a conta Microsoft/Google.' })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  unlinkIdentity(
    @CurrentAccess() access: Access,
    @Param('id', uuid) id: string,
    @Param('provider') provider: string,
    @Req() req: Request,
  ) {
    return this.users.unlinkIdentity({ access, meta: requestMeta(req) }, id, provider);
  }

  @Post(':id/password-link')
  @HttpCode(200)
  @ApiOkResponse({ type: PasswordLink, description: 'Link de uso único para definir nova senha.' })
  @ApiConflictResponse({ type: ApiErrorBody })
  passwordLink(@CurrentAccess() access: Access, @Param('id', uuid) id: string, @Req() req: Request) {
    return this.users.passwordLink({ access, meta: requestMeta(req) }, id);
  }
}
