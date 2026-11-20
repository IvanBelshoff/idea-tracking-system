/**
 * Textos que chegam do servidor como código (M28): a tela os traduz no idioma de quem lê, em vez de
 * mostrar a frase em português do backend ou o código cru. Funções puras: recebem o `t` do i18next.
 */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** `código` ou `código: detalhe` (o detalhe técnico não se traduz). Texto livre → nulo. */
export function splitCoded(raw: string): { code: string; detail: string | null } | null {
  const match = /^([a-z][a-z0-9_]*)(?:: ([\s\S]+))?$/.exec(raw.trim());
  return match?.[1] ? { code: match[1], detail: match[2] ?? null } : null;
}

/** Traduz pela chave; sem tradução, devolve o texto como chegou (registro antigo, gravado antes dos códigos). */
function byKey(t: Translate, key: string, raw: string, options?: Record<string, unknown>): string {
  const text = t(key, options);
  return text === key ? raw : text;
}

/** Falha do envio de e-mail (último teste, resultado do teste, registro de envios). */
export function mailErrorText(t: Translate, raw: string | null | undefined): string {
  if (!raw) return '';
  const parts = splitCoded(raw);
  if (!parts) return raw;
  return byKey(t, `errors.mail.${parts.code}`, raw, { detail: parts.detail ?? '' });
}

/** Falha da entrega de um webhook (`http_503`, `dns`, `timeout`…). */
export function webhookErrorText(t: Translate, raw: string | null | undefined): string {
  if (!raw) return '';
  const http = /^http_(\d{3})$/.exec(raw);
  if (http) return t('errors.webhook.http', { status: http[1] });
  return byKey(t, `errors.webhook.${raw}`, raw);
}

/** Um item de `details` do erro de validação (backend: common/api-error.ts, parseInput). */
export interface ValidationDetail {
  path?: string;
  key?: string;
  code?: string;
  message?: string;
  origin?: string;
  minimum?: number;
  maximum?: number;
}

/**
 * Mensagem de um campo recusado pelo servidor. Em português vale o texto do servidor (as regras e o Zod
 * do backend escrevem em pt-BR). Nos outros idiomas, a mensagem vem do tipo do erro e do limite.
 */
export function validationText(t: Translate, lang: string, detail: ValidationDetail): string {
  if (lang === 'pt-BR' && detail.message) return detail.message;
  const { code } = detail;
  if (code === 'too_small' || code === 'too_big') {
    const limit = code === 'too_small' ? detail.minimum : detail.maximum;
    if (typeof limit === 'number' && Number.isFinite(limit)) {
      const kind =
        detail.origin === 'string'
          ? 'string'
          : detail.origin === 'array' || detail.origin === 'set'
            ? 'array'
            : 'number';
      return t(`errors.validation.${code}.${kind}`, { count: limit });
    }
  }
  if (code === 'invalid_type' || code === 'invalid_format' || code === 'invalid_value') {
    return t(`errors.validation.${code}`);
  }
  return t('errors.validation.invalid');
}
