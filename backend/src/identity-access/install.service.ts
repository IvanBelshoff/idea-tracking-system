import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import { SettingsService } from '../organization/settings.service.js';
import { AuthService } from './auth.service.js';
import type { RequestMeta } from './auth-context.js';
import { Role } from './entities/role.entity.js';
import { User, UserStatus } from './entities/user.entity.js';
import { UserRoleScope } from './entities/user-role-scope.entity.js';
import { localizeFactoryRoles } from './factory-roles.js';
import { hashPassword } from './password.js';
import { SessionService } from './session.service.js';

/** Trava consultiva da instalação: duas chamadas simultâneas não criam dois administradores. */
const INSTALL_LOCK = 7_262_002;

export interface InstallInput {
  organizationName: string;
  timezone: string;
  locale: 'pt-BR' | 'en';
  adminName: string;
  adminEmail: string;
  password: string;
}

/**
 * Assistente de instalação (RN-43): com o banco vazio, cria a organização (entidade raiz),
 * o primeiro administrador e as configurações básicas. Depois de usado, deixa de existir.
 */
@Injectable()
export class InstallService {
  /** Uma vez instalado, fica em cache: a instalação não se desfaz. */
  private installed = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async isInstalled(): Promise<boolean> {
    if (!this.installed) this.installed = (await this.settings.get('installation.completed_at')) !== null;
    return this.installed;
  }

  async install(input: InstallInput, meta: RequestMeta): Promise<{ token: string; user: User; hours: number }> {
    if (await this.isInstalled()) throw apiError(404, 'not_found', 'Recurso não encontrado.');
    await this.auth.assertPasswordPolicy(input.password);
    const passwordHash = await hashPassword(input.password);
    const hours = await this.settings.get('auth.session_hours');

    const result = await this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [INSTALL_LOCK]);
      // Conferido de novo sob a trava: quem chegou depois recebe 404.
      if ((await this.settings.get('installation.completed_at', m)) !== null) {
        throw apiError(404, 'not_found', 'Recurso não encontrado.');
      }

      const root = await m
        .getTreeRepository(OrgEntity)
        .save(m.getTreeRepository(OrgEntity).create({ name: input.organizationName, parent: null, active: true }));
      const user = await m.getRepository(User).save(
        m.getRepository(User).create({
          email: input.adminEmail,
          name: input.adminName,
          passwordHash,
          status: UserStatus.Active,
          locale: input.locale,
        }),
      );
      // Os perfis de fábrica nascem com o banco, em pt-BR; aqui passam para o idioma escolhido.
      await localizeFactoryRoles(m, input.locale);
      const admin = await m.getRepository(Role).findOneByOrFail({ systemKey: 'admin' });
      const scopes = m.getRepository(UserRoleScope);
      await scopes.save(scopes.create({ userId: user.id, roleId: admin.id, entityId: root.id, includeChildren: true }));

      await this.settings.set('organization.name', input.organizationName, user.id, m);
      await this.settings.set('organization.timezone', input.timezone, user.id, m);
      await this.settings.set('organization.default_locale', input.locale, user.id, m);
      await this.settings.set('installation.completed_at', new Date().toISOString(), user.id, m);
      await this.audit.record(
        {
          action: 'install.completed',
          actorId: user.id,
          targetType: 'entity',
          targetId: root.id,
          data: { organization: input.organizationName },
          ip: meta.ip,
        },
        m,
      );
      const token = await this.sessions.create(user.id, hours, meta, m);
      return { token, user };
    });

    this.installed = true;
    return { ...result, hours };
  }
}
