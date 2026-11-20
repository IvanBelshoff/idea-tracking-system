import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, In } from 'typeorm';
import { HighlightConsent, HighlightPraise, HighlightStatus } from '../../hall/entities.js';
import { showsName } from '../../hall/hall-rules.js';
import { UserStatus } from '../../identity-access/entities/user.entity.js';
import { SettingsService } from '../../organization/settings.service.js';
import { CurrentIntegration, type IntegrationPrincipal } from '../principal.js';
import { FORMER_EMPLOYEE } from './author.js';
import { bi } from './bilingual.js';
import { IntegrationApi, PageQueryDocs } from './decorators.js';
import { RefItem } from './ideas.api.js';
import { ISO_MICRO_SQL, type KeyRow, pagePredicates, parsePage, SqlParams, sliceRows } from './page.js';

// --- Contrato -----------------------------------------------------------------------------------

export class HallPerson {
  @ApiProperty({ enum: ['author', 'co_author'], ...bi('Role in the idea.', 'Papel na ideia.') }) role!: string;
  @ApiProperty({
    example: 'Maria Souza',
    ...bi(
      'Display name. Only people who accepted to appear with the name (and did not opt out) are listed.',
      'Nome de exibição. Só entra quem aceitou aparecer com o nome (e não ocultou).',
    ),
  })
  name!: string;
}

export class HallGain {
  @ApiProperty({ example: 120000, ...bi('Validated gain, annualized.', 'Ganho validado, anualizado.') })
  validated_annual!: number;
  @ApiProperty({ example: 'BRL', ...bi('Currency (ISO 4217).', 'Moeda (ISO 4217).') }) currency!: string;
}

export class HallPraise {
  @ApiProperty({
    example: 'Parabéns pela ideia!',
    ...bi('Text of the praise (never the author).', 'Texto do elogio (nunca o autor).'),
  })
  body!: string;
  @ApiProperty({ type: String, format: 'date-time', ...bi('When it was written.', 'Quando foi escrito.') })
  created_at!: string;
}

export class HallItem {
  @ApiProperty({ format: 'uuid', ...bi('Identifier of the highlight.', 'Identificador do destaque.') }) id!: string;
  @ApiProperty({
    enum: ['active', 'hall_of_fame'],
    ...bi(
      'Current highlight or Hall of Fame (expired). Revoked ones never appear.',
      'Destaque vigente ou Hall da fama (vencido). Os revogados nunca aparecem.',
    ),
  })
  state!: string;
  @ApiProperty({ enum: ['entity', 'organization'], ...bi('Scope of the highlight.', 'Escopo do destaque.') })
  scope!: string;
  @ApiProperty({
    example: 'Economia comprovada e ideia replicável.',
    ...bi('Why it was highlighted.', 'Por que foi destacada.'),
  })
  justification!: string;
  @ApiProperty({ type: String, format: 'date', ...bi('First day of the highlight.', 'Primeiro dia do destaque.') })
  starts_on!: string;
  @ApiProperty({ type: String, format: 'date', ...bi('Last day of the highlight.', 'Último dia do destaque.') })
  ends_on!: string;
  @ApiProperty({ example: 'ITS-2026-0042', ...bi('Identifier of the idea.', 'Identificador da ideia.') })
  idea_code!: string;
  @ApiProperty({ example: 'Trocar o rolo da esteira', ...bi('Title of the idea.', 'Título da ideia.') }) title!: string;
  @ApiProperty({ type: RefItem, nullable: true, ...bi('Category.', 'Categoria.') }) category!: RefItem | null;
  @ApiProperty({ type: RefItem, ...bi('Entity.', 'Entidade.') }) entity!: RefItem;
  @ApiProperty({
    example: 'O rolo travava a cada duas semanas.',
    ...bi('Before: the problem or situation.', 'Antes: o problema ou a situação.'),
  })
  before!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Zero paradas em 60 dias.',
    ...bi('After: the result obtained.', 'Depois: o resultado obtido.'),
  })
  after!: string | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    ...bi('When the idea was implemented.', 'Quando a ideia foi implementada.'),
  })
  implemented_at!: string | null;
  @ApiProperty({
    type: [HallPerson],
    ...bi(
      'Authors and co-authors allowed to appear with the name.',
      'Autores e co-autores que podem aparecer com o nome.',
    ),
  })
  people!: HallPerson[];
  @ApiProperty({
    type: HallGain,
    nullable: true,
    ...bi(
      'Validated gain. Only present when the organization enabled "show gain in the Hall".',
      'Ganho validado. Só vem quando a organização habilitou "mostrar ganho no Hall".',
    ),
  })
  gain!: HallGain | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 7,
    ...bi(
      'Number of likes (never who). Null when likes are turned off.',
      'Número de curtidas (nunca quem). Nulo quando as curtidas estão desligadas.',
    ),
  })
  likes!: number | null;
  @ApiProperty({
    type: [HallPraise],
    ...bi('Praises not hidden by moderation, without author.', 'Elogios não ocultados pela moderação, sem autor.'),
  })
  praises!: HallPraise[];
  @ApiProperty({ type: String, format: 'date-time', ...bi('Last change.', 'Última alteração.') }) updated_at!: string;
}

