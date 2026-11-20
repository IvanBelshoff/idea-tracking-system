import { describe, expect, it } from 'vitest';
import { todayInZone, yearInZone } from '../../src/common/dates.js';
import { IdeaStatus } from '../../src/ideas/entities/idea.entity.js';
import { canTransition, formatIdeaCode, implementBlocker, isClosed, nextStatus } from '../../src/ideas/lifecycle.js';

const S = IdeaStatus;
const ALL = Object.values(IdeaStatus);

/** Os pares do diagrama da §4 (e só eles). */
const ALLOWED: [IdeaStatus, IdeaStatus][] = [
  [S.Submitted, S.InReview],
  [S.Submitted, S.Rejected],
  [S.InReview, S.InProgress],
  [S.InReview, S.Rejected],
  [S.InProgress, S.Implemented],
  [S.InProgress, S.Rejected],
  [S.Implemented, S.InProgress],
  [S.Rejected, S.InReview],
];

describe('Ciclo de vida da ideia (§4)', () => {
  describe('CA-RN-10.2 matriz de transições', () => {
    for (const [from, to] of ALLOWED) {
      it(`permitido: ${from} → ${to}`, () => expect(canTransition(from, to)).toBe(true));
    }
    const refused = ALL.flatMap((from) => ALL.map((to) => [from, to] as const)).filter(
      ([from, to]) => !ALLOWED.some(([f, t]) => f === from && t === to),
    );
    it('a matriz cobre os 25 pares: 8 permitidos e 17 recusados', () => {
      expect(ALLOWED.length + refused.length).toBe(25);
      expect(refused).toHaveLength(17);
    });
    for (const [from, to] of refused) {
      it(`recusado: ${from} → ${to}`, () => expect(canTransition(from, to)).toBe(false));
    }
  });

  it('cada ação leva ao destino certo e não vale fora do estado de origem', () => {
    expect(nextStatus(S.Submitted, 'start_review')).toBe(S.InReview);
    expect(nextStatus(S.Submitted, 'approve')).toBeNull(); // o atalho é assumir + aprovar
    expect(nextStatus(S.InReview, 'approve')).toBe(S.InProgress);
    expect(nextStatus(S.InProgress, 'reject')).toBeNull(); // recusar é só na triagem
    expect(nextStatus(S.InProgress, 'interrupt')).toBe(S.Rejected); // interromper a ideia
    expect(nextStatus(S.Implemented, 'reopen')).toBe(S.InProgress);
    expect(nextStatus(S.Rejected, 'reopen')).toBe(S.InReview);
    expect(nextStatus(S.InProgress, 'reopen')).toBeNull(); // CA-RN-09.4: só encerradas
    expect(nextStatus(S.Implemented, 'reject')).toBeNull();
  });

  it('RN-08 encerradas (Implementada e Não autorizada) ficam somente leitura', () => {
    expect(ALL.filter(isClosed)).toEqual([S.Implemented, S.Rejected]);
  });

  describe('RN-07 implementar', () => {
    const done = { completedAt: new Date() };
    const open = { completedAt: null };
    it('CA-RN-07.1 sem etapas → recusa', () => expect(implementBlocker([], 'ok')).toBe('no_steps'));
    it('CA-RN-07.2 3 etapas, 2 concluídas → recusa', () =>
      expect(implementBlocker([done, done, open], 'ok')).toBe('open_steps'));
    it('todas concluídas sem resultado (ou só espaços) → recusa', () => {
      expect(implementBlocker([done], null)).toBe('missing_result');
      expect(implementBlocker([done], '   ')).toBe('missing_result');
    });
    it('todas concluídas e com resultado → pode', () =>
      expect(implementBlocker([done, done], 'Ganho de 10%')).toBeNull());
  });

  describe('RN-22 identificador', () => {
    it('formata PREFIXO-AAAA-NNNN', () => {
      expect(formatIdeaCode('ITS', 2026, 1)).toBe('ITS-2026-0001');
      expect(formatIdeaCode('ITS', 2026, 42)).toBe('ITS-2026-0042');
      expect(formatIdeaCode('KZN', 2027, 12345)).toBe('KZN-2027-12345');
    });
    it('CA-T.3 o ano segue o fuso da instalação, não o UTC', () => {
      const newYearUtc = new Date('2027-01-01T01:00:00Z'); // ainda 31/12/2026 em São Paulo
      expect(yearInZone(newYearUtc, 'America/Sao_Paulo')).toBe(2026);
      expect(yearInZone(newYearUtc, 'UTC')).toBe(2027);
      expect(todayInZone(newYearUtc, 'America/Sao_Paulo')).toBe('2026-12-31');
    });
  });
});
