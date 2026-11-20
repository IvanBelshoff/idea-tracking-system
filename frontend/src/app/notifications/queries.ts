import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import type { components } from '@/api/schema';

export type NotificationItem = components['schemas']['NotificationView'];
export type NotificationType = NotificationItem['type'];
export type NotificationPreferences = components['schemas']['NotificationPreferencesView'];
export type PreferencesInput = components['schemas']['NotificationPreferencesRequest'];

export const notificationKeys = {
  all: ['notifications'] as const,
  unread: ['notifications', 'unread'] as const,
  list: (page: number, unread: boolean) => ['notifications', 'list', page, unread] as const,
  preferences: ['notifications', 'preferences'] as const,
};

/** Contador do sino: confere a cada minuto e quando a janela volta ao foco. */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: async () => (await unwrap(api.GET('/api/notifications/unread-count'))).count,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useNotifications(page: number, unread: boolean) {
  return useQuery({
    queryKey: notificationKeys.list(page, unread),
    queryFn: () =>
      unwrap(
        api.GET('/api/notifications', {
          params: { query: { page, pageSize: 20, unread: unread ? 'true' : undefined } },
        }),
      ),
    placeholderData: keepPreviousData,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: true },
    mutationFn: (id: string) => unwrap(api.POST('/api/notifications/{id}/read', { params: { path: { id } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: true },
    mutationFn: () => unwrap(api.POST('/api/notifications/read-all')),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: () => unwrap(api.GET('/api/notifications/preferences')),
  });
}

export function useSaveNotificationPreferences() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    meta: { success: t('notifications.prefs.saved') },
    mutationFn: (body: PreferencesInput) => unwrap(api.PUT('/api/notifications/preferences', { body })),
    onSuccess: (data) => qc.setQueryData(notificationKeys.preferences, data),
  });
}
