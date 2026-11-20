import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import type { components } from '@/api/schema';

export type WebhooksView = components['schemas']['WebhooksView'];
export type WebhookSubscriptionView = components['schemas']['WebhookSubscriptionView'];
export type WebhookSecretView = components['schemas']['WebhookSecretView'];
export type WebhookEventType = WebhooksView['events'][number]['type'];
export type WebhookDeliveryView = components['schemas']['WebhookDeliveryView'];

/** Webhooks (M17): chaves e consultas compartilhadas pela aba. */
export const webhookKeys = {
  view: ['admin', 'webhooks'] as const,
  deliveries: (id: string, state: string) => ['admin', 'webhooks', 'deliveries', id, state] as const,
};

export function useWebhooks() {
  return useQuery({ queryKey: webhookKeys.view, queryFn: () => unwrap(api.GET('/api/admin/webhooks')) });
}

export type DeliveryFilter = 'all' | 'pending' | 'delivered' | 'failed';

export function useDeliveries(id: string, state: DeliveryFilter) {
  return useQuery({
    queryKey: webhookKeys.deliveries(id, state),
    queryFn: () =>
      unwrap(
        api.GET('/api/admin/webhooks/{id}/deliveries', {
          params: { path: { id }, query: state === 'all' ? {} : { state } },
        }),
      ),
  });
}
