import type { EntityManager } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { getSetting } from '../organization/settings.service.js';
import { type DomainPolicy, isEmailAllowed } from './domain-policy.js';

/** Lê a política de domínio das configurações (RN-95). */
export async function loadDomainPolicy(m: EntityManager): Promise<DomainPolicy> {
  const [domains, allowExternal] = await Promise.all([
    getSetting(m, 'auth.email_domains'),
    getSetting(m, 'auth.allow_external_email'),
  ]);
  return { domains, allowExternal };
}

/** Recusa com 422 `email_domain_not_allowed` se o e-mail está fora da política (CA-RN-95.2 e 95.3). */
export async function assertEmailAllowed(m: EntityManager, email: string): Promise<void> {
  const policy = await loadDomainPolicy(m);
  if (!isEmailAllowed(email, policy)) {
    throw apiError(422, 'email_domain_not_allowed', 'O e-mail precisa ser de um dos domínios da organização.', {
      domains: policy.domains,
    });
  }
}
