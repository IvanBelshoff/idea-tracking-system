import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, In } from 'typeorm';
import { AuditService } from '../../audit/audit.service.js';
import { apiError } from '../../common/api-error.js';
import { daysAgo, todayInZone } from '../../common/dates.js';
import type { RequestMeta } from '../../identity-access/auth-context.js';
import { secretVerdict } from '../../observability/secret-expiry.js';
import { OrgEntity } from '../../organization/entities/org-entity.entity.js';
import { SettingsService } from '../../organization/settings.service.js';
import { Integration, IntegrationHour, IntegrationScope, IntegrationToken } from '../entities.js';
import { IntegrationUsageService } from '../integration-usage.service.js';
import { normalizeIpList } from '../ip-rules.js';
import {
  enableBlockers,
  INTEGRATION_LIMITS,
  INTEGRATION_MODULES,
  type IntegrationModuleId,
  isWriteModule,
  normalizeModules,
  SENSITIVE_MODULES,
} from '../modules.js';
import {
  checkExpiry,
  countActiveTokens,
  healthExpiry,
  isTokenValid,
  newIntegrationToken,
  retireAtFor,
  tokenState,
} from '../token-rules.js';
import type {
  IntegrationCreateInput,
  IntegrationExpiryView,
  IntegrationsView,
  IntegrationUpdateInput,
  IntegrationUsageView,
  IntegrationView,
  IntegrationWithToken,
} from './integration-admin.dto.js';

interface Actor {
  userId: string;
  meta: RequestMeta;
}

const UNIQUE_VIOLATION = '23505';

/**
 * Integrações, lado do administrador (permissão `integration.manage`): chave geral, módulos,
 * integrações e tokens (RN-102 a RN-104). Toda alteração valida aqui e é auditada na mesma
 * transação (RN-114); o token só existe em claro na resposta de quem o cria ou gira.
 */
