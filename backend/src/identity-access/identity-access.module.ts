import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../organization/settings.service.js';
import { AccessService } from './access.service.js';
import { AccessAdminController } from './access-admin.controller.js';
import { AccessAdminService } from './access-admin.service.js';
import { AuthController, InstallController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AvatarController } from './avatar.controller.js';
import { AvatarService } from './avatar.service.js';
import { InstallGuard, PermissionGuard, ProfileGuard, SessionGuard } from './guards.js';
import { InstallService } from './install.service.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';
import { SessionService } from './session.service.js';
import { SsoController } from './sso/sso.controller.js';
import { SsoService } from './sso/sso.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * Identidade e acesso: instalação, sessões, login e senhas. Os guards são globais e rodam nesta
 * ordem: instalação concluída → sessão válida → permissão exigida pela rota.
 */
@Global()
@Module({
  controllers: [
    InstallController,
    AuthController,
    UsersController,
    RolesController,
    AvatarController,
    AccessAdminController,
    SsoController,
  ],
  providers: [
    SettingsService,
    AuditService,
    SessionService,
    AuthService,
    InstallService,
    AccessService,
    AccessAdminService,
    SsoService,
    UsersService,
    RolesService,
    AvatarService,
    { provide: APP_GUARD, useClass: InstallGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: ProfileGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [SettingsService, AuditService, SessionService, AuthService, AccessService, AvatarService, UsersService],
})
export class IdentityAccessModule {}
