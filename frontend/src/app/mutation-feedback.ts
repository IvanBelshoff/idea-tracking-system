import { MutationCache, QueryCache, type QueryClient } from '@tanstack/react-query';
import i18n from 'i18next';
import { ApiError, errorText } from '@/api/errors';
import { errorFeedback, isSessionExpired, type MutationMeta, successFeedback } from '@/lib/mutation-feedback';
import { notify } from '@/lib/toast';
import { meQuery } from './session';

/**
 * Avisos na tela das ações (M23, RN-174), ligados UMA vez aqui, no cliente de dados: o erro é
 * automático em toda ação, e o sucesso aparece quando a ação declara o texto em `meta.success`.
 * Para ligar ação por ação, basta trocar por chamadas a `notify`.
 */
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: MutationMeta;
  }
}

/** Leitura recusada com 428 (cadastro obrigatório, M25): relê a conta, e o portão aparece. */
export function createQueryCache(getClient: () => QueryClient): QueryCache {
  return new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'profile_incomplete') {
        void getClient().invalidateQueries({ queryKey: meQuery.queryKey });
      }
    },
  });
}

export function createMutationCache(getClient: () => QueryClient): MutationCache {
  return new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Sessão expirada: sem aviso; a sessão é relida e a rota protegida leva ao login.
      if (isSessionExpired(error)) {
        void getClient().invalidateQueries({ queryKey: meQuery.queryKey });
        return;
      }
      if (error instanceof ApiError && error.code === 'profile_incomplete') {
        void getClient().invalidateQueries({ queryKey: meQuery.queryKey });
        return;
      }
      const feedback = errorFeedback(error, mutation.meta, (e) => errorText(i18n.t, e));
      if (feedback) notify.error(feedback.title);
    },
    onSuccess: (data, variables, _context, mutation) => {
      const feedback = successFeedback(data, mutation.meta, variables);
      if (feedback) notify.success(feedback.title);
    },
  });
}