export class HallPage {
  @ApiProperty({ type: [HallItem], ...bi('The items of this page.', 'Os itens desta página.') }) data!: HallItem[];
  @ApiProperty({
    type: String,
    nullable: true,
    ...bi('Cursor of the next page; null on the last page.', 'Cursor da próxima página; nulo na última.'),
  })
  next_cursor!: string | null;
}

// --- Leitura ------------------------------------------------------------------------------------

/** A hora de sincronização do destaque: a maior entre ele, a ideia, os aceites e os elogios (incluindo a moderação). */
const HALL_SYNC = `GREATEST(h.created_at, i.updated_at,
  COALESCE((SELECT max(c.answered_at) FROM highlight_consent c WHERE c.highlight_id = h.id), h.created_at),
  COALESCE((SELECT max(pr.created_at) FROM highlight_praise pr WHERE pr.highlight_id = h.id), h.created_at),
  COALESCE((SELECT max(pr.hidden_at) FROM highlight_praise pr WHERE pr.highlight_id = h.id), h.created_at))`;

@Injectable()
export class HallReader {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
  ) {}

  /** Destaques vigentes e do Hall da fama (sem os revogados) das ideias do escopo (RN-110). */
  async list(principal: IntegrationPrincipal, query: unknown): Promise<HallPage> {
    const page = parsePage(query);
    const p = new SqlParams();
    const predicates = pagePredicates('x', p, page);
    const rows: (KeyRow & { idea_id: string; state: string })[] = await this.dataSource.query(
      `SELECT x.id, x.cur_at FROM (
         SELECT h.id,
                ${HALL_SYNC} AS sync_at,
                ${ISO_MICRO_SQL(HALL_SYNC)} AS cur_at
           FROM highlight h JOIN idea i ON i.id = h.idea_id
          WHERE h.status IN ('active', 'expired') AND i.archived_at IS NULL
            AND i.entity_id = ANY(${p.add(principal.scopeEntityIds)}::uuid[])
       ) x ${predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''}
       ORDER BY x.sync_at ASC, x.id ASC LIMIT ${p.add(page.limit + 1)}`,
      p.values,
    );
    const { rows: kept, next } = sliceRows(rows, page.limit);
    return { data: await this.items(kept), next_cursor: next };
  }

  private async items(rows: KeyRow[]): Promise<HallItem[]> {
    if (rows.length === 0) return [];
    const m = this.dataSource.manager;
    const ids = rows.map((r) => r.id);
    const highlights = await m.query(
      `SELECT h.id, h.scope, h.justification, h.starts_on, h.ends_on, h.status, h.idea_id,
              i.code, i.title, i.description, i.result_text, i.implemented_at,
              i.entity_id, e.name AS entity_name, i.category_id, c.name AS category_name
         FROM highlight h JOIN idea i ON i.id = h.idea_id JOIN entity e ON e.id = i.entity_id
         LEFT JOIN category c ON c.id = i.category_id WHERE h.id = ANY($1::uuid[])`,
      [ids],
    );
    const ideaIds = [...new Set((highlights as { idea_id: string }[]).map((h) => h.idea_id))];
    const [consents, likes, praises, likesOn, showGain] = await Promise.all([
      m.getRepository(HighlightConsent).find({ where: { highlightId: In(ids) }, relations: { user: true } }),
      m.query('SELECT idea_id, count(*) AS n FROM idea_like WHERE idea_id = ANY($1::uuid[]) GROUP BY idea_id', [
        ideaIds,
      ]) as Promise<{ idea_id: string; n: string }[]>,
      m.getRepository(HighlightPraise).find({ where: { highlightId: In(ids) }, order: { createdAt: 'ASC' } }),
      this.settings.get('hall.likes_enabled'),
      this.settings.get('hall.show_gain'),
    ]);
    const gains: { idea_id: string; annual: string; currency: string }[] = showGain
      ? await m.query(
          `SELECT idea_id, CASE periodicity WHEN 'monthly' THEN realized * 12 ELSE realized END AS annual, currency
             FROM financial_gain WHERE idea_id = ANY($1::uuid[]) AND status = 'validated' AND realized IS NOT NULL`,
          [ideaIds],
        )
      : [];
    const byId = new Map((highlights as Record<string, unknown>[]).map((h) => [h.id as string, h]));
    const out: HallItem[] = [];
    for (const row of rows) {
      const h = byId.get(row.id) as Record<string, string | null> | undefined;
      if (!h) continue;
      const people = consents
        .filter((c) => c.highlightId === h.id)
        .sort((a, b) => (a.role === b.role ? 0 : a.role === 'author' ? -1 : 1))
        .flatMap((c) => {
          const anonymized = c.user.status === UserStatus.Anonymized;
          if (anonymized) return [{ role: c.role as string, name: FORMER_EMPLOYEE }];
          return showsName(c.status, c.user.hideName, false) ? [{ role: c.role as string, name: c.user.name }] : [];
        });
      const gain = gains.find((g) => g.idea_id === h.idea_id);
      out.push({
        id: h.id as string,
        state: h.status === HighlightStatus.Active ? 'active' : 'hall_of_fame',
        scope: h.scope as string,
        justification: h.justification as string,
        starts_on: String(h.starts_on),
        ends_on: String(h.ends_on),
        idea_code: h.code as string,
        title: h.title as string,
        category: h.category_id ? { id: h.category_id, name: h.category_name as string } : null,
        entity: { id: h.entity_id as string, name: h.entity_name as string },
        before: h.description as string,
        after: (h.result_text as string | null) ?? null,
        implemented_at: h.implemented_at ? new Date(h.implemented_at).toISOString() : null,
        people,
        gain: gain ? { validated_annual: Number(gain.annual), currency: gain.currency.trim() } : null,
        likes: likesOn ? Number(likes.find((l) => l.idea_id === h.idea_id)?.n ?? 0) : null,
        praises: praises
          .filter((pr) => pr.highlightId === h.id && pr.hiddenAt === null)
          .map((pr) => ({ body: pr.body, created_at: pr.createdAt.toISOString() })),
        updated_at: row.cur_at,
      });
    }
    return out;
  }
}

@Controller('integration/v1/hall')
@IntegrationApi('hall')
export class HallApiController {
  constructor(private readonly reader: HallReader) {}

  @Get()
  @ApiOperation({
    summary: 'List Hall highlights',
    ...bi(
      'Current highlights and the Hall of Fame (revoked ones never appear) for ideas in the scope. Points, levels, achievements, rankings of people and rewards are never shared.',
      'Destaques vigentes e do Hall da fama (os revogados nunca aparecem) das ideias do escopo. Pontos, níveis, conquistas, rankings de pessoas e recompensas nunca saem.',
    ),
  })
  @PageQueryDocs()
  @ApiOkResponse({ type: HallPage })
  list(@CurrentIntegration() principal: IntegrationPrincipal, @Query() query: unknown): Promise<HallPage> {
    return this.reader.list(principal, query);
  }
}
