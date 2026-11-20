import { daysBetween } from '../common/dates.js';
import { IdeaStatus } from './entities/idea.entity.js';

/**
 * Regras puras de etapas e prazos (RN-12 a RN-19). Datas sem hora em `AAAA-MM-DD`, que se
 * comparam como texto; "hoje" é sempre calculado no fuso da instalação (CA-T.3).
 */
export interface StepLike {
  position: number;
  startDate: string;
  dueDate: string;
  completedAt: Date | null;
}

const byPosition = <T extends StepLike>(steps: readonly T[]) => [...steps].sort((a, b) => a.position - b.position);

/** Prazo da ideia = previsão da última etapa (RN-17). Sem etapas, não há prazo. */
export function ideaDeadline(steps: readonly StepLike[]): string | null {
  return byPosition(steps).at(-1)?.dueDate ?? null;
}

/** A etapa aberta (só pode haver uma: são sequenciais, RN-12). */
export function openStep<T extends StepLike>(steps: readonly T[]): T | null {
  return byPosition(steps).find((s) => s.completedAt === null) ?? null;
}

/** Pode criar nova etapa? Só se não houver etapa aberta (RN-12). */
export function canAddStep(steps: readonly StepLike[]): boolean {
  return openStep(steps) === null;
}

/** Próxima posição, sem lacuna (RN-14). */
export function nextPosition(steps: readonly StepLike[]): number {
  return steps.length + 1;
}

/** Só a última etapa, aberta, é editável (RN-13). */
export function isEditableStep(step: StepLike, steps: readonly StepLike[]): boolean {
  const last = byPosition(steps).at(-1);
  return step.completedAt === null && last?.position === step.position;
}

/**
 * Excluir: só a última etapa aberta, e só se sobrar outra (uma ideia em andamento nunca fica sem
 * etapas; CA-RN-13.3). Sem lacuna: a última sai e as demais mantêm as posições (CA-RN-14.1).
 */
export function isDeletableStep(step: StepLike, steps: readonly StepLike[]): boolean {
  return isEditableStep(step, steps) && steps.length > 1;
}

/** Prevista não pode ser antes do início; igual é aceito (RN-16, CA-RN-16.1). */
export function validStepDates(startDate: string, dueDate: string): boolean {
  return dueDate >= startDate;
}

/**
 * Atrasada (RN-18): só ideia Em andamento, com etapa aberta cuja previsão já passou. A previsão
 * de hoje ainda não é atraso: atrasa no dia seguinte (CA-RN-18.4).
 */
export function isLate(status: IdeaStatus, steps: readonly StepLike[], today: string): boolean {
  if (status !== IdeaStatus.InProgress) return false;
  const open = openStep(steps);
  return open !== null && open.dueDate < today;
}

export type ProgressMode = 'steps' | 'time';

/**
 * Progresso em % (RN-19), inteiro de 0 a 100.
 * - "etapas": concluídas ÷ total (CA-RN-19.1);
 * - "tempo": dias decorridos desde o início da 1ª etapa ÷ dias até o prazo (CA-RN-19.2).
 * Sem etapas: 0% (CA-RN-19.3). Implementada: 100%.
 */
export function progress(mode: ProgressMode, status: IdeaStatus, steps: readonly StepLike[], today: string): number {
  if (status === IdeaStatus.Implemented) return 100;
  if (steps.length === 0) return 0;
  if (mode === 'steps') return Math.round((100 * steps.filter((s) => s.completedAt !== null).length) / steps.length);
  const ordered = byPosition(steps);
  const start = ordered[0]?.startDate ?? today;
  const end = ordered.at(-1)?.dueDate ?? today;
  const total = daysBetween(start, end);
  if (total <= 0) return today >= end ? 100 : 0;
  const ratio = daysBetween(start, today) / total;
  return Math.round(100 * Math.min(1, Math.max(0, ratio)));
}
