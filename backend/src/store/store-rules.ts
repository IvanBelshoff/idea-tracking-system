/**
 * Regras puras da loja (M22, RN-159 a RN-173), sem banco, para testar sem infraestrutura.
 */

export const ITEM_KINDS = ['product', 'bonus'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const LIMIT_PERIODS = ['month', 'quarter', 'semester', 'year'] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];

/** Situações do pedido (RN-165 a RN-167): entregue e paga são finais; recusado e cancelado estornam. */
export const ORDER_STATUSES = ['pending', 'approved', 'delivered', 'paid', 'rejected', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Tipos de linha do extrato (RN-160). */
export const LEDGER_KINDS = ['initial', 'earned', 'reserve', 'refund', 'adjustment', 'expiration'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export interface LedgerLine {
  kind: LedgerKind;
  amount: number;
  /** Dia (AAAA-MM-DD, no fuso da instalação) em que a linha entrou. */
  day: string;
}

/** Linhas que são crédito "de origem" e podem vencer (RN-162): saldo inicial, ponto ganho e ajuste positivo. */
export function isExpiringCredit(l: Pick<LedgerLine, 'kind' | 'amount'>): boolean {
  return (l.kind === 'initial' || l.kind === 'earned' || l.kind === 'adjustment') && l.amount > 0;
}

/**
 * Quanto venceu até o dia de corte (RN-162): os gastos consomem primeiro os créditos mais antigos.
 * Créditos de origem até o corte, menos tudo o que já foi consumido (reservas menos estornos, ajustes
 * negativos) e menos o que já expirou. Nunca negativo. O que está reservado em pedido já conta como
 * gasto, então nunca expira; um estorno devolve ao saldo e pode vencer na próxima rodada.
 */
export function expiredAmount(lines: readonly LedgerLine[], cutoffDay: string): number {
  let creditsBefore = 0;
  let consumed = 0;
  let expired = 0;
  for (const l of lines) {
    if (isExpiringCredit(l)) {
      if (l.day <= cutoffDay) creditsBefore += l.amount;
    } else if (l.kind === 'expiration') {
      expired += -l.amount;
    } else {
      // reserva (negativa), estorno (positivo) e ajuste negativo
      consumed += -l.amount;
    }
  }
  return Math.max(0, creditsBefore - Math.max(0, consumed) - expired);
}

/** O dia de corte: créditos de até N meses antes de hoje vencem (no dia em que completam N meses). */
export function expiryCutoff(today: string, months: number): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  // Vence quem entrou ANTES do mesmo dia N meses atrás: o corte é o dia anterior.
  const cut = new Date(Date.UTC(year, month - 1, day) - 86_400_000);
  return cut.toISOString().slice(0, 10);
}

/** Início do período do limite (RN-163), do calendário, para o dia dado. */
export function periodStart(day: string, period: LimitPeriod): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  const first = (month: number) => `${y}-${String(month).padStart(2, '0')}-01`;
  switch (period) {
    case 'month':
      return first(m);
    case 'quarter':
      return first(Math.floor((m - 1) / 3) * 3 + 1);
    case 'semester':
      return first(m <= 6 ? 1 : 7);
    case 'year':
      return first(1);
  }
}

/** Saldo = soma do extrato (RN-160). */
export function balanceOf(lines: readonly Pick<LedgerLine, 'amount'>[]): number {
  return lines.reduce((s, l) => s + l.amount, 0);
}
