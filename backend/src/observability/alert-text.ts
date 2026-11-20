import type { HealthKey } from './health-rules.js';

/** Nome de cada item da saúde nos dois idiomas (para o aviso e o e-mail do alerta). */
const TITLES: Record<'pt-BR' | 'en', Record<HealthKey, string>> = {
  'pt-BR': {
    database: 'Banco de dados',
    migrations: 'Migrações',
    storage: 'Espaço dos anexos',
    email: 'E-mail',
    email_queue: 'Fila de e-mail',
    email_secret: 'Segredo do e-mail',
    sso_secret: 'Segredo do login corporativo',
    integration_token: 'Token de integração',
    webhook_secret: 'Segredo dos webhooks',
    webhook_delivery: 'Entrega dos webhooks',
    worker: 'Worker',
    api: 'API',
  },
  en: {
    database: 'Database',
    migrations: 'Migrations',
    storage: 'Attachment space',
    email: 'Email',
    email_queue: 'Email queue',
    email_secret: 'Email secret',
    sso_secret: 'Corporate sign-in secret',
    integration_token: 'Integration token',
    webhook_secret: 'Webhook secret',
    webhook_delivery: 'Webhook delivery',
    worker: 'Worker',
    api: 'API',
  },
};

const localeOf = (locale: string) => (locale === 'en' ? 'en' : 'pt-BR');

export function healthTitles(keys: readonly string[], locale: string): string {
  const titles = TITLES[localeOf(locale)] as Record<string, string>;
  return keys.map((key) => titles[key] ?? key).join(', ');
}

export interface AlertEmailInput {
  name: string;
  organization: string;
  failed: readonly string[];
  recovered: readonly string[];
  /** Endereço da tela de observabilidade; vazio se a instalação não tem o endereço do sistema. */
  link: string;
}

/**
 * O e-mail do alerta de saúde (RN-94). Texto fixo, não editável: um aviso operacional não deve
 * quebrar por causa de uma edição de modelo, e sai na hora, fora do resumo diário.
 */
export function alertEmail(locale: string, input: AlertEmailInput): { subject: string; body: string } {
  const en = localeOf(locale) === 'en';
  const list = (keys: readonly string[]) => keys.map((key) => `- ${healthTitles([key], locale)}`).join('\n');
  const lines: string[] = [en ? `Hello, ${input.name}.` : `Olá, ${input.name}.`, ''];
  if (input.failed.length > 0) {
    lines.push(en ? 'Health alert, items failing:' : 'Alerta de saúde, itens em falha:', list(input.failed), '');
  }
  if (input.recovered.length > 0) {
    lines.push(en ? 'Back to normal:' : 'Voltaram ao normal:', list(input.recovered), '');
  }
  if (input.link) lines.push(en ? `Details and what to do: ${input.link}` : `Detalhes e o que fazer: ${input.link}`);

  const what =
    input.failed.length > 0
      ? `${en ? 'failure in' : 'falha em'} ${healthTitles(input.failed, locale)}`
      : `${healthTitles(input.recovered, locale)} ${en ? 'back to normal' : 'voltou ao normal'}`;
  const subject = `${en ? 'Health alert' : 'Alerta de saúde'}: ${what} | ${input.organization}`;
  return { subject: subject.replace(/[\r\n]+/g, ' ').trim(), body: lines.join('\n').trimEnd() };
}
