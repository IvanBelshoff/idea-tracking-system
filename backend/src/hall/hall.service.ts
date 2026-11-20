import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import PDFDocument from 'pdfkit';
import { type DataSource, In } from 'typeorm';
import type { z } from 'zod';
import { apiError } from '../common/api-error.js';
import { formatDayBr, todayInZone } from '../common/dates.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { IdeaParticipant, ParticipantRole } from '../ideas/entities/idea-related.entity.js';
import { IdeasService, recordEvent } from '../ideas/ideas.service.js';
import type { Access } from '../identity-access/access.js';
import { UserStatus } from '../identity-access/entities/user.entity.js';
import { photoVersions } from '../identity-access/photo-versions.js';
import { deriveBrand } from '../organization/brand-color.js';
import { logoPng } from '../organization/branding.service.js';
import { SettingsService } from '../organization/settings.service.js';
import { HallDismissal, Highlight, HighlightConsent, HighlightPraise, HighlightStatus, IdeaLike } from './entities.js';
import type {
  CandidateView,
  HallCard,
  HallView,
  HidePraiseSchema,
  HighlightDetail,
  HighlightSchema,
  LikeResult,
  PraiseView,
} from './hall.dto.js';
import { createHighlight, listCandidates } from './hall-core.js';
import { showsName } from './hall-rules.js';

const notFound = () => apiError(404, 'not_found', 'Destaque não encontrado.');

/**
 * Hall de destaques (RN-72 a RN-80). Destaque da organização aparece para todos os logados; o da
 * entidade, só para quem enxerga a entidade (RN-79). Revogado e agendado só para a curadoria.
 */
