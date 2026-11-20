import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
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
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorBody } from '../common/api-error.js';
import { type AuthContext, CurrentAuth, RequirePermission, requestMeta } from '../identity-access/auth-context.js';
import {
  CreateUserFieldRequest,
  UpdateUserFieldOptionRequest,
  UpdateUserFieldRequest,
  UserFieldOptionRequest,
  UserFieldOrderRequest,
  UserFieldView,
} from './user-fields.dto.js';
import { UserFieldsService } from './user-fields.service.js';

const uuid = new ParseUUIDPipe();

/** Campos personalizados do usuário (M25, RN-193 a RN-195): a administração dos campos e das opções. */
@ApiTags('user-fields')
@ApiCookieAuth()
@Controller('user-fields')
export class UserFieldsController {
  constructor(private readonly fields: UserFieldsService) {}

  @Get()
  @RequirePermission('user.manage')
  @ApiOkResponse({ type: [UserFieldView], description: 'Ativos e desativados, na ordem.' })
  list(): Promise<UserFieldView[]> {
    return this.fields.list();
  }

  @Post()
  @RequirePermission('user.manage')
  @ApiBody({ type: CreateUserFieldRequest })
  @ApiCreatedResponse({ type: UserFieldView })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description: 'Dados inválidos, 8 campos ativos (`custom_field_limit`) ou campo fechado sem opção.',
  })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<UserFieldView> {
    return this.fields.create(auth.user.id, requestMeta(req), body);
  }

  @Put('order')
  @RequirePermission('user.manage')
  @HttpCode(200)
  @ApiBody({ type: UserFieldOrderRequest })
  @ApiOkResponse({ type: [UserFieldView] })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'A ordem não traz todos os campos.' })
  reorder(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() req: Request): Promise<UserFieldView[]> {
    return this.fields.reorder(auth.user.id, requestMeta(req), body);
  }

  @Patch(':id')
  @RequirePermission('user.manage')
  @ApiBody({ type: UpdateUserFieldRequest })
  @ApiOkResponse({ type: UserFieldView })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  @ApiConflictResponse({
    type: ApiErrorBody,
    description: 'Mudar o tipo com valores (`custom_field_has_values`) ou exigir valor único com repetidos.',
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<UserFieldView> {
    return this.fields.update(auth.user.id, requestMeta(req), id, body);
  }

  @Delete(':id')
  @RequirePermission('user.manage')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Há valores gravados (`custom_field_in_use`).' })
  remove(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string, @Req() req: Request): Promise<void> {
    return this.fields.remove(auth.user.id, requestMeta(req), id);
  }

  @Post(':id/options')
  @RequirePermission('user.manage')
  @ApiBody({ type: UserFieldOptionRequest })
  @ApiCreatedResponse({ type: UserFieldView })
  addOption(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<UserFieldView> {
    return this.fields.addOption(auth.user.id, requestMeta(req), id, body);
  }

  @Put(':id/options/order')
  @RequirePermission('user.manage')
  @HttpCode(200)
  @ApiBody({ type: UserFieldOrderRequest })
  @ApiOkResponse({ type: UserFieldView })
  reorderOptions(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<UserFieldView> {
    return this.fields.reorderOptions(auth.user.id, requestMeta(req), id, body);
  }

  @Patch(':id/options/:optionId')
  @RequirePermission('user.manage')
  @ApiBody({ type: UpdateUserFieldOptionRequest })
  @ApiOkResponse({ type: UserFieldView })
  updateOption(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('optionId', uuid) optionId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<UserFieldView> {
    return this.fields.updateOption(auth.user.id, requestMeta(req), id, optionId, body);
  }

  @Delete(':id/options/:optionId')
  @RequirePermission('user.manage')
  @HttpCode(200)
  @ApiOkResponse({ type: UserFieldView })
  @ApiConflictResponse({
    type: ApiErrorBody,
    description: 'Alguém já escolheu a opção (`custom_field_option_in_use`).',
  })
  removeOption(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('optionId', uuid) optionId: string,
    @Req() req: Request,
  ): Promise<UserFieldView> {
    return this.fields.removeOption(auth.user.id, requestMeta(req), id, optionId);
  }
}
