import { describe, expect, it } from 'vitest';
import { computeAccess, type EntityNode } from '../../src/identity-access/access.js';

// Fixture padrão dos critérios: Org > Unidade A > Setor A1; Org > Unidade B.
const tree: EntityNode[] = [
  { id: 'org', mpath: 'org.' },
  { id: 'A', mpath: 'org.A.' },
  { id: 'A1', mpath: 'org.A.A1.' },
  { id: 'B', mpath: 'org.B.' },
];
const ANALYST = ['idea.submit', 'idea.view_scope', 'idea.triage', 'step.manage'];
const COLLABORATOR = ['idea.submit', 'idea.comment'];

describe('Acesso efetivo por perfil e entidade (§3.2)', () => {
  it('CA-RN-01.3 analista em "Unidade A, incluir sub-entidades" alcança A e A1, e não B', () => {
    const access = computeAccess('u', [{ entityId: 'A', includeChildren: true, permissions: ANALYST }], tree);
    expect(access.entities('idea.view_scope').sort()).toEqual(['A', 'A1']);
    expect(access.hasIn('idea.triage', 'B')).toBe(false);
  });

  it('sem "incluir sub-entidades" vale só a própria entidade', () => {
    const access = computeAccess('u', [{ entityId: 'A', includeChildren: false, permissions: ANALYST }], tree);
    expect(access.entities('idea.view_scope')).toEqual(['A']);
  });

  it('CA-RN-01.5 Analista em A e Colaborador em B: tria em A, não em B', () => {
    const access = computeAccess(
      'u',
      [
        { entityId: 'A', includeChildren: true, permissions: ANALYST },
        { entityId: 'B', includeChildren: true, permissions: COLLABORATOR },
      ],
      tree,
    );
    expect(access.hasIn('idea.triage', 'A')).toBe(true);
    expect(access.hasIn('idea.triage', 'B')).toBe(false);
    expect(access.hasIn('idea.submit', 'B')).toBe(true);
    expect(access.entities('idea.submit').sort()).toEqual(['A', 'A1', 'B']);
  });

  it('CA-RN-01.7 perfil sem a permissão não concede nada; códigos desconhecidos são ignorados', () => {
    const access = computeAccess(
      'u',
      [{ entityId: 'org', includeChildren: true, permissions: ['idea.submit', 'codigo.inventado'] }],
      tree,
    );
    expect(access.has('idea.triage')).toBe(false);
    expect(access.permissions()).toEqual(['idea.submit']);
  });

  it('sem perfis não há acesso algum, e entidade inexistente nunca amplia o acesso', () => {
    expect(computeAccess('u', [], tree).permissions()).toEqual([]);
    const ghost = computeAccess('u', [{ entityId: 'apagada', includeChildren: true, permissions: ANALYST }], tree);
    expect(ghost.permissions()).toEqual([]);
  });
});
