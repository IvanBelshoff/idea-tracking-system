import { describe, expect, it } from 'vitest';
import { addMonthsToMonth, monthInZone, monthsBetween } from '../../src/common/dates.js';
import { engagementMonths, MAX_MONTHS, rate } from '../../src/reports/engagement-rules.js';

describe('Engajamento: regras puras (RN-81)', () => {
  it('CA-RN-81.1 razão com denominador zero é "sem dados" (nulo), nunca zero', () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(3, 0)).toBeNull();
    expect(rate(0, 4)).toBe(0);
    expect(rate(1, 4)).toBe(0.25);
  });

  it('meses: aritmética atravessa a virada do ano', () => {
    expect(addMonthsToMonth('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToMonth('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('2026-03', '2026-02')).toEqual([]);
  });

  it('o mês de um instante é o do fuso da instalação, não o do UTC', () => {
    const instant = new Date('2026-12-01T01:00:00Z'); // ainda 30/11 às 22h em São Paulo
    expect(monthInZone(instant, 'America/Sao_Paulo')).toBe('2026-11');
    expect(monthInZone(instant, 'UTC')).toBe('2026-12');
  });

  it('evolução mensal: sem período, os 12 meses até o atual; com período, os meses dele', () => {
    const last12 = engagementMonths('2026-11');
    expect(last12).toHaveLength(12);
    expect(last12[0]).toBe('2025-12');
    expect(last12.at(-1)).toBe('2026-11');
    expect(engagementMonths('2026-11', '2026-01-15', '2026-03-02')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(engagementMonths('2026-11', undefined, '2026-03-31')).toHaveLength(12);
    expect(engagementMonths('2026-11', '2026-09-01')).toEqual(['2026-09', '2026-10', '2026-11']);
  });

  it(`período longo mostra só os últimos ${MAX_MONTHS} meses`, () => {
    const months = engagementMonths('2026-11', '2010-01-01', '2026-11-30');
    expect(months).toHaveLength(MAX_MONTHS);
    expect(months.at(-1)).toBe('2026-11');
  });
});
