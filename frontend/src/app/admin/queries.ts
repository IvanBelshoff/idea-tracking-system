import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';

/** Chaves e consultas compartilhadas pelas telas de administração. */
export const adminKeys = {
  all: ['admin'] as const,
  users: (q: object) => ['admin', 'users', q] as const,
  user: (id: string) => ['admin', 'user', id] as const,
  roles: ['admin', 'roles'] as const,
  permissions: ['admin', 'permissions'] as const,
  entities: ['entities'] as const,
  categories: (all: boolean) => ['categories', all] as const,
  settings: ['admin', 'settings'] as const,
  audit: (q: object) => ['admin', 'audit', q] as const,
  auditActions: ['admin', 'audit-actions'] as const,
  opsHealth: ['admin', 'ops', 'health'] as const,
  opsTraffic: ['admin', 'ops', 'traffic'] as const,
  opsUsage: ['admin', 'ops', 'usage'] as const,
  opsHistory: (period: string, offset: number) => ['admin', 'ops', 'history', period, offset] as const,
};

export function useEntities() {
  return useQuery({ queryKey: adminKeys.entities, queryFn: () => unwrap(api.GET('/api/entities')) });
}

export function useRoles() {
  return useQuery({ queryKey: adminKeys.roles, queryFn: () => unwrap(api.GET('/api/roles')) });
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: adminKeys.permissions,
    queryFn: () => unwrap(api.GET('/api/permissions')),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
