/**
 * Regras puras da árvore de entidades (RN-25), sobre o caminho materializado do TypeORM
 * (`id_raiz.id_filho.`): um nó é descendente de outro quando o caminho dele começa com o do outro.
 */
export interface TreeNode {
  id: string;
  mpath: string;
}

/** Mover `nodeId` para debaixo de `newParentId` criaria ciclo? (para dentro de si ou de um descendente) */
export function wouldCreateCycle(nodeId: string, newParentId: string, tree: readonly TreeNode[]): boolean {
  if (nodeId === newParentId) return true;
  const node = tree.find((n) => n.id === nodeId);
  const parent = tree.find((n) => n.id === newParentId);
  if (!node || !parent) return false;
  return parent.mpath.startsWith(node.mpath);
}

/** A própria entidade e todas as descendentes (filtros "entidade pai inclui as filhas", CA-RN-25.2). */
export function subtreeIds(entityId: string, tree: readonly TreeNode[]): string[] {
  const root = tree.find((n) => n.id === entityId);
  if (!root) return [];
  return tree.filter((n) => n.mpath.startsWith(root.mpath)).map((n) => n.id);
}

/** Profundidade a partir da raiz (raiz = 0). */
export function depthOf(mpath: string): number {
  return Math.max(0, mpath.split('.').filter(Boolean).length - 1);
}
