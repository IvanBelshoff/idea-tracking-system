import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, In } from 'typeorm';
import { Campaign, CampaignCategory, CampaignEntity, CampaignStatus } from '../../campaigns/entities.js';
import { AccessService } from '../../identity-access/access.service.js';
import { Category } from '../../organization/entities/category.entity.js';
import { OrgEntity } from '../../organization/entities/org-entity.entity.js';
import { subtreeIds } from '../../organization/tree.js';
import { CurrentIntegration, type IntegrationPrincipal } from '../principal.js';
import { bi } from './bilingual.js';
import { IntegrationApi, PageQueryDocs } from './decorators.js';
import { RefItem } from './ideas.api.js';
import { ISO_MICRO_SQL, type KeyRow, pagePredicates, parsePage, SqlParams, sliceRows } from './page.js';

// --- Contrato -----------------------------------------------------------------------------------

export class CampaignGain {
  @ApiProperty({ example: 'BRL', ...bi('Currency (ISO 4217).', 'Moeda (ISO 4217).') }) currency!: string;
  @ApiProperty({ example: 120000, ...bi('Validated gain, annualized.', 'Ganho validado, anualizado.') })
  validated_annual!: number;
}

export class CampaignTotals {
  @ApiProperty({
    example: 12,
    ...bi(
      'Linked ideas in the scope (no archived or converged).',
      'Ideias vinculadas no escopo (sem arquivadas e convergidas).',
    ),
  })
  received!: number;
  @ApiProperty({ example: 8, ...bi('Approved ideas.', 'Ideias aprovadas.') }) approved!: number;
  @ApiProperty({ example: 5, ...bi('Implemented ideas.', 'Ideias implementadas.') }) implemented!: number;
  @ApiProperty({
    example: 9,
    ...bi('People who sent ideas (a count, never who).', 'Pessoas que enviaram ideias (só a contagem, nunca quem).'),
  })
  participants!: number;
  @ApiProperty({
    type: [CampaignGain],
    ...bi('Validated gain per year, by currency.', 'Ganho validado por ano, por moeda.'),
  })
  gains!: CampaignGain[];
}

export class CampaignItem {
  @ApiProperty({ format: 'uuid', ...bi('Identifier.', 'Identificador.') }) id!: string;
  @ApiProperty({ example: 'Menos paradas na expedição', ...bi('Name.', 'Nome.') }) name!: string;
  @ApiProperty({ example: 'Reduzir as paradas não planejadas.', ...bi('Objective.', 'Objetivo.') }) objective!: string;
  @ApiProperty({ type: String, format: 'date', example: '2026-10-01', ...bi('First day.', 'Primeiro dia.') })
  starts_on!: string;
  @ApiProperty({ type: String, format: 'date', example: '2026-12-31', ...bi('Last day.', 'Último dia.') })
  ends_on!: string;
  @ApiProperty({
    enum: ['active', 'closed'],
    ...bi('Situation. Drafts never appear.', 'Situação. Rascunho nunca aparece.'),
  })
  status!: string;
  @ApiProperty({ enum: ['ideas', 'gain', 'qualitative'], ...bi('Type of goal.', 'Tipo da meta.') }) goal_type!: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 30,
    ...bi('Goal value (ideas or gain).', 'Valor da meta (ideias ou ganho).'),
  })
  goal_value!: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Reduzir 15% do tempo de entrega',
    ...bi('Goal description.', 'Descrição da meta.'),
  })
  goal_text!: string | null;
  @ApiProperty({
    type: [RefItem],
    ...bi(
      'Target entities; empty means the whole organization.',
      'Entidades-alvo; vazio vale para a organização toda.',
    ),
  })
  target_entities!: RefItem[];
  @ApiProperty({
    type: [RefItem],
    ...bi('Target categories; empty means all.', 'Categorias-alvo; vazio vale para todas.'),
  })
  target_categories!: RefItem[];
  @ApiProperty({
    type: [String],
    example: ['ITS-2026-0042'],
    ...bi('Codes of the linked ideas within the scope.', 'Identificadores das ideias vinculadas dentro do escopo.'),
  })
  idea_codes!: string[];
  @ApiProperty({
    type: CampaignTotals,
    ...bi('Dashboard totals within the scope.', 'Totais do painel dentro do escopo.'),
  })
  totals!: CampaignTotals;
  @ApiProperty({ type: String, format: 'date-time', ...bi('Last change.', 'Última alteração.') }) updated_at!: string;
}

