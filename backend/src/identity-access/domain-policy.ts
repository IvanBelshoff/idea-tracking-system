/**
 * Política de domínio de e-mail (RN-95). Regras puras, sem banco: quem chama lê as configurações
 * `auth.email_domains` e `auth.allow_external_email` e passa aqui.
 */

export interface DomainPolicy {
  /** Domínios da empresa, já normalizados. Vazio = sem restrição. */
  domains: readonly string[];
  /** Aceita e-mail fora dos domínios. */
  allowExternal: boolean;
}

/** Formato de domínio aceito: rótulos de letras, dígitos e hífen, separados por ponto, com TLD. */
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** `Empresa.COM`, `@empresa.com` e ` empresa.com ` são o mesmo domínio (CA-RN-95.1). */
export function normalizeDomain(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

export function isValidDomain(domain: string): boolean {
  return DOMAIN.test(domain);
}

/** Normaliza e tira repetidos, preservando a ordem de entrada. */
export function normalizeDomains(raw: readonly string[]): string[] {
  return [...new Set(raw.map(normalizeDomain))];
}

/** O domínio de um e-mail, em minúsculas; vazio se não houver `@`. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0
    ? ''
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/** O e-mail pertence a um dos domínios da empresa (CA-RN-96.7). */
export function isInternalEmail(email: string, domains: readonly string[]): boolean {
  const domain = emailDomain(email);
  return domain !== '' && domains.includes(domain);
}

/**
 * Pode cadastrar (ou trocar para) este e-mail? Lista vazia ou e-mail de fora ligado: sim;
 * senão, só dentro dos domínios (CA-RN-95.2 a 95.5).
 */
export function isEmailAllowed(email: string, policy: DomainPolicy): boolean {
  if (policy.domains.length === 0 || policy.allowExternal) return true;
  return isInternalEmail(email, policy.domains);
}

/** Entre os usuários dados, quem está fora da política (para o aviso da tela; CA-RN-95.6). */
export function outsidePolicy<T extends { email: string }>(users: readonly T[], domains: readonly string[]): T[] {
  if (domains.length === 0) return [];
  return users.filter((u) => !isInternalEmail(u.email, domains));
}
