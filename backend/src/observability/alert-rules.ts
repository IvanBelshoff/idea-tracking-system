import { minutesSince } from '../common/dates.js';
import type { HealthItem } from './health-rules.js';

/** "Voltou" só vale depois de duas conferências seguidas sem falha (RN-94: 10 minutos). */
export const CHECKS_TO_RECOVER = 2;
/** O mesmo item não avisa falha duas vezes em menos de 30 minutos (RN-94). */
export const MIN_FAILURE_INTERVAL_MINUTES = 30;

/** O que o alerta lembra de cada item entre uma conferência e outra (guardado em `ops_alert_state`). */
export interface AlertItemState {
  failed: boolean;
  /** Conferências seguidas sem falha desde que o item falhou. */
  cleanChecks: number;
  lastFailureNoticeAt: Date | null;
  /** A falha caiu nos 30 minutos e não avisou: a volta também não avisa. */
  silenced: boolean;
}

export type AlertStates = ReadonlyMap<string, AlertItemState>;

const FRESH: AlertItemState = { failed: false, cleanChecks: 0, lastFailureNoticeAt: null, silenced: false };

/**
 * Compara a conferência de agora com o que o alerta lembrava e diz o que avisar (RN-94). Estado
 * vazio é a primeira conferência: item em falha avisa, item em ordem não diz nada. Atenção
 * (`warning`) nunca avisa. Função pura: sem banco e sem relógio próprio.
 */
export function transitions(states: AlertStates, items: readonly HealthItem[], now: Date) {
  const next = new Map(states);
  const failedItems: HealthItem[] = [];
  const recoveredItems: HealthItem[] = [];

  for (const item of items) {
    const before = states.get(item.key) ?? FRESH;

    if (item.state === 'failed') {
      if (before.failed) {
        // Segue em falha (ou piscou e voltou antes de confirmar a volta): zera a contagem.
        next.set(item.key, { ...before, cleanChecks: 0 });
        continue;
      }
      const tooSoon =
        before.lastFailureNoticeAt !== null &&
        minutesSince(before.lastFailureNoticeAt, now) < MIN_FAILURE_INTERVAL_MINUTES;
      if (!tooSoon) failedItems.push(item);
      next.set(item.key, {
        failed: true,
        cleanChecks: 0,
        lastFailureNoticeAt: tooSoon ? before.lastFailureNoticeAt : now,
        silenced: tooSoon,
      });
      continue;
    }

    if (!before.failed) {
      if (!states.has(item.key)) next.set(item.key, FRESH);
      continue;
    }
    const cleanChecks = before.cleanChecks + 1;
    if (cleanChecks < CHECKS_TO_RECOVER) {
      next.set(item.key, { ...before, cleanChecks });
      continue;
    }
    if (!before.silenced) recoveredItems.push(item);
    next.set(item.key, { ...before, failed: false, cleanChecks: 0, silenced: false });
  }

  return { states: next as AlertStates, failedItems, recoveredItems };
}
