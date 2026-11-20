import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorBody, parseInput } from '../common/api-error.js';
import type { Access } from '../identity-access/access.js';
import { CurrentAccess, RequirePermission, requestMeta } from '../identity-access/auth-context.js';
import { TriageRuleRequest, TriageRuleSchema, TriageRuleView } from './triage-rules.dto.js';
import { TriageRulesService } from './triage-rules.service.js';

@ApiTags('triage-rules')
@ApiCookieAuth()
@ApiForbiddenResponse({ type: ApiErrorBody, description: 'Sem setting.manage.' })
@Controller('triage-rules')
@RequirePermission('setting.manage')
export class TriageRulesController {
  constructor(private readonly rules: TriageRulesService) {}

  @Get()
  @ApiOkResponse({ type: [TriageRuleView] })
  list(): Promise<TriageRuleView[]> {
    return this.rules.list();
  }

  @Post()
  @ApiBody({ type: TriageRuleRequest })
  @ApiCreatedResponse({ type: TriageRuleView })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  create(@CurrentAccess() access: Access, @Body() body: unknown, @Req() req: Request): Promise<TriageRuleView> {
    return this.rules.create({ access, meta: requestMeta(req) }, parseInput(TriageRuleSchema, body, 422));
  }

  @Put(':id')
  @ApiBody({ type: TriageRuleRequest })
  @ApiOkResponse({ type: TriageRuleView })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  update(
    @CurrentAccess() access: Access,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<TriageRuleView> {
    return this.rules.update({ access, meta: requestMeta(req) }, id, parseInput(TriageRuleSchema, body, 422));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Regra apagada; as ideias já atribuídas continuam como estão.' })
  remove(@CurrentAccess() access: Access, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request): Promise<void> {
    return this.rules.remove({ access, meta: requestMeta(req) }, id);
  }
}
