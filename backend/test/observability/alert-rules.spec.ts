import { describe, expect, it } from 'vitest';
import { type AlertItemState, type AlertStates, transitions } from '../../src/observability/alert-rules.js';
import { alertEmail } from '../../src/observability/alert-text.js';
import type { HealthItem, HealthKey, HealthState } from '../../src/observability/health-rules.js';

const T0 = new Date('2026-11-10T12:00:00Z');
/** Instante `minutes` minutos depois de T0. */
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const item = (key: HealthKey, state: HealthState): HealthItem => ({ key, state, code: state, value: null });
const keys = (items: readonly HealthItem[]) => items.map((entry) => entry.key);

/** Aplica uma conferência e devolve o novo estado e os avisos. */
function step(states: AlertStates, items: HealthItem[], now: Date) {
  return transitions(states, items, now);
}

describe('Regras do alerta de saúde (RN-94)', () => {
  it('CA-RN-94.1 item que entra em falha avisa; atenção não avisa', () => {
    const empty: AlertStates = new Map();
    const warning = step(empty, [item('worker', 'warning'), item('database', 'ok')], T0);
    expect(warning.failedItems).toEqual([]);
    expect(warning.recoveredItems).toEqual([]);

    const failed = step(empty, [item('worker', 'failed'), item('database', 'warning')], T0);
    expect(keys(failed.failedItems)).toEqual(['worker']);
    expect(failed.states.get('worker')).toMatchObject({ failed: true, silenced: false, lastFailureNoticeAt: T0 });
  });

  it('CA-RN-94.1 continuar em falha não avisa de novo', () => {
    const first = step(new Map(), [item('worker', 'failed')], T0);
    const again = step(first.states, [item('worker', 'failed')], at(5));
    expect(again.failedItems).toEqual([]);
    expect(again.recoveredItems).toEqual([]);
  });

  it('CA-RN-94.2 "voltou" só depois de 2 conferências seguidas sem falha', () => {
    let { states } = step(new Map(), [item('worker', 'failed')], T0);
    const one = step(states, [item('worker', 'ok')], at(5));
    expect(one.recoveredItems).toEqual([]);
    expect(one.states.get('worker')).toMatchObject({ failed: true, cleanChecks: 1 });
    states = one.states;
    const two = step(states, [item('worker', 'ok')], at(10));
    expect(keys(two.recoveredItems)).toEqual(['worker']);
    expect(two.states.get('worker')).toMatchObject({ failed: false, cleanChecks: 0 });
  });

  it('CA-RN-94.2 uma falha no meio zera a contagem da volta', () => {
    let { states } = step(new Map(), [item('worker', 'failed')], T0);
    states = step(states, [item('worker', 'ok')], at(5)).states;
    states = step(states, [item('worker', 'failed')], at(10)).states;
    expect(states.get('worker')?.cleanChecks).toBe(0);
    states = step(states, [item('worker', 'ok')], at(15)).states;
    expect(step(states, [item('worker', 'ok')], at(20)).recoveredItems).toHaveLength(1);
    expect(step(states, [item('worker', 'ok')], at(20)).states.get('worker')?.failed).toBe(false);
  });

  it('CA-RN-94.2 atenção também conta como "sem falha" para voltar', () => {
    let { states } = step(new Map(), [item('email', 'failed')], T0);
    states = step(states, [item('email', 'warning')], at(5)).states;
    expect(keys(step(states, [item('email', 'warning')], at(10)).recoveredItems)).toEqual(['email']);
  });

  it('CA-RN-94.3 o mesmo item não avisa falha duas vezes em menos de 30 minutos, e a volta dessa falha também não avisa', () => {
    // falhou e avisou em T0; voltou (2 conferências); falhou de novo 20 min depois do primeiro aviso
    let { states } = step(new Map(), [item('worker', 'failed')], T0);
    states = step(states, [item('worker', 'ok')], at(5)).states;
    states = step(states, [item('worker', 'ok')], at(10)).states;
    const early = step(states, [item('worker', 'failed')], at(20));
    expect(early.failedItems).toEqual([]);
    expect(early.states.get('worker')).toMatchObject({ failed: true, silenced: true, lastFailureNoticeAt: T0 });

    // a volta da falha silenciada não avisa
    let after = step(early.states, [item('worker', 'ok')], at(25)).states;
    const back = step(after, [item('worker', 'ok')], at(30));
    expect(back.recoveredItems).toEqual([]);
    expect(back.states.get('worker')).toMatchObject({ failed: false, silenced: false });

    // passados 30 minutos do último aviso, volta a avisar
    after = back.states;
    expect(keys(step(after, [item('worker', 'failed')], at(31)).failedItems)).toEqual(['worker']);
    expect(step(after, [item('worker', 'failed')], at(29)).failedItems).toEqual([]);
  });

  it('CA-RN-94.4 primeira conferência (sem estado): em falha avisa; em ordem não diz nada', () => {
    const result = step(new Map(), [item('database', 'failed'), item('api', 'ok'), item('email', 'warning')], T0);
    expect(keys(result.failedItems)).toEqual(['database']);
    expect(result.recoveredItems).toEqual([]);
    expect(result.states.get('api')).toMatchObject({ failed: false });
  });

  it('itens são independentes: um falha, outro volta, no mesmo ciclo', () => {
    const before: AlertStates = new Map<string, AlertItemState>([
      ['worker', { failed: true, cleanChecks: 1, lastFailureNoticeAt: T0, silenced: false }],
    ]);
    const result = step(before, [item('worker', 'ok'), item('email_queue', 'failed')], at(5));
    expect(keys(result.recoveredItems)).toEqual(['worker']);
    expect(keys(result.failedItems)).toEqual(['email_queue']);
  });
});

describe('E-mail do alerta (RN-94)', () => {
  const base = { name: 'Ana', organization: 'Org', failed: ['worker', 'email_queue'], recovered: [], link: '' };

  it('pt-BR: assunto numa linha, itens em falha e link só quando há endereço do sistema', () => {
    const mail = alertEmail('pt-BR', { ...base, link: 'https://its.exemplo.test/admin/observabilidade' });
    expect(mail.subject).toBe('Alerta de saúde: falha em Worker, Fila de e-mail | Org');
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.body).toContain('Olá, Ana.');
    expect(mail.body).toContain('- Worker');
    expect(mail.body).toContain('- Fila de e-mail');
    expect(mail.body).toContain('https://its.exemplo.test/admin/observabilidade');
    expect(alertEmail('pt-BR', base).body).not.toContain('Detalhes e o que fazer');
  });

  it('en e volta ao normal', () => {
    const mail = alertEmail('en', { ...base, failed: [], recovered: ['worker'] });
    expect(mail.subject).toBe('Health alert: Worker back to normal | Org');
    expect(mail.body).toContain('Back to normal:');
  });

  it('nome de organização com quebra de linha não abre cabeçalho no assunto', () => {
    const mail = alertEmail('pt-BR', { ...base, organization: 'Org\r\nBcc: alguem@x.test' });
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});
