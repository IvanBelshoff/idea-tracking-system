import type { TFunction } from 'i18next';
import { i18n } from '@/i18n';
import { type Translate, type ValidationDetail, validationText } from '@/lib/server-text';
import type { components } from './schema';

type ApiErrorBody = components['schemas']['ApiErrorBody'];

/** Erro da API no formato único `{ code, message, details }` (backend: common/api-error.ts). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Resultado do openapi-fetch → dado, ou lança ApiError. Falha de rede vira `network`. */
export async function unwrap<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch {
    throw new ApiError(0, 'network', 'Falha de rede');
  }
  if (result.response.ok) return result.data as T;
  const body = (result.error ?? {}) as Partial<ApiErrorBody>;
  throw new ApiError(result.response.status, body.code ?? 'unknown', body.message ?? '', body.details);
}

/** Texto para a pessoa, no idioma da interface: traduz pelo `code`; senão, mensagem genérica. */
export function errorText(t: TFunction, error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'unknown';
  const key = `errors.${code}`;
  const translated = t(key as never);
  return translated === key ? t('errors.unknown') : (translated as string);
}

/**
 * Detalhes de validação do backend por campo (`details: [{ path, code, message, … }]`), no idioma da
 * tela: em pt-BR, o texto do servidor; nos outros, a mensagem pelo tipo do erro e o limite (M28).
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const t = i18n.t.bind(i18n) as unknown as Translate;
  return Object.fromEntries(
    (error.details as ValidationDetail[])
      .filter((d) => d.path ?? d.key)
      .map((d) => [d.path ?? d.key ?? '', validationText(t, i18n.language, d)]),
  );
}
