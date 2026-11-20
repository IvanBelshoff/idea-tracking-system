import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, IsNull } from 'typeorm';
import type { z } from 'zod';
import { apiError } from '../common/api-error.js';
import { pageMeta } from '../common/pagination.js';
import { User } from '../identity-access/entities/user.entity.js';
import { getSetting } from '../organization/settings.service.js';
import type { NotificationPage, NotificationPreferencesView, NotificationView } from './communication.dto.js';
import { NotificationQuerySchema, PreferencesUpdateSchema } from './communication.dto.js';
import { Notification, NotificationChannel, NotificationPreference } from './entities.js';
import { isEmailActive } from './mail.js';
import {
  AUTHOR_TYPES,
  MANDATORY_TYPES,
  MURAL_TYPES,
  NOTIFICATION_TYPES,
  OPS_TYPES,
  prefKey,
  STORE_TYPES,
} from './notification-rules.js';

type ListQuery = z.infer<typeof NotificationQuerySchema>;
type PreferencesInput = z.infer<typeof PreferencesUpdateSchema>;

const AUTHOR = new Set<string>(AUTHOR_TYPES);
const MURAL = new Set<string>(MURAL_TYPES);
const STORE = new Set<string>(STORE_TYPES);

/** Sino de notificações e preferências da própria pessoa (RN-27, RN-29, RN-30). */
@Injectable()
export class NotificationsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private get repo() {
    return this.dataSource.getRepository(Notification);
  }

  unreadCount(userId: string): Promise<number> {
    return this.repo.countBy({ userId, inApp: true, readAt: IsNull() });
  }

  async list(userId: string, query: ListQuery): Promise<NotificationPage> {
    const where = { userId, inApp: true, ...(query.unread ? { readAt: IsNull() } : {}) };
    const [rows, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return {
      items: rows.map(toView),
      meta: pageMeta(query, total),
      unreadCount: await this.unreadCount(userId),
    };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const result = await this.repo.update({ id, userId, readAt: IsNull() }, { readAt: new Date() });
    if (!result.affected && !(await this.repo.existsBy({ id, userId }))) {
      throw apiError(404, 'not_found', 'Notificação não encontrada.');
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.repo.update({ userId, readAt: IsNull() }, { readAt: new Date() });
  }

  async preferences(userId: string): Promise<NotificationPreferencesView> {
    const m = this.dataSource.manager;
    const user = await m.getRepository(User).findOneByOrFail({ id: userId });
    const stored = new Map(
      (await m.getRepository(NotificationPreference).findBy({ userId })).map((p) => [
        prefKey(p.eventType, p.channel),
        p.enabled,
      ]),
    );
    const muralOn = await getSetting(m, 'mural.enabled');
    const storeOn = await getSetting(m, 'store.enabled');
    return {
      // Os avisos do mural (RN-156) só aparecem com o módulo ligado.
      events: NOTIFICATION_TYPES.filter(
        (type) => !OPS_TYPES.has(type) && (muralOn || !MURAL.has(type)) && (storeOn || !STORE.has(type)),
      ).map((type) => {
        const mandatory = MANDATORY_TYPES.has(type);
        return {
          type,
          group: AUTHOR.has(type) ? 'author' : MURAL.has(type) ? 'mural' : STORE.has(type) ? 'store' : 'team',
          mandatory,
          inApp: mandatory || (stored.get(prefKey(type, 'in_app')) ?? true),
          email: mandatory || (stored.get(prefKey(type, 'email')) ?? true),
        };
      }),
      deadlineAlertDays: user.deadlineAlertDays,
      defaultDeadlineAlertDays: await getSetting(m, 'notifications.deadline_alert_days'),
      emailActive: await isEmailActive(m),
    };
  }

  /** Decisões sobre a própria ideia não se desligam: são ignoradas aqui (RN-30). */
  async updatePreferences(userId: string, input: PreferencesInput): Promise<NotificationPreferencesView> {
    await this.dataSource.transaction(async (m) => {
      const rows = input.events
        .filter((e) => !MANDATORY_TYPES.has(e.type))
        .flatMap((e) => [
          { userId, eventType: e.type, channel: NotificationChannel.InApp, enabled: e.inApp },
          { userId, eventType: e.type, channel: NotificationChannel.Email, enabled: e.email },
        ]);
      if (rows.length > 0)
        await m.getRepository(NotificationPreference).upsert(rows, ['userId', 'eventType', 'channel']);
      await m.getRepository(User).update(userId, { deadlineAlertDays: input.deadlineAlertDays });
    });
    return this.preferences(userId);
  }
}

function toView(n: Notification): NotificationView {
  const code = typeof n.payload.code === 'string' ? n.payload.code : null;
  return {
    id: n.id,
    type: n.type,
    idea: code ? { code, title: String(n.payload.title ?? '') } : null,
    payload: n.payload,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
