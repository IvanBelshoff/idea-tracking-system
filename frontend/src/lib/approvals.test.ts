import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  approvalProgress,
  canOverride,
  decisionReady,
  holdOptions,
  isOutsideDomain,
  recipientProblems,
  recipientsBody,
  tokenFromHash,
} from './approvals.ts';

describe('Aprovação de outras áreas na tela (M24)', () => {
  it('CA-RN-183.5 o que o pedido pode segurar depende da situação da ideia', () => {
    assert.deepEqual(holdOptions('in_review'), ['approve', 'implement']);
    assert.deepEqual(holdOptions('in_progress'), ['implement']);
    for (const s of ['submitted', 'implemented', 'rejected']) assert.deepEqual(holdOptions(s), []);
  });

  it('CA-RN-190.3 e-mail fora dos domínios: sem domínios cadastrados, nenhum é de fora', () => {
    assert.equal(isOutsideDomain('ana@empresa.com.br', []), false);
    assert.equal(isOutsideDomain('ana@empresa.com.br', ['empresa.com.br']), false);
    assert.equal(isOutsideDomain('Ana@EMPRESA.com.br', ['empresa.com.br']), false);
    assert.equal(isOutsideDomain('ana@fornecedor.com', ['empresa.com.br']), true);
    assert.equal(isOutsideDomain('sem-arroba', ['empresa.com.br']), false);
  });

  it('CA-RN-183.3 as linhas de aprovadores: pessoa, nome, e-mail, área, repetidos e domínio', () => {
    const problems = recipientProblems(
      [
        { kind: 'user', userId: '', area: '' },
        { kind: 'external', name: '', email: 'x', area: '' },
        { kind: 'external', name: 'Rui', email: 'rui@empresa.com', area: 'Manutenção' },
        { kind: 'external', name: 'Rui de novo', email: 'RUI@empresa.com', area: 'Manutenção' },
        { kind: 'external', name: 'Fora', email: 'f@fornecedor.com', area: 'Compras' },
        { kind: 'user', userId: 'u1', area: 'a'.repeat(81) },
      ],
      ['empresa.com'],
      false,
    );
    assert.deepEqual(problems.get(0), ['user']);
    assert.deepEqual(problems.get(1), ['name', 'email', 'area']);
    assert.equal(problems.has(2), false);
    assert.deepEqual(problems.get(3), ['duplicate']);
    assert.deepEqual(problems.get(4), ['outside']);
    assert.deepEqual(problems.get(5), ['area']);
    assert.equal(
      recipientProblems([{ kind: 'external', name: 'F', email: 'f@fornecedor.com', area: 'C' }], ['empresa.com'], true)
        .size,
      0,
    );
  });

  it('o corpo do pedido limpa espaços e põe o e-mail em minúsculas', () => {
    assert.deepEqual(
      recipientsBody([
        { kind: 'user', userId: 'u1', area: ' Segurança ' },
        { kind: 'external', name: ' Rui ', email: ' RUI@Empresa.com ', area: ' Manutenção ' },
      ]),
      [
        { userId: 'u1', area: 'Segurança' },
        { name: 'Rui', email: 'rui@empresa.com', area: 'Manutenção' },
      ],
    );
  });

  it('CA-RN-188.1 o selo conta quantos aprovaram de quantos', () => {
    assert.deepEqual(approvalProgress([{ decision: 'approved' }, { decision: 'pending' }]), { approved: 1, total: 2 });
  });

  it('CA-RN-188.4 e 188.5 "seguir sem a aprovação" só no modo devolver, depois de recusa ou vencimento, uma vez', () => {
    const base = { canManage: true, onReject: 'return' };
    assert.equal(canOverride({ ...base, requests: [{ status: 'rejected', overriddenAt: null }] }), true);
    assert.equal(canOverride({ ...base, requests: [{ status: 'expired', overriddenAt: null }] }), true);
    assert.equal(canOverride({ ...base, requests: [{ status: 'rejected', overriddenAt: '2026-11-17' }] }), false);
    assert.equal(canOverride({ ...base, requests: [{ status: 'pending', overriddenAt: null }] }), false);
    assert.equal(canOverride({ ...base, requests: [] }), false);
    assert.equal(
      canOverride({ ...base, onReject: 'block', requests: [{ status: 'rejected', overriddenAt: null }] }),
      false,
    );
    assert.equal(
      canOverride({ ...base, canManage: false, requests: [{ status: 'rejected', overriddenAt: null }] }),
      false,
    );
  });

  it('CA-RN-184.3 não aprovar exige o motivo', () => {
    assert.equal(decisionReady(null, ''), false);
    assert.equal(decisionReady('approved', ''), true);
    assert.equal(decisionReady('rejected', '  '), false);
    assert.equal(decisionReady('rejected', 'Sem verba neste ano'), true);
    assert.equal(decisionReady('approved', 'x'.repeat(1001)), false);
  });

  it('CA-T.28 o link vem do fragmento e só no formato do token', () => {
    const token = 'Ab3_-'.repeat(9);
    assert.equal(tokenFromHash(`#${token}`), token);
    assert.equal(tokenFromHash('#curto'), null);
    assert.equal(tokenFromHash('#<script>alert(1)</script>xxxxxxxxxxxxxxxx'), null);
    assert.equal(tokenFromHash(''), null);
  });
});
