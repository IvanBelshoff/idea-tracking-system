import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, type DataSource, type EntityManager, In } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import { type PageQuery, pageMeta } from '../common/pagination.js';
import { EmailLog, Notification } from '../communication/entities.js';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import { getSetting } from '../organization/settings.service.js';
import { INCOMPLETE_SQL } from '../user-fields/profile.js';
import type { Access } from './access.js';
import { assertEmailAllowed } from './access-policy.js';
import { assertAdminRemains } from './admin-guard-rails.js';
import { AuthService } from './auth.service.js';
import type { RequestMeta } from './auth-context.js';
import { AvatarService } from './avatar.service.js';
import { PasswordReset } from './entities/password-reset.entity.js';
import { Role } from './entities/role.entity.js';
import { User, UserStatus } from './entities/user.entity.js';
import { UserIdentity } from './entities/user-identity.entity.js';
import { UserRoleScope } from './entities/user-role-scope.entity.js';
import { photoVersions } from './photo-versions.js';
import { SessionService } from './session.service.js';
import { type PasswordLink, UserDetail, type UserPage, UserScope, UserSummary } from './users.dto.js';

const notFound = () => apiError(404, 'not_found', 'Usuário não encontrado.');

interface Actor {
  access: Access;
  meta: RequestMeta;
}

