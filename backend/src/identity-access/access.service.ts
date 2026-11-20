import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, SelectQueryBuilder } from 'typeorm';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import { type Access, computeAccess, type EntityNode, type Grant } from './access.js';
import type { RequestWithAuth } from './auth-context.js';
import type { Permission } from './permissions.js';

/**
 * Carrega o acesso efetivo do usuário. Calculado a cada requisição (e guardado nela): uma edição
 * de perfil pelo admin vale na próxima chamada, sem cache para invalidar (CA-RN-01.7).
 * A árvore é pequena (dezenas ou centenas de nós), então é lida inteira.
 */
@Injectable()
export class AccessService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async load(userId: string): Promise<Access> {
    const rows: { entity_id: string; include_children: boolean; permission: string }[] = await this.dataSource.query(
      `SELECT s.entity_id, s.include_children, p.permission
         FROM user_role_scope s
         JOIN role_permission p ON p.role_id = s.role_id
        WHERE s.user_id = $1`,
      [userId],
    );
    const grants = new Map<string, Grant & { permissions: string[] }>();
    for (const r of rows) {
      const key = `${r.entity_id}:${r.include_children}`;
      const g = grants.get(key) ?? { entityId: r.entity_id, includeChildren: r.include_children, permissions: [] };
      g.permissions.push(r.permission);
      grants.set(key, g);
    }
    return computeAccess(userId, [...grants.values()], await this.tree());
  }

  /** Acesso do usuário da requisição, calculado uma vez por requisição. */
  async forRequest(req: RequestWithAuth): Promise<Access> {
    if (!req.auth) throw new Error('forRequest sem sessão');
    req.access ??= await this.load(req.auth.user.id);
    return req.access;
  }

  async tree(): Promise<EntityNode[]> {
    return this.dataSource
      .getRepository(OrgEntity)
      .createQueryBuilder('e')
      .select('e.id', 'id')
      .addSelect('e.mpath', 'mpath')
      .getRawMany<EntityNode>();
  }
}

/**
 * Escopo central (RN-01, CA-T.5; docs/STACK-E-ARQUITETURA.md §3.3): restringe a consulta às
 * entidades onde o usuário tem a permissão. `ownerColumn` aplica a exceção fixa "o autor sempre
 * vê o que é seu" (ideias, a partir do M2). Sem entidade alguma, a consulta não devolve nada.
 */
export function applyScope<T extends object>(
  qb: SelectQueryBuilder<T>,
  access: Access,
  permission: Permission,
  options: { entityColumn: string; ownerColumn?: string },
): SelectQueryBuilder<T> {
  const ids = access.entities(permission);
  const param = `scope_${permission.replace(/\W/g, '_')}`;
  const conditions: string[] = [];
  if (ids.length > 0) conditions.push(`${options.entityColumn} IN (:...${param})`);
  if (options.ownerColumn) conditions.push(`${options.ownerColumn} = :${param}_owner`);
  if (conditions.length === 0) return qb.andWhere('1 = 0');
  return qb.andWhere(`(${conditions.join(' OR ')})`, { [param]: ids, [`${param}_owner`]: access.userId });
}
