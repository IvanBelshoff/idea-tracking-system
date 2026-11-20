import { isPermission, type Permission } from './permissions.js';

/**
 * Acesso efetivo de um usuário (§3.2 das regras): para cada permissão, em quais entidades ela vale.
 * Um perfil é concedido EM uma entidade, com ou sem as sub-entidades; perfis diferentes em
 * entidades diferentes se somam. Regra pura, sem banco (testável no nível U).
 */

/** Um "perfil em entidade" do usuário, já com as permissões do perfil. */
export interface Grant {
  entityId: string;
  includeChildren: boolean;
  permissions: readonly string[];
}

/** Nó da árvore de entidades com o caminho materializado do TypeORM (`id1.id2.`). */
export interface EntityNode {
  id: string;
  mpath: string;
}

export class Access {
  constructor(
    readonly userId: string,
    private readonly byPermission: ReadonlyMap<Permission, ReadonlySet<string>>,
  ) {}

  /** Tem a permissão em pelo menos uma entidade (para rotas que não são de uma entidade só). */
  has(permission: Permission): boolean {
    return (this.byPermission.get(permission)?.size ?? 0) > 0;
  }

  /** Tem a permissão nesta entidade (ex.: triar uma ideia da Unidade B; CA-RN-01.5). */
  hasIn(permission: Permission, entityId: string): boolean {
    return this.byPermission.get(permission)?.has(entityId) ?? false;
  }

  /** Tem alguma permissão nesta entidade (acesso à entidade; responsável de etapa, CA-RN-15.2). */
  hasAnyIn(entityId: string): boolean {
    for (const set of this.byPermission.values()) if (set.has(entityId)) return true;
    return false;
  }

  /** Entidades onde a permissão vale: é o que o `applyScope` usa nas consultas. */
  entities(permission: Permission): string[] {
    return [...(this.byPermission.get(permission) ?? [])];
  }

  /** Permissões que o usuário tem em alguma entidade (o frontend usa para montar o menu). */
  permissions(): Permission[] {
    return [...this.byPermission.entries()].filter(([, set]) => set.size > 0).map(([p]) => p);
  }
}

export function computeAccess(userId: string, grants: readonly Grant[], tree: readonly EntityNode[]): Access {
  const pathOf = new Map(tree.map((e) => [e.id, e.mpath]));
  const byPermission = new Map<Permission, Set<string>>();

  for (const grant of grants) {
    const root = pathOf.get(grant.entityId);
    if (root === undefined) continue; // entidade inexistente: ignora, nunca amplia o acesso
    const entities = grant.includeChildren
      ? tree.filter((e) => e.mpath.startsWith(root)).map((e) => e.id)
      : [grant.entityId];
    for (const code of grant.permissions) {
      if (!isPermission(code)) continue; // código antigo ou desconhecido não concede nada
      const set = byPermission.get(code) ?? new Set<string>();
      for (const id of entities) set.add(id);
      byPermission.set(code, set);
    }
  }
  return new Access(userId, byPermission);
}
