import { applyDecorators, Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiQuery } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { parseInput } from '../../common/api-error.js';
import { type Access, computeAccess } from '../../identity-access/access.js';
import { AccessService } from '../../identity-access/access.service.js';
import type { EngagementReport, ReportSummary, ResultsReport } from '../../reports/reports.dto.js';
import { ReportsService } from '../../reports/reports.service.js';
import { CurrentIntegration, type IntegrationPrincipal } from '../principal.js';
import { bi } from './bilingual.js';
import { IntegrationApi, PageQueryDocs } from './decorators.js';
import { ISO_MICRO_SQL, type KeyRow, pagePredicates, parsePage, SqlParams, sliceRows } from './page.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');
const IndicatorQuery = z
  .object({
    from: day.optional(),
    to: day.optional(),
    entity_id: z.uuid().optional(),
    category_id: z.uuid().optional(),
  })
  .refine((q) => !q.from || !q.to || q.to >= q.from, { path: ['to'], message: 'O fim não pode ser antes do início' });

const num = (en: string, pt: string, nullable = false) => ({ type: Number, nullable, ...bi(en, pt) });

// --- Contrato: indicadores (mesma conta do relatório interno) ------------------------------------

export class IndicatorStatusCount {
  @ApiProperty({
    enum: ['submitted', 'in_review', 'in_progress', 'implemented', 'rejected'],
    ...bi('Situation.', 'Situação.'),
  })
  status!: string;
  @ApiProperty(num('Ideas in this situation.', 'Ideias nesta situação.')) count!: number;
}
export class IndicatorGroupCount {
  @ApiProperty({ type: String, nullable: true, ...bi('Identifier.', 'Identificador.') }) id!: string | null;
  @ApiProperty({ ...bi('Name.', 'Nome.') }) name!: string;
  @ApiProperty(num('Ideas.', 'Ideias.')) count!: number;
}
export class IndicatorProcess {
  @ApiProperty(num('Average seconds from sending to decision.', 'Média, em segundos, do envio até a decisão.', true))
  avg_triage_seconds!: number | null;
  @ApiProperty(
    num(
      'Average seconds from decision to implementation.',
      'Média, em segundos, da decisão até a implementação.',
      true,
    ),
  )
  avg_execution_seconds!: number | null;
  @ApiProperty(num('Approved ÷ decided, from 0 to 1.', 'Aprovadas ÷ decididas, de 0 a 1.', true)) approval_rate!:
    | number
    | null;
  @ApiProperty(num('Decided ideas.', 'Ideias decididas.')) decided!: number;
  @ApiProperty(num('Late ÷ in progress, from 0 to 1.', 'Atrasadas ÷ em andamento, de 0 a 1.', true)) late_rate!:
    | number
    | null;
  @ApiProperty(num('Ideas in progress.', 'Ideias em andamento.')) in_progress!: number;
  @ApiProperty(num('Late ideas.', 'Ideias atrasadas.')) late!: number;
  @ApiProperty(num('Distinct authors (a count, never who).', 'Autores distintos (só a contagem, nunca quem).'))
  authors!: number;
  @ApiProperty(num('Ideas ÷ distinct authors.', 'Ideias ÷ autores distintos.', true)) ideas_per_author!: number | null;
}
export class IndicatorsSummary {
  @ApiProperty(num('Ideas in the cut (no archived or converged).', 'Ideias no recorte (sem arquivadas e convergidas).'))
  total!: number;
  @ApiProperty({
    type: [IndicatorStatusCount],
    ...bi('Always the 5 situations, even with zero.', 'Sempre as 5 situações, mesmo com zero.'),
  })
  by_status!: IndicatorStatusCount[];
  @ApiProperty({ type: IndicatorProcess, ...bi('Process indicators.', 'Indicadores de processo.') })
  process!: IndicatorProcess;
  @ApiProperty({ type: [IndicatorGroupCount], ...bi('Ideas by category.', 'Ideias por categoria.') })
  by_category!: IndicatorGroupCount[];
  @ApiProperty({ type: [IndicatorGroupCount], ...bi('Ideas by entity.', 'Ideias por entidade.') })
  by_entity!: IndicatorGroupCount[];
}

