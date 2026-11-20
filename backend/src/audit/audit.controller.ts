import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiErrorBody, parseInput } from '../common/api-error.js';
import { RequirePermission } from '../identity-access/auth-context.js';
import { AuditPage, AuditQuerySchema } from './audit.dto.js';
import { AuditQueryService } from './audit-query.service.js';

@ApiTags('audit')
@ApiCookieAuth()
@ApiForbiddenResponse({
  type: ApiErrorBody,
  description: 'Sem a permissão audit.view (por padrão, só o Administrador).',
})
@Controller('audit')
@RequirePermission('audit.view')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @ApiQuery({
    name: 'action',
    required: false,
    description: 'Exata (auth.login) ou família terminada em ponto (auth.)',
  })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'targetType', required: false })
  @ApiQuery({ name: 'targetId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'Data/hora inicial (inclusive), ISO 8601' })
  @ApiQuery({ name: 'to', required: false, description: 'Data/hora final (exclusive), ISO 8601' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: AuditPage })
  list(@Query() query: unknown): Promise<AuditPage> {
    return this.audit.list(parseInput(AuditQuerySchema, query));
  }

  @Get('actions')
  @ApiOkResponse({ type: [String], description: 'Ações já registradas (para o filtro)' })
  actions(): Promise<string[]> {
    return this.audit.actions();
  }
}
