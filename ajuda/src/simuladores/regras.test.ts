import { describe, expect, it } from 'vitest';
import { PERMISSION_EN } from '../components/tabela-de-perfis';
import {
  canAddStep,
  canBeConverged,
  canSupport,
  hallEligibility,
  ideaDeadline,
  isLate,
  isTriageOverdue,
  principalOf,
  priorityScore,
  progressBySteps,
  roleHas,
  type Status,
  type Step,
  scopeCovers,
  showsName,
  TREE,
  triageDueDate,
  validStepDates,
} from './regras';
import regras from './regras.json';

const step = (dueDate: string, done: boolean): Step => ({ name: 'x', startDate: '2026-11-02', dueDate, done });

describe('Regras dos simuladores = regras do backend (vetores do regras.json)', () => {
  it('previsão de retorno, em dias corridos e úteis, a partir de qualquer dia da semana (RN-54)', () => {
    for (const v of regras.triage.dueVectors)
      expect(triageDueDate(v.submitted, v.days, v.business), JSON.stringify(v)).toBe(v.due);
    const { submitted, calendarDue, businessDue } = regras.triage.examples;
    expect(triageDueDate(submitted, regras.triage.slaDays, false)).toBe(calendarDue);
    expect(triageDueDate(submitted, regras.triage.slaDays, true)).toBe(businessDue);
  });

  it('atraso de triagem: no dia da previsão ainda não; no seguinte, sim; Em análise nunca (RN-54)', () => {
    const o = regras.triage.overdue;
    expect(isTriageOverdue('submitted', '2026-11-19', '2026-11-19')).toBe(o.noDiaDoPrazo);
    expect(isTriageOverdue('submitted', '2026-11-19', '2026-11-20')).toBe(o.diaSeguinte);
    expect(isTriageOverdue('in_review', '2026-11-19', '2026-11-30')).toBe(o.emAnaliseNaoAtrasa);
  });

  it('prioridade impacto ÷ esforço em todas as combinações (RN-56)', () => {
    for (const v of regras.triage.priority) expect(priorityScore(v.impact, v.effort)).toBe(v.score);
  });

  it('etapas: criar, datas, prazo, atraso e progresso (RN-12, 16, 17, 18, 19)', () => {
    const s = regras.steps;
    expect(canAddStep([])).toBe(s.canAddStep.semEtapas);
    expect(canAddStep([step('2026-11-20', false)])).toBe(s.canAddStep.comEtapaAberta);
    expect(canAddStep([step('2026-11-20', true)])).toBe(s.canAddStep.todasConcluidas);
    expect(validStepDates('2026-11-10', '2026-11-20')).toBe(s.validDates.previstaDepois);
    expect(validStepDates('2026-11-10', '2026-11-10')).toBe(s.validDates.mesmoDia);
    expect(validStepDates('2026-11-10', '2026-11-09')).toBe(s.validDates.previstaAntes);
    expect(ideaDeadline([step('2026-11-20', true), step('2026-12-05', false)])).toBe(s.deadlineIsLastDue);
    for (const v of s.progressSteps) {
      expect(progressBySteps(Array.from({ length: v.total }, (_, i) => step('2026-11-20', i < v.done)))).toBe(v.pct);
    }
    expect(isLate('in_progress', [step('2026-11-09', false)], '2026-11-09')).toBe(s.lateExamples.previsaoHoje);
    expect(isLate('in_progress', [step('2026-11-08', false)], '2026-11-09')).toBe(s.lateExamples.previsaoOntem);
    expect(isLate('in_progress', [step('2026-11-08', true)], '2026-11-09')).toBe(s.lateExamples.concluida);
  });

  it('convergência: quem pode apoiar e ser convergida, e a principal é a mais antiga (RN-84, RN-86)', () => {
    for (const st of regras.lifecycle.statuses as Status[]) {
      expect(canSupport(st)).toBe(regras.convergence.canSupport[st]);
      expect(canBeConverged(st)).toBe(regras.convergence.canBeConverged[st]);
    }
    const older = { code: 'ITS-2026-0020', submitted: '2026-10-01' };
    const newer = { code: 'ITS-2026-0003', submitted: '2026-10-20' };
    expect(principalOf(newer, older)[0] === older).toBe(regras.convergence.principalIsOlder);
  });

  it('escopo: onde um perfil concedido numa entidade vale, com e sem subentidades (§3.2)', () => {
    for (const v of regras.access.vectors) {
      const sees = TREE.filter((e) => scopeCovers(v.grant, v.includeChildren, e.id)).map((e) => e.id);
      expect(sees, JSON.stringify(v)).toEqual(v.sees);
    }
  });

  it('perfis de fábrica: colaborador não vê ideias dos outros; analista e gestor veem no escopo', () => {
    expect(roleHas('collaborator', 'idea.view_scope')).toBe(false);
    expect(roleHas('analyst', 'idea.view_scope')).toBe(true);
    expect(roleHas('manager', 'idea.view_scope')).toBe(true);
    expect(roleHas('manager', 'hall.highlight_entity')).toBe(true);
    expect(roleHas('manager', 'hall.highlight_org')).toBe(false);
  });

  it('Hall: elegibilidade por situação e nome só com aceite (RN-73, RN-74)', () => {
    for (const st of regras.lifecycle.statuses as Status[]) {
      expect([hallEligibility(st, false), hallEligibility(st, true)]).toEqual(regras.hall.eligibility[st]);
    }
    const n = regras.hall.showsName;
    expect(showsName('accepted', false)).toBe(n.aceitou);
    expect(showsName('pending', false)).toBe(n.semResposta);
    expect(showsName('declined', false)).toBe(n.recusou);
    expect(showsName('accepted', true)).toBe(n.aceitouMasOcultaNome);
  });

  it('toda permissão do backend tem nome em inglês na tabela de perfis', () => {
    expect(Object.keys(PERMISSION_EN).sort()).toEqual(Object.keys(regras.permissions).sort());
  });
});