export class IndicatorEngagementMonth {
  @ApiProperty({
    example: '2026-11',
    ...bi('Month (YYYY-MM) in the installation time zone.', 'Mês (AAAA-MM) no fuso da instalação.'),
  })
  month!: string;
  @ApiProperty(num('Ideas sent in the month.', 'Ideias enviadas no mês.')) submitted!: number;
  @ApiProperty(num('Of those, how many are implemented.', 'Das enviadas, quantas já foram implementadas.'))
  implemented!: number;
  @ApiProperty(
    num('People who sent at least one idea (a count).', 'Pessoas que enviaram ao menos uma ideia (só a contagem).'),
  )
  participants!: number;
}
export class IndicatorsEngagement {
  @ApiProperty(num('Active people who can send ideas.', 'Pessoas ativas que podem enviar ideias.'))
  active_collaborators!: number;
  @ApiProperty(num('Of those, who sent at least one idea.', 'Dessas, quantas enviaram ao menos uma ideia.'))
  participants!: number;
  @ApiProperty(num('Participants ÷ active people, from 0 to 1.', 'Participantes ÷ pessoas ativas, de 0 a 1.', true))
  participation_rate!: number | null;
  @ApiProperty(num('Ideas sent in the period.', 'Ideias enviadas no período.')) ideas!: number;
  @ApiProperty(num('Ideas ÷ active people.', 'Ideias ÷ pessoas ativas.', true)) ideas_per_collaborator!: number | null;
  @ApiProperty(num('Implemented ideas.', 'Ideias implementadas.')) implemented!: number;
  @ApiProperty(num('Implemented ÷ sent, from 0 to 1.', 'Implementadas ÷ enviadas, de 0 a 1.', true))
  implementation_rate!: number | null;
  @ApiProperty({
    type: [IndicatorEngagementMonth],
    ...bi('Monthly evolution (up to 36 months).', 'Evolução mensal (até 36 meses).'),
  })
  monthly!: IndicatorEngagementMonth[];
}

export class IndicatorCurrency {
  @ApiProperty({ example: 'BRL', ...bi('Currency (ISO 4217).', 'Moeda (ISO 4217).') }) currency!: string;
  @ApiProperty(num('Validated realized gain, annualized.', 'Ganho realizado validado, anualizado.'))
  validated_annual!: number;
  @ApiProperty(num('Ideas with a validated gain.', 'Ideias com ganho validado.')) validated_ideas!: number;
  @ApiProperty(num('Average per idea with a validated gain.', 'Média por ideia com ganho validado.', true))
  avg_per_idea!: number | null;
  @ApiProperty(
    num(
      'Annualized validated gain ÷ implementation cost.',
      'Ganho validado anualizado ÷ custo de implementação.',
      true,
    ),
  )
  roi!: number | null;
}
export class IndicatorGainGroup {
  @ApiProperty({ type: String, nullable: true, ...bi('Identifier.', 'Identificador.') }) id!: string | null;
  @ApiProperty({ ...bi('Name.', 'Nome.') }) name!: string;
  @ApiProperty({ ...bi('Currency.', 'Moeda.') }) currency!: string;
  @ApiProperty(num('Validated gain, annualized.', 'Ganho validado, anualizado.')) validated_annual!: number;
  @ApiProperty(num('Ideas.', 'Ideias.')) ideas!: number;
  @ApiProperty(num('Return on investment.', 'Retorno sobre o investimento.', true)) roi!: number | null;
}
export class IndicatorsResults {
  @ApiProperty({
    type: [IndicatorCurrency],
    ...bi('One row per currency. Declared gains never appear.', 'Uma linha por moeda. Ganho declarado nunca aparece.'),
  })
  currencies!: IndicatorCurrency[];
  @ApiProperty({ type: [IndicatorGainGroup], ...bi('Validated gain by category.', 'Ganho validado por categoria.') })
  by_category!: IndicatorGainGroup[];
  @ApiProperty({ type: [IndicatorGainGroup], ...bi('Validated gain by entity.', 'Ganho validado por entidade.') })
  by_entity!: IndicatorGainGroup[];
}

export class GainItem {
  @ApiProperty({ example: 'ITS-2026-0042', ...bi('Identifier of the idea.', 'Identificador da ideia.') })
  idea_code!: string;
  @ApiProperty(num('Realized gain (validated).', 'Ganho realizado (validado).')) realized!: number;
  @ApiProperty({ example: 'BRL', ...bi('Currency (ISO 4217).', 'Moeda (ISO 4217).') }) currency!: string;
  @ApiProperty({ enum: ['once', 'monthly', 'yearly'], ...bi('Periodicity of the gain.', 'Periodicidade do ganho.') })
  periodicity!: string;
  @ApiProperty(num('Implementation cost.', 'Custo de implementação.', true)) implementation_cost!: number | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    ...bi('When the gain was validated.', 'Quando o ganho foi validado.'),
  })
  validated_at!: string;
  @ApiProperty({ type: String, format: 'date-time', ...bi('Last change of the gain.', 'Última alteração do ganho.') })
  updated_at!: string;
}
export class GainPage {
  @ApiProperty({ type: [GainItem], ...bi('The items of this page.', 'Os itens desta página.') }) data!: GainItem[];
  @ApiProperty({
    type: String,
    nullable: true,
    ...bi('Cursor of the next page; null on the last page.', 'Cursor da próxima página; nulo na última.'),
  })
  next_cursor!: string | null;
}

