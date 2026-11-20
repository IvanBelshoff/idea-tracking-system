import { addMonthsToMonth, monthsBetween } from '../common/dates.js';

/** Máximo de meses na evolução mensal (um período maior mostra os últimos). */
export const MAX_MONTHS = 36;

/** Razão com denominador zero → `null` ("sem dados", nunca zero; CA-RN-81.1). */
export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Meses da evolução mensal (RN-81): os do período escolhido; sem início, os 12 meses que terminam no
 * fim do período (ou no mês atual). Períodos maiores que {@link MAX_MONTHS} mostram os últimos.
 */
export function engagementMonths(currentMonth: string, from?: string, to?: string): string[] {
  const end = to ? to.slice(0, 7) : currentMonth;
  const start = from ? from.slice(0, 7) : addMonthsToMonth(end, -11);
  return monthsBetween(start, end).slice(-MAX_MONTHS);
}
