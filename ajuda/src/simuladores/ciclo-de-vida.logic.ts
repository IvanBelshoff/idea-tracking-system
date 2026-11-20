import regras from './regras.json';

/**
 * Lógica do simulador do ciclo de vida, pura (sem React). As transições vêm do regras.json, que o
 * backend gera a partir de src/ideas/lifecycle.ts: o simulador oferece exatamente as ações que o
 * ITS aceita em cada situação.
 */
export type Status = 'submitted' | 'in_review' | 'in_progress' | 'implemented' | 'rejected';
export type Action = 'start_review' | 'approve' | 'reject' | 'interrupt' | 'implement' | 'reopen';

const TRANSITIONS = regras.lifecycle.transitions as Record<Action, Partial<Record<Status, Status>>>;
export const STATUSES = regras.lifecycle.statuses as Status[];
export const ACTIONS = regras.lifecycle.actions as Action[];
export const isClosed = (s: Status) => (regras.lifecycle.closed as Status[]).includes(s);

/** O que cada ação exige e quem pode fazê-la (perfis de fábrica). */
export const ACTION_META: Record<
  Action,
  { needs: 'reason' | 'responsible' | 'result' | null; who: 'analyst' | 'admin'; rule: string }
> = {
  start_review: { needs: null, who: 'analyst', rule: 'RN-10' },
  approve: { needs: 'responsible', who: 'analyst', rule: 'RN-06' },
  reject: { needs: 'reason', who: 'analyst', rule: 'RN-05' },
  interrupt: { needs: 'reason', who: 'analyst', rule: 'RN-05' },
  implement: { needs: 'result', who: 'analyst', rule: 'RN-07' },
  reopen: { needs: 'reason', who: 'admin', rule: 'RN-09' },
};

export interface HistoryEntry {
  action: Action;
  from: Status;
  to: Status;
  note: string;
}
export interface SimState {
  status: Status;
  history: HistoryEntry[];
}
export const INITIAL: SimState = { status: 'submitted', history: [] };

export const availableActions = (status: Status): Action[] => ACTIONS.filter((a) => TRANSITIONS[a][status]);

export type ApplyError = 'invalid' | 'needs_reason' | 'needs_responsible' | 'needs_result';

/** Aplica a ação: o novo estado, ou o motivo de não poder (a mesma checagem do ITS). */
export function apply(state: SimState, action: Action, input = ''): SimState | ApplyError {
  const to = TRANSITIONS[action][state.status];
  if (!to) return 'invalid';
  const note = input.trim();
  const needs = ACTION_META[action].needs;
  if (needs && !note) return `needs_${needs}`;
  return { status: to, history: [...state.history, { action, from: state.status, to, note }] };
}
