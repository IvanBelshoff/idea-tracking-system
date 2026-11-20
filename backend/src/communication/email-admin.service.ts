import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import { parseServiceAccount } from '../common/google.js';
import { type PageQuery, pageMeta } from '../common/pagination.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { User } from '../identity-access/entities/user.entity.js';
import { getSetting } from '../organization/settings.service.js';
import type { EmailLogPage, ProviderInput, ProviderView, TemplateView, TestEmailResult } from './communication.dto.js';
import {
  composeTemplateMap,
  DEFAULT_TEMPLATES,
  isTemplateKey,
  isTemplateLocale,
  oneLine,
  TEMPLATE_KEYS,
  TEMPLATE_LOCALES,
  TEMPLATE_VARIABLES,
  type TemplateKey,
  type TemplateLocale,
  unknownVariables,
} from './email-templates.js';
import { EmailLog, EmailStatus, EmailTemplate, MailProvider } from './entities.js';
import {
  composeEmail,
  defaultTransport,
  loadProvider,
  providerType,
  readConfig,
  type TransportFactory,
} from './mail.js';
import {
  configSecrets,
  type GoogleConfig,
  type GraphConfig,
  type ProviderConfig,
  type SmtpConfig,
  safeErrorMessage,
} from './mail-transport.js';
import { seal, secretKeyReady } from './secret-box.js';

interface Actor {
  userId: string;
  meta: RequestMeta;
}

/**
 * Tela "E-mail" do administrador (RN-90, RN-32, CA-RN-90.4): provedor com segredo cifrado,
 * e-mail de teste, ligar e desligar o envio, modelos e envios com falha. Só com `email.manage`.
 */
