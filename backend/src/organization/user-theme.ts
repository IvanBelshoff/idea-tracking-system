import { type DerivedBrand, deriveBrand } from './brand-color.js';

/**
 * Paleta curada da cor de cada pessoa (RN-145): só estas cores, nunca uma livre. Cada uma passa pela
 * mesma regra da cor da marca (o escuro é derivado e o contraste AA é conferido); o teste da paleta
 * exige que nenhuma precise de correção, nos dois temas.
 */
export const USER_THEME_COLORS = [
  { key: 'indigo', hex: '#5458c8' },
  { key: 'blue', hex: '#1d4ed8' },
  { key: 'teal', hex: '#0f766e' },
  { key: 'green', hex: '#15803d' },
  { key: 'amber', hex: '#b45309' },
  { key: 'red', hex: '#be123c' },
  { key: 'pink', hex: '#be185d' },
  { key: 'violet', hex: '#7c3aed' },
] as const;
export type UserThemeColor = (typeof USER_THEME_COLORS)[number]['key'];
export const USER_THEME_KEYS = USER_THEME_COLORS.map((c) => c.key) as [UserThemeColor, ...UserThemeColor[]];

export function isUserThemeColor(value: unknown): value is UserThemeColor {
  return USER_THEME_COLORS.some((c) => c.key === value);
}

/** A cor da marca derivada de uma cor da paleta (nulo para chave desconhecida). */
export function userBrand(key: string | null): DerivedBrand | null {
  const color = USER_THEME_COLORS.find((c) => c.key === key);
  return color ? deriveBrand(color.hex) : null;
}
