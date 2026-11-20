import { isInternalEmail } from '../domain-policy.js';
import type { SsoProviderId } from '../entities/sso-provider.entity.js';
import type { Permission } from '../permissions.js';
import type { ProviderIdentity } from './providers.js';
import { SsoError } from './sso-errors.js';

/**
 * Regras puras do login corporativo (RN-96 a RN-98): sem banco e sem rede, para testar nos limites.
 */

export type LoginMode = 'password' | 'password_sso' | 'sso';

/**
 * Esta pessoa pode entrar por senha? (RN-97, CA-RN-97.1.) Fora do modo "Só SSO" sempre pode. No
 * modo "Só SSO" só pode quem tem o acesso de emergência (`setting.manage`) ou quem tem e-mail de
 * fora dos domínios, que não tem como entrar por SSO.
 */
export function canUsePassword(p: {
  mode: LoginMode;
  email: string;
  domains: readonly string[];
  isEmergency: boolean;
}): boolean {
  if (p.mode !== 'sso') return true;
  if (p.isEmergency) return true;
  return !isInternalEmail(p.email, p.domains);
}

/**
 * Confere o que o provedor disse sobre a pessoa e devolve o e-mail normalizado. SSO exige domínios
 * cadastrados; e-mail de fora entra só com senha (CA-RN-96.6 e 96.7).
 */
export function assertIdentityAllowed(
  provider: SsoProviderId,
  identity: ProviderIdentity,
  domains: readonly string[],
): string {
  if (domains.length === 0) throw new SsoError('sso_domain_not_allowed', 'Não há domínios cadastrados.');
  if (!identity.email) throw new SsoError('sso_email_missing', 'O provedor não informou o e-mail.');
  if (!identity.emailVerified) throw new SsoError('sso_email_unverified', 'O e-mail não está verificado.');
  if (provider === 'google' && (!identity.hostedDomain || !domains.includes(identity.hostedDomain))) {
    throw new SsoError('sso_domain_not_allowed', 'A conta Google não é de um domínio da organização.');
  }
  if (!isInternalEmail(identity.email, domains)) {
    throw new SsoError('sso_domain_not_allowed', 'O e-mail não é de um domínio da organização.');
  }
  return identity.email;
}

export type EnableBlocker =
  | 'app_url_required'
  | 'https_required'
  | 'secret_key_missing'
  | 'provider_incomplete'
  | 'domains_required'
  | 'test_required';

/** `https://` obrigatório, salvo em localhost (a Microsoft e o Google só aceitam `http` lá). */
export function isHttpsOrLocal(appUrl: string): boolean {
  try {
    const url = new URL(appUrl);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** O que falta para ligar um provedor (CA-RN-97.6). Lista vazia = pode ligar. */
export function enableBlockers(p: {
  provider: SsoProviderId;
  appUrl: string;
  secretKeyReady: boolean;
  clientId: string;
  tenantId: string | null;
  hasSecret: boolean;
  lastTestOk: boolean | null;
  domains: readonly string[];
}): EnableBlocker[] {
  const out: EnableBlocker[] = [];
  if (p.appUrl === '') out.push('app_url_required');
  else if (!isHttpsOrLocal(p.appUrl)) out.push('https_required');
  if (!p.secretKeyReady) out.push('secret_key_missing');
  const complete = p.clientId !== '' && p.hasSecret && (p.provider !== 'microsoft' || !!p.tenantId);
  if (!complete) out.push('provider_incomplete');
  if (p.domains.length === 0) out.push('domains_required');
  if (p.lastTestOk !== true) out.push('test_required');
  return out;
}

export type ModeBlocker = 'no_provider_enabled' | 'domains_required' | 'admin_not_linked';

/** O que impede escolher o modo (CA-RN-97.8). */
export function modeBlockers(p: {
  mode: LoginMode;
  enabledProviders: number;
  domains: readonly string[];
  actorLinked: boolean;
}): ModeBlocker[] {
  if (p.mode === 'password') return [];
  const out: ModeBlocker[] = [];
  if (p.enabledProviders === 0) out.push('no_provider_enabled');
  if (p.domains.length === 0) out.push('domains_required');
  if (p.mode === 'sso' && !p.actorLinked) out.push('admin_not_linked');
  return out;
}

/**
 * Permissões que tornam um perfil "administrativo". Um perfil com qualquer uma delas, ou o perfil
 * de fábrica Administrador, nunca pode ser o perfil inicial da criação automática (RN-98).
 */
export const ADMIN_CLASS_PERMISSIONS: readonly Permission[] = [
  'user.manage',
  'role.manage',
  'setting.manage',
  'sso.manage',
  'email.manage',
  'audit.view',
  'ops.view',
];

export function isAdministrativeRole(role: { systemKey: string | null; permissions: readonly string[] }): boolean {
  return (
    role.systemKey === 'admin' ||
    role.permissions.some((p) => (ADMIN_CLASS_PERMISSIONS as readonly string[]).includes(p))
  );
}

/** Nome da conta criada: o do provedor, ou o que vem antes do `@`; no máximo 200 caracteres (CA-RN-98.8). */
export function provisionedName(name: string | null, email: string): string {
  const base = (name ?? '').trim() || email.split('@')[0] || email;
  return base.slice(0, 200);
}