@Injectable()
export class EmailAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  // --- Provedor -----------------------------------------------------------------------------------

  async provider(): Promise<ProviderView> {
    const m = this.dataSource.manager;
    const p = await loadProvider(m);
    const appUrl = await getSetting(m, 'email.app_url');
    let read: ProviderConfig | null = null;
    if (p && secretKeyReady()) {
      try {
        read = readConfig(p);
      } catch {
        read = null; // chave trocada: a tela pede para cadastrar de novo
      }
    }
    const smtp = read?.type === 'smtp' ? read.config : null;
    const graph = read?.type === 'microsoft_graph' ? read.config : null;
    const google = read?.type === 'google_workspace' ? read.config : null;
    return {
      configured: p !== null,
      type: p ? providerType(p) : 'smtp',
      host: smtp?.host ?? null,
      port: smtp?.port ?? null,
      security: smtp?.security ?? null,
      username: smtp?.username ?? null,
      passwordSet: Boolean(smtp?.password),
      tenantId: graph?.tenantId ?? null,
      clientId: graph?.clientId ?? null,
      clientSecretSet: Boolean(graph?.clientSecret),
      mailboxId: graph?.mailboxId ?? null,
      replyTo: graph?.replyTo ?? google?.replyTo ?? null,
      serviceAccountEmail: google?.clientEmail ?? null,
      serviceAccountKeySet: Boolean(google?.privateKey),
      secretExpiresOn: p?.secretExpiresOn ?? null,
      fromAddress: p?.fromAddress ?? null,
      fromName: p?.fromName ?? null,
      active: p?.active ?? false,
      lastTestAt: p?.lastTestAt?.toISOString() ?? null,
      lastTestOk: p?.lastTestOk ?? null,
      lastTestError: p?.lastTestError ?? null,
      secretKeyReady: secretKeyReady(),
      appUrl,
    };
  }

  /**
   * Grava o provedor (SMTP ou Microsoft). Qualquer mudança, inclusive trocar o tipo, desliga o envio e
   * exige novo teste (CA-RN-90.1, CA-RN-99.4). O segredo (senha ou segredo do cliente) só é trocado quando
   * enviado; nunca vai para a auditoria nem volta na resposta (CA-RN-90.3, CA-RN-99.2).
   */
  async saveProvider(actor: Actor, input: ProviderInput): Promise<ProviderView> {
    if (!secretKeyReady()) {
      throw apiError(503, 'secret_key_missing', 'Defina APP_SECRET_KEY no servidor antes de cadastrar o provedor.');
    }
    await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(MailProvider);
      const existing = await loadProvider(m);
      let previous: ProviderConfig | null = null;
      if (existing) {
        try {
          previous = readConfig(existing);
        } catch {
          previous = null;
        }
      }

      let config: SmtpConfig | GraphConfig | GoogleConfig;
      let secretExpiresOn: string | null = null;
      let auditData: Record<string, unknown>;
      let name: string;
      let credentialChanged: boolean;
      if (input.type === 'microsoft_graph') {
        const before = previous?.type === 'microsoft_graph' ? previous.config : null;
        const clientSecret =
          input.clientSecret === undefined ? (before?.clientSecret ?? '') : (input.clientSecret ?? '');
        if (clientSecret === '') {
          throw apiError(422, 'client_secret_required', 'Informe o segredo do cliente da Microsoft.');
        }
        credentialChanged =
          input.clientSecret !== undefined && input.clientSecret !== null && input.clientSecret !== '';
        config = {
          tenantId: input.tenantId,
          clientId: input.clientId,
          clientSecret,
          mailboxId: input.mailboxId || null,
          replyTo: input.replyTo || null,
        } satisfies GraphConfig;
        // Trocar o segredo sem informar a nova validade apaga a data antiga (era a do segredo antigo; RN-100).
        secretExpiresOn =
          input.secretExpiresOn !== undefined
            ? input.secretExpiresOn
            : credentialChanged
              ? null
              : (existing?.secretExpiresOn ?? null);
        name = 'Microsoft 365';
        // `expiresOn`: a auditoria descarta qualquer chave com "secret" no nome.
        auditData = {
          type: input.type,
          tenantId: input.tenantId,
          fromAddress: input.fromAddress,
          expiresOn: secretExpiresOn,
        };
      } else if (input.type === 'google_workspace') {
        const before = previous?.type === 'google_workspace' ? previous.config : null;
        // Ausente = manter a chave gravada; nulo ou vazio = apagar (e então é preciso colar outra).
        let key = before ? { clientEmail: before.clientEmail, privateKey: before.privateKey } : null;
        credentialChanged = false;
        if (input.serviceAccountJson !== undefined) {
          key = input.serviceAccountJson ? parseServiceAccount(input.serviceAccountJson) : null;
          if (input.serviceAccountJson && !key) {
            throw apiError(
              422,
              'invalid_service_account',
              'O arquivo JSON não é uma chave de conta de serviço do Google válida.',
            );
          }
          credentialChanged = key !== null;
        }
        if (!key)
          throw apiError(422, 'service_account_required', 'Informe a chave JSON da conta de serviço do Google.');
        config = { clientEmail: key.clientEmail, privateKey: key.privateKey, replyTo: input.replyTo || null };
        // Trocar a chave sem informar a nova validade apaga a data antiga (era a da chave antiga; RN-100).
        secretExpiresOn =
          input.secretExpiresOn !== undefined
            ? input.secretExpiresOn
            : credentialChanged
              ? null
              : (existing?.secretExpiresOn ?? null);
        name = 'Google Workspace';
        auditData = {
          type: input.type,
          serviceAccountEmail: key.clientEmail,
          fromAddress: input.fromAddress,
          expiresOn: secretExpiresOn,
        };
      } else {
        const before = previous?.type === 'smtp' ? previous.config : null;
        const password = input.password === undefined ? (before?.password ?? null) : input.password || null;
        credentialChanged = input.password !== undefined;
        config = {
          host: input.host,
          port: input.port,
          security: input.security,
          username: input.username || null,
          password,
        } satisfies SmtpConfig;
        name = 'SMTP';
        auditData = { type: input.type, host: input.host, port: input.port, security: input.security };
      }
      const values = {
        type: input.type,
        name,
        configEncrypted: seal(JSON.stringify(config)),
        fromAddress: input.fromAddress,
        fromName: input.type === 'microsoft_graph' ? null : input.fromName || null,
        secretExpiresOn,
        active: false,
        lastTestOk: null,
        lastTestError: null,
        lastTestAt: null,
        updatedById: actor.userId,
      };
      if (existing) await repo.update(existing.id, values);
      else await repo.save(repo.create(values));
      await this.audit.record(
        {
          action: 'email.provider_updated',
          actorId: actor.userId,
          targetType: 'mail_provider',
          targetId: existing?.id ?? null,
          data: {
            ...auditData,
            fromAddress: input.fromAddress,
            credentialChanged,
            wasActive: existing?.active ?? false,
          },
          ip: actor.meta.ip,
        },
        m,
      );
    });
    return this.provider();
  }

  /** E-mail de teste, enviado agora (não pela fila), para o admin ver o resultado na hora (CA-RN-90.2, CA-RN-99.3). */
  async sendTest(
    actor: Actor,
    to: string,
    transportFor: TransportFactory = defaultTransport,
  ): Promise<TestEmailResult> {
    const m = this.dataSource.manager;
    const p = await loadProvider(m);
    if (!p) throw apiError(409, 'provider_missing', 'Cadastre o provedor de e-mail antes de testar.');
    let config: ProviderConfig;
    try {
      config = readConfig(p);
    } catch {
      throw apiError(
        409,
        'provider_unreadable',
        'A configuração gravada não pôde ser lida; cadastre o provedor de novo.',
      );
    }
    const user = await m.getRepository(User).findOneByOrFail({ id: actor.userId });
    const email = await composeEmail(m, 'test', user.locale, { name: user.name });
    let error: string | null = null;
    try {
      await transportFor(config).send({
        from: { name: p.fromName, address: p.fromAddress },
        to,
        subject: email.subject,
        text: email.body,
      });
    } catch (e) {
      error = safeErrorMessage(e, configSecrets(config));
    }
    await m
      .getRepository(MailProvider)
      .update(p.id, { lastTestAt: new Date(), lastTestOk: error === null, lastTestError: error });
    await this.audit.record({
      action: 'email.test_sent',
      actorId: actor.userId,
      targetType: 'mail_provider',
      targetId: p.id,
      data: { ok: error === null, type: providerType(p) },
      ip: actor.meta.ip,
    });
    return { ok: error === null, error };
  }

  /** Liga o envio: só depois de um teste bem-sucedido e com o endereço do sistema definido. */
  async activate(actor: Actor): Promise<ProviderView> {
    await this.dataSource.transaction(async (m) => {
      const p = await loadProvider(m);
      if (!p) throw apiError(409, 'provider_missing', 'Cadastre o provedor de e-mail antes de ligar o envio.');
      if (p.lastTestOk !== true) {
        throw apiError(409, 'email_test_required', 'Envie um e-mail de teste com sucesso antes de ligar o envio.');
      }
      if (!(await getSetting(m, 'email.app_url'))) {
        throw apiError(
          409,
          'app_url_required',
          'Defina o endereço do sistema (usado nos links dos e-mails) antes de ligar o envio.',
        );
      }
      await m.getRepository(MailProvider).update(p.id, { active: true, updatedById: actor.userId });
      await this.recordToggle(m, actor, p.id, 'email.activated');
    });
    return this.provider();
  }

  async deactivate(actor: Actor): Promise<ProviderView> {
    await this.dataSource.transaction(async (m) => {
      const p = await loadProvider(m);
      if (!p?.active) return;
      await m.getRepository(MailProvider).update(p.id, { active: false, updatedById: actor.userId });
      await this.recordToggle(m, actor, p.id, 'email.deactivated');
    });
    return this.provider();
  }

  private recordToggle(m: EntityManager, actor: Actor, id: string, action: string) {
    return this.audit.record(
      { action, actorId: actor.userId, targetType: 'mail_provider', targetId: id, ip: actor.meta.ip },
      m,
    );
  }

  // --- Modelos ------------------------------------------------------------------------------------

  async templates(): Promise<TemplateView[]> {
    const stored = composeTemplateMap(await this.dataSource.getRepository(EmailTemplate).find());
    return TEMPLATE_KEYS.flatMap((key) =>
      TEMPLATE_LOCALES.map((locale) => {
        const custom = stored.get(`${key}:${locale}`);
        const text = custom ?? DEFAULT_TEMPLATES[key][locale];
        return { key, locale, ...text, customized: custom !== undefined, variables: [...TEMPLATE_VARIABLES[key]] };
      }),
    );
  }

  private assertTemplate(key: string, locale: string): asserts key is TemplateKey {
    if (!isTemplateKey(key) || !isTemplateLocale(locale)) throw apiError(404, 'not_found', 'Modelo não encontrado.');
  }

  /** Variável que o modelo não conhece é recusada (CA-RN-32.1). Vale no próximo envio. */
  async saveTemplate(
    actor: Actor,
    key: string,
    locale: string,
    input: { subject: string; body: string },
  ): Promise<TemplateView[]> {
    this.assertTemplate(key, locale);
    const unknown = unknownVariables(key, input.subject, input.body);
    if (unknown.length > 0) {
      throw apiError(
        422,
        'unknown_variable',
        `Variável não disponível neste modelo: ${unknown.join(', ')}.`,
        unknown.map((name) => ({ variable: name, allowed: TEMPLATE_VARIABLES[key] })),
      );
    }
    await this.dataSource.transaction(async (m) => {
      await m.getRepository(EmailTemplate).save(
        m.getRepository(EmailTemplate).create({
          key,
          locale: locale as TemplateLocale,
          subject: oneLine(input.subject),
          body: input.body,
          updatedById: actor.userId,
        }),
      );
      await this.audit.record(
        {
          action: 'email.template_updated',
          actorId: actor.userId,
          targetType: 'email_template',
          targetId: `${key}:${locale}`,
          ip: actor.meta.ip,
        },
        m,
      );
    });
    return this.templates();
  }

  async resetTemplate(actor: Actor, key: string, locale: string): Promise<TemplateView[]> {
    this.assertTemplate(key, locale);
    await this.dataSource.transaction(async (m) => {
      const result = await m.getRepository(EmailTemplate).delete({ key, locale });
      if (result.affected) {
        await this.audit.record(
          {
            action: 'email.template_reset',
            actorId: actor.userId,
            targetType: 'email_template',
            targetId: `${key}:${locale}`,
            ip: actor.meta.ip,
          },
          m,
        );
      }
    });
    return this.templates();
  }

  // --- Envios -------------------------------------------------------------------------------------

  async log(query: PageQuery & { status?: 'pending' | 'sent' | 'failed' }): Promise<EmailLogPage> {
    const [rows, total] = await this.dataSource.getRepository(EmailLog).findAndCount({
      where: query.status ? { status: query.status as EmailStatus } : {},
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        toAddress: r.toAddress,
        subject: r.subject,
        status: r.status,
        attempts: r.attempts,
        lastError: r.lastError,
        createdAt: r.createdAt.toISOString(),
        sentAt: r.sentAt?.toISOString() ?? null,
      })),
      meta: pageMeta(query, total),
    };
  }

  /** "Tentar de novo": volta para a fila de saída com as tentativas zeradas. */
  async retry(actor: Actor, id: string): Promise<void> {
    const repo = this.dataSource.getRepository(EmailLog);
    const log = await repo.findOneBy({ id });
    if (!log) throw apiError(404, 'not_found', 'Envio não encontrado.');
    if (log.status !== EmailStatus.Failed)
      throw apiError(409, 'not_failed', 'Só envios com falha podem ser repetidos.');
    await repo.update(
      { id, status: EmailStatus.Failed },
      { status: EmailStatus.Pending, attempts: 0, queuedAt: null, lastError: null },
    );
    await this.audit.record({
      action: 'email.retry_requested',
      actorId: actor.userId,
      targetType: 'email_log',
      targetId: id,
      ip: actor.meta.ip,
    });
  }
}
