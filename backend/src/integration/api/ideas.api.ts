import { Controller, Get, Injectable, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, In } from 'typeorm';
import { z } from 'zod';
import { ApprovalRequest } from '../../approvals/entities.js';
import { apiError, parseInput } from '../../common/api-error.js';
import { todayInZone } from '../../common/dates.js';
import { Idea, IdeaCategory, IdeaStatus } from '../../ideas/entities/idea.entity.js';
import { Step } from '../../ideas/entities/idea-related.entity.js';
import { progress } from '../../ideas/steps-rules.js';
import { AccessService } from '../../identity-access/access.service.js';
import { MuralPost, MuralStatus } from '../../mural/entities.js';
import { SettingsService } from '../../organization/settings.service.js';
import { subtreeIds } from '../../organization/tree.js';
import { CurrentIntegration, type IntegrationPrincipal } from '../principal.js';
import { authorName } from './author.js';
import { bi } from './bilingual.js';
import { IntegrationApi, PageQueryDocs } from './decorators.js';
import { ISO_MICRO_SQL, type KeyRow, pagePredicates, parsePage, SqlParams, sliceRows } from './page.js';

const STATUSES = Object.values(IdeaStatus);

// --- Contrato -----------------------------------------------------------------------------------

export class RefItem {
  @ApiProperty({
    format: 'uuid',
    example: '019a2c10-0000-7000-8000-000000000001',
    ...bi('Identifier.', 'Identificador.'),
  })
  id!: string;
  @ApiProperty({ example: 'Expedição', ...bi('Name.', 'Nome.') }) name!: string;
}

export class IdeaStepItem {
  @ApiProperty({ example: 1, ...bi('Position of the step (1, 2, 3...).', 'Posição da etapa (1, 2, 3...).') })
  position!: number;
  @ApiProperty({ example: 'Planejar a mudança', ...bi('Step name.', 'Nome da etapa.') }) name!: string;
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-11-02',
    ...bi('Start date (no time).', 'Data de início (sem hora).'),
  })
  start_date!: string;
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-11-20',
    ...bi('Planned date (no time).', 'Data prevista (sem hora).'),
  })
  due_date!: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    ...bi('When it was completed; null while open.', 'Quando foi concluída; nulo enquanto aberta.'),
  })
  completed_at!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['plan', 'do', 'check', 'act'],
    example: 'plan',
    ...bi('PDCA phase, when the idea uses that model.', 'Fase do PDCA, quando a ideia usa esse modelo.'),
  })
  pdca_phase!: string | null;
}

export class IdeaItem {
  @ApiProperty({
    example: 'ITS-2026-0042',
    ...bi('Human-readable identifier of the idea.', 'Identificador legível da ideia.'),
  })
  code!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Trocar o rolo da esteira por um modelo selado',
    ...bi(
      'Title. Null on a converged idea (the text of who sent it is not shared).',
      'Título. Nulo na ideia convergida (o texto de quem a enviou não sai).',
    ),
  })
  title!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'O rolo atual trava a cada duas semanas por acúmulo de poeira.',
    ...bi(
      'Problem or current situation. Null on a converged idea.',
      'Problema ou situação atual. Nulo na ideia convergida.',
    ),
  })
  description!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Rolo selado com vedação dupla.',
    ...bi('Proposed solution.', 'Solução proposta.'),
  })
  proposed_solution!: string | null;
  @ApiProperty({
    enum: STATUSES,
    example: 'in_progress',
    ...bi('Situation in the lifecycle.', 'Situação no ciclo de vida.'),
  })
  status!: string;
  @ApiProperty({ type: RefItem, ...bi('Entity the idea belongs to.', 'Entidade a que a ideia pertence.') })
  entity!: RefItem;
  @ApiProperty({ type: RefItem, nullable: true, ...bi('Main category.', 'Categoria principal.') })
  category!: RefItem | null;
  @ApiProperty({ type: [RefItem], ...bi('Other categories (tags).', 'Demais categorias (tags).') })
  other_categories!: RefItem[];
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'OS-8841',
    ...bi('Free external reference.', 'Referência externa livre.'),
  })
  external_ref!: string | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-02T13:00:00.000000Z',
    ...bi('When it was sent.', 'Quando foi enviada.'),
  })
  submitted_at!: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-05T09:30:00.000000Z',
    ...bi('Last change of the idea or of any of its steps.', 'Última alteração da ideia ou de alguma etapa.'),
  })
  updated_at!: string;
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-11-20',
    ...bi('Deadline: planned date of the last step.', 'Prazo: data prevista da última etapa.'),
  })
  deadline!: string | null;
  @ApiProperty({ example: 40, ...bi('Progress, from 0 to 100.', 'Progresso, de 0 a 100.') }) progress!: number;
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    ...bi('Campaign the idea was linked to.', 'Campanha a que a ideia foi vinculada.'),
  })
  campaign_id!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Maria Souza',
    ...bi(
      'Display name of the author. Null when the person opted out of showing the name; "Ex-colaborador" when anonymized. Never an e-mail.',
      'Nome de exibição do autor. Nulo quando a pessoa optou por ocultar o nome; "Ex-colaborador" quando anonimizada. Nunca o e-mail.',
    ),
  })
  author!: string | null;
  @ApiProperty({
    example: false,
    ...bi(
      'Archived ideas stay in the list, marked, so you know they left the lists.',
      'Ideia arquivada segue na lista, marcada, para você saber que saiu das listas.',
    ),
  })
  archived!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    ...bi(
      'Code of the main idea when this one was converged into it.',
      'Identificador da ideia principal quando esta foi convergida nela.',
    ),
  })
  converged_into!: string | null;
  @ApiProperty({
    example: false,
    ...bi(
      'The idea is on the idea wall now (M21). Reactions and comments of the wall never leave the installation.',
      'A ideia está no mural agora (M21). Reações e comentários do mural nunca saem da instalação.',
    ),
  })
  on_mural!: boolean;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    ...bi(
      'When it was (last) published on the idea wall; null when it is not on the wall.',
      'Quando foi publicada (pela última vez) no mural; nulo quando não está no mural.',
    ),
  })
  mural_published_at!: string | null;
  @ApiProperty({
    example: false,
    ...bi(
      'The idea is waiting for the approval of another area (M24). Approvers, emails and comments never leave the installation.',
      'A ideia aguarda a aprovação de outra área (M24). Aprovadores, e-mails e comentários nunca saem da instalação.',
    ),
  })
  pending_approval!: boolean;
  @ApiProperty({
    type: [IdeaStepItem],
    ...bi('Steps, in order. Empty on a converged idea.', 'Etapas, em ordem. Vazio na ideia convergida.'),
  })
  steps!: IdeaStepItem[];
}