@Injectable()
export class HallService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly ideas: IdeasService,
  ) {}

  private async today(): Promise<string> {
    return todayInZone(new Date(), await this.settings.get('organization.timezone'));
  }

  /** Pode destacar (ou revogar) neste escopo, na entidade da ideia (permissões distintas; RN-79). */
  private canCurateIn(access: Access, scope: Highlight['scope'], entityId: string): boolean {
    return scope === 'organization'
      ? access.hasIn('hall.highlight_org', entityId)
      : access.hasIn('hall.highlight_entity', entityId) || access.hasIn('hall.highlight_org', entityId);
  }

  private state(h: Highlight, today: string): 'scheduled' | 'active' | 'expired' | 'revoked' {
    if (h.status === HighlightStatus.Revoked) return 'revoked';
    if (h.status === HighlightStatus.Expired) return 'expired';
    return h.startsOn > today ? 'scheduled' : 'active';
  }

  /** Quem vê este destaque (RN-79, CA-RN-80.2). */
  private visible(access: Access, h: Highlight, entityId: string, today: string): boolean {
    const state = this.state(h, today);
    if (state === 'revoked' || state === 'scheduled') return this.canCurateIn(access, h.scope, entityId);
    return h.scope === 'organization' || access.hasAnyIn(entityId);
  }

  /** Monta os cartões em lote: ideia, pessoas (com consentimento), ganho, curtidas, elogios. */
  private async cards(access: Access, highlights: Highlight[], today: string): Promise<HallCard[]> {
    if (highlights.length === 0) return [];
    const m = this.dataSource.manager;
    const ideaIds = [...new Set(highlights.map((h) => h.ideaId))];
    const hIds = highlights.map((h) => h.id);
    const [ideas, consents, likes, mine, praises] = await Promise.all([
      m.getRepository(Idea).find({ where: { id: In(ideaIds) }, relations: { category: true, entity: true } }),
      m.getRepository(HighlightConsent).find({ where: { highlightId: In(hIds) }, relations: { user: true } }),
      m.query('SELECT idea_id, count(*) AS n FROM idea_like WHERE idea_id = ANY($1) GROUP BY idea_id', [ideaIds]),
      m.getRepository(IdeaLike).findBy({ ideaId: In(ideaIds), userId: access.userId }),
      m.query(
        'SELECT highlight_id, count(*) AS n FROM highlight_praise WHERE highlight_id = ANY($1) AND hidden_at IS NULL GROUP BY highlight_id',
        [hIds],
      ),
    ]);
    const [likesOn, showGain] = await Promise.all([
      this.settings.get('hall.likes_enabled'),
      this.settings.get('hall.show_gain'),
    ]);
    const gains: { idea_id: string; annual: string; currency: string }[] = showGain
      ? await m.query(
          `SELECT idea_id, CASE periodicity WHEN 'monthly' THEN realized * 12 ELSE realized END AS annual, currency
             FROM financial_gain WHERE idea_id = ANY($1) AND status = 'validated' AND realized IS NOT NULL`,
          [ideaIds],
        )
      : [];
    const participants = await m.getRepository(IdeaParticipant).find({
      where: { ideaId: In(ideaIds), userId: access.userId },
    });
    const ideaById = new Map(ideas.map((i) => [i.id, i]));
    const photos = await photoVersions(
      m,
      consents.map((c) => c.userId),
    );
    const out: HallCard[] = [];
    for (const h of highlights) {
      const idea = ideaById.get(h.ideaId);
      if (!idea) continue;
      const people = consents
        .filter((c) => c.highlightId === h.id)
        .sort((a, b) => (a.role === b.role ? 0 : a.role === 'author' ? -1 : 1))
        .map((c) => {
          const visibleName = showsName(c.status, c.user.hideName, c.user.status === UserStatus.Anonymized);
          return {
            name: visibleName ? c.user.name : null,
            userId: visibleName ? c.userId : null,
            photoVersion: visibleName ? (photos.get(c.userId) ?? null) : null,
            role: c.role,
          };
        });
      const own =
        idea.authorId === access.userId ||
        participants.some(
          (p) => p.ideaId === idea.id && (p.role === ParticipantRole.Author || p.role === ParticipantRole.CoAuthor),
        );
      const gain = gains.find((g) => g.idea_id === idea.id);
      out.push({
        id: h.id,
        scope: h.scope,
        state: this.state(h, today),
        justification: h.justification,
        startsOn: h.startsOn,
        endsOn: h.endsOn,
        idea: {
          code: idea.code,
          title: idea.title,
          category: idea.category ? { name: idea.category.name, color: idea.category.color } : null,
          entity: idea.entity.name,
          before: idea.description,
          after: idea.resultText,
          implementedAt: idea.implementedAt?.toISOString() ?? null,
        },
        people,
        gain: gain ? { validatedAnnual: Number(gain.annual), currency: gain.currency } : null,
        likes: likesOn ? Number(likes.find((l: { idea_id: string }) => l.idea_id === idea.id)?.n ?? 0) : null,
        likedByMe: likesOn && mine.some((l) => l.ideaId === idea.id),
        canLike: likesOn && !own,
        praises: Number(praises.find((p: { highlight_id: string }) => p.highlight_id === h.id)?.n ?? 0),
        canManage: h.status === HighlightStatus.Active && this.canCurateIn(access, h.scope, idea.entityId),
        canOpenIdea: own || access.hasIn('idea.view_scope', idea.entityId),
      });
    }
    return out;
  }

  async hall(access: Access): Promise<HallView> {
    const today = await this.today();
    const all = await this.dataSource.getRepository(Highlight).find({
      where: { status: In([HighlightStatus.Active, HighlightStatus.Expired]) },
      relations: { idea: true },
      order: { startsOn: 'DESC' },
      take: 500,
    });
    const visible = all.filter(
      (h) => this.state(h, today) !== 'scheduled' && this.visible(access, h, h.idea.entityId, today),
    );
    const cards = await this.cards(access, visible, today);
    const current = cards
      .filter((c) => c.state === 'active')
      .sort((a, b) => (a.scope === b.scope ? (b.likes ?? 0) - (a.likes ?? 0) : a.scope === 'organization' ? -1 : 1));
    const byYear = new Map<number, HallCard[]>();
    for (const c of cards.filter((x) => x.state === 'expired')) {
      const year = Number(c.endsOn.slice(0, 4));
      byYear.set(year, [...(byYear.get(year) ?? []), c]);
    }
    const mine = await this.dataSource.getRepository(HighlightConsent).find({
      where: { userId: access.userId, highlight: { status: HighlightStatus.Active } },
      relations: { highlight: { idea: true } },
    });
    return {
      current,
      fame: [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, list]) => ({ year, cards: list })),
      mine: mine.map((c) => ({ highlightId: c.highlightId, ideaTitle: c.highlight.idea.title, status: c.status })),
      canCurate: access.has('hall.highlight_entity') || access.has('hall.highlight_org'),
      likesEnabled: await this.settings.get('hall.likes_enabled'),
    };
  }

  private async load(access: Access, id: string): Promise<{ h: Highlight; today: string }> {
    const h = await this.dataSource.getRepository(Highlight).findOne({ where: { id }, relations: { idea: true } });
    const today = await this.today();
    if (!h || !this.visible(access, h, h.idea.entityId, today)) throw notFound();
    return { h, today };
  }

  async detail(access: Access, id: string): Promise<HighlightDetail> {
    const { h, today } = await this.load(access, id);
    const [card] = await this.cards(access, [h], today);
    const canModerate = access.hasIn('hall.moderate', h.idea.entityId);
    const praises = await this.dataSource.getRepository(HighlightPraise).find({
      where: { highlightId: id },
      relations: { author: true },
      order: { createdAt: 'ASC' },
    });
    const consent = await this.dataSource
      .getRepository(HighlightConsent)
      .findOneBy({ highlightId: id, userId: access.userId });
    const praiseList: PraiseView[] = praises
      .filter((p) => canModerate || p.hiddenAt === null)
      .map((p) => ({
        id: p.id,
        author: p.author && !p.author.hideName && p.author.status !== UserStatus.Anonymized ? p.author.name : null,
        body: p.body,
        createdAt: p.createdAt.toISOString(),
        hidden: p.hiddenAt !== null,
        hiddenReason: canModerate ? p.hiddenReason : null,
      }));
    return {
      card: card as HallCard,
      praiseList,
      canModerate,
      myConsent: consent?.status ?? null,
      revokedReason: h.status === HighlightStatus.Revoked ? h.revokedReason : null,
    };
  }

  /** Destacar (CA-RN-72.1): permissão do escopo na entidade da ideia, justificativa e período. */
  async create(access: Access, input: z.infer<typeof HighlightSchema>): Promise<HighlightDetail> {
    const idea = await this.findIdea(input.ideaRef);
    if (!this.canCurateIn(access, input.scope, idea.entityId)) {
      throw apiError(
        403,
        'forbidden',
        input.scope === 'organization'
          ? 'Você não destaca ideias para a organização inteira.'
          : 'Você não destaca ideias desta entidade.',
      );
    }
    const id = await this.dataSource.transaction((m) =>
      createHighlight(
        m,
        {
          ideaId: idea.id,
          scope: input.scope,
          justification: input.justification,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
        },
        access.userId,
      ),
    );
    return this.detail(access, id);
  }

  private async findIdea(ref: string): Promise<Idea> {
    const where = /^[0-9a-f-]{36}$/i.test(ref) ? { id: ref } : { code: ref.toUpperCase() };
    const idea = await this.dataSource.getRepository(Idea).findOneBy(where);
    if (!idea) throw apiError(404, 'not_found', 'Ideia não encontrada.');
    return idea;
  }

  /** Revogar (CA-RN-78.1): motivo obrigatório, registrado no histórico da ideia. */
  async revoke(access: Access, id: string, reason: string): Promise<HighlightDetail> {
    await this.dataSource.transaction(async (m) => {
      const h = await m.getRepository(Highlight).findOne({
        where: { id },
        relations: { idea: true },
        lock: { mode: 'pessimistic_write', tables: ['highlight'] },
      });
      if (!h) throw notFound();
      if (!this.canCurateIn(access, h.scope, h.idea.entityId))
        throw apiError(403, 'forbidden', 'Você não revoga este destaque.');
      if (h.status !== HighlightStatus.Active)
        throw apiError(409, 'not_active', 'Só destaque em vigor pode ser revogado.');
      await m
        .getRepository(Highlight)
        .update(id, { status: HighlightStatus.Revoked, revokedReason: reason, revokedAt: new Date() });
      await recordEvent(m, {
        ideaId: h.ideaId,
        type: 'highlight_revoked',
        actorId: access.userId,
        reason,
        data: { scope: h.scope, highlightId: id },
      });
    });
    return this.detail(access, id);
  }

  /** Consentimento (RN-74): a própria pessoa aceita aparecer com nome ou prefere sem nome. */
  async consent(access: Access, id: string, accept: boolean): Promise<HighlightDetail> {
    await this.load(access, id);
    const repo = this.dataSource.getRepository(HighlightConsent);
    if (!(await repo.existsBy({ highlightId: id, userId: access.userId }))) {
      throw apiError(403, 'forbidden', 'Só quem participa da ideia responde ao consentimento.');
    }
    await repo.update(
      { highlightId: id, userId: access.userId },
      { status: accept ? 'accepted' : 'declined', answeredAt: new Date() },
    );
    return this.detail(access, id);
  }

  async praise(access: Access, id: string, body: string): Promise<HighlightDetail> {
    const { h, today } = await this.load(access, id);
    if (this.state(h, today) === 'revoked') throw notFound();
    const repo = this.dataSource.getRepository(HighlightPraise);
    await repo.save(repo.create({ highlightId: id, authorId: access.userId, body }));
    return this.detail(access, id);
  }

  /** Moderação (CA-RN-77.1): quem modera na entidade da ideia oculta, com motivo. */
  async hidePraise(
    access: Access,
    praiseId: string,
    input: z.infer<typeof HidePraiseSchema>,
  ): Promise<HighlightDetail> {
    const p = await this.dataSource
      .getRepository(HighlightPraise)
      .findOne({ where: { id: praiseId }, relations: { highlight: { idea: true } } });
    if (!p) throw apiError(404, 'not_found', 'Elogio não encontrado.');
    if (!access.hasIn('hall.moderate', p.highlight.idea.entityId)) {
      throw apiError(403, 'forbidden', 'Você não modera elogios desta entidade.');
    }
    await this.dataSource
      .getRepository(HighlightPraise)
      .update(praiseId, { hiddenAt: new Date(), hiddenById: access.userId, hiddenReason: input.reason });
    return this.detail(access, p.highlightId);
  }

  /**
   * Curtir (RN-76): idempotente; só quem vê a ideia ou um destaque dela (CA-RN-76.4); nunca a
   * própria nem a de co-autoria (CA-RN-76.1). Desligado → 404 (CA-RN-76.3).
   */
  async like(access: Access, ref: string, on: boolean): Promise<LikeResult> {
    if (!(await this.settings.get('hall.likes_enabled'))) throw apiError(404, 'not_found', 'Curtidas desligadas.');
    const idea = await this.findIdea(ref);
    const today = await this.today();
    let canSee = false;
    try {
      await this.ideas.findVisible(access, idea.id);
      canSee = true;
    } catch {
      const highlights = await this.dataSource
        .getRepository(Highlight)
        .find({ where: { ideaId: idea.id, status: In([HighlightStatus.Active, HighlightStatus.Expired]) } });
      canSee = highlights.some((h) => this.visible(access, h, idea.entityId, today));
    }
    if (!canSee) throw apiError(404, 'not_found', 'Ideia não encontrada.');
    const own = await this.dataSource.getRepository(IdeaParticipant).existsBy({
      ideaId: idea.id,
      userId: access.userId,
      role: In([ParticipantRole.Author, ParticipantRole.CoAuthor]),
    });
    if (own || idea.authorId === access.userId) {
      throw apiError(422, 'own_idea', 'Não dá para curtir a própria ideia (nem a de que você é co-autor).');
    }
    const repo = this.dataSource.getRepository(IdeaLike);
    if (on)
      await repo.createQueryBuilder().insert().values({ ideaId: idea.id, userId: access.userId }).orIgnore().execute();
    else await repo.delete({ ideaId: idea.id, userId: access.userId });
    return { likes: await repo.countBy({ ideaId: idea.id }), likedByMe: on };
  }

  private curatorEntities(access: Access): string[] {
    return [...new Set([...access.entities('hall.highlight_entity'), ...access.entities('hall.highlight_org')])];
  }

  async candidates(access: Access): Promise<CandidateView[]> {
    const entities = this.curatorEntities(access);
    if (entities.length === 0) throw apiError(403, 'forbidden', 'Você não faz curadoria do Hall.');
    return (await listCandidates(this.dataSource.manager, entities)).map(({ ideaId: _i, ...c }) => c);
  }

  /** Recusar a candidata (CA-RN-72.3): a decisão fica guardada e ela não volta a ser sugerida. */
  async dismiss(access: Access, ref: string): Promise<CandidateView[]> {
    const idea = await this.findIdea(ref);
    if (!this.curatorEntities(access).includes(idea.entityId))
      throw apiError(403, 'forbidden', 'Você não faz curadoria desta entidade.');
    await this.dataSource
      .getRepository(HallDismissal)
      .createQueryBuilder()
      .insert()
      .values({ ideaId: idea.id, dismissedById: access.userId })
      .orIgnore()
      .execute();
    return this.candidates(access);
  }

  /** Cartão em PDF para murais (RN-80): só o que o Hall mostra, com as mesmas regras de nome e ganho. */
  async cardPdf(access: Access, id: string): Promise<{ code: string; pdf: Buffer }> {
    const { card } = await this.detail(access, id);
    const organization = await this.settings.get('organization.name');
    const brandHex = deriveBrand(
      await this.settings.get('branding.color'),
      await this.settings.get('branding.color_dark'),
    ).lightHex;
    const logo = await logoPng(this.dataSource.manager);
    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A5',
        layout: 'landscape',
        margin: 36,
        compress: process.env.NODE_ENV !== 'test',
        info: { Title: `${card.idea.code} - ${card.idea.title}`, Author: organization || 'ITS', Creator: 'ITS' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.rect(0, 0, doc.page.width, 8).fill(brandHex);
      doc.moveDown(0.5);
      if (logo) {
        doc.image(logo, doc.page.width - 36 - 120, 20, { fit: [120, 32], align: 'right' });
      }
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(brandHex)
        .text(
          `${organization || 'ITS'} · ${card.scope === 'organization' ? 'DESTAQUE DA ORGANIZAÇÃO' : 'DESTAQUE DA ENTIDADE'}`,
        );
      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(20).fillColor('#111111').text(card.idea.title);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#555555')
        .text([card.idea.category?.name, card.idea.entity, card.idea.code].filter(Boolean).join(' · '));
      const block = (label: string, value: string | null) => {
        if (!value) return;
        doc.moveDown(0.6).font('Helvetica-Bold').fontSize(9).fillColor('#555555').text(label.toUpperCase());
        doc.font('Helvetica').fontSize(11).fillColor('#111111').text(value, { height: 60, ellipsis: true });
      };
      block('Antes', card.idea.before);
      block('Depois', card.idea.after);
      block('Por que é destaque', card.justification);
      const names = card.people.map((p) => p.name ?? 'Colaborador anônimo').join(', ');
      block('Quem fez', names);
      if (card.gain) {
        const value = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: card.gain.currency }).format(
          card.gain.validatedAnnual,
        );
        block('Ganho validado por ano', value);
      }
      doc
        .moveDown(0.6)
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#555555')
        .text(`Destaque de ${formatDayBr(card.startsOn)} a ${formatDayBr(card.endsOn)}`);
      doc.end();
    });
    return { code: card.idea.code, pdf };
  }
}
