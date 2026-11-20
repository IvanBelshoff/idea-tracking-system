import { describe, expect, it } from 'vitest';
import { todayInZone } from '../../src/common/dates.js';
import { IdeaStatus } from '../../src/ideas/entities/idea.entity.js';
import {
  canAddStep,
  ideaDeadline,
  isDeletableStep,
  isEditableStep,
  isLate,
  nextPosition,
  progress,
  type StepLike,
  validStepDates,
} from '../../src/ideas/steps-rules.js';

const S = IdeaStatus;
const step = (position: number, dueDate: string, done = false, startDate = '2026-03-01'): StepLike => ({
  position,
  startDate,
  dueDate,
  completedAt: done ? new Date() : null,
});

describe('Etapas e prazos (RN-12 a RN-19)', () => {
  it('RN-12 só cria nova etapa sem etapa aberta; posição +1', () => {
    expect(canAddStep([step(1, '2026-03-10')])).toBe(false);
    expect(canAddStep([step(1, '2026-03-10', true)])).toBe(true);
    expect(nextPosition([step(1, '2026-03-10', true), step(2, '2026-03-20', true)])).toBe(3);
  });

  it('CA-RN-13 só a última etapa aberta é editável; concluída ou aberta fora do fim, não', () => {
    const done = step(1, '2026-03-10', true);
    const last = step(2, '2026-03-20');
    expect(isEditableStep(done, [done, last])).toBe(false);
    expect(isEditableStep(last, [done, last])).toBe(true);
    // aberta que não é a última (caso exista por reversão)
    const openMiddle = step(1, '2026-03-10');
    expect(isEditableStep(openMiddle, [openMiddle, step(2, '2026-03-20', true)])).toBe(false);
  });

  it('CA-RN-14.1 criar 3 e excluir a última → posições 1 e 2, sem lacuna; a única etapa não se exclui', () => {
    const steps = [step(1, '2026-03-10', true), step(2, '2026-03-15', true), step(3, '2026-03-20')];
    const third = steps[2] as StepLike;
    expect(isDeletableStep(third, steps)).toBe(true);
    const remaining = steps.filter((s) => s !== third);
    expect(remaining.map((s) => s.position)).toEqual([1, 2]);
    expect(nextPosition(remaining)).toBe(3);
    const only = step(1, '2026-03-10');
    expect(isDeletableStep(only, [only])).toBe(false);
  });

  it('CA-RN-16.1 prevista antes do início → recusa; igual → aceita', () => {
    expect(validStepDates('2026-03-10', '2026-03-09')).toBe(false);
    expect(validStepDates('2026-03-10', '2026-03-10')).toBe(true);
  });

  it('CA-RN-17.1 com etapas em 10/03 e 20/03, o prazo é 20/03; sem etapas, sem prazo', () => {
    expect(ideaDeadline([step(2, '2026-03-20'), step(1, '2026-03-10', true)])).toBe('2026-03-20');
    expect(ideaDeadline([])).toBeNull();
  });

  describe('atraso (RN-18)', () => {
    const today = '2026-03-15';
    it('CA-RN-18.1 em andamento, etapa aberta com previsão ontem → atrasada', () => {
      expect(isLate(S.InProgress, [step(1, '2026-03-14')], today)).toBe(true);
    });
    it('CA-RN-18.2 implementada ou não autorizada com previsão vencida → não atrasada', () => {
      expect(isLate(S.Implemented, [step(1, '2026-03-01')], today)).toBe(false);
      expect(isLate(S.Rejected, [step(1, '2026-03-01')], today)).toBe(false);
    });
    it('CA-RN-18.3 em andamento com todas concluídas → não atrasada', () => {
      expect(isLate(S.InProgress, [step(1, '2026-03-01', true)], today)).toBe(false);
    });
    it('CA-RN-18.4 previsão hoje → ainda não; atrasa no dia seguinte, no fuso da instalação', () => {
      expect(isLate(S.InProgress, [step(1, today)], today)).toBe(false);
      expect(isLate(S.InProgress, [step(1, today)], '2026-03-16')).toBe(true);
      // 02:00 UTC do dia 16 ainda é dia 15 em São Paulo: não atrasou lá; em UTC, sim.
      const instant = new Date('2026-03-16T02:00:00Z');
      expect(isLate(S.InProgress, [step(1, today)], todayInZone(instant, 'America/Sao_Paulo'))).toBe(false);
      expect(isLate(S.InProgress, [step(1, today)], todayInZone(instant, 'UTC'))).toBe(true);
    });
  });

  describe('progresso (RN-19)', () => {
    it('CA-RN-19.1 modo etapas: 2 concluídas de 4 → 50%', () => {
      const steps = [
        step(1, '2026-03-05', true),
        step(2, '2026-03-06', true),
        step(3, '2026-03-07'),
        step(4, '2026-03-08'),
      ];
      expect(progress('steps', S.InProgress, steps, '2026-03-06')).toBe(50);
    });
    it('CA-RN-19.2 modo tempo: início 01/03, prazo 11/03, hoje 06/03 → 50%; limitado a 0 e 100', () => {
      const steps = [step(1, '2026-03-11', false, '2026-03-01')];
      expect(progress('time', S.InProgress, steps, '2026-03-06')).toBe(50);
      expect(progress('time', S.InProgress, steps, '2026-04-30')).toBe(100);
      expect(progress('time', S.InProgress, steps, '2026-02-01')).toBe(0);
    });
    it('CA-RN-19.3 sem etapas → 0% (sem divisão por zero); implementada → 100%', () => {
      expect(progress('steps', S.InProgress, [], '2026-03-06')).toBe(0);
      expect(progress('time', S.InProgress, [], '2026-03-06')).toBe(0);
      expect(progress('steps', S.Implemented, [], '2026-03-06')).toBe(100);
    });
  });
});
