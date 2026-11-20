import { type EntityManager, In } from 'typeorm';
import type { Idea } from '../ideas/entities/idea.entity.js';
import { ideaCapabilities } from '../ideas/idea-access.js';
import type { Access } from '../identity-access/access.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { photoVersions } from '../identity-access/photo-versions.js';
import { MuralComment, MuralReport } from './entities.js';
import type { MuralCard, MuralCardPerson, MuralCommentView, ReactionCounts } from './mural.dto.js';
import { consentsOf, participantsOf, personView } from './mural-common.js';
import { MURAL_REACTIONS, type MuralReaction, muralShowsName } from './mural-rules.js';

export const emptyCounts = (): ReactionCounts => ({ like: 0, congrats: 0, support: 0, brilliant: 0, inspiring: 0 });

/** Contagem por tipo e a reação de quem pergunta, de várias ideias de uma vez (RN-152). */
export async function reactionSummary(
  m: EntityManager,
  ideaIds: readonly string[],
  viewerId: string,
): Promise<Map<string, { counts: ReactionCounts; total: number; mine: MuralReaction | null }>> {
  const out = new Map<string, { counts: ReactionCounts; total: number; mine: MuralReaction | null }>();
  for (const id of ideaIds) out.set(id, { counts: emptyCounts(), total: 0, mine: null });
  if (ideaIds.length === 0) return out;
  const [counts, mine]: [
    { idea_id: string; kind: MuralReaction; n: string }[],
    { idea_id: string; kind: MuralReaction }[],
  ] = await Promise.all([
    m.query('SELECT idea_id, kind, count(*) AS n FROM mural_reaction WHERE idea_id = ANY($1) GROUP BY idea_id, kind', [
      ideaIds,
    ]),
    m.query('SELECT idea_id, kind FROM mural_reaction WHERE idea_id = ANY($1) AND user_id = $2', [ideaIds, viewerId]),
  ]);
  for (const r of counts) {
    const s = out.get(r.idea_id);
    if (s && (MURAL_REACTIONS as readonly string[]).includes(r.kind)) {
      s.counts[r.kind] = Number(r.n);
      s.total += Number(r.n);
    }
  }
  for (const r of mine) {
    const s = out.get(r.idea_id);
    if (s) s.mine = r.kind;
  }
  return out;
}

/**
 * Os cartões do mural (RN-150), em lote. A ideia vem com `category` e `entity` carregadas. Só sai o
 * que o cartão mostra; os participantes, só quem consentiu e pode aparecer (RN-151).
 */
