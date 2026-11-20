/**
 * Validade dos segredos (M14, RN-100): regras puras, sem banco. A data é `AAAA-MM-DD`; os dias restantes
 * são contados no fuso da instalação (CA-T.3), então a virada de dia segue a instalação, não o servidor.
 */
import { daysBetween, todayInZone } from '../common/dates.js';

/** Dias restantes que mudam o estado (RN-100). */
export const SECRET_LIMITS = {
  /** A 30 dias ou menos do vencimento: atenção. */
  warningDays: 30,
  /** A 7 dias ou menos, ou já vencido: falha (e alerta, RN-94). */
  failedDays: 7,
} as const;

export type SecretState = 'ok' | 'warning' | 'failed';

export interface SecretVerdict {
  state: SecretState;
  /** `ok`, `no_date` (sem data informada), `expiring` (a vencer) ou `expired` (vencido). */
  code: 'ok' | 'no_date' | 'expiring' | 'expired';
  /** Dias até vencer (0 = vence hoje; negativo = venceu); nulo sem data. */
  days: number | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Dias de hoje (no fuso) até a data de validade; nulo se a data falta ou não é uma data de verdade. */
export function daysLeft(expiresOn: string | null | undefined, now: Date, timeZone: string): number | null {
  if (!expiresOn || !DAY.test(expiresOn)) return null;
  const parsed = new Date(`${expiresOn}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== expiresOn) return null;
  return daysBetween(todayInZone(now, timeZone), expiresOn);
}

/** O estado de um segredo pela data de validade (CA-RN-100.2). */
export function secretVerdict(expiresOn: string | null | undefined, now: Date, timeZone: string): SecretVerdict {
  const days = daysLeft(expiresOn, now, timeZone);
  if (days === null) return { state: 'warning', code: 'no_date', days: null };
  if (days < 0) return { state: 'failed', code: 'expired', days };
  if (days <= SECRET_LIMITS.failedDays) return { state: 'failed', code: 'expiring', days };
  if (days <= SECRET_LIMITS.warningDays) return { state: 'warning', code: 'expiring', days };
  return { state: 'ok', code: 'ok', days };
}

const RANK: Record<SecretState, number> = { ok: 0, warning: 1, failed: 2 };

/** O pior veredito de vários segredos; no empate, o que vence primeiro (sem data conta por último). */
export function worstVerdict(verdicts: readonly SecretVerdict[]): SecretVerdict | null {
  let worst: SecretVerdict | null = null;
  for (const v of verdicts) {
    if (
      !worst ||
      RANK[v.state] > RANK[worst.state] ||
      (RANK[v.state] === RANK[worst.state] &&
        (v.days ?? Number.POSITIVE_INFINITY) < (worst.days ?? Number.POSITIVE_INFINITY))
    ) {
      worst = v;
    }
  }
  return worst;
}
