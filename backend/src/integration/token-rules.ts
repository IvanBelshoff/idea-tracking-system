import { randomBytes } from 'node:crypto';
import { tokenHash } from '../identity-access/password.js';
import { INTEGRATION_LIMITS } from './modules.js';

/**
 * Token de integração (RN-104): regras puras, sem banco. O token é `its_` mais 256 bits em base64url;
 * só o hash e um prefixo curto são gravados, e o valor aparece uma única vez, na criação ou na rotação.
 */
export const TOKEN_MARK = 'its_';
/** Tamanho do prefixo mostrado na tela: `its_` mais 4 caracteres. */
export const TOKEN_PREFIX_LENGTH = 8;
const TOKEN_FORMAT = /^its_[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface NewToken {
  /** O valor completo: devolvido uma vez e nunca guardado. */
  token: string;
  /** SHA-256 em hexadecimal, o que vai para o banco. */
  hash: string;
  prefix: string;
}

export function newIntegrationToken(): NewToken {
  const token = `${TOKEN_MARK}${randomBytes(32).toString('base64url')}`;
  return { token, hash: tokenHash(token), prefix: token.slice(0, TOKEN_PREFIX_LENGTH) };
}

/**
 * Tira o token do cabeçalho `Authorization: Bearer <token>` (RN-104). Qualquer outra coisa
 * (ausente, esquema errado, formato errado) é "sem token": nunca se diz o motivo.
 */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  const token = match?.[1];
  return token && TOKEN_FORMAT.test(token) ? token : null;
}

export interface TokenTimes {
  expiresAt: Date;
  /** Fim da sobreposição de um token que foi girado. */
  retireAt: Date | null;
  revokedAt: Date | null;
}

export type TokenState = 'active' | 'retiring' | 'retired' | 'expired' | 'revoked';

/** O estado do token agora: `retiring` ainda vale (o antigo de uma rotação), `retired` não. */
export function tokenState(t: TokenTimes, now: Date): TokenState {
  if (t.revokedAt) return 'revoked';
  if (now.getTime() >= t.expiresAt.getTime()) return 'expired';
  if (t.retireAt) return now.getTime() >= t.retireAt.getTime() ? 'retired' : 'retiring';
  return 'active';
}

/** O token autentica? Não revogado, dentro da validade e fora da janela de aposentadoria. */
export function isTokenValid(t: TokenTimes, now: Date): boolean {
  const state = tokenState(t, now);
  return state === 'active' || state === 'retiring';
}

export function countActiveTokens(tokens: readonly TokenTimes[], now: Date): number {
  return tokens.filter((t) => isTokenValid(t, now)).length;
}

/**
 * Validade pedida (RN-104): obrigatória, no futuro e a no máximo 365 dias. O banco repete o limite
 * (`CHECK` contra `created_at`).
 */
export function checkExpiry(expiresAt: Date, now: Date): 'ok' | 'in_the_past' | 'too_far' {
  if (expiresAt.getTime() <= now.getTime()) return 'in_the_past';
  if (expiresAt.getTime() > now.getTime() + INTEGRATION_LIMITS.maxTokenDays * DAY_MS) return 'too_far';
  return 'ok';
}

/** Quando o token antigo deixa de valer numa rotação: fim da janela, nunca depois da validade dele. */
export function retireAtFor(oldExpiresAt: Date, now: Date, overlapHours: number): Date {
  const end = now.getTime() + overlapHours * HOUR_MS;
  return new Date(Math.min(end, oldExpiresAt.getTime()));
}

/**
 * A validade que conta para a saúde (RN-113): a do token de maior validade que não foi revogado
 * (o antigo de uma rotação não pesa). Sem nenhum token não revogado, nulo.
 */
export function healthExpiry(tokens: readonly Pick<TokenTimes, 'expiresAt' | 'revokedAt'>[]): Date | null {
  let best: Date | null = null;
  for (const t of tokens) {
    if (t.revokedAt) continue;
    if (!best || t.expiresAt.getTime() > best.getTime()) best = t.expiresAt;
  }
  return best;
}