@Injectable()
export class IntegrationAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly usage: IntegrationUsageService,
  ) {}

  // --- Leitura -------------------------------------------------------------------------------

  async view(m: EntityManager = this.dataSource.manager): Promise<IntegrationsView> {
    const [enabled, enabledModules, appUrl, timeZone] = await Promise.all([
      this.settings.get('integration.enabled', m),
      this.settings.get('integration.modules', m),
      this.settings.get('email.app_url', m),
      this.settings.get('organization.timezone', m),
    ]);
    const rows = await m.getRepository(Integration).find({ order: { name: 'ASC' } });
    const integrations = await this.loadViews(m, rows, timeZone);
    const entities: { id: string; name: string; parent_id: string | null }[] = await m.query(
      'SELECT id, name, parent_id FROM entity ORDER BY name',
    );
    const base = appUrl.trim().replace(/\/+$/, '');
    return {
      enabled,
      appUrl,
      baseUrl: base ? `${base}/integration/v1` : null,
      blockers: enableBlockers(appUrl),
      modules: INTEGRATION_MODULES.map((id) => ({
        id,
        enabled: enabledModules.includes(id),
        sensitive: SENSITIVE_MODULES.includes(id),
        writes: isWriteModule(id),
      })),
      integrations,
      limits: {
        maxTokenDays: INTEGRATION_LIMITS.maxTokenDays,
        defaultRatePerMinute: INTEGRATION_LIMITS.defaultRatePerMinute,
        maxRatePerMinute: INTEGRATION_LIMITS.maxRatePerMinute,
        maxIpEntries: INTEGRATION_LIMITS.maxIpEntries,
        maxActiveTokens: INTEGRATION_LIMITS.maxActiveTokens,
        defaultOverlapHours: INTEGRATION_LIMITS.defaultOverlapHours,
        maxOverlapHours: INTEGRATION_LIMITS.maxOverlapHours,
        suggestedTokenDays: 90,
      },
      entityOptions: entities.map((e) => ({ id: e.id, name: e.name, parentId: e.parent_id })),
    };
  }

  /** O consumo por hora e por módulo dos últimos `days` dias (RN-113). Grava antes o que está em memória. */
  async usageOf(id: string, days: number): Promise<IntegrationUsageView> {
    await this.require(this.dataSource.manager, id);
    await this.usage.flush();
    const since = daysAgo(days);
    const rows = await this.dataSource
      .getRepository(IntegrationHour)
      .createQueryBuilder('h')
      .where('h.integration_id = :id', { id })
      .andWhere('h.hour >= :since', { since })
      .orderBy('h.hour', 'ASC')
      .getMany();
    const byModule = new Map<string, IntegrationUsageView['byModule'][number]>();
    const byHour = new Map<string, IntegrationUsageView['hours'][number]>();
    for (const r of rows) {
      const mod = byModule.get(r.module) ?? {
        module: r.module,
        requests: 0,
        errors4xx: 0,
        errors5xx: 0,
        rateLimited: 0,
      };
      const hourKey = r.hour.toISOString();
      const hr = byHour.get(hourKey) ?? { hour: hourKey, requests: 0, errors4xx: 0, errors5xx: 0, rateLimited: 0 };
      for (const target of [mod, hr]) {
        target.requests += r.requests;
        target.errors4xx += r.errors4xx;
        target.errors5xx += r.errors5xx;
        target.rateLimited += r.rateLimited;
      }
      byModule.set(r.module, mod);
      byHour.set(hourKey, hr);
    }
    return { since: since.toISOString(), byModule: [...byModule.values()], hours: [...byHour.values()] };
  }

  // --- Chave geral e módulos (RN-102) --------------------------------------------------------

  async setEnabled({ userId, meta }: Actor, enabled: boolean): Promise<IntegrationsView> {
    await this.dataSource.transaction(async (m) => {
      const before = await this.settings.get('integration.enabled', m);
      if (enabled) {
        const blockers = enableBlockers(await this.settings.get('email.app_url', m));
        if (blockers.length > 0) {
          throw apiError(
            422,
            blockers[0] === 'app_url_required' ? 'integration_requires_app_url' : 'integration_requires_https',
            'Para ligar a API de integração, defina o endereço do sistema em HTTPS (ou localhost).',
            { blockers },
          );
        }
      }
      await this.settings.set('integration.enabled', enabled, userId, m);
      await this.audit.record(
        {
          action: 'integration.enabled_changed',
          actorId: userId,
          targetType: 'setting',
          data: { enabled, before: { enabled: before } },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.view();
  }

  async setModules({ userId, meta }: Actor, input: readonly string[]): Promise<IntegrationsView> {
    const modules = normalizeModules(input);
    if (!modules) throw apiError(422, 'invalid_modules', 'Módulo desconhecido na lista.');
    await this.dataSource.transaction(async (m) => {
      const before = await this.settings.get('integration.modules', m);
      await this.settings.set('integration.modules', modules, userId, m);
      await this.audit.record(
        {
          action: 'integration.modules_changed',
          actorId: userId,
          targetType: 'setting',
          data: { modules, before: { modules: before } },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.view();
  }

  // --- Integrações (RN-103) ------------------------------------------------------------------

  async create({ userId, meta }: Actor, input: IntegrationCreateInput): Promise<IntegrationWithToken> {
    const now = new Date();
    const expiresAt = this.expiry(input.expiresAt, now);
    const issued = newIntegrationToken();
    const id = await this.dataSource.transaction(async (m) => {
      const enabledModules = await this.settings.get('integration.modules', m);
      const modules = this.checkModules(input.modules, enabledModules, []);
      const ips = this.checkIps(input.ipAllowlist);
      await this.checkScope(m, input.scope);
      let integration: Integration;
      try {
        integration = await m.getRepository(Integration).save(
          m.getRepository(Integration).create({
            name: input.name,
            nameKey: input.name.toLowerCase(),
            owner: input.owner,
            status: 'active',
            modules,
            includeEmail: input.includeEmail,
            ratePerMinute: input.ratePerMinute,
            ipAllowlist: ips,
            createdById: userId,
          }),
        );
      } catch (error) {
        throw this.translate(error);
      }
      await this.saveScope(m, integration.id, input.scope);
      const token = await m.getRepository(IntegrationToken).save(
        m.getRepository(IntegrationToken).create({
          integrationId: integration.id,
          tokenHash: issued.hash,
          prefix: issued.prefix,
          expiresAt,
          createdById: userId,
        }),
      );
      await this.audit.record(
        {
          action: 'integration.created',
          actorId: userId,
          targetType: 'integration',
          targetId: integration.id,
          data: {
            integrationId: integration.id,
            name: integration.name,
            modules,
            includeEmail: input.includeEmail,
            scopeSize: input.scope.length,
          },
          ip: meta.ip,
        },
        m,
      );
      await this.audit.record(
        {
          action: 'integration.token_created',
          actorId: userId,
          targetType: 'integration',
          targetId: integration.id,
          data: { integrationId: integration.id, name: integration.name, prefix: token.prefix },
          ip: meta.ip,
        },
        m,
      );
      return integration.id;
    });
    return { integration: await this.viewOf(id), token: issued.token };
  }

  async update({ userId, meta }: Actor, id: string, input: IntegrationUpdateInput): Promise<IntegrationView> {
    await this.dataSource.transaction(async (m) => {
      const integration = await this.lock(m, id);
      if (integration.status === 'revoked') throw this.revokedError();
      const enabledModules = await this.settings.get('integration.modules', m);
      // Módulo que a integração já tem pode continuar mesmo desligado; só os novos precisam estar ligados.
      const modules = this.checkModules(input.modules, enabledModules, integration.modules);
      const ips = this.checkIps(input.ipAllowlist);
      await this.checkScope(m, input.scope);
      const before = {
        name: integration.name,
        modules: integration.modules,
        includeEmail: integration.includeEmail,
        ratePerMinute: integration.ratePerMinute,
      };
      try {
        await m.getRepository(Integration).update(
          { id },
          {
            name: input.name,
            nameKey: input.name.toLowerCase(),
            owner: input.owner,
            modules,
            includeEmail: input.includeEmail,
            ratePerMinute: input.ratePerMinute,
            ipAllowlist: ips,
          },
        );
      } catch (error) {
        throw this.translate(error);
      }
      await m.getRepository(IntegrationScope).delete({ integrationId: id });
      await this.saveScope(m, id, input.scope);
      await this.audit.record(
        {
          action: 'integration.updated',
          actorId: userId,
          targetType: 'integration',
          targetId: id,
          data: {
            integrationId: id,
            name: input.name,
            modules,
            includeEmail: input.includeEmail,
            ratePerMinute: input.ratePerMinute,
            scopeSize: input.scope.length,
            before,
          },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.viewOf(id);
  }

  async suspend(actor: Actor, id: string): Promise<IntegrationView> {
    return this.transition(actor, id, 'suspended', 'integration.suspended', (s) => s === 'active');
  }

  async reactivate(actor: Actor, id: string): Promise<IntegrationView> {
    return this.transition(actor, id, 'active', 'integration.reactivated', (s) => s === 'suspended');
  }

  /** Revogar é definitivo: os tokens morrem e a integração não volta (RN-103). */
  async revoke({ userId, meta }: Actor, id: string): Promise<IntegrationView> {
    await this.dataSource.transaction(async (m) => {
      const integration = await this.lock(m, id);
      if (integration.status === 'revoked') throw this.revokedError();
      const now = new Date();
      await m.getRepository(Integration).update({ id }, { status: 'revoked', revokedAt: now });
      await m
        .createQueryBuilder()
        .update(IntegrationToken)
        .set({ revokedAt: now })
        .where('integration_id = :id AND revoked_at IS NULL', { id })
        .execute();
      await this.audit.record(
        {
          action: 'integration.revoked',
          actorId: userId,
          targetType: 'integration',
          targetId: id,
          data: { integrationId: id, name: integration.name },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.viewOf(id);
  }

  // --- Tokens (RN-104) -----------------------------------------------------------------------

  /**
   * Gera um token novo. Os que valem hoje e ainda não tinham fim ganham a janela de sobreposição
   * (padrão 24 h, nunca além da validade deles); no máximo 2 tokens ativos por integração.
   */
  async rotate(
    { userId, meta }: Actor,
    id: string,
    input: { expiresAt: string; overlapHours: number },
  ): Promise<IntegrationWithToken> {
    const now = new Date();
    const expiresAt = this.expiry(input.expiresAt, now);
    const issued = newIntegrationToken();
    await this.dataSource.transaction(async (m) => {
      const integration = await this.lock(m, id);
      if (integration.status === 'revoked') throw this.revokedError();
      const tokens = await m.getRepository(IntegrationToken).findBy({ integrationId: id });
      if (countActiveTokens(tokens, now) >= INTEGRATION_LIMITS.maxActiveTokens) {
        throw apiError(
          409,
          'too_many_tokens',
          'A integração já tem 2 tokens ativos. Revogue um deles antes de gerar outro.',
        );
      }
      const current = tokens.filter((t) => isTokenValid(t, now));
      for (const t of current) {
        if (t.retireAt === null) {
          await m
            .getRepository(IntegrationToken)
            .update({ id: t.id }, { retireAt: retireAtFor(t.expiresAt, now, input.overlapHours) });
        }
      }
      const token = await m.getRepository(IntegrationToken).save(
        m.getRepository(IntegrationToken).create({
          integrationId: id,
          tokenHash: issued.hash,
          prefix: issued.prefix,
          expiresAt,
          createdById: userId,
        }),
      );
      await this.audit.record(
        {
          action: current.length > 0 ? 'integration.token_rotated' : 'integration.token_created',
          actorId: userId,
          targetType: 'integration',
          targetId: id,
          data: {
            integrationId: id,
            name: integration.name,
            prefix: token.prefix,
            overlapHours: current.length > 0 ? input.overlapHours : null,
          },
          ip: meta.ip,
        },
        m,
      );
    });
    return { integration: await this.viewOf(id), token: issued.token };
  }

  /** Revoga um token na hora (CA-RN-104.6); o outro token da integração segue valendo. */
  async revokeToken({ userId, meta }: Actor, id: string, tokenId: string): Promise<IntegrationView> {
    await this.dataSource.transaction(async (m) => {
      const integration = await this.lock(m, id);
      const token = await m.getRepository(IntegrationToken).findOneBy({ id: tokenId, integrationId: id });
      if (!token) throw apiError(404, 'not_found', 'Token não encontrado.');
      if (token.revokedAt) return;
      await m.getRepository(IntegrationToken).update({ id: tokenId }, { revokedAt: new Date() });
      await this.audit.record(
        {
          action: 'integration.token_revoked',
          actorId: userId,
          targetType: 'integration',
          targetId: id,
          data: { integrationId: id, name: integration.name, prefix: token.prefix },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.viewOf(id);
  }

  // --- Auxiliares ----------------------------------------------------------------------------

  private async transition(
    { userId, meta }: Actor,
    id: string,
    status: 'active' | 'suspended',
    action: string,
    allowed: (current: string) => boolean,
  ): Promise<IntegrationView> {
    await this.dataSource.transaction(async (m) => {
      const integration = await this.lock(m, id);
      if (integration.status === 'revoked') throw this.revokedError();
      if (!allowed(integration.status)) {
        throw apiError(409, 'invalid_state', 'A integração não está num estado que permita esta ação.');
      }
      await m.getRepository(Integration).update({ id }, { status });
      await this.audit.record(
        {
          action,
          actorId: userId,
          targetType: 'integration',
          targetId: id,
          data: { integrationId: id, name: integration.name },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.viewOf(id);
  }

  private revokedError() {
    return apiError(409, 'integration_revoked', 'A integração foi revogada e não pode mais ser alterada.');
  }

  private async require(m: EntityManager, id: string): Promise<Integration> {
    const row = await m.getRepository(Integration).findOneBy({ id });
    if (!row) throw apiError(404, 'not_found', 'Integração não encontrada.');
    return row;
  }

  /** Lê a integração travando a linha: serializa rotações e mudanças simultâneas (CA-T.2). */
  private async lock(m: EntityManager, id: string): Promise<Integration> {
    const row = await m.getRepository(Integration).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!row) throw apiError(404, 'not_found', 'Integração não encontrada.');
    return row;
  }

  private expiry(raw: string, now: Date): Date {
    const date = new Date(raw);
    const verdict = checkExpiry(date, now);
    if (verdict === 'in_the_past') {
      throw apiError(422, 'invalid_expiry', 'A validade do token precisa estar no futuro.', { reason: verdict });
    }
    if (verdict === 'too_far') {
      throw apiError(
        422,
        'invalid_expiry',
        `A validade do token pode ser de no máximo ${INTEGRATION_LIMITS.maxTokenDays} dias.`,
        { reason: verdict },
      );
    }
    return date;
  }

  /** Módulos válidos e ligados; os que a integração já tem (`kept`) podem continuar mesmo desligados. */
  private checkModules(
    input: readonly string[],
    enabled: readonly string[],
    kept: readonly string[],
  ): IntegrationModuleId[] {
    const modules = normalizeModules(input);
    if (!modules) throw apiError(422, 'invalid_modules', 'Módulo desconhecido na lista.');
    const off = modules.filter((mod) => !enabled.includes(mod) && !kept.includes(mod));
    if (off.length > 0) {
      throw apiError(422, 'module_not_enabled', 'Ligue o módulo na tela de módulos antes de usá-lo.', {
        modules: off,
      });
    }
    return modules;
  }

  private checkIps(input: readonly string[]): string[] {
    const ips = normalizeIpList(input);
    if (!ips) {
      throw apiError(
        422,
        'invalid_ip_list',
        `Informe até ${INTEGRATION_LIMITS.maxIpEntries} IPs ou faixas válidos (ex.: 203.0.113.7 ou 10.0.0.0/8).`,
      );
    }
    return ips;
  }

  private async checkScope(m: EntityManager, scope: readonly { entityId: string }[]): Promise<void> {
    if (scope.length === 0) return;
    const ids = scope.map((s) => s.entityId);
    const found = await m.getRepository(OrgEntity).count({ where: { id: In(ids) } });
    if (found !== ids.length) throw apiError(422, 'invalid_scope', 'Há entidade inexistente no escopo.');
  }

  private async saveScope(
    m: EntityManager,
    integrationId: string,
    scope: readonly { entityId: string; includeChildren: boolean }[],
  ): Promise<void> {
    if (scope.length === 0) return;
    await m
      .getRepository(IntegrationScope)
      .insert(scope.map((s) => ({ integrationId, entityId: s.entityId, includeChildren: s.includeChildren })));
  }

  private translate(error: unknown): unknown {
    if ((error as { code?: string; driverError?: { code?: string } })?.code === UNIQUE_VIOLATION)
      return this.nameTaken();
    if ((error as { driverError?: { code?: string } })?.driverError?.code === UNIQUE_VIOLATION) return this.nameTaken();
    return error;
  }

  private nameTaken() {
    return apiError(409, 'integration_name_taken', 'Já existe uma integração com este nome.');
  }

  private async viewOf(id: string): Promise<IntegrationView> {
    const m = this.dataSource.manager;
    const row = await this.require(m, id);
    const timeZone = await this.settings.get('organization.timezone', m);
    const [view] = await this.loadViews(m, [row], timeZone);
    return view as IntegrationView;
  }

  private async loadViews(m: EntityManager, rows: Integration[], timeZone: string): Promise<IntegrationView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [scopes, tokens, entities] = await Promise.all([
      m.getRepository(IntegrationScope).find({ where: { integrationId: In(ids) } }),
      m.getRepository(IntegrationToken).find({ where: { integrationId: In(ids) }, order: { createdAt: 'DESC' } }),
      m.query('SELECT id, name FROM entity') as Promise<{ id: string; name: string }[]>,
    ]);
    const entityName = new Map(entities.map((e) => [e.id, e.name]));
    const now = new Date();
    return rows.map((r) => {
      const mine = tokens.filter((t) => t.integrationId === r.id);
      const best = healthExpiry(mine);
      let expiry: IntegrationExpiryView | null = null;
      if (best) {
        const verdict = secretVerdict(todayInZone(best, timeZone), now, timeZone);
        expiry = {
          state: verdict.state,
          code: verdict.code === 'no_date' ? 'ok' : verdict.code,
          days: verdict.days,
        };
      }
      const used = mine.map((t) => t.lastUsedAt).filter((d): d is Date => d !== null);
      const last = used.length > 0 ? new Date(Math.max(...used.map((d) => d.getTime()))) : null;
      return {
        id: r.id,
        name: r.name,
        owner: r.owner,
        status: r.status,
        modules: r.modules,
        includeEmail: r.includeEmail,
        ratePerMinute: r.ratePerMinute,
        ipAllowlist: r.ipAllowlist,
        scope: scopes
          .filter((s) => s.integrationId === r.id)
          .map((s) => ({
            entityId: s.entityId,
            entityName: entityName.get(s.entityId) ?? '',
            includeChildren: s.includeChildren,
          }))
          .sort((a, b) => a.entityName.localeCompare(b.entityName)),
        tokens: mine.map((t) => ({
          id: t.id,
          prefix: t.prefix,
          state: tokenState(t, now),
          expiresAt: t.expiresAt.toISOString(),
          retireAt: t.retireAt?.toISOString() ?? null,
          revokedAt: t.revokedAt?.toISOString() ?? null,
          lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
          createdAt: t.createdAt.toISOString(),
        })),
        expiry,
        lastUsedAt: last?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        revokedAt: r.revokedAt?.toISOString() ?? null,
      };
    });
  }
}
