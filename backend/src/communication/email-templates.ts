/**
 * Modelos de e-mail (RN-32): textos de fábrica em pt-BR e en, variáveis permitidas por modelo e a
 * troca das variáveis. Texto puro, sem HTML: nada do que o admin escreve vira código no e-mail.
 */

export const TEMPLATE_KEYS = [
  'digest',
  'password_reset',
  'test',
  'approval_request',
  'approval_code',
  'approval_reminder',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_LOCALES = ['pt-BR', 'en'] as const;
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number];

/** Língua de reserva quando o idioma da pessoa não tem modelo (CA-RN-32.1). */
export const FALLBACK_LOCALE: TemplateLocale = 'pt-BR';

export function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function isTemplateLocale(value: string): value is TemplateLocale {
  return (TEMPLATE_LOCALES as readonly string[]).includes(value);
}

export const TEMPLATE_VARIABLES: Record<TemplateKey, readonly string[]> = {
  digest: ['name', 'organization', 'count', 'items', 'link'],
  password_reset: ['name', 'organization', 'link', 'minutes'],
  test: ['name', 'organization'],
  approval_request: ['name', 'organization', 'requester', 'area', 'idea', 'summary', 'due', 'link'],
  approval_code: ['name', 'organization', 'code', 'minutes'],
  approval_reminder: ['name', 'organization', 'idea', 'due', 'link'],
};

export interface TemplateText {
  subject: string;
  body: string;
}

export const DEFAULT_TEMPLATES: Record<TemplateKey, Record<TemplateLocale, TemplateText>> = {
  approval_reminder: {
    'pt-BR': {
      subject: 'Lembrete: aprovação até {{due}} | {{organization}}',
      body: [
        'Olá, {{name}}.',
        '',
        'A equipe de melhoria de {{organization}} ainda aguarda a sua resposta sobre esta ideia:',
        '',
        '{{idea}}',
        '',
        'Para aprovar ou não, abra o link abaixo até {{due}}. Ele substitui o link do e-mail anterior e vale uma vez só:',
        '',
        '{{link}}',
      ].join('\n'),
    },
    en: {
      subject: 'Reminder: approval by {{due}} | {{organization}}',
      body: [
        'Hello, {{name}}.',
        '',
        'The {{organization}} improvement team is still waiting for your answer about this idea:',
        '',
        '{{idea}}',
        '',
        'To approve it or not, open the link below by {{due}}. It replaces the link of the previous email and works only once:',
        '',
        '{{link}}',
      ].join('\n'),
    },
  },
  approval_code: {
    'pt-BR': {
      subject: 'Seu código de confirmação | {{organization}}',
      body: [
        'Olá, {{name}}.',
        '',
        'Use este código para confirmar a sua resposta ao pedido de aprovação:',
        '',
        '{{code}}',
        '',
        'Ele vale por {{minutes}} minutos. Se não foi você que pediu, ignore este e-mail.',
      ].join('\n'),
    },
    en: {
      subject: 'Your confirmation code | {{organization}}',
      body: [
        'Hello, {{name}}.',
        '',
        'Use this code to confirm your answer to the approval request:',
        '',
        '{{code}}',
        '',
        'It is valid for {{minutes}} minutes. If you did not ask for it, ignore this email.',
      ].join('\n'),
    },
  },
  approval_request: {
    'pt-BR': {
      subject: 'Aprovação pedida: {{idea}} | {{organization}}',
      body: [
        'Olá, {{name}}.',
        '',
        '{{requester}}, da equipe de melhoria de {{organization}}, pede a sua aprovação, como responsável por {{area}}, para esta ideia:',
        '',
        '{{idea}}',
        '',
        '{{summary}}',
        '',
        'Para aprovar ou não, abra o link abaixo até {{due}}. Ele é pessoal e vale uma vez só:',
        '',
        '{{link}}',
        '',
        'Se você não reconhece este pedido, ignore este e-mail.',
      ].join('\n'),
    },
    en: {
      subject: 'Approval requested: {{idea}} | {{organization}}',
      body: [
        'Hello, {{name}}.',
        '',
        '{{requester}}, from the {{organization}} improvement team, asks for your approval, as the person responsible for {{area}}, for this idea:',
        '',
        '{{idea}}',
        '',
        '{{summary}}',
        '',
        'To approve it or not, open the link below by {{due}}. It is personal and works only once:',
        '',
        '{{link}}',
        '',
        'If you do not recognize this request, ignore this email.',
      ].join('\n'),
    },
  },
  digest: {
    'pt-BR': {
      subject: 'Resumo do dia: {{count}} aviso(s) | {{organization}}',
      body: [
        'Olá, {{name}}.',
        '',
        'Estes são os seus avisos desde o último resumo:',
        '',
        '{{items}}',
        '',
        'Veja todos em {{link}}',
        '',
        'Você recebe este resumo no máximo uma vez por dia. Para escolher o que chega por e-mail, abra Minha conta > Notificações.',
      ].join('\n'),
    },
    en: {
      subject: 'Daily summary: {{count}} notice(s) | {{organization}}',
      body: [
        'Hello, {{name}}.',
        '',
        'These are your notices since the last summary:',
        '',
        '{{items}}',
        '',
        'See them all at {{link}}',
        '',
        'You get this summary at most once a day. To choose what arrives by email, open My account > Notifications.',
      ].join('\n'),
    },
  },
  password_reset: {
    'pt-BR': {
      subject: 'Redefinir sua senha | {{organization}}',
      body: [
        'Olá, {{name}}.',
        '',
        'Recebemos um pedido para redefinir a sua senha. Para criar uma nova, abra o link abaixo em até {{minutes}} minutos:',
        '',
        '{{link}}',
        '',
        'Se não foi você, ignore este e-mail: a sua senha continua a mesma.',
      ].join('\n'),
    },
    en: {
      subject: 'Reset your password | {{organization}}',
      body: [
        'Hello, {{name}}.',
        '',
        'We received a request to reset your password. To create a new one, open the link below within {{minutes}} minutes:',
        '',
        '{{link}}',
        '',
        'If it was not you, ignore this email: your password stays the same.',
      ].join('\n'),
    },
  },
  test: {
    'pt-BR': {
      subject: 'E-mail de teste | {{organization}}',
      body: [
        'Este é um e-mail de teste do acompanhamento de ideias de {{organization}}.',
        '',
        'Se você o recebeu, o envio está funcionando.',
        '',
        'Enviado por {{name}}.',
      ].join('\n'),
    },
    en: {
      subject: 'Test email | {{organization}}',
      body: [
        'This is a test email from the {{organization}} idea tracking system.',
        '',
        'If you received it, sending works.',
        '',
        'Sent by {{name}}.',
      ].join('\n'),
    },
  },
};

