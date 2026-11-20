import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiErrorBody, parseInput } from '../common/api-error.js';
import type { Access } from '../identity-access/access.js';
import { CurrentAccess, RequirePermission } from '../identity-access/auth-context.js';
import { EngagementReport, ReportQuerySchema, ReportSummary, ResultsReport } from './reports.dto.js';
import { ReportsService } from './reports.service.js';

@ApiTags('reports')
@ApiCookieAuth()
@ApiForbiddenResponse({ type: ApiErrorBody, description: 'Sem report.view, ou entidade fora do escopo (RN-49).' })
@Controller('reports')
@RequirePermission('report.view')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @ApiQuery({ name: 'from', required: false, description: 'Início do período (AAAA-MM-DD, fuso da instalação)' })
  @ApiQuery({ name: 'to', required: false, description: 'Fim do período, inclusive (AAAA-MM-DD)' })
  @ApiQuery({ name: 'entityId', required: false, description: 'Inclui as sub-entidades; precisa estar no escopo' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'options', required: false, type: [String], description: 'Opções de campos fechados (RN-201)' })
  @ApiOkResponse({ type: ReportSummary })
  summary(@CurrentAccess() access: Access, @Query() query: unknown): Promise<ReportSummary> {
    return this.reports.summary(access, parseInput(ReportQuerySchema, query));
  }

  @Get('engagement')
  @ApiQuery({ name: 'from', required: false, description: 'Início do período (AAAA-MM-DD, fuso da instalação)' })
  @ApiQuery({ name: 'to', required: false, description: 'Fim do período, inclusive (AAAA-MM-DD)' })
  @ApiQuery({ name: 'entityId', required: false, description: 'Inclui as sub-entidades; precisa estar no escopo' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'options', required: false, type: [String], description: 'Opções de campos fechados (RN-201)' })
  @ApiOkResponse({
    type: EngagementReport,
    description: 'Participação, ideias por colaborador ativo, implementação e evolução mensal (RN-81).',
  })
  engagement(@CurrentAccess() access: Access, @Query() query: unknown): Promise<EngagementReport> {
    return this.reports.engagement(access, parseInput(ReportQuerySchema, query));
  }

  @Get('results')
  @ApiQuery({ name: 'from', required: false, description: 'Início do período (AAAA-MM-DD, fuso da instalação)' })
  @ApiQuery({ name: 'to', required: false, description: 'Fim do período, inclusive (AAAA-MM-DD)' })
  @ApiQuery({ name: 'entityId', required: false, description: 'Inclui as sub-entidades; precisa estar no escopo' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'options', required: false, type: [String], description: 'Opções de campos fechados (RN-201)' })
  @ApiOkResponse({ type: ResultsReport, description: 'Ganho validado acumulado e ROI (RN-46, RN-82).' })
  results(@CurrentAccess() access: Access, @Query() query: unknown): Promise<ResultsReport> {
    return this.reports.results(access, parseInput(ReportQuerySchema, query));
  }
}
