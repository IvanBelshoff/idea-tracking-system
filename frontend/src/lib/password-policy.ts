/**
 * Mesma regra do backend (backend/src/identity-access/password.ts), só para mostrar o progresso
 * enquanto a pessoa digita. Quem decide é sempre o servidor.
 */
export interface PasswordPolicy {
  minLength: number;
  minClasses: number;
}

export function passwordChecks(password: string, policy: PasswordPolicy) {
  const length = [...password].length;
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{Nd}]/u].filter((re) => re.test(password)).length;
  return {
    length: length >= policy.minLength,
    classes: classes >= Math.min(policy.minClasses, 4),
  };
}

export function meetsPolicy(password: string, policy: PasswordPolicy): boolean {
  const c = passwordChecks(password, policy);
  return c.length && c.classes;
}

/** Política padrão, usada só enquanto as configurações públicas carregam. */
export const DEFAULT_POLICY: PasswordPolicy = { minLength: 10, minClasses: 3 };
