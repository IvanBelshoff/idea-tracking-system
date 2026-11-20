import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service.js';
import { PtBrLogger } from '../../common/pt-br-logger.js';
import { open } from '../../communication/secret-box.js';
import { OrgEntity } from '../../organization/entities/org-entity.entity.js';
import { SettingsService } from '../../organization/settings.service.js';
import { AuthService } from '../auth.service.js';
import type { RequestMeta } from '../auth-context.js';
import { AvatarService } from '../avatar.service.js';
import { Role, RolePermission } from '../entities/role.entity.js';
import { SsoProvider, type SsoProviderId } from '../entities/sso-provider.entity.js';
import { User, UserStatus } from '../entities/user.entity.js';
import { UserIdentity } from '../entities/user-identity.entity.js';
import { UserRoleScope } from '../entities/user-role-scope.entity.js';
import { authorizationUrl, discover, exchangeCode, newToken, pkceChallenge, verifyWithProviderKeys } from './oidc.js';
import { fetchProviderPhoto, type PhotoRequest, photoRequestFor } from './provider-photo.js';
import { issuerFor, type ProviderIdentity, presetOf } from './providers.js';
import { SsoError, type SsoErrorCode } from './sso-errors.js';
import { assertIdentityAllowed, isAdministrativeRole, provisionedName } from './sso-rules.js';
import type { SsoFlowState } from './sso-state.js';

const logger = new PtBrLogger('LoginCorporativo');

export type SsoCallbackResult =
  | { kind: 'login'; token: string; hours: number; back: string }
  | { kind: 'test'; ok: boolean; linked: boolean; error: SsoErrorCode | null };

type FlowStart = Omit<SsoFlowState, 'until'>;

/**
 * Login corporativo (M13, RN-96 a RN-98): início e retorno do fluxo OpenID Connect, vínculo da
 * identidade e criação automática de conta. Nada aqui registra token, código ou segredo.
 */
