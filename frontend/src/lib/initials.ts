/** Iniciais do nome (primeira e última palavra), só com letras: "Ana Souza (demo)" → "AS" (CA-RN-142.1). */
export function initials(name: string): string {
  const parts = name
    .replace(/\([^)]*\)/g, ' ')
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}

/** Endereço da foto de uma pessoa; `version` renova o cache do navegador quando a foto muda. */
export const photoUrl = (userId: string, version: string) => `/api/users/${userId}/photo?v=${version}`;
