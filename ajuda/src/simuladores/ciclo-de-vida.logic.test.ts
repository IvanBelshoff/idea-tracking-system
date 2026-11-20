import { describe, expect, it } from 'vitest';
import { apply, availableActions, INITIAL, isClosed, type SimState, type Status } from './ciclo-de-vida.logic';

const step = (state: SimState, ...moves: [Parameters<typeof apply>[1], string?][]) =>
  moves.reduce((s, [action, input]) => {
    const next = apply(s, action, input);
    if (typeof next === 'string') throw new Error(`${action}: ${next}`);
    return next;
  }, state);

describe('Simulador do ciclo de vida (regras reais via regras.json)', () => {
  it('começa Enviada e oferece só o que o ITS aceita em cada situação', () => {
    expect(INITIAL.status).toBe('submitted');
    const offered: Record<Status, string[]> = {
      submitted: availableActions('submitted'),
      in_review: availableActions('in_review'),
      in_progress: availableActions('in_progress'),
      implemented: availableActions('implemented'),
      rejected: availableActions('rejected'),
    };
    expect(offered).toEqual({
      submitted: ['start_review', 'reject'],
      in_review: ['approve', 'reject'],
      in_progress: ['interrupt', 'implement'],
      implemented: ['reopen'],
      rejected: ['reopen'],
    });
  });

  it('caminho feliz até Implementada, com a linha do tempo completa', () => {
    const end = step(INITIAL, ['start_review'], ['approve', 'Bruno Lima'], ['implement', 'Retrabalho caiu 60%.']);
    expect(end.status).toBe('implemented');
    expect(isClosed(end.status)).toBe(true);
    expect(end.history.map((h) => `${h.from}>${h.to}`)).toEqual([
      'submitted>in_review',
      'in_review>in_progress',
      'in_progress>implemented',
    ]);
  });

  it('não autorizar sem justificativa é recusado (RN-05); aprovar sem responsável também (RN-06)', () => {
    expect(apply(INITIAL, 'reject', '   ')).toBe('needs_reason');
    const review = step(INITIAL, ['start_review']);
    expect(apply(review, 'approve')).toBe('needs_responsible');
    const doing = step(review, ['approve', 'Davi Rocha']);
    expect(apply(doing, 'implement', '')).toBe('needs_result');
  });

  it('ação fora do diagrama não vale; reabrir exige motivo e volta para o lugar certo (RN-09)', () => {
    expect(apply(INITIAL, 'implement', 'x')).toBe('invalid');
    const rejected = step(INITIAL, ['reject', 'Já existe na prensa 2.']);
    expect(apply(rejected, 'reopen', '')).toBe('needs_reason');
    expect(step(rejected, ['reopen', 'Analisar de novo.']).status).toBe('in_review');
  });
});