const TOKEN = /\{\{([^{}]*)\}\}/g;

/** Variáveis usadas no texto que o modelo não conhece (recusadas na gravação, CA-RN-32.1). */
export function unknownVariables(key: TemplateKey, ...texts: string[]): string[] {
  const allowed = new Set(TEMPLATE_VARIABLES[key]);
  const unknown = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(TOKEN)) {
      const name = (match[1] ?? '').trim();
      if (!allowed.has(name)) unknown.add(name || '(vazia)');
    }
  }
  return [...unknown];
}

/** Troca `{{variavel}}` pelo valor. */
export function renderText(text: string, vars: Record<string, string | number>): string {
  return text.replace(TOKEN, (whole, raw: string) => {
    const value = vars[raw.trim()];
    return value === undefined ? whole : String(value);
  });
}

/** Assunto numa linha só: quebra de linha no assunto abriria espaço para injetar cabeçalhos. */
export function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Escolhe o texto: o editado no idioma da pessoa, o de fábrica nesse idioma, e por fim o pt-BR
 * (editado ou de fábrica).
 */
export function resolveTemplate(
  key: TemplateKey,
  locale: string,
  stored: ReadonlyMap<string, TemplateText>,
): TemplateText {
  const pick = (l: string) =>
    stored.get(`${key}:${l}`) ?? (isTemplateLocale(l) ? DEFAULT_TEMPLATES[key][l] : undefined);
  return pick(locale) ?? pick(FALLBACK_LOCALE) ?? DEFAULT_TEMPLATES[key][FALLBACK_LOCALE];
}

/** Linhas editadas do banco → mapa `chave:idioma` para `resolveTemplate`. */
export function composeTemplateMap(
  rows: readonly { key: string; locale: string; subject: string; body: string }[],
): Map<string, TemplateText> {
  return new Map(rows.map((r) => [`${r.key}:${r.locale}`, { subject: r.subject, body: r.body }]));
}

export function renderTemplate(template: TemplateText, vars: Record<string, string | number>): TemplateText {
  return { subject: oneLine(renderText(template.subject, vars)), body: renderText(template.body, vars) };
}
