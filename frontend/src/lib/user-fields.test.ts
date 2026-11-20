import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyPattern,
  checkValue,
  cpfValid,
  fieldLabel,
  maskInput,
  numericMask,
  patternExample,
  patternValid,
  placeholderFor,
} from './user-fields.ts';

describe('Campos personalizados na tela (M25), a mesma regra do servidor', () => {
  it('CA-RN-194.1 CPF pelos dígitos verificadores', () => {
    assert.equal(cpfValid('529.982.247-25'), true);
    assert.equal(cpfValid('529.982.247-26'), false);
    assert.equal(cpfValid('111.111.111-11'), false);
    assert.deepEqual(checkValue('mask', { preset: 'cpf' }, '52998224725'), { ok: true, value: '529.982.247-25' });
  });

  it('CA-RN-194.1 máscara livre AA-9999, com ou sem os fixos', () => {
    assert.equal(applyPattern('AA-9999', 'AB-1234'), 'AB-1234');
    assert.equal(applyPattern('AA-9999', 'ab1234'), 'AB-1234');
    assert.equal(applyPattern('AA-9999', 'A1-1234'), null);
    assert.equal(applyPattern('AA-9999', 'AB-123'), null);
    assert.equal(patternValid('AA-9999'), true);
    assert.equal(patternValid('--'), false);
  });

  it('CA-RN-194.2 texto, número e data fora da regra, com o motivo para a tela', () => {
    assert.deepEqual(checkValue('text', { max: 3 }, 'abcd'), { ok: false, problem: { key: 'tooLong', max: 3 } });
    assert.deepEqual(checkValue('number', { integer: true }, '1,5'), { ok: false, problem: { key: 'integer' } });
    assert.deepEqual(checkValue('number', {}, '1,5'), { ok: true, value: '1.5' });
    assert.deepEqual(checkValue('number', { max: 10 }, '11'), { ok: false, problem: { key: 'max', max: 10 } });
    assert.deepEqual(checkValue('date', {}, '2026-02-30'), { ok: false, problem: { key: 'date' } });
    assert.deepEqual(checkValue('mask', { preset: 'phone' }, '11987654321'), { ok: true, value: '(11) 98765-4321' });
    assert.deepEqual(checkValue('text', {}, '  '), { ok: false, problem: { key: 'required' } });
  });

  it('formato com espaço no meio vale; nas pontas, com tabulação ou sem lugar para digitar, não', () => {
    assert.equal(patternValid('(99) 99999-9999'), true);
    assert.equal(patternValid(' 9999'), false);
    assert.equal(patternValid('99\t99'), false);
    assert.equal(patternValid('0000-0000'), false);
    assert.equal(patternExample('(99) 99999-9999'), '(12) 34567-8901');
    assert.equal(patternExample('AA-9999'), 'AB-1234');
  });

  it('a máscara se aplica a cada tecla: fixos no lugar, letra fora do dígito, para no fim', () => {
    const custom = { preset: 'custom' as const, pattern: '(99) 99999-9999' };
    assert.equal(maskInput(custom, '1'), '(1');
    assert.equal(maskInput(custom, '11'), '(11');
    assert.equal(maskInput(custom, '119'), '(11) 9');
    assert.equal(maskInput(custom, '11987654321'), '(11) 98765-4321');
    assert.equal(maskInput(custom, '(11) 98765-43219'), '(11) 98765-4321');
    assert.equal(maskInput(custom, '11a9'), '(11) 9');
    // Apagar o último dígito tira os fixos que ficaram sobrando.
    assert.equal(maskInput(custom, '(11) '), '(11');
    assert.equal(maskInput({ preset: 'custom', pattern: 'AA-9999' }, 'ab12'), 'AB-12');
    assert.equal(maskInput({ preset: 'custom', pattern: '99999999' }, '1234abc5678'), '12345678');
    assert.equal(maskInput({ preset: 'cpf' }, '52998224725'), '529.982.247-25');
    assert.equal(maskInput({ preset: 'phone' }, '1134567890'), '(11) 3456-7890');
    assert.equal(maskInput({ preset: 'phone' }, '11987654321'), '(11) 98765-4321');
    assert.equal(numericMask(custom), true);
    assert.equal(numericMask({ preset: 'custom', pattern: 'AA-9999' }), false);
    assert.equal(numericMask({ preset: 'cpf' }), true);
  });

  it('o exemplo do formato e o nome no idioma da tela', () => {
    assert.equal(placeholderFor('mask', { preset: 'custom', pattern: 'AA-9999' }), 'AA-0000');
    assert.equal(placeholderFor('mask', { preset: 'cpf' }), '000.000.000-00');
    assert.equal(placeholderFor('text', {}), undefined);
    assert.equal(fieldLabel({ labelPt: 'Matrícula', labelEn: 'Employee ID' }, 'en'), 'Employee ID');
    assert.equal(fieldLabel({ labelPt: 'Matrícula', labelEn: null }, 'en'), 'Matrícula');
    assert.equal(fieldLabel({ labelPt: 'Matrícula', labelEn: 'Employee ID' }, 'pt-BR'), 'Matrícula');
  });
});
