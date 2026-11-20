import { type EntityManager, In } from 'typeorm';
import { Idea } from '../ideas/entities/idea.entity.js';
import { IdeaParticipant, ParticipantRole } from '../ideas/entities/idea-related.entity.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { Notification, NotificationEmailState, NotificationPreference } from './entities.js';
import { isEmailActive } from './mail.js';
import {
  channelsFor,
  type IdeaEventRef,
  NOTIFYING_EVENTS,
  type NotificationDraft,
  notificationsForEvent,
  prefKey,
} from './notification-rules.js';

/**
 * Grava os avisos na MESMA transação da ação que os gerou: se a ação desfaz, o aviso some junto.
 * Só para usuários ativos; respeita as preferências por evento e canal (RN-30).
 */
export async function dispatchNotifications(m: EntityManager, drafts: readonly NotificationDraft[]): Promise<number> {
  if (drafts.length === 0) return 0;
  const userIds = [...new Set(drafts.map((d) => d.userId))];
  const active = new Set(
    (
      await m.getRepository(User).find({ select: { id: true }, where: { id: In(userIds), status: UserStatus.Active } })
    ).map((u) => u.id),
  );
  if (active.size === 0) return 0;

  const prefsByUser = new Map<string, Map<string, boolean>>();
  for (const p of await m.getRepository(NotificationPreference).findBy({ userId: In([...active]) })) {
    const map = prefsByUser.get(p.userId) ?? new Map<string, boolean>();
    map.set(prefKey(p.eventType, p.channel), p.enabled);
    prefsByUser.set(p.userId, map);
  }
  const emailActive = await isEmailActive(m);

  const repo = m.getRepository(Notification);
  const rows: Notification[] = [];
  for (const d of drafts) {
    if (!active.has(d.userId)) continue;
    const { inApp, email } = channelsFor(d.type, prefsByUser.get(d.userId) ?? new Map(), emailActive);
    if (!inApp && !email) continue;
    rows.push(
      repo.create({
        userId: d.userId,
        type: d.type,
        ideaId: d.ideaId,
        payload: d.payload,
        inApp,
        emailState: email ? NotificationEmailState.Pending : NotificationEmailState.None,
        readAt: null,
      }),
    );
  }
  if (rows.length > 0) await repo.save(rows);
  return rows.length;
}

/** Chamado a cada evento gravado no histórico da ideia (RN-27, CA-RN-20.1). */
export async function notifyIdeaEvent(m: EntityManager, event: IdeaEventRef & { ideaId: string }): Promise<void> {
  if (!NOTIFYING_EVENTS.has(event.type)) return;
  const idea = await m.getRepository(Idea).findOne({
    select: { id: true, code: true, title: true, authorId: true, assignedToId: true },
    where: { id: event.ideaId },
  });
  if (!idea) return;
  const coAuthors = await m
    .getRepository(IdeaParticipant)
    .find({ select: { userId: true }, where: { ideaId: idea.id, role: ParticipantRole.CoAuthor } });
  await dispatchNotifications(
    m,
    notificationsForEvent(event, { ...idea, coAuthorIds: coAuthors.map((p) => p.userId) }),
  );
}
