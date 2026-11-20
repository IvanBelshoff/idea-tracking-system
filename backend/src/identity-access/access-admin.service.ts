import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import { open, seal, secretKeyReady } from '../communication/secret-box.js';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import { SettingsService } from '../organization/settings.service.js';
import { type AccessView, isValidTenant, type SsoProviderView, type SsoView } from './access-admin.dto.js';
import { loadDomainPolicy } from './access-policy.js';
import type { RequestMeta } from './auth-context.js';
import { AvatarService } from './avatar.service.js';
import { Role } from './entities/role.entity.js';
import { SSO_PROVIDERS, SsoProvider, type SsoProviderId } from './entities/sso-provider.entity.js';
import { User, UserStatus } from './entities/user.entity.js';
import { UserIdentity } from './entities/user-identity.entity.js';
import { discover, fetchJwks } from './sso/oidc.js';
import { issuerFor } from './sso/providers.js';
import { SsoError } from './sso/sso-errors.js';
import { enableBlockers, isAdministrativeRole, type LoginMode, modeBlockers } from './sso/sso-rules.js';

interface Actor {
  userId: string;
  meta: RequestMeta;
}

/**
 * Acesso corporativo, lado do administrador (permissão `sso.manage`): política de domínio (RN-95),
 * provedores Microsoft/Google, modo de login e criação automática de conta (RN-96 a RN-98). Todas
 * as alterações validam as pré-condições aqui e são auditadas; o segredo do cliente só existe cifrado.
 */
