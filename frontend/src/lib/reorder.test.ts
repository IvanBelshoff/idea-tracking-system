import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { insertAt, moveBy, moveTo } from './reorder.ts';

describe('Ordenar sem arrastar (CA-RN-137.2, CA-RN-138.1)', () => {
  it('subir e descer movem uma posição e param nas pontas', () => {
    assert.deepEqual(moveBy(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
    assert.deepEqual(moveBy(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
    assert.deepEqual(moveBy(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
    assert.deepEqual(moveBy(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
    assert.deepEqual(moveBy(['a', 'b', 'c'], 'x', 1), ['a', 'b', 'c']);
  });

  it('a lista devolvida é sempre completa e sem repetição', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    for (const id of list) {
      for (const delta of [-2, -1, 1, 2]) {
        const out = moveBy(list, id, delta);
        assert.deepEqual([...out].sort(), [...list].sort());
      }
    }
  });

  it('soltar sobre outro item leva o item para a posição dele', () => {
    assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 'a', 'c'), ['b', 'c', 'a', 'd']);
    assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 'd', 'a'), ['d', 'a', 'b', 'c']);
    assert.deepEqual(moveTo(['a', 'b'], 'a', 'a'), ['a', 'b']);
    assert.deepEqual(moveTo(['a', 'b'], 'a', 'zzz'), ['a', 'b']);
  });

  it('a variável entra na posição do cursor, no lugar da seleção, ou no fim', () => {
    assert.deepEqual(insertAt('Olá, !', 'name', 5, 5), { text: 'Olá, {{name}}!', cursor: 13 });
    assert.deepEqual(insertAt('Olá, XXX!', 'name', 5, 8), { text: 'Olá, {{name}}!', cursor: 13 });
    assert.deepEqual(insertAt('Veja ', 'link', null, null), { text: 'Veja {{link}}', cursor: 13 });
    assert.deepEqual(insertAt('', 'items', 0, 0), { text: '{{items}}', cursor: 9 });
  });
});
