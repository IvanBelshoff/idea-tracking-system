import { describe, expect, it } from 'vitest';
import { depthOf, subtreeIds, type TreeNode, wouldCreateCycle } from '../../src/organization/tree.js';

const tree: TreeNode[] = [
  { id: 'org', mpath: 'org.' },
  { id: 'A', mpath: 'org.A.' },
  { id: 'A1', mpath: 'org.A.A1.' },
  { id: 'A1x', mpath: 'org.A.A1.A1x.' },
  { id: 'B', mpath: 'org.B.' },
  // prefixo parecido não é descendente: "org.A" × "org.AB"
  { id: 'AB', mpath: 'org.AB.' },
];

describe('Árvore de entidades (RN-25)', () => {
  it('CA-RN-25.1 mover uma entidade para dentro de si mesma ou de um descendente → ciclo', () => {
    expect(wouldCreateCycle('A', 'A', tree)).toBe(true);
    expect(wouldCreateCycle('A', 'A1', tree)).toBe(true);
    expect(wouldCreateCycle('A', 'A1x', tree)).toBe(true);
    expect(wouldCreateCycle('A1', 'B', tree)).toBe(false);
    expect(wouldCreateCycle('A', 'AB', tree)).toBe(false);
    expect(wouldCreateCycle('A1x', 'org', tree)).toBe(false);
  });

  it('CA-RN-25.2 (base) a entidade pai inclui todas as descendentes, e só elas', () => {
    expect(subtreeIds('A', tree).sort()).toEqual(['A', 'A1', 'A1x']);
    expect(subtreeIds('B', tree)).toEqual(['B']);
    expect(subtreeIds('inexistente', tree)).toEqual([]);
  });

  it('calcula a profundidade pelo caminho', () => {
    expect(depthOf('org.')).toBe(0);
    expect(depthOf('org.A.A1.')).toBe(2);
  });
});
