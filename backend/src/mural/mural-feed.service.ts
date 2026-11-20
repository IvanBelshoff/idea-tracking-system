import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, In } from 'typeorm';
import type { z } from 'zod';
import { apiError } from '../common/api-error.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import type { Access } from '../identity-access/access.js';
import { AccessService } from '../identity-access/access.service.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { photoVersions } from '../identity-access/photo-versions.js';
import { subtreeIds } from '../organization/tree.js';
import { MuralReactionRow } from './entities.js';
import type {
  FeedQuerySchema,
  MuralFeed,
  MuralPage,
  MuralPersonOption,
  ReactionResult,
  ReactorView,
} from './mural.dto.js';
import { MuralService } from './mural.service.js';
import { decodeCursor, encodeCursor, findPublished, participantsOf, personView } from './mural-common.js';
import { bumpDigest } from './mural-notify.js';
import type { MuralReaction } from './mural-rules.js';
import { buildCards, buildThread, emptyCounts, reactionSummary } from './mural-views.js';

const PAGE = 20;

/**
 * O que todos os logados veem no mural (RN-150, RN-152): a lista, a página de cada ideia, as reações e
 * a busca de colegas para o "enviar". Nada aqui abre a ideia (RN-01 continua valendo para ela).
 */
@Injectable()
export class MuralFeedService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mural: MuralService,
    private readonly accessService: AccessService,
  ) {}

  /** A lista paginada por cursor estável (CA-RN-150.6), com ordem e filtros (RN-150). */
  async feed(access: Access, q: z.infer<typeof FeedQuerySchema>): Promise<MuralFeed> {
    await this.mural.assertEnabled();
    const m = this.dataSource.manager;
    const cursor = decodeCursor(q.cursor);
    const byReactions = q.sort === 'reactions';
    if (cursor && byReactions !== (cursor.t !== undefined)) {
      throw apiError(422, 'invalid_cursor', 'O cursor é de outra ordem.');
    }
    const entityIds = q.entityId ? subtreeIds(q.entityId, await this.accessService.tree()) : null;
    const keyset = byReactions
      ? '($4::bigint IS NULL OR (total, pkey, idea_id) < ($6::int, $4::bigint, $5::uuid))'
      : '($4::bigint IS NULL OR (pkey, idea_id) < ($4::bigint, $5::uuid))';
    const order = byReactions ? 'total DESC, pkey DESC, idea_id DESC' : 'pkey DESC, idea_id DESC';
    const rows: { idea_id: string; pkey: string; total: number; published_at: Date }[] = await m.query(
      `WITH base AS (
         SELECT p.idea_id, p.published_at,
                (extract(epoch FROM p.published_at) * 1000000)::bigint AS pkey,
                (SELECT count(*)::int FROM mural_reaction r WHERE r.idea_id = p.idea_id) AS total
           FROM mural_post p
           JOIN idea i ON i.id = p.idea_id
          WHERE p.status = 'published'
            AND (cardinality($1::text[]) = 0 OR i.status::text = ANY($1::text[]))
            AND ($2::uuid IS NULL OR i.category_id = $2::uuid)
            AND ($3::uuid[] IS NULL OR i.entity_id = ANY($3::uuid[]))
       )
       SELECT idea_id, pkey::text AS pkey, total, published_at FROM base
        WHERE ${keyset}
        ORDER BY ${order}
        LIMIT ${PAGE + 1}`,
      // O total ($6) só entra na ordem por reações: parâmetro sem uso o Postgres recusa.
      [
        q.status,
        q.categoryId ?? null,
        entityIds,
        cursor?.p ?? null,
        cursor?.id ?? null,
        ...(byReactions ? [cursor?.t ?? null] : []),
      ],
    );
    const page = rows.slice(0, PAGE);
    const ideas = page.length
      ? await m.getRepository(Idea).find({
          where: { id: In(page.map((r) => r.idea_id)) },
          relations: { category: true, entity: true },
        })
      : [];
    const byId = new Map(ideas.map((i) => [i.id, i]));
    const ordered = page.map((r) => byId.get(r.idea_id)).filter((i): i is Idea => i !== undefined);
    const items = await buildCards(m, access, ordered, new Map(page.map((r) => [r.idea_id, new Date(r.published_at)])));
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        rows.length > PAGE && last
          ? encodeCursor({ p: last.pkey, id: last.idea_id, ...(byReactions ? { t: last.total } : {}) })
          : null,
    };
  }

  /** A página da ideia no mural: o cartão e a conversa (RN-150, RN-153). */
  async page(access: Access, ref: string): Promise<MuralPage> {
    await this.mural.assertEnabled();
    const m = this.dataSource.manager;
    const { idea, post } = await findPublished(m, ref);
    const full = await m.getRepository(Idea).findOneOrFail({
      where: { id: idea.id },
      relations: { category: true, entity: true },
    });
    const [card] = await buildCards(m, access, [full], new Map([[idea.id, post.publishedAt]]));
    const reveal = access.hasIn('mural.manage', idea.entityId);
    return { card: card as MuralPage['card'], comments: await buildThread(m, access, idea, reveal), canComment: true };
  }

  /**
   * Reagir, trocar ou tirar (RN-152): uma por pessoa e ideia (a chave primária garante, mesmo em
   * paralelo, CA-RN-152.2); participante não reage à própria ideia (RN-151).
   */
  async react(access: Access, ref: string, kind: MuralReaction | null): Promise<ReactionResult> {
    await this.mural.assertEnabled();
    const m = this.dataSource.manager;
    const { idea } = await findPublished(m, ref);
    const parts = (await participantsOf(m, [idea])).get(idea.id);
    if (parts?.has(access.userId)) {
      throw apiError(403, 'own_idea', 'Quem participa da ideia não reage a ela.');
    }
    await this.dataSource.transaction(async (tx) => {
      if (!kind) {
        await tx.getRepository(MuralReactionRow).delete({ ideaId: idea.id, userId: access.userId });
        return;
      }
      // `xmax = 0` só na linha recém-inserida: trocar o tipo não conta de novo no resumo do dia.
      const [row]: { inserted: boolean }[] = await tx.query(
        `INSERT INTO mural_reaction (idea_id, user_id, kind) VALUES ($1, $2, $3)
         ON CONFLICT (idea_id, user_id) DO UPDATE SET kind = EXCLUDED.kind
         RETURNING (xmax = 0) AS inserted`,
        [idea.id, access.userId, kind],
      );
      if (row?.inserted) await bumpDigest(tx, idea, access.userId, { reactions: 1 });
    });
    const s = (await reactionSummary(m, [idea.id], access.userId)).get(idea.id);
    return { reactions: s?.counts ?? emptyCounts(), reactionTotal: s?.total ?? 0, myReaction: s?.mine ?? null };
  }

  /**
   * Quem reagiu (RN-152), com o nome; anonimizado como "Ex-colaborador". Reação de quem hoje é
   * participante não aparece (não pode ligar a pessoa à ideia, CA-RN-151.5).
   */
  async reactors(ref: string, kind: MuralReaction | undefined): Promise<ReactorView[]> {
    await this.mural.assertEnabled();
    const m = this.dataSource.manager;
    const { idea } = await findPublished(m, ref);
    const parts = (await participantsOf(m, [idea])).get(idea.id) ?? new Map();
    const rows = await m.getRepository(MuralReactionRow).find({
      where: { ideaId: idea.id, ...(kind ? { kind } : {}) },
      relations: { user: true },
      order: { createdAt: 'DESC' },
      take: 500,
    });
    const visible = rows.filter((r) => !parts.has(r.userId));
    const photos = await photoVersions(
      m,
      visible.map((r) => r.userId),
    );
    return visible.map((r) => ({
      person: personView(r.user, { participant: null, consent: null, reveal: false, photos }),
      kind: r.kind,
    }));
  }

  /** Colegas ativos para o "enviar a um colega" (RN-155): só nome e foto, nunca o e-mail. */
  async people(access: Access, search: string): Promise<MuralPersonOption[]> {
    await this.mural.assertEnabled();
    const qb = this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .select(['u.id', 'u.name'])
      .where('u.status = :active', { active: UserStatus.Active })
      .andWhere('u.id <> :me', { me: access.userId })
      .orderBy('u.name', 'ASC')
      .take(20);
    if (search) qb.andWhere('u.name ILIKE :like', { like: `%${search.replace(/[%_\\]/g, '\\$&')}%` });
    const users = await qb.getMany();
    const photos = await photoVersions(
      this.dataSource.manager,
      users.map((u) => u.id),
    );
    return users.map((u) => ({ id: u.id, name: u.name, photoVersion: photos.get(u.id) ?? null }));
  }
}
