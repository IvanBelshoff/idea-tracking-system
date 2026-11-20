import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ApiError, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { applyLanguage, isLanguage } from '@/i18n';

export type Me = components['schemas']['MeResponse'];
export type Permission = Me['permissions'][number];
export type ThemePreference = Me['theme'];
export type PublicSettings = components['schemas']['PublicSettingsView'];

export const keys = {
  installStatus: ['install-status'] as const,
  me: ['me'] as const,
  publicSettings: ['public-settings'] as const,
};

/*
 * Consultas compartilhadas: os guardas do roteador (beforeLoad) e as telas leem o mesmo cache.
 */
export const installStatusQuery = queryOptions({
  queryKey: keys.installStatus,
  queryFn: () => unwrap(api.GET('/api/install/status')),
  staleTime: Number.POSITIVE_INFINITY,
});

/** Usuário logado; `null` quando não há sessão (401). Outros erros sobem. */
export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: async (): Promise<Me | null> => {
    try {
      const me = await unwrap(api.GET('/api/auth/me'));
      applyAccountPreferences(me);
      return me;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  staleTime: 60_000,
  retry: false,
});

export const publicSettingsQuery = queryOptions({
  queryKey: keys.publicSettings,
  queryFn: () => unwrap(api.GET('/api/settings/public')),
  staleTime: 5 * 60_000,
});

export const useInstallStatus = () => useQuery(installStatusQuery);
export const useMe = () => useQuery(meQuery);
export const usePublicSettings = () => useQuery(publicSettingsQuery);

/** Permissão em alguma entidade (para mostrar menus). A API sempre confere de novo. */
export function useCan() {
  const { data: me } = useMe();
  return (...permissions: Permission[]) => !!me && permissions.some((p) => me.permissions.includes(p));
}

/** As preferências salvas na conta passam a valer neste navegador (a conta é a fonte). */
export function applyAccountPreferences(me: Me): void {
  if (isLanguage(me.locale)) applyLanguage(me.locale);
}

/** Depois de login, instalação ou logout: atualiza o cache sem esperar nova consulta. */
export function useSetSession() {
  const qc = useQueryClient();
  return (me: Me | null) => {
    qc.setQueryData(keys.me, me);
    if (me) {
      qc.setQueryData(keys.installStatus, { installed: true });
      applyAccountPreferences(me);
    } else {
      // Ao sair, nada do usuário anterior pode ficar em cache.
      qc.removeQueries({ predicate: (q) => !Object.values(keys).some((k) => k[0] === q.queryKey[0]) });
    }
  };
}

export type PreferencesPatch = Partial<
  Pick<Me, 'locale' | 'theme' | 'navCollapsed' | 'hideName'> & {
    /** Cor da paleta curada e fonte da própria tela (RN-145); nulo = a da organização. */
    uiColor: Me['appearance']['color'];
    uiFont: Me['appearance']['font'];
  }
>;

/**
 * Preferências da conta (idioma, tema, menu recolhido): aplica na hora e salva no servidor.
 * Sem sessão (login, assistente), valem só neste navegador.
 */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  const mutation = useMutation({
    meta: { silent: true },
    mutationFn: (patch: PreferencesPatch) => unwrap(api.PATCH('/api/auth/me/preferences', { body: patch })),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: keys.me });
      const previous = qc.getQueryData<Me | null>(keys.me);
      if (previous) qc.setQueryData(keys.me, { ...previous, ...patch });
      return { previous };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.me, ctx.previous);
    },
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
  return (patch: PreferencesPatch) => {
    if (patch.locale && isLanguage(patch.locale)) applyLanguage(patch.locale);
    if (qc.getQueryData<Me | null>(keys.me)) mutation.mutate(patch);
  };
}