/**
 * Gestão de usuários (permissão `user.manage`). Quem administra enxerga os usuários que têm algum
 * perfil dentro das entidades onde ele pode administrar, mais os recém-criados ainda sem perfil.
 * Fora disso, 404: não revela que o usuário existe (CA-T.5).
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly avatars: AvatarService,
  ) {}

  /** Confere que o usuário está no escopo de quem administra (404 se não; mesma regra das telas de usuário). */
  async assertManages(access: Access, id: string): Promise<void> {
    await this.findVisible(access, id);
  }

  private visible(access: Access, m: EntityManager = this.dataSource.manager) {
    const ids = access.entities('user.manage');
    return m
      .getRepository(User)
      .createQueryBuilder('u')
      .where(
        new Brackets((w) => {
          w.where('NOT EXISTS (SELECT 1 FROM user_role_scope s WHERE s.user_id = u.id)');
          if (ids.length > 0) {
            w.orWhere('EXISTS (SELECT 1 FROM user_role_scope s WHERE s.user_id = u.id AND s.entity_id IN (:...ids))', {
              ids,
            });
          }
        }),
      );
  }

  private async findVisible(access: Access, id: string, m?: EntityManager): Promise<User> {
    const user = await this.visible(access, m).andWhere('u.id = :id', { id }).getOne();
    if (!user) throw notFound();
    return user;
  }

  private async detail(user: User, m: EntityManager = this.dataSource.manager): Promise<UserDetail> {
    const scopes = await m.getRepository(UserRoleScope).find({
      where: { userId: user.id },
      relations: { role: true, entity: true },
      order: { createdAt: 'ASC' },
    });
    const identities = await m.getRepository(UserIdentity).find({
      where: { userId: user.id },
      order: { createdAt: 'ASC' },
    });
    return {
      ...UserSummary.from(user, (await photoVersions(m, [user.id])).get(user.id) ?? null),
      scopes: scopes.map(UserScope.from),
      identities: identities.map((i) => ({
        provider: i.provider,
        linkedAt: i.createdAt.toISOString(),
        lastLoginAt: i.lastLoginAt?.toISOString() ?? null,
      })),
      canUsePassword: await this.auth.canUserUsePassword(user, m),
    };
  }

  private async assertEmailFree(email: string, m: EntityManager, exceptId?: string): Promise<void> {
    const other = await m.getRepository(User).findOneBy({ email });
    if (other && other.id !== exceptId) throw apiError(409, 'email_taken', 'Já existe um usuário com este e-mail.');
  }

  async list(
    access: Access,
    query: PageQuery & { search?: string; status?: UserStatus; incomplete?: boolean; options?: string[] },
  ): Promise<UserPage> {
    const qb = this.visible(access);
    if (query.status) qb.andWhere('u.status = :status', { status: query.status });
    if (query.search) {
      // Nome, e-mail e os campos pesquisáveis, inclusive os sensíveis: só a administração vê esta lista (RN-200).
      const like = query.search.replace(/[%_\\]/g, '\\$&');
      const bare = query.search.replace(/[^\p{L}\p{N}]/gu, '').replace(/[%_\\]/g, '\\$&');
      qb.andWhere(
        `(u.name ILIKE :q OR u.email ILIKE :q OR EXISTS (
           SELECT 1 FROM user_field_value v JOIN user_field f ON f.id = v.field_id
             LEFT JOIN user_field_option o ON o.id = v.option_id
            WHERE v.user_id = u.id AND f.active AND f.searchable
              AND (COALESCE(v.value, o.label) ILIKE :q
                   OR (CAST(:bare AS text) <> '' AND regexp_replace(v.value, '[^[:alnum:]]', '', 'g') ILIKE :qb))))`,
        { q: `%${like}%`, bare, qb: `%${bare}%` },
      );
    }
    if (query.incomplete) qb.andWhere(INCOMPLETE_SQL('u'));
    for (const [i, option] of (query.options ?? []).entries()) {
      qb.andWhere(`EXISTS (SELECT 1 FROM user_field_value v WHERE v.user_id = u.id AND v.option_id = :opt${i})`, {
        [`opt${i}`]: option,
      });
    }
    const incompleteTotal = await this.visible(access).andWhere(INCOMPLETE_SQL('u')).getCount();
    const [rows, total] = await qb
      .orderBy('u.name', 'ASC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    const photos = await photoVersions(
      this.dataSource.manager,
      rows.map((u) => u.id),
    );
    const incomplete = new Set<string>(
      rows.length === 0
        ? []
        : (
            await this.dataSource.query(`SELECT u.id FROM "user" u WHERE u.id = ANY($1) AND ${INCOMPLETE_SQL('u')}`, [
              rows.map((u) => u.id),
            ])
          ).map((r: { id: string }) => r.id),
    );
    return {
      items: rows.map((u) => UserSummary.from(u, photos.get(u.id) ?? null, incomplete.has(u.id))),
      meta: pageMeta(query, total),
      incompleteTotal,
    };
  }

  async get(access: Access, id: string): Promise<UserDetail> {
    return this.detail(await this.findVisible(access, id));
  }

  /** O usuário nasce sem senha e recebe um link para defini-la (nunca senha por e-mail; RN-42). */
  async create(
    { access, meta }: Actor,
    input: { name: string; email: string; locale?: string },
  ): Promise<{ user: UserDetail; passwordLink: PasswordLink | null }> {
    const user = await this.dataSource.transaction(async (m) => {
      await this.assertEmailFree(input.email, m);
      await assertEmailAllowed(m, input.email);
      const repo = m.getRepository(User);
      const locale = input.locale ?? (await getSetting(m, 'organization.default_locale'));
      const created = await repo.save(repo.create({ ...input, locale, passwordHash: null, status: UserStatus.Active }));
      await this.audit.record(
        {
          action: 'user.created',
          actorId: access.userId,
          targetType: 'user',
          targetId: created.id,
          data: { email: input.email },
          ip: meta.ip,
        },
        m,
      );
      return created;
    });
    // No modo "Só SSO" quem tem e-mail da organização entra pela conta corporativa: sem link de senha (RN-97).
    if (!(await this.auth.canUserUsePassword(user))) return { user: await this.detail(user), passwordLink: null };
    const link = await this.auth.createPasswordReset(user.id, access.userId, meta);
    return {
      user: await this.detail(user),
      passwordLink: { token: link.token, expiresAt: link.expiresAt.toISOString() },
    };
  }

  async update({ access, meta }: Actor, id: string, input: Partial<{ name: string; email: string; locale: string }>) {
    return this.dataSource.transaction(async (m) => {
      const user = await this.findVisible(access, id, m);
      if (user.status === UserStatus.Anonymized)
        throw apiError(409, 'user_anonymized', 'Usuário anonimizado não pode ser editado.');
      if (input.email) {
        await this.assertEmailFree(input.email, m, user.id);
        // Quem já está fora da política continua editável: só a troca para um e-mail novo é conferida.
        if (input.email !== user.email.toLowerCase()) await assertEmailAllowed(m, input.email);
      }
      await m.getRepository(User).update(user.id, input);
      await this.audit.record(
        {
          action: 'user.updated',
          actorId: access.userId,
          targetType: 'user',
          targetId: user.id,
          data: { fields: Object.keys(input) },
          ip: meta.ip,
        },
        m,
      );
      return this.detail(await m.getRepository(User).findOneByOrFail({ id: user.id }), m);
    });
  }

  /** Desativa (RN-41): não entra mais e perde as sessões na hora; vínculos com ideias permanecem. */
  async disable({ access, meta }: Actor, id: string): Promise<UserDetail> {
    if (id === access.userId) throw apiError(409, 'cannot_disable_self', 'Você não pode desativar a própria conta.');
    return this.dataSource.transaction(async (m) => {
      const user = await this.findVisible(access, id, m);
      if (user.status !== UserStatus.Active) throw apiError(409, 'user_not_active', 'O usuário não está ativo.');
      await m.getRepository(User).update(user.id, { status: UserStatus.Disabled });
      await this.sessions.revokeAll(user.id, m);
      await assertAdminRemains(m);
      await this.audit.record(
        { action: 'user.disabled', actorId: access.userId, targetType: 'user', targetId: user.id, ip: meta.ip },
        m,
      );
      return this.detail(await m.getRepository(User).findOneByOrFail({ id: user.id }), m);
    });
  }

  async enable({ access, meta }: Actor, id: string): Promise<UserDetail> {
    return this.dataSource.transaction(async (m) => {
      const user = await this.findVisible(access, id, m);
      if (user.status !== UserStatus.Disabled)
        throw apiError(409, 'user_not_disabled', 'Só um usuário desativado pode ser reativado.');
      await m.getRepository(User).update(user.id, { status: UserStatus.Active, failedAttempts: 0, lockedUntil: null });
      await this.audit.record(
        { action: 'user.enabled', actorId: access.userId, targetType: 'user', targetId: user.id, ip: meta.ip },
        m,
      );
      return this.detail(await m.getRepository(User).findOneByOrFail({ id: user.id }), m);
    });
  }

  /**
   * Anonimiza (RN-40): só usuário já desativado; irreversível. Troca nome e e-mail por valores
   * neutros, apaga a senha e os links de recuperação, tira os perfis e mantém o registro, para as
   * ideias continuarem apontando para ele ("Ex-colaborador"). A foto (RN-91) entra com o perfil do usuário.
   */
  async anonymize({ access, meta }: Actor, id: string): Promise<UserDetail> {
    let avatarFiles: string[] = [];
    const detail = await this.dataSource.transaction(async (m) => {
      const user = await this.findVisible(access, id, m);
      if (user.status === UserStatus.Active) {
        throw apiError(409, 'user_active', 'Desative o usuário antes de anonimizá-lo.');
      }
      if (user.status === UserStatus.Anonymized)
        throw apiError(409, 'user_anonymized', 'O usuário já foi anonimizado.');
      await m.getRepository(User).update(user.id, {
        name: 'Ex-colaborador',
        email: `anonimizado-${user.id}@anonimizado.invalid`,
        passwordHash: null,
        status: UserStatus.Anonymized,
        hideName: true,
        anonymizedAt: new Date(),
        lastLoginAt: null,
      });
      await m.getRepository(PasswordReset).delete({ userId: user.id });
      await m.getRepository(UserIdentity).delete({ userId: user.id });
      await m.getRepository(UserRoleScope).delete({ userId: user.id });
      await m.query('DELETE FROM user_field_value WHERE user_id = $1', [user.id]);
      avatarFiles = await this.avatars.purge(user.id, m);
      // O rastro de envios também perde o endereço e os avisos pendentes deixam de existir (M4).
      await m
        .getRepository(EmailLog)
        .update({ userId: user.id }, { toAddress: `anonimizado-${user.id}@anonimizado.invalid` });
      await m.getRepository(Notification).delete({ userId: user.id });
      await this.sessions.revokeAll(user.id, m);
      await this.audit.record(
        { action: 'user.anonymized', actorId: access.userId, targetType: 'user', targetId: user.id, ip: meta.ip },
        m,
      );
      return this.detail(await m.getRepository(User).findOneByOrFail({ id: user.id }), m);
    });
    // O arquivo da foto sai do disco depois do commit (CA-RN-91.6).
    await this.avatars.removeFiles(avatarFiles);
    return detail;
  }

  /** Link de recuperação gerado pelo administrador (no M1, ele o entrega à pessoa; CA-RN-42.3). */
  async passwordLink({ access, meta }: Actor, id: string): Promise<PasswordLink> {
    const user = await this.findVisible(access, id);
    if (user.status !== UserStatus.Active) throw apiError(409, 'user_not_active', 'O usuário não está ativo.');
    if (!(await this.auth.canUserUsePassword(user))) {
      throw apiError(409, 'sso_required', 'Esta pessoa entra pela conta corporativa (Microsoft ou Google).');
    }
    const link = await this.auth.createPasswordReset(user.id, access.userId, meta);
    return { token: link.token, expiresAt: link.expiresAt.toISOString() };
  }

  /** Desfaz o vínculo com a conta do provedor (RN-96): no próximo login corporativo ele é refeito pelo e-mail. */
  async unlinkIdentity({ access, meta }: Actor, id: string, provider: string): Promise<UserDetail> {
    let photoFiles: string[] = [];
    const detail = await this.dataSource.transaction(async (m) => {
      const user = await this.findVisible(access, id, m);
      const removed = await m.getRepository(UserIdentity).delete({ userId: user.id, provider: provider as never });
      if (!removed.affected) throw apiError(404, 'not_found', 'Vínculo não encontrado.');
      // A foto daquele provedor vai junto (RN-144); quem a usava volta à enviada.
      if (provider === 'microsoft' || provider === 'google') {
        photoFiles = await this.avatars.purgeSource(m, provider, user.id);
      }
      await this.audit.record(
        {
          action: 'auth.sso_unlinked',
          actorId: access.userId,
          targetType: 'user',
          targetId: user.id,
          data: { provider },
          ip: meta.ip,
        },
        m,
      );
      return this.detail(await m.getRepository(User).findOneByOrFail({ id: user.id }), m);
    });
    await this.avatars.removeFiles(photoFiles);
    return detail;
  }

  /**
   * Substitui os perfis do usuário (perfil EM entidade, §3.2). Quem administra só concede ou
   * retira perfis em entidades onde ele próprio tem `user.manage`.
   */
  async setScopes(
    { access, meta }: Actor,
    id: string,
    scopes: { roleId: string; entityId: string; includeChildren: boolean }[],
  ): Promise<UserDetail> {
    const allowed = new Set(access.entities('user.manage'));
    return this.dataSource.transaction(async (m) => {
      const user = await this.findVisible(access, id, m);
      if (user.status === UserStatus.Anonymized)
        throw apiError(409, 'user_anonymized', 'Usuário anonimizado não recebe perfis.');

      const unique = new Map(scopes.map((s) => [`${s.roleId}:${s.entityId}`, s]));
      const wanted = [...unique.values()];
      const roleIds = [...new Set(wanted.map((s) => s.roleId))];
      const entityIds = [...new Set(wanted.map((s) => s.entityId))];
      if ((await m.getRepository(Role).countBy({ id: In(roleIds) })) !== roleIds.length) {
        throw apiError(422, 'role_not_found', 'Perfil inexistente.');
      }
      if ((await m.getRepository(OrgEntity).countBy({ id: In(entityIds) })) !== entityIds.length) {
        throw apiError(422, 'entity_not_found', 'Entidade inexistente.');
      }

      const current = await m.getRepository(UserRoleScope).findBy({ userId: user.id });
      const touched = [...current.map((s) => s.entityId), ...entityIds];
      if (touched.some((e) => !allowed.has(e))) {
        throw apiError(403, 'forbidden', 'Você só pode conceder ou retirar perfis nas entidades que administra.');
      }

      await m.getRepository(UserRoleScope).delete({ userId: user.id });
      const repo = m.getRepository(UserRoleScope);
      await repo.save(wanted.map((s) => repo.create({ ...s, userId: user.id })));
      await assertAdminRemains(m);
      await this.audit.record(
        {
          action: 'user.scopes_changed',
          actorId: access.userId,
          targetType: 'user',
          targetId: user.id,
          data: { scopes: wanted },
          ip: meta.ip,
        },
        m,
      );
      return this.detail(user, m);
    });
  }
}