export class IdeaPage {
  @ApiProperty({ type: [IdeaItem], ...bi('The items of this page.', 'Os itens desta página.') }) data!: IdeaItem[];
  @ApiProperty({
    type: String,
    nullable: true,
    ...bi('Cursor of the next page; null on the last page.', 'Cursor da próxima página; nulo na última.'),
  })
  next_cursor!: string | null;
}

// --- Leitura ------------------------------------------------------------------------------------

const Filters = z.object({
  status: z.enum(STATUSES as [string, ...string[]]).optional(),
  entity_id: z.uuid().optional(),
  category_id: z.uuid().optional(),
  campaign_id: z.uuid().optional(),
});

/** A hora de sincronização: a maior entre a ideia e suas etapas (uma etapa concluída muda o que a API mostra). */
const SYNC = `GREATEST(i.updated_at, COALESCE((SELECT max(s.updated_at) FROM step s WHERE s.idea_id = i.id), i.updated_at))`;

@Injectable()
export class IdeasReader {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
  ) {}

  async list(principal: IntegrationPrincipal, query: unknown): Promise<IdeaPage> {
    const page = parsePage(query);
    const f = parseInput(Filters, query, 422);
    const p = new SqlParams();
    const where = [`i.entity_id = ANY(${p.add(principal.scopeEntityIds)}::uuid[])`];
    if (f.status) where.push(`i.status = ${p.add(f.status)}`);
    if (f.entity_id) {
      const tree = await this.access.tree();
      const inScope = new Set(principal.scopeEntityIds);
      where.push(`i.entity_id = ANY(${p.add(subtreeIds(f.entity_id, tree).filter((id) => inScope.has(id)))}::uuid[])`);
    }
    if (f.category_id) {
      const c = p.add(f.category_id);
      where.push(
        `(i.category_id = ${c} OR EXISTS (SELECT 1 FROM idea_category ic WHERE ic.idea_id = i.id AND ic.category_id = ${c}))`,
      );
    }
    if (f.campaign_id) where.push(`i.campaign_id = ${p.add(f.campaign_id)}`);
    const predicates = pagePredicates('x', p, page);
    const rows: (KeyRow & { sync_at: string })[] = await this.dataSource.query(
      `SELECT x.id, x.cur_at FROM (
         SELECT i.id, ${SYNC} AS sync_at, ${ISO_MICRO_SQL(SYNC)} AS cur_at FROM idea i WHERE ${where.join(' AND ')}
       ) x ${predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''}
       ORDER BY x.sync_at ASC, x.id ASC LIMIT ${p.add(page.limit + 1)}`,
      p.values,
    );
    const { rows: kept, next } = sliceRows(rows, page.limit);
    return { data: await this.items(kept), next_cursor: next };
  }

  async get(principal: IntegrationPrincipal, code: string): Promise<IdeaItem> {
    const found = await this.dataSource
      .getRepository(Idea)
      .findOne({ where: { code }, select: { id: true, entityId: true } });
    if (!found || !principal.scopeEntityIds.includes(found.entityId)) {
      throw apiError(404, 'not_found', 'Ideia não encontrada.');
    }
    const [row]: KeyRow[] = await this.dataSource.query(
      `SELECT i.id, ${ISO_MICRO_SQL(SYNC)} AS cur_at FROM idea i WHERE i.id = $1`,
      [found.id],
    );
    const [item] = await this.items([row as KeyRow]);
    return item as IdeaItem;
  }

  /** Monta os itens, na ordem das linhas, com as consultas auxiliares em lote. */
  private async items(rows: KeyRow[]): Promise<IdeaItem[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [ideas, steps, extra, mode, zone, posts, pending] = await Promise.all([
      this.dataSource.getRepository(Idea).find({
        where: { id: In(ids) },
        relations: { category: true, entity: true, author: true, convergedInto: true },
      }),
      this.dataSource.getRepository(Step).find({ where: { ideaId: In(ids) }, order: { position: 'ASC' } }),
      this.dataSource.getRepository(IdeaCategory).find({ where: { ideaId: In(ids) }, relations: { category: true } }),
      this.settings.get('steps.progress_mode'),
      this.settings.get('organization.timezone'),
      this.dataSource.getRepository(MuralPost).findBy({ ideaId: In(ids), status: MuralStatus.Published }),
      this.dataSource.getRepository(ApprovalRequest).findBy({ ideaId: In(ids), status: 'pending' }),
    ]);
    const pendingApproval = new Set(pending.map((p) => p.ideaId));
    const onMural = new Map(posts.map((p) => [p.ideaId, p.publishedAt]));
    const today = todayInZone(new Date(), zone);
    const byId = new Map(ideas.map((i) => [i.id, i]));
    const items: IdeaItem[] = [];
    for (const row of rows) {
      const idea = byId.get(row.id);
      if (!idea) continue;
      const converged = idea.convergedIntoId !== null;
      const mine = converged ? [] : steps.filter((s) => s.ideaId === idea.id);
      items.push({
        code: idea.code,
        title: converged ? null : idea.title,
        description: converged ? null : idea.description,
        proposed_solution: converged ? null : idea.proposedSolution,
        status: idea.status,
        entity: { id: idea.entity.id, name: idea.entity.name },
        category: idea.category ? { id: idea.category.id, name: idea.category.name } : null,
        other_categories: extra
          .filter((e) => e.ideaId === idea.id)
          .map((e) => ({ id: e.category.id, name: e.category.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        external_ref: idea.externalRef,
        submitted_at: idea.submittedAt.toISOString(),
        updated_at: row.cur_at,
        deadline: mine.length > 0 ? (mine.at(-1) as Step).dueDate : null,
        progress: progress(mode, idea.status, mine, today),
        campaign_id: idea.campaignId,
        author: authorName(idea.author),
        archived: idea.archivedAt !== null,
        converged_into: idea.convergedInto?.code ?? null,
        on_mural: onMural.has(idea.id),
        mural_published_at: onMural.get(idea.id)?.toISOString() ?? null,
        pending_approval: pendingApproval.has(idea.id),
        steps: mine.map((s) => ({
          position: s.position,
          name: s.name,
          start_date: s.startDate,
          due_date: s.dueDate,
          completed_at: s.completedAt?.toISOString() ?? null,
          pdca_phase: s.pdcaPhase,
        })),
      });
    }
    return items;
  }
}

@Controller('integration/v1/ideas')
@IntegrationApi('ideas')
export class IdeasApiController {
  constructor(private readonly reader: IdeasReader) {}

  @Get()
  @ApiOperation({
    summary: 'List ideas',
    ...bi(
      'Ideas of the entities in the integration scope, oldest change first. Never returns comments, history, attachments, step owners, gains or e-mails.',
      'Ideias das entidades do escopo da integração, da alteração mais antiga para a mais nova. Nunca devolve comentários, histórico, anexos, responsável da etapa, ganho nem e-mail.',
    ),
  })
  @PageQueryDocs()
  @ApiQuery({ name: 'status', required: false, enum: STATUSES, ...bi('Filter by situation.', 'Filtra pela situação.') })
  @ApiQuery({
    name: 'entity_id',
    required: false,
    ...bi(
      'Filter by entity (includes sub-entities within the scope).',
      'Filtra por entidade (inclui as subentidades dentro do escopo).',
    ),
  })
  @ApiQuery({
    name: 'category_id',
    required: false,
    ...bi('Filter by main or other category.', 'Filtra por categoria principal ou demais.'),
  })
  @ApiQuery({ name: 'campaign_id', required: false, ...bi('Filter by campaign.', 'Filtra por campanha.') })
  @ApiOkResponse({ type: IdeaPage })
  list(@CurrentIntegration() principal: IntegrationPrincipal, @Query() query: unknown): Promise<IdeaPage> {
    return this.reader.list(principal, query);
  }

  @Get(':code')
  @ApiOperation({
    summary: 'Get an idea',
    ...bi(
      'One idea by its identifier; 404 if it is outside the scope.',
      'Uma ideia pelo identificador; 404 se estiver fora do escopo.',
    ),
  })
  @ApiParam({ name: 'code', example: 'ITS-2026-0042', ...bi('Identifier of the idea.', 'Identificador da ideia.') })
  @ApiOkResponse({ type: IdeaItem })
  get(@CurrentIntegration() principal: IntegrationPrincipal, @Param('code') code: string): Promise<IdeaItem> {
    return this.reader.get(principal, code);
  }
}
