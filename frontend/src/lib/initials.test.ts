import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initials, photoUrl } from './initials.ts';

describe('Avatar padrão (CA-RN-142.1)', () => {
  it('primeira e última palavra, só letras, em maiúsculas', () => {
    assert.equal(initials('Ana Souza (demo)'), 'AS');
    assert.equal(initials('ana maria de souza'), 'AS');
    assert.equal(initials('Ana'), 'A');
    assert.equal(initials('Élio Ávila'), 'ÉÁ');
    assert.equal(initials('  João   '), 'J');
  });
  it('nome sem letras vira "?"', () => {
    assert.equal(initials(''), '?');
    assert.equal(initials('123 (x)'), '?');
  });
  it('o endereço da foto leva a versão para renovar o cache', () => {
    assert.equal(photoUrl('u1', '42'), '/api/users/u1/photo?v=42');
  });
});
