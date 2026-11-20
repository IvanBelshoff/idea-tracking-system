import type { DataSource, EntityManager } from 'typeorm';
import { getSetting } from '../organization/settings.service.js';
import {
  composeTemplateMap,
  renderTemplate,
  resolveTemplate,
  type TemplateKey,
  type TemplateText,
} from './email-templates.js';
import { EmailLog, EmailStatus, EmailTemplate, MailProvider } from './entities.js';
import { googleTransport } from './mail-google.js';
import { graphTransport } from './mail-graph.js';
import {
  configSecrets,
  type GoogleConfig,
  type GraphConfig,
  type MailErrorCode,
  type MailProviderType,
  MailSendError,
  type MailTransport,
  mailErrorText,
  type ProviderConfig,
  type SmtpConfig,
  safeErrorMessage,
  smtpTransport,
} from './mail-transport.js';
import { open, seal } from './secret-box.js';

/**
 * Núcleo do e-mail, usado pela API e pelo worker: provedor, modelos, fila de saída (`email_log`)
 * e a entrega com novas tentativas (CA-RN-90.4).
 */

/** Tentativas por e-mail antes de ficar `failed` (1 + 4 novas tentativas com espera crescente). */
export const MAX_ATTEMPTS = 5;

export type TransportFactory = (provider: ProviderConfig) => MailTransport;

/** O adaptador do tipo do provedor (RN-90, RN-99). */
export const defaultTransport: TransportFactory = (p) => {
  if (p.type === 'microsoft_graph') return graphTransport(p.config);
  if (p.type === 'google_workspace') return googleTransport(p.config);
  return smtpTransport(p.config);
};

/** Na v1 há um único provedor. */
export function loadProvider(m: EntityManager): Promise<MailProvider | null> {
  return m.getRepository(MailProvider).findOne({ where: {}, order: { createdAt: 'ASC' } });
}

/** Lê e abre a configuração cifrada; o `type` da linha diz qual é o formato. */
export function readConfig(provider: MailProvider): ProviderConfig {
  const config: unknown = JSON.parse(open(provider.configEncrypted));
  if (provider.type === 'microsoft_graph') return { type: 'microsoft_graph', config: config as GraphConfig };
  if (provider.type === 'google_workspace') return { type: 'google_workspace', config: config as GoogleConfig };
  return { type: 'smtp', config: config as SmtpConfig };
}

/** O tipo gravado na linha, com `smtp` para qualquer valor desconhecido. */
export const providerType = (provider: Pick<MailProvider, 'type'>): MailProviderType =>
  provider.type === 'microsoft_graph' || provider.type === 'google_workspace' ? provider.type : 'smtp';

/** Envio ligado na instalação (CA-RN-90.1: começa desligado). */
export async function isEmailActive(m: EntityManager): Promise<boolean> {
  return (await m.getRepository(MailProvider).countBy({ active: true })) > 0;
}

export async function loadTemplate(m: EntityManager, key: TemplateKey, locale: string): Promise<TemplateText> {
  const rows = await m.getRepository(EmailTemplate).findBy({ key });
  return resolveTemplate(key, locale, composeTemplateMap(rows));
}

export async function composeEmail(
  m: EntityManager,
  key: TemplateKey,
  locale: string,
  vars: Record<string, string | number>,
): Promise<TemplateText> {
  const organization = await getSetting(m, 'organization.name');
  return renderTemplate(await loadTemplate(m, key, locale), { organization, ...vars });
}

/** Põe um e-mail na fila de saída. Não envia: quem envia é o worker (não bloqueia a requisição). */
export async function queueEmail(
  m: EntityManager,
  e: { kind: string; userId: string | null; to: string; subject: string; body: string },
): Promise<EmailLog> {
  const repo = m.getRepository(EmailLog);
  return repo.save(
    repo.create({
      kind: e.kind,
      userId: e.userId,
      toAddress: e.to,
      subject: e.subject.slice(0, 300),
      bodyEncrypted: seal(e.body),
      status: EmailStatus.Pending,
      attempts: 0,
      lastError: null,
      queuedAt: null,
      sentAt: null,
    }),
  );
}

export type DeliveryOutcome = 'sent' | 'retry' | 'failed' | 'skipped';

/**
 * Uma tentativa de entrega. Falhou e ainda há tentativas: fica pendente com o erro e devolve
 * `retry` (o job lança erro e o pg-boss repete com espera crescente). Esgotou: `failed`, com o
 * último erro visível ao admin. Já enviado ou fora da fila: `skipped` (reexecução não reenvia).
 */
export async function deliverEmail(
  ds: DataSource,
  id: string,
  transportFor: TransportFactory = defaultTransport,
): Promise<DeliveryOutcome> {
  const logs = ds.getRepository(EmailLog);
  const log = await logs.findOneBy({ id });
  if (!log || log.status !== EmailStatus.Pending) return 'skipped';

  const fail = async (code: MailErrorCode): Promise<DeliveryOutcome> => {
    await logs.update(id, { status: EmailStatus.Failed, lastError: mailErrorText(code) });
    return 'failed';
  };

  const provider = await loadProvider(ds.manager);
  if (!provider?.active) return fail('mail_disabled');
  let config: ProviderConfig;
  let body: string;
  try {
    config = readConfig(provider);
    body = open(log.bodyEncrypted);
  } catch {
    return fail('config_unreadable');
  }

  const attempts = log.attempts + 1;
  try {
    await transportFor(config).send({
      from: { name: provider.fromName, address: provider.fromAddress },
      to: log.toAddress,
      subject: log.subject,
      text: body,
    });
    await logs.update(id, { status: EmailStatus.Sent, attempts, sentAt: new Date(), lastError: null });
    return 'sent';
  } catch (error) {
    const message = safeErrorMessage(error, configSecrets(config));
    // Erro permanente (credencial recusada, sem permissão, caixa inexistente): repetir não adianta (CA-RN-99.7).
    const permanent = error instanceof MailSendError && error.permanent;
    if (permanent || attempts >= MAX_ATTEMPTS) {
      await logs.update(id, { status: EmailStatus.Failed, attempts, lastError: message });
      return 'failed';
    }
    await logs.update(id, { attempts, lastError: message });
    return 'retry';
  }
}