// --- Conversão do relatório interno (camelCase) para o contrato (snake_case) ----------------------

const group = (g: { id: string | null; name: string; count: number }): IndicatorGroupCount => ({
  id: g.id,
  name: g.name,
  count: g.count,
});
const gainGroup = (g: ResultsReport['byCategory'][number]): IndicatorGainGroup => ({
  id: g.id,
  name: g.name,
  currency: g.currency,
  validated_annual: g.validatedAnnual,
  ideas: g.ideas,
  roi: g.roi,
});

export function summaryOf(r: ReportSummary): IndicatorsSummary {
  return {
    total: r.total,
    by_status: r.byStatus.map((s) => ({ status: s.status, count: s.count })),
    process: {
      avg_triage_seconds: r.process.avgTriageSeconds,
      avg_execution_seconds: r.process.avgExecutionSeconds,
      approval_rate: r.process.approvalRate,
      decided: r.process.decided,
      late_rate: r.process.lateRate,
      in_progress: r.process.inProgress,
      late: r.process.late,
      authors: r.process.authors,
      ideas_per_author: r.process.ideasPerAuthor,
    },
    by_category: r.byCategory.map(group),
    by_entity: r.byEntity.map(group),
  };
}

export function engagementOf(r: EngagementReport): IndicatorsEngagement {
  return {
    active_collaborators: r.activeCollaborators,
    participants: r.participants,
    participation_rate: r.participationRate,
    ideas: r.ideas,
    ideas_per_collaborator: r.ideasPerCollaborator,
    implemented: r.implemented,
    implementation_rate: r.implementationRate,
    monthly: r.monthly.map((m) => ({
      month: m.month,
      submitted: m.submitted,
      implemented: m.implemented,
      participants: m.participants,
    })),
  };
}

/** O ganho declarado (ainda não validado) NUNCA sai (RN-108): só o validado entra no contrato. */
export function resultsOf(r: ResultsReport): IndicatorsResults {
  return {
    currencies: r.currencies.map((c) => ({
      currency: c.currency,
      validated_annual: c.validatedAnnual,
      validated_ideas: c.validatedIdeas,
      avg_per_idea: c.avgPerIdea,
      roi: c.roi,
    })),
    by_category: r.byCategory.map(gainGroup),
    by_entity: r.byEntity.map(gainGroup),
  };
}

// --- Leitura ------------------------------------------------------------------------------------

@Injectable()
export class IndicatorsReader {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly reports: ReportsService,
  ) {}

  /** O escopo da integração como um `Access` de `report.view`: a MESMA conta do relatório interno. */
  private async scope(principal: IntegrationPrincipal): Promise<Access> {
    const grants = principal.scopeEntityIds.map((entityId) => ({
      entityId,
      includeChildren: false,
      permissions: ['report.view'] as const,
    }));
    return computeAccess(principal.id, grants, await this.access.tree());
  }

  private reportQuery(query: unknown) {
    const q = parseInput(IndicatorQuery, query, 422);
    return { from: q.from, to: q.to, entityId: q.entity_id, categoryId: q.category_id, options: [] };
  }

  async summary(principal: IntegrationPrincipal, query: unknown): Promise<IndicatorsSummary> {
    const q = this.reportQuery(query);
    return summaryOf(await this.reports.summary(await this.scope(principal), q));
  }

  async engagement(principal: IntegrationPrincipal, query: unknown): Promise<IndicatorsEngagement> {
    const q = this.reportQuery(query);
    return engagementOf(await this.reports.engagement(await this.scope(principal), q));
  }

  async results(principal: IntegrationPrincipal, query: unknown): Promise<IndicatorsResults> {
    const q = this.reportQuery(query);
    return resultsOf(await this.reports.results(await this.scope(principal), q));
  }

  /** Os ganhos VALIDADOS das ideias do escopo (RN-63, RN-108): nunca o declarado nem o estimado. */
  async gains(principal: IntegrationPrincipal, query: unknown): Promise<GainPage> {
    const page = parsePage(query);
    const p = new SqlParams();
    const predicates = pagePredicates('x', p, page);
    const rows: (KeyRow & Record<string, unknown>)[] = await this.dataSource.query(
      `SELECT x.* FROM (
         SELECT i.code AS idea_code, g.idea_id AS id, g.realized, g.currency, g.periodicity, g.implementation_cost,
                g.validated_at, g.updated_at AS sync_at, ${ISO_MICRO_SQL('g.updated_at')} AS cur_at
           FROM financial_gain g JOIN idea i ON i.id = g.idea_id
          WHERE g.status = 'validated' AND g.realized IS NOT NULL
            AND i.archived_at IS NULL AND i.converged_into_id IS NULL
            AND i.entity_id = ANY(${p.add(principal.scopeEntityIds)}::uuid[])
       ) x ${predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''}
       ORDER BY x.sync_at ASC, x.id ASC LIMIT ${p.add(page.limit + 1)}`,
      p.values,
    );
    const { rows: kept, next } = sliceRows(rows, page.limit);
    return {
      data: kept.map((r) => ({
        idea_code: r.idea_code as string,
        realized: Number(r.realized),
        currency: (r.currency as string).trim(),
        periodicity: r.periodicity as string,
        implementation_cost: r.implementation_cost === null ? null : Number(r.implementation_cost),
        validated_at: (r.validated_at as Date).toISOString(),
        updated_at: r.cur_at,
      })),
      next_cursor: next,
    };
  }
}

