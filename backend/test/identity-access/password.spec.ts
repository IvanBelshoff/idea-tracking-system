import { describe, expect, it } from 'vitest';
import {
  checkPasswordPolicy,
  hashPassword,
  newToken,
  PASSWORD_MAX_LENGTH,
  tokenHash,
  verifyPassword,
} from '../../src/identity-access/password.js';

const policy = { minLength: 10, minClasses: 3 };

describe('Senhas (RN-42)', () => {
  it('CA-RN-42.4 a senha é guardada só como hash Argon2id, nunca em texto', async () => {
    const hash = await hashPassword('Correta-Cavalo-9');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('Correta-Cavalo-9');
    expect(await verifyPassword(hash, 'Correta-Cavalo-9')).toBe(true);
    expect(await verifyPassword(hash, 'correta-cavalo-9')).toBe(false);
    expect(await verifyPassword('lixo', 'qualquer')).toBe(false);
  });

  it('CA-RN-42.1 a política mínima (tamanho e classes) é aplicada e configurável', () => {
    expect(checkPasswordPolicy('Curta1!', policy)).toEqual(['too_short']);
    expect(checkPasswordPolicy('somenteminusculas', policy)).toEqual(['too_few_classes']);
    expect(checkPasswordPolicy('Minusculas e MAIUSCULAS', policy)).toEqual([]); // espaço conta como símbolo
    expect(checkPasswordPolicy('Senhaforte2026', policy)).toEqual([]);
    expect(checkPasswordPolicy('ação-Ñandú-çõ', policy)).toEqual([]); // letras acentuadas contam
    expect(checkPasswordPolicy('a'.repeat(PASSWORD_MAX_LENGTH + 1), policy)).toContain('too_long');
    // Configurável: política mais branda aceita o que a padrão recusa.
    expect(checkPasswordPolicy('somenteminusculas', { minLength: 8, minClasses: 1 })).toEqual([]);
  });

  it('tokens são aleatórios e só o hash SHA-256 é guardado', () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
    expect(tokenHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash(a)).toBe(tokenHash(a));
  });
});
