/**
 * Ordem da árvore de entidades na escolha do escopo (RN-103): cada pai antes dos filhos, irmãos por
 * nome, com a profundidade para recuar. Função pura, sem React: roda nos testes do Node. Só `import type`.
 */
import type { components } from '@/api/schema';

export type EntityOption = components['schemas']['IntegrationEntityOption'];

/** As entidades em ordem de árvore (cada pai antes dos filhos, irmãos por nome) com a profundidade, para a lista do escopo. */
export function orderedTree(options: readonly EntityOption[]): { option: EntityOption; depth: number }[] {
  const ids = new Set(options.map((o) => o.id));
  const children = new Map<string | null, EntityOption[]>();
  for (const o of options) {
    const parent = o.parentId && ids.has(o.parentId) ? o.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), o]);
  }
  const out: { option: EntityOption; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = [...(children.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    for (const option of list) {
      out.push({ option, depth });
      if (depth < 20) walk(option.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
