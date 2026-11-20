import { describe, expect, it } from 'vitest';
import { contrast, deriveBrand } from '../../src/organization/brand-color.js';
import { USER_THEME_COLORS, userBrand } from '../../src/organization/user-theme.js';

const parse = (css: string) => {
  const [L, C, H] = css
    .replace(/^oklch\(|\)$/g, '')
    .split(' ')
    .map(Number);
  return { L: L as number, C: C as number, H: H as number };
};

describe('Paleta curada da cor de cada pessoa (M20, RN-145)', () => {
  it('CA-RN-145.3 cada cor passa no contraste nos dois temas sem precisar de correção', () => {
    for (const { key, hex } of USER_THEME_COLORS) {
      const d = deriveBrand(hex);
      expect(d.adjusted, key).toEqual({ light: false, dark: false });
      for (const pair of [d.light, d.dark]) {
        expect(contrast(parse(pair.brandFg), parse(pair.brand)), `${key} texto sobre a cor`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it('as chaves são únicas e a cor desconhecida não vira marca', () => {
    expect(new Set(USER_THEME_COLORS.map((c) => c.key)).size).toBe(USER_THEME_COLORS.length);
    expect(USER_THEME_COLORS).toHaveLength(8);
    expect(userBrand('violet')?.lightHex).toMatch(/^#[0-9a-f]{6}$/);
    expect(userBrand('#ff0000')).toBeNull();
    expect(userBrand(null)).toBeNull();
  });
});
