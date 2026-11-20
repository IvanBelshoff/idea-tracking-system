import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import type { components } from '@/api/schema';

export type AccessView = components['schemas']['AccessView'];

/** Acesso corporativo (M13): política de domínio e, adiante, o login Microsoft/Google. */
export const accessKeys = {
  view: ['admin', 'access'] as const,
};

export function useAccess() {
  return useQuery({ queryKey: accessKeys.view, queryFn: () => unwrap(api.GET('/api/admin/access')) });
}