@Injectable()
export class SsoService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly avatars: AvatarService,
  ) {}

  /** Escopo pedido: com a foto ligada, a Microsoft precisa de `User.Read` para o Graph (RN-144). */
  private scopeFor(id: SsoProviderId, row: SsoProvider): string {
    const base = presetOf(id).scope;
    return id === 'microsoft' && row.photoEnabled ? `${base} User.Read` : base;
  }

  /** Configuração do provedor com o segredo aberto. Ligado, ou só configurado quando é teste. */
  private async loadProvider(id: SsoProviderId, forTest: boolean): Promise<{ row: SsoProvider; secret: string }> {
    const row = await this.dataSource.getRepository(SsoProvider).findOneBy({ provider: id });
    if (
      !row?.configEncrypted ||
      row.clientId === '' ||
      (id === 'microsoft' && !row.tenantId) ||
      (!forTest && !row.enabled)
    ) {
      throw new SsoError('sso_not_configured', 'O provedor não está configurado ou ligado.');
    }
    let secret = '';
    try {
      secret = (JSON.parse(open(row.configEncrypted)) as { clientSecret?: string }).clientSecret ?? '';
    } catch {
      throw new SsoError('sso_not_configured', 'O segredo gravado não pôde ser lido (a chave do servidor mudou?).');
    }
    if (secret === '') throw new SsoError('sso_not_configured', 'O provedor está sem segredo.');
    return { row, secret };
  }

  async redirectUri(id: SsoProviderId): Promise<string> {
    const appUrl = await this.settings.get('email.app_url');
    if (!appUrl) throw new SsoError('sso_not_configured', 'Falta o endereço do sistema.');
    return `${appUrl}/api/auth/sso/${id}/callback`;
  }

  private async assertModeOn(forTest: boolean): Promise<void> {
    if (!forTest && (await this.settings.get('auth.login_mode')) === 'password') {
      throw new SsoError('sso_not_configured', 'O login corporativo está desligado.');
    }
  }

  /** Início: monta o endereço de autorização e o estado que vai no cookie. */
  async start(
    id: SsoProviderId,
    opts: { back: string; test: boolean; actorId: string | null },
  ): Promise<{ url: string; flow: FlowStart }> {
    await this.assertModeOn(opts.test);
    const { row } = await this.loadProvider(id, opts.test);
    const endpoints = await discover(issuerFor(id, row.tenantId));
    const state = newToken();
    const nonce = newToken();
    const verifier = newToken(48);
    const url = authorizationUrl(endpoints, {
      clientId: row.clientId,
      redirectUri: await this.redirectUri(id),
      scope: this.scopeFor(id, row),
      state,
      nonce,
      challenge: pkceChallenge(verifier),
    });
    return {
      url,
      flow: { provider: id, state, nonce, verifier, back: opts.back, test: opts.test, actorId: opts.actorId },
    };
  }

  /** Retorno do provedor: confere tudo e termina o login (ou o teste de conexão). */
  async callback(
    id: SsoProviderId,
    query: { code?: string; state?: string; error?: string },
    flow: SsoFlowState | null,
    meta: RequestMeta,
    actorId: string | null,
  ): Promise<SsoCallbackResult> {
    if (!flow || !query.state || query.state !== flow.state) {
      throw new SsoError('sso_state_invalid', 'O estado do retorno não confere.');
    }
    if (flow.test && (!actorId || actorId !== flow.actorId)) {
      throw new SsoError('sso_session_required', 'O teste precisa da mesma sessão que o iniciou.');
    }
    const body = async (): Promise<{ row: SsoProvider; identity: ProviderIdentity; photo: PhotoRequest | null }> => {
      if (query.error) {
        throw new SsoError('sso_provider_error', `O provedor devolveu um erro (${query.error.slice(0, 40)}).`);
      }
      if (!query.code) throw new SsoError('sso_state_invalid', 'O retorno veio sem código.');
      await this.assertModeOn(flow.test);
      const { row, secret } = await this.loadProvider(id, flow.test);
      const issuer = issuerFor(id, row.tenantId);
      const endpoints = await discover(issuer);
      const { idToken, accessToken } = await exchangeCode(endpoints, {
        clientId: row.clientId,
        clientSecret: secret,
        redirectUri: await this.redirectUri(id),
        code: query.code,
        verifier: flow.verifier,
      });
      const claims = await verifyWithProviderKeys(idToken, endpoints, {
        issuer,
        audience: row.clientId,
        nonce: flow.nonce,
      });
      return {
        row,
        identity: presetOf(id).identify(claims, issuer, row.tenantId),
        photo: row.photoEnabled ? photoRequestFor(id, claims, accessToken) : null,
      };
    };

    if (flow.test) return this.finishTest(id, body, meta, actorId as string);
    return this.finishLogin(id, body, flow.back, meta);
  }

  private async finishLogin(
    id: SsoProviderId,
    body: () => Promise<{ row: SsoProvider; identity: ProviderIdentity; photo: PhotoRequest | null }>,
    back: string,
    meta: RequestMeta,
  ): Promise<SsoCallbackResult> {
    let email: string | null = null;
    try {
      const { identity, photo } = await body();
      email = identity.email;
      const domains = await this.settings.get('auth.email_domains');
      const allowed = assertIdentityAllowed(id, identity, domains);
      const user = await this.dataSource.transaction((m) => this.resolveUser(m, id, identity, allowed, meta));
      if (photo) await this.refreshPhoto(id, user.id, photo);
      const done = await this.auth.finishLogin(user, meta, 'auth.sso_login', { provider: id });
      return { kind: 'login', token: done.token, hours: done.hours, back };
    } catch (e) {
      if (e instanceof SsoError) {
        logger.warn(`Login corporativo recusado (${id}): ${e.code}. ${e.message}`);
        await this.audit.record({
          action: 'auth.sso_login_failed',
          data: { provider: id, reason: e.code, ...(email ? { email } : {}) },
          ip: meta.ip,
        });
      }
      throw e;
    }
  }

  /**
   * Guarda a foto do provedor (RN-144), à parte e sem mudar a escolha da pessoa. Qualquer falha só vira
   * um aviso no log (sem dado pessoal): o login segue.
   */
  private async refreshPhoto(id: SsoProviderId, userId: string, photo: PhotoRequest): Promise<void> {
    try {
      const bytes = await fetchProviderPhoto(id, photo);
      if (!bytes) {
        logger.warn(`Foto do perfil não trazida do provedor (${id}).`);
        return;
      }
      if (!(await this.avatars.storeProviderPhoto(userId, id, bytes))) {
        logger.warn(`Foto do perfil do provedor (${id}) não é uma imagem aceita; descartada.`);
      }
    } catch {
      logger.warn(`Foto do perfil do provedor (${id}) não pôde ser guardada.`);
    }
  }

  /** Acha (ou vincula, ou cria) o usuário. Tudo sob trava por e-mail, para dois logins simultâneos. */
  private async resolveUser(
    m: EntityManager,
    id: SsoProviderId,
    identity: ProviderIdentity,
    email: string,
    meta: RequestMeta,
  ): Promise<User> {
    await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sso:${email}`]);
    const identities = m.getRepository(UserIdentity);
    const users = m.getRepository(User);
    const where = { provider: id, issuer: identity.issuer, subject: identity.subject };

    const linked = await identities.findOneBy(where);
    if (linked) {
      const user = await users.findOneByOrFail({ id: linked.userId });
      this.assertActive(user);
      await identities.update(linked.id, { lastLoginAt: new Date() });
      return user;
    }

    const byEmail = await users.findOneBy({ email });
    if (byEmail) {
      this.assertActive(byEmail);
      await this.link(m, byEmail, id, identity, email, meta);
      return byEmail;
    }

    if (!(await this.settings.get('sso.auto_create', m))) {
      throw new SsoError('sso_user_not_found', 'O e-mail não está cadastrado.');
    }
    return this.provision(m, id, identity, email, meta);
  }

  private assertActive(user: User): void {
    if (user.status !== UserStatus.Active) {
      throw new SsoError('sso_user_disabled', 'A conta está desativada ou anonimizada.');
    }
  }

  /** Vincula a conta do provedor ao usuário; recusa se ele já tem outra conta no mesmo provedor. */
  private async link(
    m: EntityManager,
    user: User,
    id: SsoProviderId,
    identity: ProviderIdentity,
    email: string,
    meta: RequestMeta,
  ): Promise<void> {
    const identities = m.getRepository(UserIdentity);
    if (await identities.existsBy({ userId: user.id, provider: id })) {
      throw new SsoError('sso_identity_conflict', 'O usuário já está vinculado a outra conta do provedor.');
    }
    await identities.save(
      identities.create({
        userId: user.id,
        provider: id,
        issuer: identity.issuer,
        subject: identity.subject,
        emailAtLink: email,
        lastLoginAt: new Date(),
      }),
    );
    await this.audit.record(
      {
        action: 'auth.sso_identity_linked',
        actorId: user.id,
        targetType: 'user',
        targetId: user.id,
        data: { provider: id },
        ip: meta.ip,
      },
      m,
    );
  }

  /** Criação automática (RN-98): perfil e entidade iniciais, revalidados aqui. */
  private async provision(
    m: EntityManager,
    id: SsoProviderId,
    identity: ProviderIdentity,
    email: string,
    meta: RequestMeta,
  ): Promise<User> {
    const roleId = await this.settings.get('sso.default_role_id', m);
    const entityId = await this.settings.get('sso.default_entity_id', m);
    const role = roleId
      ? await m.getRepository(Role).findOne({ where: { id: roleId }, relations: { permissions: true } })
      : null;
    const entity = entityId ? await m.getRepository(OrgEntity).findOneBy({ id: entityId }) : null;
    if (!role || !entity?.active) {
      throw new SsoError('sso_provisioning_unavailable', 'O perfil ou a entidade iniciais não existem mais.');
    }
    const permissions = role.permissions.map((p: RolePermission) => p.permission);
    if (isAdministrativeRole({ systemKey: role.systemKey, permissions })) {
      throw new SsoError('sso_provisioning_unavailable', 'O perfil inicial é administrativo.');
    }

    const users = m.getRepository(User);
    const user = await users.save(
      users.create({
        email,
        name: provisionedName(identity.name, email),
        locale: await this.settings.get('organization.default_locale', m),
        passwordHash: null,
        status: UserStatus.Active,
      }),
    );
    const scopes = m.getRepository(UserRoleScope);
    await scopes.save(scopes.create({ userId: user.id, roleId: role.id, entityId: entity.id, includeChildren: true }));
    await this.link(m, user, id, identity, email, meta);
    await this.audit.record(
      {
        action: 'auth.sso_user_provisioned',
        actorId: user.id,
        targetType: 'user',
        targetId: user.id,
        data: { provider: id, roleId: role.id, entityId: entity.id },
        ip: meta.ip,
      },
      m,
    );
    return user;
  }

  /**
   * Teste de conexão do administrador logado (RN-97): confere o retorno como um login, mas não troca
   * a sessão. Registra o resultado no provedor e, se o e-mail da conta é o do administrador, vincula.
   */
  private async finishTest(
    id: SsoProviderId,
    body: () => Promise<{ row: SsoProvider; identity: ProviderIdentity; photo: PhotoRequest | null }>,
    meta: RequestMeta,
    actorId: string,
  ): Promise<SsoCallbackResult> {
    const providers = this.dataSource.getRepository(SsoProvider);
    const record = async (ok: boolean, error: SsoErrorCode | null, linked: boolean) => {
      await providers.update(
        { provider: id },
        { lastTestAt: new Date(), lastTestOk: ok, lastTestError: error, updatedById: actorId },
      );
      await this.audit.record({
        action: ok ? 'sso.test_ok' : 'sso.test_failed',
        actorId,
        targetType: 'sso_provider',
        data: { provider: id, linked, ...(error ? { reason: error } : {}) },
        ip: meta.ip,
      });
    };
    try {
      const { identity } = await body();
      const domains = await this.settings.get('auth.email_domains');
      if (domains.length > 0) assertIdentityAllowed(id, identity, domains);
      else if (!identity.email || !identity.emailVerified) {
        throw new SsoError(
          identity.email ? 'sso_email_unverified' : 'sso_email_missing',
          'E-mail ausente ou não verificado.',
        );
      }
      let linked = false;
      await this.dataSource.transaction(async (m) => {
        const actor = await m.getRepository(User).findOneByOrFail({ id: actorId });
        if (identity.email !== actor.email.toLowerCase()) return;
        const existing = await m.getRepository(UserIdentity).findOneBy({
          provider: id,
          issuer: identity.issuer,
          subject: identity.subject,
        });
        if (existing && existing.userId !== actorId) {
          throw new SsoError('sso_identity_conflict', 'Esta conta do provedor já pertence a outro usuário.');
        }
        if (!existing) await this.link(m, actor, id, identity, identity.email as string, meta);
        linked = true;
      });
      await record(true, null, linked);
      return { kind: 'test', ok: true, linked, error: null };
    } catch (e) {
      if (!(e instanceof SsoError)) throw e;
      logger.warn(`Teste de conexão recusado (${id}): ${e.code}. ${e.message}`);
      await record(false, e.code, false);
      return { kind: 'test', ok: false, linked: false, error: e.code };
    }
  }
}
