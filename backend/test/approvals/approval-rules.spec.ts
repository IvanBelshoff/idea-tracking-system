import { describe, expect, it } from 'vitest';
import { hashToken, newToken } from '../../src/approvals/approval-core.js';
import { holdAllowed, holdState, outcomeOf, outsideDomains } from '../../src/approvals/approval-rules.js';
import { IdeaStatus } from '../../src/ideas/entities/idea.entity.js';

describe('Aprovação de outras áreas: regras (M24)', () => {
  it('CA-RN-183.5 segurar a aprovação só Em análise; a implementação, Em análise e Em andamento', () => {
    expect(holdAllowed(IdeaStatus.InReview, 'approve')).toBe(true);
    expect(holdAllowed(IdeaStatus.InProgress, 'approve')).toBe(false);
    expect(holdAllowed(IdeaStatus.InReview, 'implement')).toBe(true);
    expect(holdAllowed(IdeaStatus.InProgress, 'implement')).toBe(true);
    for (const s of [IdeaStatus.Submitted, IdeaStatus.Implemented, IdeaStatus.Rejected]) {
      expect(holdAllowed(s, 'approve')).toBe(false);
      expect(holdAllowed(s, 'implement')).toBe(false);
    }
  });

  it('CA-RN-188.1 o último pedido decide se a transição passa', () => {
    expect(holdState(null)).toBe('free');
    expect(holdState({ status: 'pending', overriddenAt: null })).toBe('pending');
    expect(holdState({ status: 'approved', overriddenAt: null })).toBe('free');
    expect(holdState({ status: 'cancelled', overriddenAt: null })).toBe('free');
    expect(holdState({ status: 'rejected', overriddenAt: null })).toBe('not_obtained');
    expect(holdState({ status: 'expired', overriddenAt: null })).toBe('not_obtained');
    expect(holdState({ status: 'rejected', overriddenAt: new Date() })).toBe('free');
  });

  it('CA-RN-188.2 CA-RN-188.3 em paralelo e unânime: todos aprovam, ou uma recusa fecha', () => {
    expect(outcomeOf(['approved', 'approved'])).toBe('approved');
    expect(outcomeOf(['approved', 'pending'])).toBe('pending');
    expect(outcomeOf(['approved', 'rejected', 'pending'])).toBe('rejected');
    expect(outcomeOf([])).toBe('pending');
  });

  it('CA-RN-190.3 e-mail de fora dos domínios só existe quando há domínios cadastrados', () => {
    expect(outsideDomains('a@outra.com', [])).toBe(false);
    expect(outsideDomains('a@empresa.com.br', ['empresa.com.br'])).toBe(false);
    expect(outsideDomains('a@EMPRESA.com.br', ['empresa.com.br'])).toBe(false);
    expect(outsideDomains('a@outra.com', ['empresa.com.br'])).toBe(true);
  });

  it('CA-T.28 o link tem 32 bytes aleatórios e só o SHA-256 é guardado', () => {
    const a = newToken();
    const b = newToken();
    expect(a.token).not.toBe(b.token);
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a.token)).toBe(a.hash);
    expect(a.hash).not.toContain(a.token);
  });
});