export class CampaignPage {
  @ApiProperty({ type: [CampaignItem], ...bi('The items of this page.', 'Os itens desta página.') })
  data!: CampaignItem[];
  @ApiProperty({
    type: String,
    nullable: true,
    ...bi('Cursor of the next page; null on the last page.', 'Cursor da próxima página; nulo na última.'),
  })
  next_cursor!: string | null;
}

// --- Leitura ------------------------------------------------------------------------------------

const ANNUAL = `CASE g.periodicity WHEN 'monthly' THEN g.realized * 12 ELSE g.realized END`;

@Injectable()
export class CampaignsReader {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: AccessService,
  ) {}

  /**
   * Campanhas ativas e encerradas (nunca rascunho) que tocam o escopo: alguma entidade-alvo, com as
   * subentidades, está no escopo; sem entidade-alvo a campanha vale para a organização toda (RN-109).
   */
  async list(principal: IntegrationPrincipal, query: unknown): Promise<CampaignPage> {
    const page = parsePage(query);
    const tree = await this.access.tree();
    const inScope = new Set(principal.scopeEntityIds);
    // O filtro de escopo é feito depois da consulta (precisa da árvore); por isso pede-se em lotes até encher a página.
    const kept: (KeyRow & Record<string, unknown>)[] = [];
    let cursorPage = page;
    let more = true;
    while (kept.length <= page.limit && more) {
      const q = new SqlParams();
      const preds = pagePredicates('x', q, cursorPage);
      const rows: (KeyRow & Record<string, unknown>)[] = await this.dataSource.query(
        `SELECT x.* FROM (
           SELECT c.id, c.updated_at AS sync_at, ${ISO_MICRO_SQL('c.updated_at')} AS cur_at
             FROM campaign c WHERE c.status IN ('active', 'closed')
         ) x ${preds.length > 0 ? `WHERE ${preds.join(' AND ')}` : ''}
         ORDER BY x.sync_at ASC, x.id ASC LIMIT ${q.add(200)}`,
        q.values,
      );
      if (rows.length === 0) break;
      const targets = await this.dataSource
        .getRepository(CampaignEntity)
        .find({ where: { campaignId: In(rows.map((r) => r.id)) } });
      for (const r of rows) {
        const mine = targets.filter((t) => t.campaignId === r.id);
        const touches =
          mine.length === 0 || mine.some((t) => subtreeIds(t.entityId, tree).some((id) => inScope.has(id)));
        if (touches) kept.push(r);
        if (kept.length > page.limit) break;
      }
      const last = rows.at(-1) as KeyRow;
      more = rows.length === 200;
      cursorPage = { ...page, cursor: { at: last.cur_at, id: last.id } };
    }
    const { rows: slice, next } = sliceRows(kept, page.limit);
    return { data: await this.items(principal, slice), next_cursor: next };
  }

  private async items(principal: IntegrationPrincipal, rows: KeyRow[]): Promise<CampaignItem[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const m = this.dataSource.manager;
    const [campaigns, entTargets, catTargets, ideas, counts, gains] = await Promise.all([
      m.getRepository(Campaign).find({ where: { id: In(ids) } }),
      m.getRepository(CampaignEntity).find({ where: { campaignId: In(ids) } }),
      m.getRepository(CampaignCategory).find({ where: { campaignId: In(ids) } }),
      m.query(
        `SELECT i.campaign_id, i.code FROM idea i
          WHERE i.campaign_id = ANY($1::uuid[]) AND i.archived_at IS NULL AND i.converged_into_id IS NULL
            AND i.entity_id = ANY($2::uuid[]) ORDER BY i.code`,
        [ids, principal.scopeEntityIds],
      ) as Promise<{ campaign_id: string; code: string }[]>,
      m.query(
        `SELECT i.campaign_id,
                count(*) AS received,
                count(*) FILTER (WHERE i.decided_at IS NOT NULL AND i.status IN ('in_progress', 'implemented')) AS approved,
                count(*) FILTER (WHERE i.status = 'implemented') AS implemented,
                count(DISTINCT i.author_id) AS participants
           FROM idea i
          WHERE i.campaign_id = ANY($1::uuid[]) AND i.archived_at IS NULL AND i.converged_into_id IS NULL
            AND i.entity_id = ANY($2::uuid[]) GROUP BY i.campaign_id`,
        [ids, principal.scopeEntityIds],
      ) as Promise<Record<string, string>[]>,
      m.query(
        `SELECT i.campaign_id, g.currency, sum(${ANNUAL}) AS total
           FROM idea i JOIN financial_gain g ON g.idea_id = i.id
          WHERE i.campaign_id = ANY($1::uuid[]) AND i.archived_at IS NULL AND i.converged_into_id IS NULL
            AND i.entity_id = ANY($2::uuid[]) AND i.status = 'implemented'
            AND g.status = 'validated' AND g.realized IS NOT NULL
          GROUP BY i.campaign_id, g.currency ORDER BY total DESC`,
        [ids, principal.scopeEntityIds],
      ) as Promise<{ campaign_id: string; currency: string; total: string }[]>,
    ]);
    const entityIds = [...new Set(entTargets.map((t) => t.entityId))];
    const categoryIds = [...new Set(catTargets.map((t) => t.categoryId))];
    const [entities, categories] = await Promise.all([
      entityIds.length > 0 ? m.getRepository(OrgEntity).find({ where: { id: In(entityIds) } }) : [],
      categoryIds.length > 0 ? m.getRepository(Category).find({ where: { id: In(categoryIds) } }) : [],
    ]);
    const byId = new Map(campaigns.map((c) => [c.id, c]));
    const out: CampaignItem[] = [];
    for (const row of rows) {
      const c = byId.get(row.id);
      if (!c) continue;
      const count = counts.find((r) => r.campaign_id === c.id);
      out.push({
        id: c.id,
        name: c.name,
        objective: c.objective,
        starts_on: c.startsOn,
        ends_on: c.endsOn,
        status: c.status === CampaignStatus.Closed ? 'closed' : 'active',
        goal_type: c.goalType,
        goal_value: c.goalValue,
        goal_text: c.goalText,
        target_entities: entTargets
          .filter((t) => t.campaignId === c.id)
          .flatMap((t) => entities.filter((e) => e.id === t.entityId))
          .map((e) => ({ id: e.id, name: e.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        target_categories: catTargets
          .filter((t) => t.campaignId === c.id)
          .flatMap((t) => categories.filter((e) => e.id === t.categoryId))
          .map((e) => ({ id: e.id, name: e.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        idea_codes: ideas.filter((i) => i.campaign_id === c.id).map((i) => i.code),
        totals: {
          received: Number(count?.received ?? 0),
          approved: Number(count?.approved ?? 0),
          implemented: Number(count?.implemented ?? 0),
          participants: Number(count?.participants ?? 0),
          gains: gains
            .filter((g) => g.campaign_id === c.id)
            .map((g) => ({ currency: g.currency.trim(), validated_annual: Number(g.total) })),
        },
        updated_at: row.cur_at,
      });
    }
    return out;
  }
}

@Controller('integration/v1/campaigns')
@IntegrationApi('campaigns')
export class CampaignsApiController {
  constructor(private readonly reader: CampaignsReader) {}

  @Get()
  @ApiOperation({
    summary: 'List campaigns',
    ...bi(
      'Active and closed campaigns whose target entities touch the integration scope (drafts never appear). The reward note is never shared.',
      'Campanhas ativas e encerradas cujas entidades-alvo tocam o escopo da integração (rascunho nunca aparece). A recompensa informativa não sai.',
    ),
  })
  @PageQueryDocs()
  @ApiOkResponse({ type: CampaignPage })
  list(@CurrentIntegration() principal: IntegrationPrincipal, @Query() query: unknown): Promise<CampaignPage> {
    return this.reader.list(principal, query);
  }
}
