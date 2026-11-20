import { addDaysToDay, daysBetween } from '../common/dates.js';
import { type IdeaStatus, IdeaStatus as S } from './entities/idea.entity.js';

/**
 * Regras puras da triagem em volume (RN-54, RN-55). Sem banco, para testar sem infraestrutura.
 */

/** Dia da semana de uma data AAAA-MM-DD (0 = domingo), sem depender do fuso do processo. */
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const isWeekend = (day: string) => {
  const d = weekday(day);
  return d === 0 || d === 6;
};

/**
 * Previsão de retorno (RN-54): data do envio + prazo. Em dias úteis, sábado e domingo não contam
 * (CA-RN-54.3); feriados ficam para quando houver calendário da instalação.
 */
export function triageDueDate(submittedDay: string, slaDays: number, businessDays: boolean): string {
  if (!businessDays) return addDaysToDay(submittedDay, slaDays);
  let day = submittedDay;
  let left = slaDays;
  while (left > 0) {
    day = addDaysToDay(day, 1);
    if (!isWeekend(day)) left -= 1;
  }
  return day;
}

/**
 * Retorno atrasado (RN-54): ideia ainda Enviada depois da previsão de retorno. No dia da previsão
 * ainda está no prazo: com prazo de 10 dias, enviada há 10 dias está no prazo e há 11, atrasada
 * (CA-RN-54.1). Ao ser assumida (Em análise), o autor já teve retorno.
 */
export function isTriageOverdue(status: IdeaStatus, dueDay: string, today: string): boolean {
  return status === S.Submitted && today > dueDay;
}

// --- Atribuição automática (RN-55) -------------------------------------------------------------

export interface TriageRuleLike {
  id: string;
  entityId: string | null;
  categoryId: string | null;
  assigneeId: string;
  priority: number;
}

export interface EntityPath {
  id: string;
  mpath: string;
}

/**
 * A regra que vale para a ideia (CA-RN-55.2):
 * 1. a regra precisa casar: entidade da ideia dentro da entidade da regra (com sub-entidades) e
 *    categoria igual; campo vazio na regra vale para qualquer valor;
 * 2. vence a mais específica: entidade E categoria > só uma delas > nenhuma; entre regras de
 *    entidade, a da entidade mais funda (mais perto da ideia);
 * 3. empate: maior prioridade; depois, a criada primeiro (id menor), para o resultado ser estável.
 * Sem regra que case: `null` (fila geral).
 */
export function chooseTriageRule<T extends TriageRuleLike>(
  rules: readonly T[],
  idea: { entityId: string; categoryId: string | null },
  tree: readonly EntityPath[],
): T | null {
  const pathOf = new Map(tree.map((e) => [e.id, e.mpath]));
  const ideaPath = pathOf.get(idea.entityId);
  if (ideaPath === undefined) return null;
  const depth = (mpath: string) => mpath.split('.').filter(Boolean).length;

  const scored = rules
    .filter((r) => {
      if (r.categoryId && r.categoryId !== idea.categoryId) return false;
      if (!r.entityId) return true;
      const rulePath = pathOf.get(r.entityId);
      return rulePath !== undefined && ideaPath.startsWith(rulePath);
    })
    .map((r) => ({
      rule: r,
      specificity: (r.entityId ? 1 : 0) + (r.categoryId ? 1 : 0),
      depth: r.entityId ? depth(pathOf.get(r.entityId) ?? '') : 0,
    }));
  scored.sort(
    (a, b) =>
      b.specificity - a.specificity ||
      b.depth - a.depth ||
      b.rule.priority - a.rule.priority ||
      (a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0),
  );
  return scored[0]?.rule ?? null;
}

/** Nota de prioridade (RN-56): impacto ÷ esforço; sem um dos dois, sem nota. */
export function priorityScore(impact: number | null, effort: number | null): number | null {
  if (impact === null || effort === null) return null;
  return Math.round((impact / effort) * 1000) / 1000;
}

/** Dias corridos que a ideia está esperando o primeiro retorno (para mostrar na fila). */
export const waitingDays = (submittedDay: string, today: string): number =>
  Math.max(0, daysBetween(submittedDay, today));
