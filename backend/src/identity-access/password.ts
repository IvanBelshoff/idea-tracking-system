import { createHash, randomBytes } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Senhas: somente hash adaptativo Argon2id (RN-42, CA-RN-42.4). Parâmetros mínimos recomendados
 * pela OWASP (19 MiB de memória, 2 iterações, 1 via).
 */
const ARGON2 = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Hash de uma senha aleatória, calculado uma vez: quando o e-mail não existe, o login verifica
 * contra ele para gastar o mesmo tempo e não revelar se a conta existe (CA-RN-42.2).
 */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHash;
}

// --- Política de senha (CA-RN-42.1) -------------------------------------------------------------

export interface PasswordPolicy {
  minLength: number;
  /** Classes exigidas entre: minúscula, maiúscula, dígito, símbolo. */
  minClasses: number;
}

export type PasswordViolation = 'too_short' | 'too_long' | 'too_few_classes';

/** Limite superior: evita gastar CPU com entradas gigantes no hash. */
export const PASSWORD_MAX_LENGTH = 128;

/** Regra pura: lista o que a senha não atende (vazia = aceita). */
export function checkPasswordPolicy(password: string, policy: PasswordPolicy): PasswordViolation[] {
  const violations: PasswordViolation[] = [];
  const length = [...password].length;
  if (length < policy.minLength) violations.push('too_short');
  if (length > PASSWORD_MAX_LENGTH) violations.push('too_long');
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{Nd}]/u].filter((re) => re.test(password)).length;
  if (classes < Math.min(policy.minClasses, 4)) violations.push('too_few_classes');
  return violations;
}

// --- Tokens (sessão e recuperação) ---------------------------------------------------------------

/** Token aleatório de 256 bits para o cookie ou o link. Só o hash vai para o banco. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
