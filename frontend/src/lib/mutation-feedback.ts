/**
 * Que aviso uma ação mostra (M23, RN-174): função pura, sem React nem i18n, para os testes do Node.
 * Quem liga isto ao cliente de dados é app/mutation-feedback.ts.
 *
 * - Erro: sempre, com o mesmo texto que a tela já usa para o erro, também quando a tela o mostra junto
 *   do campo (decisão do dono: os dois). Exceção: a sessão expirada, que leva ao login.
 * - Sucesso: só quando a ação declara o texto em `meta.success`; `meta.silent` marca as ações cujo
 *   resultado a tela já mostra na hora (reagir, marcar lida, tema, arrastar...).
 */
export type MutationMeta = {
  /**
   * Texto do aviso de sucesso, já traduzido. Pode depender da resposta e do que foi pedido (ligar ou
   * desligar, por exemplo); um texto vazio não mostra nada.
   */
  // biome-ignore lint/suspicious/noExplicitAny: cada ação tem a sua resposta e as suas variáveis.
  success?: string | ((data: any, variables: any) => string);
  /** A tela já mostra o resultado na hora: nenhum aviso de sucesso (o erro continua). */
  silent?: true;
  /** A tela trata este erro de outro jeito (raro; diga o porquê no código). */
  silentError?: true;
};

export type Feedback = { tone: 'success' | 'error'; title: string } | null;

/** A sessão expirou: a tela leva ao login, sem aviso (o 401 do login com senha errada é outro código). */
export function isSessionExpired(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 401 &&
    (error as { code?: unknown }).code === 'unauthenticated'
  );
}

export function errorFeedback(
  error: unknown,
  meta: MutationMeta | undefined,
  text: (error: unknown) => string,
): Feedback {
  if (meta?.silentError || isSessionExpired(error)) return null;
  return { tone: 'error', title: text(error) };
}

export function successFeedback(data: unknown, meta: MutationMeta | undefined, variables?: unknown): Feedback {
  if (!meta?.success || meta.silent) return null;
  const title = typeof meta.success === 'function' ? meta.success(data, variables) : meta.success;
  return title ? { tone: 'success', title } : null;
}
