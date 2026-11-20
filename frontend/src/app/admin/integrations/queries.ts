import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import type { components } from '@/api/schema';

export type IntegrationsView = components['schemas']['IntegrationsView'];
export type IntegrationView = components['schemas']['IntegrationView'];
export type IntegrationTokenView = components['schemas']['IntegrationTokenView'];
export type EntityOption = components['schemas']['IntegrationEntityOption'];

/** Integrações (M16): chaves e consultas compartilhadas pela tela de administração. */
export const integrationKeys = {
  view: ['admin', 'integrations'] as const,
  usage: (id: string, days: number) => ['admin', 'integrations', 'usage', id, days] as const,
  contract: (integration: string) => ['admin', 'integrations', 'contract', integration] as const,
};

export function useIntegrations() {
  return useQuery({ queryKey: integrationKeys.view, queryFn: () => unwrap(api.GET('/api/admin/integrations')) });
}

export function useIntegrationUsage(id: string, days = 7) {
  return useQuery({
    queryKey: integrationKeys.usage(id, days),
    queryFn: () => unwrap(api.GET('/api/admin/integrations/{id}/usage', { params: { path: { id }, query: { days } } })),
  });
}

/** O contrato da API de integração, só dos módulos ligados (ou só dos da integração pedida). */
export function useContract(integration: string) {
  return useQuery({
    queryKey: integrationKeys.contract(integration),
    queryFn: async () => {
      const query = integration ? { integration } : {};
      return (await unwrap(api.GET('/api/admin/integrations/openapi', { params: { query } }))) as unknown as object;
    },
  });
}

/** Os módulos na ordem do contrato. */
export const MODULE_IDS = [
  'ideas',
  'indicators',
  'campaigns',
  'hall',
  'entities',
  'users',
  'store',
  'ideas_write',
  'gains_write',
] as const;

/** Módulos que gravam no ITS (M18): a tela os marca como "grava". */
export const WRITE_MODULE_IDS: readonly string[] = ['ideas_write', 'gains_write'];
export type ModuleId = (typeof MODULE_IDS)[number];
