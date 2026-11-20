import { afterEach, describe, expect, it } from 'vitest';
import { isAllowedPhotoUrl, photoRequestFor } from '../../src/identity-access/sso/provider-photo.js';

const ENV = ['SSO_GRAPH_BASE_OVERRIDE', 'SSO_PHOTO_TEST_HOST'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

describe('Foto do provedor: endereços permitidos (M20, RN-144, CA-T.22)', () => {
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('Google: só https em *.googleusercontent.com, sem porta nem usuário na URL', () => {
    delete process.env.SSO_PHOTO_TEST_HOST;
    expect(isAllowedPhotoUrl('google', 'https://lh3.googleusercontent.com/a/abc=s512-c')).toBe(true);
    for (const bad of [
      'http://lh3.googleusercontent.com/a/abc',
      'https://lh3.googleusercontent.com:8443/a/abc',
      'https://user:x@lh3.googleusercontent.com/a',
      'https://googleusercontent.com.evil.test/a',
      'https://evilgoogleusercontent.com/a',
      'https://127.0.0.1/a',
      'http://169.254.169.254/latest/meta-data',
      'file:///etc/passwd',
      'nada',
    ]) {
      expect(isAllowedPhotoUrl('google', bad), bad).toBe(false);
    }
  });

  it('Microsoft: só o Graph; o host de teste vale só com o valor exato', () => {
    delete process.env.SSO_GRAPH_BASE_OVERRIDE;
    delete process.env.SSO_PHOTO_TEST_HOST;
    expect(isAllowedPhotoUrl('microsoft', 'https://graph.microsoft.com/v1.0/me/photo/$value')).toBe(true);
    expect(isAllowedPhotoUrl('microsoft', 'http://graph.microsoft.com/v1.0/me/photo/$value')).toBe(false);
    expect(isAllowedPhotoUrl('microsoft', 'https://lh3.googleusercontent.com/a')).toBe(false);
    process.env.SSO_PHOTO_TEST_HOST = '127.0.0.1:4567';
    expect(isAllowedPhotoUrl('google', 'http://127.0.0.1:4567/picture/a')).toBe(true);
    expect(isAllowedPhotoUrl('google', 'http://127.0.0.1:4568/picture/a')).toBe(false);
    expect(isAllowedPhotoUrl('google', 'http://localhost:4567/picture/a')).toBe(false);
  });

  it('o pedido: Microsoft precisa do token; Google pede 512 px quando o endereço aceita tamanho', () => {
    delete process.env.SSO_GRAPH_BASE_OVERRIDE;
    expect(photoRequestFor('microsoft', {}, null)).toBeNull();
    expect(photoRequestFor('microsoft', {}, 'tk')).toEqual({
      urls: [
        'https://graph.microsoft.com/v1.0/me/photos/504x504/$value',
        'https://graph.microsoft.com/v1.0/me/photo/$value',
      ],
      bearer: 'tk',
    });
    expect(photoRequestFor('google', { picture: 'https://lh3.googleusercontent.com/a/abc=s96-c' }, 'tk')).toEqual({
      urls: ['https://lh3.googleusercontent.com/a/abc=s512-c'],
      bearer: null,
    });
    expect(photoRequestFor('google', { picture: 'https://lh3.googleusercontent.com/a/abc' }, null)?.urls).toEqual([
      'https://lh3.googleusercontent.com/a/abc',
    ]);
    expect(photoRequestFor('google', {}, null)).toBeNull();
    expect(photoRequestFor('google', { picture: 42 }, null)).toBeNull();
  });
});
