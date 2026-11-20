import { describe, expect, it } from 'vitest';
import { IdeaStatus as S } from '../../src/ideas/entities/idea.entity.js';
import { chooseTriageRule, isTriageOverdue, triageDueDate } from '../../src/ideas/triage-rules.js';

const tree = [
  { id: 'org', mpath: 'org.' },
  { id: 'A', mpath: 'org.A.' },
  { id: 'A1', mpath: 'org.A.A1.' },
  { id: 'B', mpath: 'org.B.' },
];
const rule = (id: string, entityId: string | null, categoryId: string | null, priority = 0) => ({
  id,
  entityId,
  categoryId,
  assigneeId: `analista-${id}`,
  priority,
});

describe('Triagem em volume: regras puras (M6, RN-54, RN-55)', () => {
  it('CA-RN-54.1 prazo de 10 dias: enviada há 10 dias está no prazo; há 11, atrasada', () => {
    const due = triageDueDate('2026-11-02', 10, false);
    expect(due).toBe('2026-11-12');
    expect(isTriageOverdue(S.Submitted, due, '2026-11-12')).toBe(false);
    expect(isTriageOverdue(S.Submitted, due, '2026-11-13')).toBe(true);
  });

  it('só ideia ainda Enviada atrasa: em análise já teve retorno', () => {
    for (const status of [S.InReview, S.InProgress, S.Implemented, S.Rejected]) {
      expect(isTriageOverdue(status, '2026-01-01', '2026-12-31')).toBe(false);
    }
  });

  it('CA-RN-54.3 em dias úteis, sábado e domingo não contam', () => {
    // 06/11/2026 é sexta: 1 dia útil depois é segunda, 09/11.
    expect(triageDueDate('2026-11-06', 1, true)).toBe('2026-11-09');
    expect(triageDueDate('2026-11-06', 5, true)).toBe('2026-11-13');
    expect(triageDueDate('2026-11-02', 10, true)).toBe('2026-11-16'); // segunda + 10 úteis = duas semanas
    // Enviada no sábado: o prazo começa a contar na segunda.
    expect(triageDueDate('2026-11-07', 1, true)).toBe('2026-11-09');
    expect(triageDueDate('2026-11-06', 0, true)).toBe('2026-11-06');
  });

  it('CA-RN-55.1 regra por categoria atribui a ideia daquela categoria', () => {
    const rules = [rule('seg', null, 'seguranca')];
    expect(chooseTriageRule(rules, { entityId: 'A1', categoryId: 'seguranca' }, tree)?.id).toBe('seg');
    expect(chooseTriageRule(rules, { entityId: 'A1', categoryId: 'qualidade' }, tree)).toBeNull();
  });

  it('CA-RN-55.2 vence a mais específica; empate, a de maior prioridade; sem regra, fila geral', () => {
    const rules = [
      rule('geral', null, null),
      rule('cat', null, 'seguranca'),
      rule('ent', 'A', null),
      rule('ent-fundo', 'A1', null),
      rule('ent-cat', 'A', 'seguranca'),
    ];
    expect(chooseTriageRule(rules, { entityId: 'A1', categoryId: 'seguranca' }, tree)?.id).toBe('ent-cat');
    expect(chooseTriageRule(rules, { entityId: 'A1', categoryId: 'qualidade' }, tree)?.id).toBe('ent-fundo');
    expect(chooseTriageRule(rules, { entityId: 'A', categoryId: 'qualidade' }, tree)?.id).toBe('ent');
    expect(chooseTriageRule(rules, { entityId: 'B', categoryId: 'seguranca' }, tree)?.id).toBe('cat');
    expect(chooseTriageRule(rules, { entityId: 'B', categoryId: null }, tree)?.id).toBe('geral');
    // Empate de especificidade: prioridade maior vence; depois, a mais antiga (id menor).
    const tie = [rule('b', 'A', null, 1), rule('a', 'A', null, 5), rule('c', 'A', null, 5)];
    expect(chooseTriageRule(tie, { entityId: 'A1', categoryId: null }, tree)?.id).toBe('a');
    expect(chooseTriageRule([], { entityId: 'A1', categoryId: null }, tree)).toBeNull();
    // Regra de outra unidade não casa; entidade inexistente nunca casa.
    expect(chooseTriageRule([rule('b', 'B', null)], { entityId: 'A1', categoryId: null }, tree)).toBeNull();
    expect(chooseTriageRule([rule('x', 'sumiu', null)], { entityId: 'A1', categoryId: null }, tree)).toBeNull();
  });
});
