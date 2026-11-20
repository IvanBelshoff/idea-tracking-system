import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasSensitive, MASK, maskAuditData, maskValue, REVEAL_MS } from './sensitive.ts';

describe('Campos sensíveis (CA-RN-135.6, CA-RN-135.8)', () => {
  it('CA-RN-135.6 a máscara é sempre a mesma, não revela o tamanho e o vazio continua vazio', () => {
    assert.equal(maskValue('5aadad111-4fc5-4175-ab2c-6fb054575104'), MASK);
    assert.equal(maskValue('x'), MASK);
    assert.equal(maskValue(''), '');
    assert.equal(maskValue(null), '');
    assert.equal(maskValue(undefined), '');
    assert.equal(maskValue('curto'), maskValue('um valor bem mais comprido que o outro'));
  });

  it('o campo revelado volta a ocultar em 60 segundos', () => {
    assert.equal(REVEAL_MS, 60_000);
  });

  it('CA-RN-135.8 a auditoria: chave email/ip e e-mail ou IPv4 dentro de texto viram a máscara, em qualquer nível', () => {
    const data = {
      email: 'maria@empresa.com.br',
      ip: '203.0.113.7',
      name: 'Maria',
      nested: { userEmail: 'x', ipAddress: '2001:db8::1', note: 'veio de 198.51.100.9 por joao@empresa.com' },
      list: ['a@b.co', 'sem nada'],
    };
    const out = JSON.stringify(maskAuditData(data));
    for (const leak of [
      'maria@empresa.com.br',
      '203.0.113.7',
      '2001:db8::1',
      '198.51.100.9',
      'joao@empresa.com',
      'a@b.co',
    ]) {
      assert.equal(out.includes(leak), false, leak);
    }
    assert.equal(out.includes('Maria'), true);
    assert.equal(out.includes('sem nada'), true);
    assert.deepEqual(maskAuditData({ count: 3, ok: true, none: null }), { count: 3, ok: true, none: null });
  });

  it('só marca como sensível o que tem e-mail ou IP', () => {
    assert.equal(hasSensitive({ email: 'a@b.co' }), true);
    assert.equal(hasSensitive({ ip: '10.0.0.1' }), true);
    assert.equal(hasSensitive({ texto: 'contato a@b.co' }), true);
    assert.equal(hasSensitive({ nome: 'Maria', total: 3 }), false);
    assert.equal(hasSensitive(null), false);
  });
});