function IndicatorQueryParams() {
  return applyDecorators(
    ApiQuery({
      name: 'from',
      required: false,
      ...bi(
        'Start of the period (YYYY-MM-DD, installation time zone).',
        'Início do período (AAAA-MM-DD, fuso da instalação).',
      ),
    }),
    ApiQuery({
      name: 'to',
      required: false,
      ...bi('End of the period, inclusive (YYYY-MM-DD).', 'Fim do período, inclusive (AAAA-MM-DD).'),
    }),
    ApiQuery({
      name: 'entity_id',
      required: false,
      ...bi(
        'Entity (includes sub-entities); must be in the scope.',
        'Entidade (inclui as subentidades); precisa estar no escopo.',
      ),
    }),
    ApiQuery({ name: 'category_id', required: false, ...bi('Category.', 'Categoria.') }),
  );
}

@Controller('integration/v1')
@IntegrationApi('indicators')
export class IndicatorsApiController {
  constructor(private readonly reader: IndicatorsReader) {}

  @Get('indicators/summary')
  @ApiOperation({
    summary: 'Process indicators',
    ...bi(
      'Ideas by situation, category and entity, plus process times and rates; the same numbers as the internal report.',
      'Ideias por situação, categoria e entidade, mais tempos e taxas do processo; os mesmos números do relatório interno.',
    ),
  })
  @IndicatorQueryParams()
  @ApiOkResponse({ type: IndicatorsSummary })
  summary(@CurrentIntegration() principal: IntegrationPrincipal, @Query() query: unknown): Promise<IndicatorsSummary> {
    return this.reader.summary(principal, query);
  }

  @Get('indicators/engagement')
  @ApiOperation({
    summary: 'Engagement indicators',
    ...bi(
      'Participation, ideas per person, implementation rate and monthly evolution.',
      'Participação, ideias por pessoa, taxa de implementação e evolução mensal.',
    ),
  })
  @IndicatorQueryParams()
  @ApiOkResponse({ type: IndicatorsEngagement })
  engagement(
    @CurrentIntegration() principal: IntegrationPrincipal,
    @Query() query: unknown,
  ): Promise<IndicatorsEngagement> {
    return this.reader.engagement(principal, query);
  }

  @Get('indicators/results')
  @ApiOperation({
    summary: 'Financial results',
    ...bi(
      'Validated gain and ROI by currency, category and entity. Declared gains never appear.',
      'Ganho validado e ROI por moeda, categoria e entidade. Ganho declarado nunca aparece.',
    ),
  })
  @IndicatorQueryParams()
  @ApiOkResponse({ type: IndicatorsResults })
  results(@CurrentIntegration() principal: IntegrationPrincipal, @Query() query: unknown): Promise<IndicatorsResults> {
    return this.reader.results(principal, query);
  }

  @Get('gains')
  @ApiOperation({
    summary: 'List validated gains',
    ...bi(
      'Validated gains of the ideas in the scope. Declared or estimated gains never appear; there is no author or validator.',
      'Ganhos validados das ideias do escopo. Ganho declarado ou estimado nunca aparece; não há autor nem validador.',
    ),
  })
  @PageQueryDocs()
  @ApiOkResponse({ type: GainPage })
  gains(@CurrentIntegration() principal: IntegrationPrincipal, @Query() query: unknown): Promise<GainPage> {
    return this.reader.gains(principal, query);
  }
}
