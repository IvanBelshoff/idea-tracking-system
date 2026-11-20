import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorBody, apiError, parseInput } from '../common/api-error.js';
import { type AuthContext, CurrentAuth, RequirePermission, requestMeta } from './auth-context.js';
import {
  CreateRoleRequest,
  CreateRoleSchema,
  PermissionInfo,
  RoleView,
  UpdateRoleRequest,
  UpdateRoleSchema,
} from './roles.dto.js';
import { RolesService } from './roles.service.js';

const uuid = new ParseUUIDPipe({ exceptionFactory: () => apiError(404, 'not_found', 'Perfil não encontrado.') });

@ApiTags('roles')
@ApiCookieAuth()
@ApiForbiddenResponse({ type: ApiErrorBody })
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Catálogo de permissões (quem gerencia perfis ou atribui perfis a usuários). */
  @Get('permissions')
  @RequirePermission('role.manage', 'user.manage')
  @ApiOkResponse({ type: [PermissionInfo] })
  catalog(): PermissionInfo[] {
    return this.roles.catalog();
  }

  @Get('roles')
  @RequirePermission('role.manage', 'user.manage')
  @ApiOkResponse({ type: [RoleView] })
  list(): Promise<RoleView[]> {
    return this.roles.list();
  }

  @Post('roles')
  @RequirePermission('role.manage')
  @ApiBody({ type: CreateRoleRequest })
  @ApiCreatedResponse({ type: RoleView })
  @ApiConflictResponse({ type: ApiErrorBody })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<RoleView> {
    return this.roles.create(auth.user.id, requestMeta(req), parseInput(CreateRoleSchema, body));
  }

  @Patch('roles/:id')
  @RequirePermission('role.manage')
  @ApiBody({ type: UpdateRoleRequest })
  @ApiOkResponse({ type: RoleView })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  @ApiConflictResponse({ type: ApiErrorBody })
  update(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string, @Body() body: unknown, @Req() req: Request) {
    return this.roles.update(auth.user.id, requestMeta(req), id, parseInput(UpdateRoleSchema, body));
  }

  @Delete('roles/:id')
  @RequirePermission('role.manage')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ApiErrorBody })
  @ApiConflictResponse({ type: ApiErrorBody })
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string, @Req() req: Request): Promise<void> {
    await this.roles.remove(auth.user.id, requestMeta(req), id);
  }
}