export async function buildCards(
  m: EntityManager,
  access: Access,
  ideas: readonly Idea[],
  publishedAt: ReadonlyMap<string, Date>,
): Promise<MuralCard[]> {
  if (ideas.length === 0) return [];
  const ids = ideas.map((i) => i.id);
  const [participants, consents, reactions, comments, assigned] = await Promise.all([
    participantsOf(m, ideas),
    consentsOf(m, ids),
    reactionSummary(m, ids, access.userId),
    m.query(
      `SELECT idea_id, count(*) AS n FROM mural_comment
        WHERE idea_id = ANY($1) AND deleted_at IS NULL AND hidden_at IS NULL GROUP BY idea_id`,
      [ids],
    ) as Promise<{ idea_id: string; n: string }[]>,
    m.query('SELECT DISTINCT idea_id FROM step WHERE idea_id = ANY($1) AND assignee_id = $2', [
      ids,
      access.userId,
    ]) as Promise<{ idea_id: string }[]>,
  ]);
  // Só quem aceitou pode aparecer; os demais nem são carregados.
  const accepted = new Set<string>();
  for (const [ideaId, map] of consents) {
    for (const [userId, status] of map)
      if (status === 'accepted' && participants.get(ideaId)?.has(userId)) accepted.add(userId);
  }
  const users = accepted.size
    ? await m.getRepository(User).find({
        select: { id: true, name: true, status: true, hideName: true },
        where: { id: In([...accepted]) },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const visibleIds = users
    .filter((u) => muralShowsName('accepted', { hideName: u.hideName, active: u.status === UserStatus.Active }))
    .map((u) => u.id);
  const photos = await photoVersions(m, visibleIds);
  const assignedSet = new Set(assigned.map((a) => a.idea_id));

  return ideas.map((idea) => {
    const parts = participants.get(idea.id) ?? new Map();
    const people: MuralCardPerson[] = [];
    for (const [userId, role] of parts) {
      const u = userById.get(userId);
      const consent = consents.get(idea.id)?.get(userId) ?? null;
      if (u && muralShowsName(consent, { hideName: u.hideName, active: u.status === UserStatus.Active })) {
        people.push({ name: u.name, userId, photoVersion: photos.get(userId) ?? null, role });
      }
    }
    people.sort((a, b) => (a.role === b.role ? 0 : a.role === 'author' ? -1 : 1));
    const isParticipant = parts.has(access.userId);
    const r = reactions.get(idea.id);
    return {
      code: idea.code,
      title: idea.title,
      status: idea.status,
      category: idea.category ? { id: idea.category.id, name: idea.category.name, color: idea.category.color } : null,
      entity: { id: idea.entity.id, name: idea.entity.name },
      publishedAt: (publishedAt.get(idea.id) ?? new Date(0)).toISOString(),
      people,
      reactions: r?.counts ?? emptyCounts(),
      reactionTotal: r?.total ?? 0,
      myReaction: r?.mine ?? null,
      commentCount: Number(comments.find((c) => c.idea_id === idea.id)?.n ?? 0),
      canOpen: isParticipant || ideaCapabilities(access, idea, assignedSet.has(idea.id)).view,
      canReact: !isParticipant,
      canManage: access.hasIn('mural.manage', idea.entityId),
    };
  });
}

/**
 * A conversa de uma ideia no mural (RN-153, RN-154): comentários em ordem, cada um com as respostas.
 * Removido sem respostas some; removido com respostas fica "Comentário removido". Oculto: o texto só
 * para quem escreveu e para a equipe (`reveal`); os outros veem "Comentário oculto pela equipe".
 */
export async function buildThread(
  m: EntityManager,
  access: Access,
  idea: Pick<Idea, 'id' | 'authorId'>,
  reveal: boolean,
): Promise<MuralCommentView[]> {
  const rows = await m.getRepository(MuralComment).find({
    where: { ideaId: idea.id },
    relations: { author: true },
    order: { createdAt: 'ASC', id: 'ASC' },
    take: 1000,
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [participants, consents, photos, reports] = await Promise.all([
    participantsOf(m, [idea]),
    consentsOf(m, [idea.id]),
    photoVersions(
      m,
      rows.map((r) => r.authorId),
    ),
    m
      .getRepository(MuralReport)
      .find({ select: { commentId: true, reporterId: true, resolvedAt: true }, where: { commentId: In(ids) } }),
  ]);
  const parts = participants.get(idea.id) ?? new Map();
  const consentOf = consents.get(idea.id) ?? new Map();

  const view = (c: MuralComment): MuralCommentView => {
    const mine = c.authorId !== null && c.authorId === access.userId;
    const state: MuralCommentView['state'] = c.deletedAt ? 'deleted' : c.hiddenAt ? 'hidden' : 'visible';
    const reportedByMe = reports.some((r) => r.commentId === c.id && r.reporterId === access.userId);
    const showText = state === 'visible' || (state === 'hidden' && (mine || reveal));
    return {
      id: c.id,
      parentId: c.parentId,
      author:
        state === 'deleted'
          ? null
          : personView(c.author, {
              participant: c.authorId ? (parts.get(c.authorId) ?? null) : null,
              consent: c.authorId ? (consentOf.get(c.authorId) ?? null) : null,
              reveal,
              photos,
            }),
      body: showText ? c.body : null,
      state,
      hiddenReason: state === 'hidden' && (mine || reveal) ? c.hiddenReason : null,
      createdAt: c.createdAt.toISOString(),
      editedAt: state === 'deleted' ? null : (c.editedAt?.toISOString() ?? null),
      mine: mine && state !== 'deleted',
      canEdit: mine && state === 'visible',
      canReport: !mine && state === 'visible' && !reportedByMe,
      reportedByMe,
      pendingReports: reveal ? reports.filter((r) => r.commentId === c.id && r.resolvedAt === null).length : 0,
      replies: [],
    };
  };

  const top: MuralCommentView[] = [];
  const byId = new Map<string, MuralCommentView>();
  for (const c of rows.filter((r) => r.parentId === null)) {
    const v = view(c);
    byId.set(c.id, v);
    top.push(v);
  }
  for (const c of rows.filter((r) => r.parentId !== null)) byId.get(c.parentId as string)?.replies.push(view(c));
  // Removido sem respostas não deixa rastro.
  return top.filter((v) => v.state !== 'deleted' || v.replies.length > 0);
}
