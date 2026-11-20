import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { orderedTree } from './scope-tree.ts';

const o = (id: string, name: string, parentId: string | null) => ({ id, name, parentId });

describe('Escolha do escopo das integrações (RN-103)', () => {
  it('cada pai vem antes dos filhos, irmãos por nome, e a profundidade recua os filhos', () => {
    const tree = orderedTree([
      o('exp', 'Expedição', 'fab'),
      o('fab', 'Fábrica', 'raiz'),
      o('raiz', 'Ideias Demo', null),
      o('log', 'Logística', 'raiz'),
      o('mon', 'Montagem', 'log'),
      o('usi', 'Usinagem', 'log'),
    ]);
    assert.deepEqual(
      tree.map((t) => `${'-'.repeat(t.depth)}${t.option.name}`),
      ['Ideias Demo', '-Fábrica', '--Expedição', '-Logística', '--Montagem', '--Usinagem'],
    );
  });

  it('entidade cujo pai não está na lista vira raiz; lista vazia dá vazio', () => {
    assert.deepEqual(
      orderedTree([o('a', 'A', 'sumiu')]).map((t) => [t.option.id, t.depth]),
      [['a', 0]],
    );
    assert.deepEqual(orderedTree([]), []);
  });
});
