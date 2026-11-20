/**
 * Nome do autor para quem consome a API (RN-107): só o nome de exibição, e só quando pode sair.
 * Sem autor ou com o opt-out de nome (RN-70, RN-74): nulo. Anonimizado (RN-40): "Ex-colaborador".
 * (O envio anônimo, D5, ainda não existe no ITS; quando existir, a ideia anônima não terá autor.)
 */
export interface AuthorLike {
  name: string;
  hideName: boolean;
  status: string;
}

export const FORMER_EMPLOYEE = 'Ex-colaborador';

export function authorName(user: AuthorLike | null | undefined): string | null {
  if (!user) return null;
  if (user.status === 'anonymized') return FORMER_EMPLOYEE;
  if (user.hideName) return null;
  return user.name;
}
