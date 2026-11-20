import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorBody } from '../common/api-error.js';
import type { Access } from '../identity-access/access.js';
import {
  AllowIncompleteProfile,
  type AuthContext,
  CurrentAccess,
  CurrentAuth,
  RequirePermission,
  requestMeta,
} from '../identity-access/auth-context.js';
import { UsersService } from '../identity-access/users.service.js';
import { SaveUserFieldValuesRequest, UserFieldFormView } from './user-values.dto.js';
import { UserValuesService } from './user-values.service.js';

/** Os próprios campos (RN-196, RN-197): respondem com o cadastro incompleto, para o diálogo poder preencher. */
@ApiTags('user-fields')
@ApiCookieAuth()
@Controller('me/fields')
@AllowIncompleteProfile()
export class MyFieldsController {
  constructor(private readonly values: UserValuesService) {}

  @Get()
  @ApiOkResponse({ type: UserFieldFormView })
  mine(@CurrentAuth() auth: AuthContext): Promise<UserFieldFormView> {
    return this.values.form(auth.user.id, false);
  }

  @Put()
  @ApiBody({ type: SaveUserFieldValuesRequest })
  @ApiOkResponse({ type: UserFieldFormView })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Só a administração altera (`custom_field_locked`).' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Outra pessoa já tem o valor (`custom_field_duplicate`).' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Valor fora do tipo ou obrigatório vazio.' })
  save(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<UserFieldFormView> {
    return this.values.save(auth.user.id, { id: auth.user.id, asAdmin: false }, requestMeta(req), body);
  }
}

/** Os campos de qualquer usuário do escopo, pela administração (RN-196). */
@ApiTags('user-fields')
@ApiCookieAuth()
@Controller('users/:id/fields')
@RequirePermission('user.manage')
export class UserValuesController {
  constructor(
    private readonly values: UserValuesService,
    private readonly users: UsersService,
  ) {}

  @Get()
  @ApiOkResponse({ type: UserFieldFormView })
  async get(@CurrentAccess() access: Access, @Param('id', new ParseUUIDPipe()) id: string): Promise<UserFieldFormView> {
    await this.users.get(access, id);
    return this.values.form(id, true);
  }

  @Put()
  @ApiBody({ type: SaveUserFieldValuesRequest })
  @ApiOkResponse({ type: UserFieldFormView })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Outra pessoa já tem o valor (`custom_field_duplicate`).' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  async save(
    @CurrentAccess() access: Access,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<UserFieldFormView> {
    await this.users.get(access, id);
    return this.values.save(id, { id: auth.user.id, asAdmin: true }, requestMeta(req), body);
  }
}
