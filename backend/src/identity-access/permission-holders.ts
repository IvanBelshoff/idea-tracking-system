import type { EntityManager } from 'typeorm';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import type { Permission } from './permissions.js';

/**
 * Usuários ATIVOS que têm a permissão numa entidade (perfil concedido nela ou num ancestral com
 * sub-entidades). Mesma regra de `computeAccess`, ao contrário: em vez de "onde esta pessoa pode",
 * "quem pode aqui". Usado por jobs (ex.: alerta de triagem atrasada ao gestor, RN-54).
 */
export async function usersWithPermissionIn(
  m: EntityManager,
  permission: Permission,
  entityId: string,
): Promise<string[]> {
  return usersWithPermissionInAny(m, permission, [entityId]);
}

/**
 * Usuários ATIVOS com a permissão em ao menos uma das entidades dadas. Usado pelos indicadores de
 * engajamento (RN-81): "quem pode enviar ideias" no escopo do relatório.
 */
export async function usersWithPermissionInAny(
  m: EntityManager,
  permission: Permission,
  entityIds: string[],
): Promise<string[]> {
  if (entityIds.length === 0) return [];
  const tree = await m
    .getRepository(OrgEntity)
    .createQueryBuilder('e')
    .select('e.id', 'id')
    .addSelect('e.mpath', 'mpath')
    .getRawMany<{ id: string; mpath: string }>();
  const pathOf = new Map(tree.map((e) => [e.id, e.mpath]));
  const targets = entityIds.flatMap((id) => {
    const mpath = pathOf.get(id);
    return mpath === undefined ? [] : [{ id, mpath }];
  });
  if (targets.length === 0) return [];
  const grants: { user_id: string; entity_id: string; include_children: boolean }[] = await m.query(
    `SELECT DISTINCT s.user_id, s.entity_id, s.include_children
       FROM user_role_scope s
       JOIN role_permission p ON p.role_id = s.role_id
       JOIN "user" u ON u.id = s.user_id
      WHERE p.permission = $1 AND u.status = 'active'`,
    [permission],
  );
  const users = new Set<string>();
  for (const g of grants) {
    if (users.has(g.user_id)) continue;
    const root = pathOf.get(g.entity_id);
    if (root === undefined) continue;
    const covers = targets.some((t) => t.id === g.entity_id || (g.include_children && t.mpath.startsWith(root)));
    if (covers) users.add(g.user_id);
  }
  return [...users];
}

/**
 * Usuários ATIVOS com a permissão em qualquer entidade, sem olhar a árvore. Para avisos da
 * instalação como um todo, como o alerta de saúde para quem tem `ops.view` (RN-94).
 */
export async function usersWithPermission(m: EntityManager, permission: Permission): Promise<string[]> {
  const rows: { user_id: string }[] = await m.query(
    `SELECT DISTINCT s.user_id
       FROM user_role_scope s
       JOIN role_permission p ON p.role_id = s.role_id
       JOIN "user" u ON u.id = s.user_id
      WHERE p.permission = $1 AND u.status = 'active'`,
    [permission],
  );
  return rows.map((row) => row.user_id);
}

/** Esta pessoa tem a permissão em alguma entidade? (acesso de emergência, RN-97). */
export async function userHasPermission(m: EntityManager, userId: string, permission: Permission): Promise<boolean> {
  const rows: unknown[] = await m.query(
    `SELECT 1
       FROM user_role_scope s
       JOIN role_permission p ON p.role_id = s.role_id
      WHERE s.user_id = $1 AND p.permission = $2
      LIMIT 1`,
    [userId, permission],
  );
  return rows.length > 0;
}
