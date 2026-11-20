import { z } from 'zod';
import { apiError } from '../common/api-error.js';
import { daysAgo, hoursFromNow } from '../common/dates.js';

/** O histórico vai de uma hora até 31 dias atrás (RN-92); o padrão são as últimas 24 horas. */
export const MAX_HISTORY_DAYS = 31;

export const HistoryQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Resolve o período pedido; invertido ou maior que 31 dias → 422 (CA-RN-92.5). */
export function resolveHistoryRange(query: { from?: Date; to?: Date }, now = new Date()): { from: Date; to: Date } {
  const to = query.to ?? now;
  const from = query.from ?? hoursFromNow(-24, to);
  if (from > to) throw apiError(422, 'invalid_period', 'O início do período vem depois do fim.');
  if (from < daysAgo(MAX_HISTORY_DAYS, to)) {
    throw apiError(422, 'invalid_period', `O período vai até ${MAX_HISTORY_DAYS} dias.`);
  }
  return { from, to };
}
