/**
 * Ordenar sem arrastar (M19, RN-137, RN-138): funções puras, sem React, que rodam nos testes do Node. Toda
 * ação de arrastar tem a alternativa por botões ("subir" e "descer") e por teclado, que usam estas funções.
 */

/** Move o item `id` `delta` posições (negativo = para cima). No limite, devolve a mesma lista. */
export function moveBy<T>(list: readonly T[], id: T, delta: number): T[] {
  const from = list.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Move o item `id` para a posição de `overId` (o que o arrastar faz ao soltar). */
export function moveTo<T>(list: readonly T[], id: T, overId: T): T[] {
  const from = list.indexOf(id);
  const to = list.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return [...list];
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Insere `{{variavel}}` no texto, na posição do cursor (ou no lugar da seleção); sem cursor, no fim.
 * Devolve o texto novo e onde o cursor fica (logo depois da variável).
 */
export function insertAt(
  text: string,
  variable: string,
  start: number | null,
  end: number | null,
): { text: string; cursor: number } {
  const token = `{{${variable}}}`;
  const from = start ?? text.length;
  const to = end ?? from;
  return { text: `${text.slice(0, from)}${token}${text.slice(to)}`, cursor: from + token.length };
}