@Injectable()
export class AccessAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly avatars: AvatarService,
  ) {}

  /**
   * Liga ou desliga a foto do perfil vinda do provedor (RN-144). Desligar apaga as fotos guardadas desse
   * provedor, e quem as usava volta à foto enviada (ou às iniciais).
   */
  async setPhoto({ userId, meta }: Actor, id: SsoProviderId, on: boolean): Promise<AccessView> {
    let files: string[] = [];
    await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(SsoProvider);
      const row = await repo.findOneBy({ provider: id });
      if (!row)
        throw apiError(422, 'sso_blocked', 'Configure o provedor antes.', { blockers: ['provider_incomplete'] });
      if (row.photoEnabled === on) return;
      await repo.update(row.id, { photoEnabled: on, updatedById: userId });
      if (!on) files = await this.avatars.purgeSource(m, id, null);
      await this.audit.record(
        {
          action: on ? 'sso.photo_enabled' : 'sso.photo_disabled',
          actorId: userId,
          targetType: 'sso_provider',
          data: { provider: id, ...(on ? {} : { photosRemoved: files.length }) },
          ip: meta.ip,
        },
        m,
      );
    });
    await this.avatars.removeFiles(files);
    return this.view(userId);
  }

  async view(actorId: string, m: EntityManager = this.dataSource.manager): Promise<AccessView> {
    const policy = await loadDomainPolicy(m);
    const policyView = { domains: [...policy.domains], allowExternal: policy.allowExternal };
    const sso = await this.ssoView(m, actorId, policyView.domains);
    if (policy.domains.length === 0) return { policy: policyView, outsideUsers: [], outsideTotal: 0, sso };
    const [rows, total] = await m
      .getRepository(User)
      .createQueryBuilder('u')
      .select(['u.id', 'u.name', 'u.email'])
      .where('u.status != :anonymized', { anonymized: UserStatus.Anonymized })
      .andWhere('LOWER(SPLIT_PART(u.email, :at, 2)) NOT IN (:...domains)', { at: '@', domains: policy.domains })
      .orderBy('u.name', 'ASC')
      .take(50)
      .getManyAndCount();
    return {
      policy: policyView,
      outsideUsers: rows.map((u) => ({ id: u.id, name: u.name, email: u.email })),
      outsideTotal: total,
      sso,
    };
  }

  private providerView(
    id: SsoProviderId,
    row: SsoProvider | undefined,
    ctx: { appUrl: string; domains: readonly string[] },
  ): SsoProviderView {
    const hasSecret = !!row?.configEncrypted;
    const clientId = row?.clientId ?? '';
    const tenantId = row?.tenantId ?? null;
    const configured = clientId !== '' && hasSecret && (id !== 'microsoft' || !!tenantId);
    return {
      provider: id,
      configured,
      clientId,
      tenantId,
      clientSecretSet: hasSecret,
      secretExpiresOn: row?.secretExpiresOn ?? null,
      enabled: row?.enabled ?? false,
      photoEnabled: row?.photoEnabled ?? false,
      lastTestAt: row?.lastTestAt?.toISOString() ?? null,
      lastTestOk: row?.lastTestOk ?? null,
      lastTestError: row?.lastTestError ?? null,
      redirectUri: ctx.appUrl ? `${ctx.appUrl}/api/auth/sso/${id}/callback` : null,
      blockers: enableBlockers({
        provider: id,
        appUrl: ctx.appUrl,
        secretKeyReady: secretKeyReady(),
        clientId,
        tenantId,
        hasSecret,
        lastTestOk: row?.lastTestOk ?? null,
        domains: ctx.domains,
      }),
    };
  }

  private async ssoView(m: EntityManager, actorId: string, domains: readonly string[]): Promise<SsoView> {
    const [appUrl, mode, autoCreate, defaultRoleId, defaultEntityId] = await Promise.all([
      this.settings.get('email.app_url', m),
      this.settings.get('auth.login_mode', m),
      this.settings.get('sso.auto_create', m),
      this.settings.get('sso.default_role_id', m),
      this.settings.get('sso.default_entity_id', m),
    ]);
    const rows = await m.getRepository(SsoProvider).find();
    const actorLinked = await m.getRepository(UserIdentity).existsBy({ userId: actorId });
    const roles = await m.getRepository(Role).find({ relations: { permissions: true }, order: { name: 'ASC' } });
    const entities = await m.getRepository(OrgEntity).find({ where: { active: true }, order: { name: 'ASC' } });
    return {
      appUrl,
      secretKeyReady: secretKeyReady(),
      mode,
      modeBlockers: modeBlockers({
        mode: 'password_sso',
        enabledProviders: rows.filter((r) => r.enabled).length,
        domains,
        actorLinked,
      }),
      actorLinked,
      autoCreate,
      defaultRoleId,
      defaultEntityId,
      providers: SSO_PROVIDERS.map((id) =>
        this.providerView(
          id,
          rows.find((r) => r.provider === id),
          { appUrl, domains },
        ),
      ),
      roleOptions: roles.map((r) => ({
        id: r.id,
        name: r.name,
        administrative: isAdministrativeRole({
          systemKey: r.systemKey,
          permissions: r.permissions.map((p) => p.permission),
        }),
      })),
      entityOptions: entities.map((e) => ({ id: e.id, name: e.name })),
    };
  }

  async updatePolicy(
    { userId, meta }: Actor,
    input: { domains: string[]; allowExternal: boolean },
  ): Promise<AccessView> {
    await this.dataSource.transaction(async (m) => {
      const before = await loadDomainPolicy(m);
      // Com o login corporativo em uso, o SSO depende dos domínios (RN-96): não dá para esvaziar a lista.
      if (input.domains.length === 0 && (await this.settings.get('auth.login_mode', m)) !== 'password') {
        throw apiError(
          422,
          'sso_domains_required',
          'Com o login corporativo em uso, é preciso ter ao menos um domínio.',
        );
      }
      await this.settings.set('auth.email_domains', input.domains, userId, m);
      await this.settings.set('auth.allow_external_email', input.allowExternal, userId, m);
      await this.audit.record(
        {
          action: 'access.policy_updated',
          actorId: userId,
          targetType: 'setting',
          data: {
            domains: input.domains,
            allowExternal: input.allowExternal,
            before: { domains: before.domains, allowExternal: before.allowExternal },
          },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.view(userId);
  }

  /** Cadastra ou altera o provedor. Mudou cliente, segredo ou tenant → desliga e zera o teste (RN-97). */
  async saveProvider(
    { userId, meta }: Actor,
    id: SsoProviderId,
    input: {
      clientId: string;
      tenantId?: string | null;
      clientSecret?: string | null;
      secretExpiresOn?: string | null;
    },
  ): Promise<AccessView> {
    const tenantId = id === 'microsoft' ? input.tenantId?.trim() || null : null;
    if (tenantId && !isValidTenant(tenantId)) {
      throw apiError(400, 'validation_failed', 'Informe o ID do tenant (GUID) ou o domínio dele.', [
        { path: 'tenantId', message: 'Informe o ID do tenant (GUID) ou o domínio dele' },
      ]);
    }
    const newSecret = typeof input.clientSecret === 'string' && input.clientSecret !== '';
    if (newSecret && !secretKeyReady()) {
      throw apiError(
        503,
        'secret_key_missing',
        'Defina APP_SECRET_KEY no ambiente do servidor para guardar o segredo.',
      );
    }
    await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(SsoProvider);
      const row = await repo.findOneBy({ provider: id });
      let config = row?.configEncrypted ?? null;
      let secretChanged = false;
      if (input.clientSecret !== undefined) {
        if (newSecret) {
          config = seal(JSON.stringify({ clientSecret: input.clientSecret }));
          secretChanged = true;
        } else {
          secretChanged = config !== null;
          config = null;
        }
      }
      const changed = !row || row.clientId !== input.clientId || (row.tenantId ?? null) !== tenantId || secretChanged;
      if (changed && row?.enabled) await this.assertAnotherProvider(m, id);
      const patch = {
        clientId: input.clientId,
        tenantId,
        configEncrypted: config,
        // A validade é do segredo: trocar o segredo sem informar a data apaga a antiga (RN-100).
        secretExpiresOn:
          input.secretExpiresOn !== undefined
            ? input.secretExpiresOn
            : secretChanged
              ? null
              : (row?.secretExpiresOn ?? null),
        updatedById: userId,
        ...(changed ? { enabled: false, lastTestAt: null, lastTestOk: null, lastTestError: null } : {}),
      };
      if (row) await repo.update(row.id, patch);
      else await repo.save(repo.create({ provider: id, ...patch, enabled: false }));
      await this.audit.record(
        {
          action: 'sso.provider_updated',
          actorId: userId,
          targetType: 'sso_provider',
          data: {
            provider: id,
            tenantId,
            credentialChanged: secretChanged,
            changed,
            // `expiresOn`, e não `secretExpiresOn`: a auditoria descarta qualquer chave com "secret" no nome.
            expiresOn: patch.secretExpiresOn,
            wasEnabled: row?.enabled ?? false,
          },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.view(userId);
  }

  /** Não deixa o modo "Só SSO" sem nenhum provedor ligado (CA-RN-97.8). */
  private async assertAnotherProvider(m: EntityManager, id: SsoProviderId): Promise<void> {
    if ((await this.settings.get('auth.login_mode', m)) !== 'sso') return;
    const others = await m.getRepository(SsoProvider).find({ where: { enabled: true } });
    if (!others.some((r) => r.provider !== id)) {
      throw apiError(
        409,
        'sso_mode_requires_provider',
        'O modo "Só SSO" precisa de um provedor ligado. Mude o modo antes.',
      );
    }
  }

  /** Faz só a descoberta e a leitura das chaves: confere o alcance de rede e o endereço do provedor. */
  async testAddress(id: SsoProviderId): Promise<{ ok: boolean; error: string | null }> {
    const row = await this.dataSource.getRepository(SsoProvider).findOneBy({ provider: id });
    if (id === 'microsoft' && !row?.tenantId) return { ok: false, error: 'sso_not_configured' };
    try {
      const endpoints = await discover(issuerFor(id, row?.tenantId ?? null), true);
      await fetchJwks(endpoints.jwks_uri, true);
      return { ok: true, error: null };
    } catch (e) {
      if (e instanceof SsoError) return { ok: false, error: e.code };
      throw e;
    }
  }

  async setEnabled({ userId, meta }: Actor, id: SsoProviderId, on: boolean): Promise<AccessView> {
    await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(SsoProvider);
      const row = await repo.findOneBy({ provider: id });
      if (on) {
        const blockers = enableBlockers({
          provider: id,
          appUrl: await this.settings.get('email.app_url', m),
          secretKeyReady: secretKeyReady(),
          clientId: row?.clientId ?? '',
          tenantId: row?.tenantId ?? null,
          hasSecret: !!row?.configEncrypted,
          lastTestOk: row?.lastTestOk ?? null,
          domains: await this.settings.get('auth.email_domains', m),
        });
        if (blockers.length > 0 || !row?.configEncrypted) {
          throw apiError(422, 'sso_blocked', 'Ainda falta algo para ligar este provedor.', { blockers });
        }
        // O segredo precisa continuar legível (a chave do servidor pode ter mudado).
        try {
          open(row.configEncrypted);
        } catch {
          throw apiError(422, 'sso_blocked', 'O segredo gravado não pôde ser lido. Cadastre-o de novo.', {
            blockers: ['provider_incomplete'],
          });
        }
      } else if (row?.enabled) {
        await this.assertAnotherProvider(m, id);
      }
      if (row) await repo.update(row.id, { enabled: on, updatedById: userId });
      await this.audit.record(
        {
          action: on ? 'sso.provider_enabled' : 'sso.provider_disabled',
          actorId: userId,
          targetType: 'sso_provider',
          data: { provider: id },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.view(userId);
  }

  async setMode({ userId, meta }: Actor, mode: LoginMode): Promise<AccessView> {
    await this.dataSource.transaction(async (m) => {
      const blockers = modeBlockers({
        mode,
        enabledProviders: await m.getRepository(SsoProvider).countBy({ enabled: true }),
        domains: await this.settings.get('auth.email_domains', m),
        actorLinked: await m.getRepository(UserIdentity).existsBy({ userId }),
      });
      if (blockers.length > 0) {
        throw apiError(422, 'sso_mode_blocked', 'Ainda falta algo para usar este modo de login.', { blockers });
      }
      const from = await this.settings.get('auth.login_mode', m);
      await this.settings.set('auth.login_mode', mode, userId, m);
      await this.audit.record(
        { action: 'sso.mode_changed', actorId: userId, targetType: 'setting', data: { from, to: mode }, ip: meta.ip },
        m,
      );
    });
    return this.view(userId);
  }

  /** Criação automática (RN-98): o perfil inicial nunca pode ser administrativo (CA-RN-98.6). */
  async setProvisioning(
    { userId, meta }: Actor,
    input: { autoCreate: boolean; roleId: string | null; entityId: string | null },
  ): Promise<AccessView> {
    await this.dataSource.transaction(async (m) => {
      if (input.autoCreate && (!input.roleId || !input.entityId)) {
        throw apiError(422, 'sso_provisioning_incomplete', 'Escolha o perfil e a entidade iniciais.');
      }
      if (input.roleId) {
        const role = await m
          .getRepository(Role)
          .findOne({ where: { id: input.roleId }, relations: { permissions: true } });
        if (!role) throw apiError(422, 'sso_provisioning_incomplete', 'O perfil escolhido não existe.');
        const permissions = role.permissions.map((p) => p.permission);
        if (isAdministrativeRole({ systemKey: role.systemKey, permissions })) {
          throw apiError(422, 'sso_role_administrative', 'O perfil inicial não pode ser administrativo.');
        }
      }
      if (input.entityId) {
        const entity = await m.getRepository(OrgEntity).findOneBy({ id: input.entityId });
        if (!entity?.active) {
          throw apiError(422, 'sso_provisioning_incomplete', 'A entidade escolhida não existe ou está inativa.');
        }
      }
      await this.settings.set('sso.auto_create', input.autoCreate, userId, m);
      await this.settings.set('sso.default_role_id', input.roleId, userId, m);
      await this.settings.set('sso.default_entity_id', input.entityId, userId, m);
      await this.audit.record(
        {
          action: 'sso.provisioning_updated',
          actorId: userId,
          targetType: 'setting',
          data: { autoCreate: input.autoCreate, roleId: input.roleId, entityId: input.entityId },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.view(userId);
  }
}
