/**
 * Regras puras do resultado da ideia (RN-60 a RN-64, RN-82). Sem banco, sem relógio.
 */

export type StepModel = 'free' | 'pdca';
export type PdcaPhase = 'plan' | 'do' | 'check' | 'act';
export const PDCA_PHASES: readonly PdcaPhase[] = ['plan', 'do', 'check', 'act'];

/**
 * Fase da próxima etapa numa ideia com modelo PDCA (RN-60). As etapas continuam sequenciais
 * (RN-12): o modelo só dá o rótulo, uma etapa de cada vez. Depois de "Agir", começa outro ciclo.
 */
export function nextPdcaPhase(last: PdcaPhase | null): PdcaPhase {
  if (last === null) return 'plan';
  return PDCA_PHASES[(PDCA_PHASES.indexOf(last) + 1) % PDCA_PHASES.length] as PdcaPhase;
}

export type Direction = 'increase' | 'decrease';

export interface MeasurementLike {
  direction: Direction;
  baseline: number;
  target: number | null;
  achieved: number | null;
}

/**
 * Atingimento da meta, de 0 a 1 (CA-RN-61.1): quanto do caminho entre a linha de base e a meta foi
 * percorrido. Passar da meta conta como 100%; piorar, como 0%. Sem meta (ou sem obtido, ou meta igual
 * à linha de base) não há percentual (CA-RN-61.2).
 */
export function attainment(m: MeasurementLike): number | null {
  if (m.target === null || m.achieved === null || m.target === m.baseline) return null;
  const sign = m.direction === 'increase' ? 1 : -1;
  const wanted = sign * (m.target - m.baseline);
  if (wanted <= 0) return null; // meta no sentido contrário ao escolhido: não há o que medir
  const done = sign * (m.achieved - m.baseline);
  return Math.min(1, Math.max(0, done / wanted));
}

/** Variação do obtido em relação à linha de base (sempre mostrada quando há obtido). */
export function variation(
  baseline: number,
  achieved: number | null,
): { absolute: number; percent: number | null } | null {
  if (achieved === null) return null;
  return { absolute: achieved - baseline, percent: baseline === 0 ? null : (achieved - baseline) / Math.abs(baseline) };
}

export type Periodicity = 'once' | 'monthly' | 'yearly';

/** Ganho anualizado (CA-RN-62.2): mensal × 12; anual e único × 1. */
export function annualize(value: number, periodicity: Periodicity): number {
  return periodicity === 'monthly' ? value * 12 : value;
}

/**
 * Retorno (RN-82, CA-RN-82.1): ganho realizado **validado** (anualizado) ÷ custo de implementação.
 * Ganho só declarado não entra; custo zero ou ausente → não calculável (`null`).
 */
export function roi(validatedAnnualGain: number | null, cost: number | null): number | null {
  if (validatedAnnualGain === null || cost === null || cost === 0) return null;
  return validatedAnnualGain / cost;
}
