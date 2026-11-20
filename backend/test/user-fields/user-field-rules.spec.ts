import { describe, expect, it } from 'vitest';
import {
  applyPattern,
  configProblem,
  cpfValid,
  defaultSearchable,
  duplicateLabel,
  flagsProblem,
  normalizeValue,
  patternValid,
} from '../../src/user-fields/user-field-rules.js';

describe('Campos personalizados: regras puras (M25, RN-193 a RN-195)', () => {
  it('CA-RN-194.1 a máscara CPF aceita só CPF com os dígitos verificadores certos', () => {
    expect(cpfValid('529.982.247-25')).toBe(true);
    expect(cpfValid('52998224725')).toBe(true);
    expect(cpfValid('529.982.247-26')).toBe(false);
    expect(cpfValid('111.111.111-11')).toBe(false);
    expect(cpfValid('1234')).toBe(false);
    expect(normalizeValue('mask', { preset: 'cpf' }, '52998224725')).toEqual({
      ok: true,
      value: '529.982.247-25',
      uniqueKey: '52998224725',
    });
  });

  it('CA-RN-194.1 a máscara livre AA-9999 aceita "AB-1234", com ou sem o fixo, e recusa "A1-1234" e "AB-123"', () => {
    expect(applyPattern('AA-9999', 'AB-1234')).toBe('AB-1234');
    expect(applyPattern('AA-9999', 'ab1234')).toBe('AB-1234');
    expect(applyPattern('AA-9999', 'A1-1234')).toBeNull();
    expect(applyPattern('AA-9999', 'AB-123')).toBeNull();
    expect(applyPattern('AA-9999', 'AB/1234')).toBeNull();
    expect(applyPattern('***.99', 'x7.12')).toBeNull();
    expect(applyPattern('***.99', 'x7z.12')).toBe('x7z.12');
    const result = normalizeValue('mask', { preset: 'custom', pattern: 'AA-9999' }, 'ab1234');
    expect(result).toEqual({ ok: true, value: 'AB-1234', uniqueKey: 'ab1234' });
  });

  it('telefone com 10 ou 11 dígitos sai formatado', () => {
    expect(normalizeValue('mask', { preset: 'phone' }, '11987654321')).toMatchObject({ value: '(11) 98765-4321' });
    expect(normalizeValue('mask', { preset: 'phone' }, '(11) 3456-7890')).toMatchObject({ value: '(11) 3456-7890' });
    expect(normalizeValue('mask', { preset: 'phone' }, '123')).toMatchObject({ ok: false });
  });

  it('CA-RN-194.2 texto, número e data fora da regra são recusados', () => {
    expect(normalizeValue('text', { min: 3, max: 5 }, 'ab')).toMatchObject({ ok: false });
    expect(normalizeValue('text', { min: 3, max: 5 }, 'abcdef')).toMatchObject({ ok: false });
    expect(normalizeValue('text', {}, 'x'.repeat(201))).toMatchObject({ ok: false });
    expect(normalizeValue('text', {}, '  Operador  ')).toEqual({ ok: true, value: 'Operador', uniqueKey: 'operador' });
    expect(normalizeValue('number', { integer: true }, '12,5')).toMatchObject({ ok: false });
    expect(normalizeValue('number', {}, '12,5')).toEqual({ ok: true, value: '12.5', uniqueKey: '12.5' });
    expect(normalizeValue('number', { min: 1, max: 10 }, '11')).toMatchObject({ ok: false });
    expect(normalizeValue('number', {}, 'doze')).toMatchObject({ ok: false });
    expect(normalizeValue('date', {}, '2026-02-30')).toMatchObject({ ok: false });
    expect(normalizeValue('date', {}, '2026-11-17')).toMatchObject({ ok: true, value: '2026-11-17' });
    expect(normalizeValue('text', {}, '   ')).toMatchObject({ ok: false });
  });

  it('a configuração de cada tipo é conferida', () => {
    expect(configProblem('text', { min: 10, max: 5 })).toMatchObject({ path: 'config.min' });
    expect(configProblem('text', { max: 500 })).toMatchObject({ path: 'config.max' });
    expect(configProblem('mask', {})).toMatchObject({ path: 'config.preset' });
    expect(configProblem('mask', { preset: 'custom', pattern: '---' })).toMatchObject({ path: 'config.pattern' });
    expect(configProblem('mask', { preset: 'custom', pattern: 'AA-9999' })).toBeNull();
    expect(configProblem('choice', {})).toBeNull();
    // Espaço no meio vale (telefone com a máscara livre); nas pontas e tabulação, não.
    expect(patternValid('(99) 99999-9999')).toBe(true);
    expect(patternValid(' 9999')).toBe(false);
    expect(patternValid('99\t99')).toBe(false);
    expect(normalizeValue('mask', { preset: 'custom', pattern: '(99) 99999-9999' }, '11987654321')).toMatchObject({
      ok: true,
      value: '(11) 98765-4321',
    });
    expect(normalizeValue('mask', { preset: 'custom', pattern: '(99) 99999-9999' }, '(11) 98765-4321')).toMatchObject({
      ok: true,
    });
  });

  it('valor único só nos abertos; dado sensível não sai na integração; pesquisável de fábrica', () => {
    expect(flagsProblem('choice', { uniqueValues: true, sensitive: false, integration: false })).toMatchObject({
      path: 'uniqueValues',
    });
    expect(flagsProblem('mask', { uniqueValues: true, sensitive: true, integration: true })).toMatchObject({
      path: 'integration',
    });
    expect(flagsProblem('mask', { uniqueValues: true, sensitive: true, integration: false })).toBeNull();
    expect(defaultSearchable('text', false)).toBe(true);
    expect(defaultSearchable('mask', true)).toBe(false);
    expect(defaultSearchable('choice', false)).toBe(false);
    expect(duplicateLabel(['Manutenção', 'Produção', 'manutenção'])).toBe('manutenção');
    expect(duplicateLabel(['A', 'B'])).toBeNull();
  });
});
