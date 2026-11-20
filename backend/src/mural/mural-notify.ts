import type { EntityManager } from 'typeorm';
import { todayInZone } from '../common/dates.js';
import { Notification } from '../communication/entities.js';
import type { NotificationType } from '../communication/notification-rules.js';
import { dispatchNotifications } from '../communication/notify.js';
import type { Idea } from '../ideas/entities/idea.entity.js';
import { usersWithPermissionIn } from '../identity-access/permission-holders.js';
import { getSetting } from '../organization/settings.service.js';
import { participantsOf } from './mural-common.js';

/**
 * Avisos do mural (M21, RN-156). Todos passam pelas preferências (nenhum é obrigatório) e são
 * gravados na transação da ação. Nenhum gera pontos.
 */

type IdeaRef = Pick<Idea, 'id' | 'code' | 'title' | 'authorId' | 'entityId'>;

const base = (idea: IdeaRef) => ({ code: idea.code, title: idea.title });

/** Publicada ou retirada: um aviso a cada participante atual (autor e co-autores). */
export async function notifyParticipants(
  m: EntityManager,
  idea: IdeaRef,
  type: 'mural_published' | 'mural_withdrawn',
  extra: Record<string, unknown> = {},
): Promise<void> {
  const people = (await participantsOf(m, [idea])).get(idea.id) ?? new Map();
  await dispatchNotifications(
    m,
    [...people.keys()].map((userId) => ({ userId, type, ideaId: idea.id, payload: { ...base(idea), ...extra } })),
  );
}

/** Aviso simples a uma pessoa (comentário ocultado, ideia enviada por um colega). */
export async function notifyOne(
  m: EntityManager,
  userId: string,
  type: 'mural_comment_hidden' | 'mural_shared',
  idea: IdeaRef,
  extra: Record<string, unknown>,
): Promise<void> {
  await dispatchNotifications(m, [{ userId, type, ideaId: idea.id, payload: { ...base(idea), ...extra } }]);
}

/**
 * Aviso AGRUPADO por dia (RN-156): se a pessoa já tem, hoje (no fuso da instalação), o aviso deste
 * tipo, desta ideia e deste grupo, os contadores somam e ele volta a ficar não lido no topo; senão
 * nasce um novo (pelas preferências). Uma trava por chave impede dois avisos em paralelo (CA-T.1).
 */
export async function bumpGrouped(
  m: EntityManager,
  input: {
    userId: string;
    type: Extract<NotificationType, 'mural_digest' | 'mural_reply' | 'mural_reports'>;
    idea: IdeaRef;
    group: string;
    counts: Record<string, number>;
  },
): Promise<void> {
  const day = todayInZone(new Date(), await getSetting(m, 'organization.timezone'));
  const key = `${input.userId}:${input.type}:${input.idea.id}:${input.group}:${day}`;
  await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
  const repo = m.getRepository(Notification);
  const existing = await repo
    .createQueryBuilder('n')
    .where('n.user_id = :user AND n.type = :type AND n.idea_id = :idea', {
      user: input.userId,
      type: input.type,
      idea: input.idea.id,
    })
    .andWhere(`n.payload ->> 'day' = :day AND n.payload ->> 'group' = :group`, { day, group: input.group })
    .getOne();
  if (existing) {
    const payload = { ...existing.payload };
    for (const [k, v] of Object.entries(input.counts)) payload[k] = (Number(payload[k]) || 0) + v;
    // O e-mail do resumo diário ainda pendente sai com os números novos; o que já saiu não se repete.
    await repo
      .createQueryBuilder()
      .update()
      .set({ payload: () => ':payload::jsonb', readAt: null, createdAt: () => 'now()' })
      .where('id = :id', { id: existing.id })
      .setParameter('payload', JSON.stringify(payload))
      .execute();
    return;
  }
  const zeros = input.type === 'mural_digest' ? { reactions: 0, comments: 0 } : {};
  const payload = { ...base(input.idea), day, group: input.group, ...zeros, ...input.counts };
  await dispatchNotifications(m, [{ userId: input.userId, type: input.type, ideaId: input.idea.id, payload }]);
}

/** Resumo do dia aos participantes: reação nova ou comentário novo (quem age não avisa a si mesmo). */
export async function bumpDigest(
  m: EntityManager,
  idea: IdeaRef,
  actorId: string,
  counts: { reactions?: number; comments?: number },
): Promise<void> {
  const people = (await participantsOf(m, [idea])).get(idea.id) ?? new Map();
  for (const userId of people.keys()) {
    if (userId === actorId) continue;
    await bumpGrouped(m, { userId, type: 'mural_digest', idea, group: 'digest', counts });
  }
}

/** Denúncia nova: avisa, agrupado por dia e por ideia, quem modera o mural na entidade da ideia. */
export async function bumpReports(m: EntityManager, idea: IdeaRef, reporterId: string): Promise<void> {
  for (const userId of await usersWithPermissionIn(m, 'mural.manage', idea.entityId)) {
    if (userId === reporterId) continue;
    await bumpGrouped(m, { userId, type: 'mural_reports', idea, group: 'reports', counts: { reports: 1 } });
  }
}
