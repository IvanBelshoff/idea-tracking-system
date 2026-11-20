import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import type { components } from '@/api/schema';

/** Campos personalizados do usuário (M25): tipos e consultas. */
export type UserField = components['schemas']['UserFieldView'];
export type UserFieldOption = components['schemas']['UserFieldOptionView'];
export type FieldForm = components['schemas']['UserFieldFormView'];
export type FieldValue = components['schemas']['UserFieldValueView'];

export const userFieldKeys = {
  all: ['user-fields'] as const,
  admin: ['user-fields', 'admin'] as const,
  mine: ['user-fields', 'mine'] as const,
  of: (userId: string) => ['user-fields', 'user', userId] as const,
};

/** A administração dos campos (só com `user.manage`). */
export function useUserFields(enabled = true) {
  return useQuery({
    queryKey: userFieldKeys.admin,
    queryFn: () => unwrap(api.GET('/api/user-fields')),
    enabled,
  });
}

export function useMyFields() {
  return useQuery({ queryKey: userFieldKeys.mine, queryFn: () => unwrap(api.GET('/api/me/fields')) });
}

export function useFieldsOf(userId: string) {
  return useQuery({
    queryKey: userFieldKeys.of(userId),
    queryFn: () => unwrap(api.GET('/api/users/{id}/fields', { params: { path: { id: userId } } })),
  });
}
