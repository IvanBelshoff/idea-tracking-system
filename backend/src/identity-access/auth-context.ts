import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Access } from './access.js';
import type { User } from './entities/user.entity.js';
import type { Permission } from './permissions.js';

/** Quem está chamando: preenchido pelo SessionGuard a partir do cookie de sessão. */
export interface AuthContext {
  user: User;
  sessionId: string;
}

export interface RequestWithAuth extends Request {
  auth?: AuthContext;
  /** Acesso efetivo, calculado sob demanda uma vez por requisição (AccessService.forRequest). */
  access?: Access;
}

/** Rota que não exige login (ex.: login, consulta pública). */
export const IS_PUBLIC = 'its:public';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Rota que responde mesmo antes da instalação (só o assistente e o health; RN-43). */
export const ALLOW_BEFORE_INSTALL = 'its:allow-before-install';
export const AllowBeforeInstall = () => SetMetadata(ALLOW_BEFORE_INSTALL, true);

/**
 * Rota que responde mesmo com campo obrigatório vazio (RN-197): a própria conta, os próprios campos,
 * a foto e sair. As outras recebem 428 `profile_incomplete`.
 */
export const ALLOW_INCOMPLETE = 'its:allow-incomplete';
export const AllowIncompleteProfile = () => SetMetadata(ALLOW_INCOMPLETE, true);

/**
 * Exige a permissão em pelo menos uma entidade (rotas administrativas). Checagens por entidade
 * específica (ex.: triar ideia de B) ficam no serviço, com `access.hasIn`.
 */
export const REQUIRED_PERMISSIONS = 'its:required-permissions';
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Injeta o acesso efetivo do usuário (já carregado pelo PermissionGuard ou sob demanda). */
export const CurrentAccess = createParamDecorator((_data: unknown, ctx: ExecutionContext): Access => {
  const access = ctx.switchToHttp().getRequest<RequestWithAuth>().access;
  if (!access) throw new Error('CurrentAccess usado numa rota sem @RequirePermission.');
  return access;
});

/** Injeta o contexto autenticado no handler. Só use em rotas protegidas. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<RequestWithAuth>().auth;
  if (!auth) throw new Error('CurrentAuth usado numa rota sem sessão.');
  return auth;
});

/** Metadados da requisição que vão para o log de auditoria e para a sessão. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 500) ?? null };
}
