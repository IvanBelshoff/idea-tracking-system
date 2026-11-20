import regras from './regras.json';

/**
 * As regras do ITS usadas pelos simuladores, em JavaScript puro. Cada função espelha uma do backend
 * (src/ideas/*-rules.ts) e é conferida contra os vetores que o próprio backend grava no regras.json
 * (regras.test.ts): se o ITS mudar uma regra, o teste do backend falha até o JSON ser regerado, e o
 * teste daqui falha até a função acompanhar.
 */
export type Status = 'submitted' | 'in_review' | 'in_progress' | 'implemented' | 'rejected';
export type Lang = 'pt-BR' | 'en';

/** Dia sem hora, AAAA-MM-DD, em UTC (como o backend). */
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => {
  const d = toDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return toDay(d);
};
const isWeekend = (day: string) => [0, 6].includes(toDate(day).getUTCDay());

/** Previsão de retorno (RN-54): envio + prazo; em dias úteis, sábado e domingo não contam. */
export function triageDueDate(submitted: string, days: number, business: boolean): string {
  if (!business) return addDays(submitted, days);
  let day = submitted;
  let left = days;
  while (left > 0) {
    day = addDays(day, 1);
    if (!isWeekend(day)) left -= 1;
  }
  return day;
}

/** Retorno atrasado (RN-54): ainda Enviada depois da previsão (no dia da previsão, ainda no prazo). */
export const isTriageOverdue = (status: Status, due: string, today: string) => status === 'submitted' && today > due;

/** Prioridade (RN-56): impacto ÷ esforço, com três casas. */
export const priorityScore = (impact: number | null, effort: number | null) =>
  impact === null || effort === null ? null : Math.round((impact / effort) * 1000) / 1000;

export interface Step {
  name: string;
  startDate: string;
  dueDate: string;
  done: boolean;
}
/** Nova etapa só sem etapa aberta (RN-12). */
export const canAddStep = (steps: readonly Step[]) => steps.every((s) => s.done);
/** Prevista não antes do início (RN-16). */
export const validStepDates = (start: string, due: string) => due >= start;
/** Prazo da ideia = prevista da última etapa (RN-17). */
export const ideaDeadline = (steps: readonly Step[]) => steps.at(-1)?.dueDate ?? null;
/** Atrasada (RN-18): Em andamento, com etapa aberta cuja prevista já passou. */
export const isLate = (status: Status, steps: readonly Step[], today: string) => {
  const open = steps.find((s) => !s.done);
  return status === 'in_progress' && !!open && open.dueDate < today;
};
/** Progresso por etapas (RN-19): concluídas ÷ total. */
export const progressBySteps = (steps: readonly Step[]) =>
  steps.length === 0 ? 0 : Math.round((100 * steps.filter((s) => s.done).length) / steps.length);

/** "Apoiar" (RN-86): só enquanto a principal está aberta. */
export const canSupport = (status: Status) => regras.convergence.canSupport[status];
/** Convergir (RN-84): só ideia ainda sem execução. */
export const canBeConverged = (status: Status) => regras.convergence.canBeConverged[status];
/** A principal é a mais antiga; empate, o menor identificador (RN-84). */
export function principalOf<T extends { code: string; submitted: string }>(a: T, b: T): [T, T] {
  if (a.submitted !== b.submitted) return a.submitted < b.submitted ? [a, b] : [b, a];
  return a.code < b.code ? [a, b] : [b, a];
}

export const SLA_DAYS = regras.triage.slaDays;

/** Data no formato do ITS ("19 de nov. de 2026" / "Nov 19, 2026"). */
export const formatDay = (day: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    toDate(day),
  );

/** Árvore de exemplo do simulador "quem enxerga" (a mesma do teste do backend). */
export const TREE = regras.access.tree;
const pathOf = (id: string) => TREE.find((e) => e.id === id)?.mpath ?? '';
/** Um perfil concedido em `grant` vale em `entity`? Com subentidades, vale em todo o ramo (§3.2). */
export const scopeCovers = (grant: string, includeChildren: boolean, entity: string) =>
  includeChildren ? pathOf(entity).startsWith(pathOf(grant)) && pathOf(grant) !== '' : grant === entity;
/** O perfil de fábrica tem a permissão? (a matriz vem do backend, src/identity-access/factory-roles.ts) */
export const roleHas = (role: string, permission: string) =>
  regras.roles.find((r) => r.key === role)?.permissions.includes(permission) ?? false;

/** Pode ser destaque (RN-73)? Implementada sim; Em andamento só com a opção ligada; Não autorizada nunca. */
export const hallEligibility = (status: Status, allowInProgress: boolean): 'ok' | 'rejected' | 'not_ready' =>
  status === 'implemented'
    ? 'ok'
    : status === 'rejected'
      ? 'rejected'
      : status === 'in_progress' && allowInProgress
        ? 'ok'
        : 'not_ready';
export type Consent = 'pending' | 'accepted' | 'declined';
/** O nome aparece no Hall (RN-74, RN-70)? Só com aceite e sem "ocultar meu nome". */
export const showsName = (consent: Consent, hideName: boolean) => consent === 'accepted' && !hideName;
