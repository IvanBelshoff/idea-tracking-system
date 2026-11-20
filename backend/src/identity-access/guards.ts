import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { missingRequired } from '../user-fields/profile.js';
import { AccessService } from './access.service.js';
import {
  ALLOW_BEFORE_INSTALL,
  ALLOW_INCOMPLETE,
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
  type RequestWithAuth,
} from './auth-context.js';
import { InstallService } from './install.service.js';
import type { Permission } from './permissions.js';
import { SessionService } from './session.service.js';
import { readSessionCookie } from './session-cookie.js';

/** Antes da instalação, só o assistente e o health respondem (CA-RN-43.1). */
@Injectable()
export class InstallGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly install: InstallService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_BEFORE_INSTALL, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed || (await this.install.isInstalled())) return true;
    throw apiError(503, 'not_installed', 'O sistema ainda não foi instalado. Conclua o assistente de instalação.');
  }
}

/**
 * Exige sessão válida em toda rota que não seja @Public (RN-01: nenhuma regra de acesso é só
 * visual). Em rotas públicas, a sessão é lida se existir, sem obrigar.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = readSessionCookie(req);
    const auth = token ? await this.sessions.resolve(token) : null;
    if (auth) req.auth = auth;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic || auth) return true;
    throw apiError(401, 'unauthenticated', 'Sessão ausente ou expirada. Entre novamente.');
  }
}

/**
 * Cadastro incompleto (M25, RN-197): com um campo obrigatório vazio, a pessoa só usa as rotas da própria
 * conta (`@AllowIncompleteProfile`) até preencher; o resto recebe 428 `profile_incomplete`. Quem tem
 * `setting.manage` passa (acesso de emergência, como na RN-97). Rotas públicas e a integração (token, sem
 * sessão) não passam por aqui.
 */
@Injectable()
export class ProfileGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    if (!req.auth) return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_INCOMPLETE, targets)) return true;
    const missing = await missingRequired(this.dataSource.manager, req.auth.user.id);
    if (missing.length === 0) return true;
    if ((await this.access.forRequest(req)).has('setting.manage')) return true;
    throw apiError(428, 'profile_incomplete', 'Preencha os campos obrigatórios do seu cadastro para continuar.', {
      missing,
    });
  }
}

/**
 * Permissão exigida por @RequirePermission (basta uma das listadas). Sem a permissão → 403.
 * Roda depois do SessionGuard. Carrega o acesso efetivo e o deixa na requisição.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    if (!req.auth) throw apiError(401, 'unauthenticated', 'Sessão ausente ou expirada. Entre novamente.');
    const access = await this.access.forRequest(req);
    if (required.some((p) => access.has(p))) return true;
    throw apiError(403, 'forbidden', 'Você não tem permissão para esta ação.');
  }
}
