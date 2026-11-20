import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import type { RequestMeta } from './auth-context.js';
import { Role, RolePermission } from './entities/role.entity.js';
import { UserRoleScope } from './entities/user-role-scope.entity.js';
import { ALL_PERMISSIONS, isPermission, PERMISSIONS, type Permission } from './permissions.js';
import type { PermissionInfo, RoleView } from './roles.dto.js';

const notFound = () => apiError(404, 'not_found', 'Perfil não encontrado.');

/**
 * Perfis e permissões (§3.2): o admin edita os de fábrica e cria outros. Travas:
 *  - o Administrador sempre tem todas as permissões (senão alguém poderia perder o controle);
 *  - perfil de fábrica não é apagado; perfil em uso também não.
 */
@Injectable()
export class RolesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  catalog(): PermissionInfo[] {
    return ALL_PERMISSIONS.map((code) => ({ code, description: PERMISSIONS[code] }));
  }

  private async view(role: Role, m: EntityManager): Promise<RoleView> {
    const grants = await m.getRepository(RolePermission).findBy({ roleId: role.id });
    const usersCount = await m
      .getRepository(UserRoleScope)
      .createQueryBuilder('s')
      .select('COUNT(DISTINCT s.user_id)', 'n')
      .where('s.role_id = :id', { id: role.id })
      .getRawOne<{ n: string }>();
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      systemKey: role.systemKey,
      permissions: grants
        .map((g) => g.permission)
        .filter(isPermission)
        .sort(),
      usersCount: Number(usersCount?.n ?? 0),
    };
  }

  async list(): Promise<RoleView[]> {
    const m = this.dataSource.manager;
    const roles = await m.getRepository(Role).find({ order: { isSystem: 'DESC', name: 'ASC' } });
    return Promise.all(roles.map((r) => this.view(r, m)));
  }

  private async assertNameFree(name: string, m: EntityManager, exceptId?: string) {
    const other = await m
      .getRepository(Role)
      .createQueryBuilder('r')
      .where('lower(r.name) = lower(:name)', { name })
      .getOne();
    if (other && other.id !== exceptId) throw apiError(409, 'role_name_taken', 'Já existe um perfil com este nome.');
  }

  async create(
    actorId: string,
    meta: RequestMeta,
    input: { name: string; description?: string | null; permissions: Permission[] },
  ): Promise<RoleView> {
    return this.dataSource.transaction(async (m) => {
      await this.assertNameFree(input.name, m);
      const repo = m.getRepository(Role);
      const role = await repo.save(
        repo.create({ name: input.name, description: input.description ?? null, isSystem: false, systemKey: null }),
      );
      if (input.permissions.length > 0) {
        await m
          .getRepository(RolePermission)
          .insert(input.permissions.map((permission) => ({ roleId: role.id, permission })));
      }
      await this.audit.record(
        {
          action: 'role.created',
          actorId,
          targetType: 'role',
          targetId: role.id,
          data: { name: role.name, permissions: input.permissions },
          ip: meta.ip,
        },
        m,
      );
      return this.view(role, m);
    });
  }

  async update(
    actorId: string,
    meta: RequestMeta,
    id: string,
    input: Partial<{ name: string; description: string | null; permissions: Permission[] }>,
  ): Promise<RoleView> {
    return this.dataSource.transaction(async (m) => {
      const role = await m.getRepository(Role).findOneBy({ id });
      if (!role) throw notFound();
      if (role.systemKey === 'admin' && input.permissions && input.permissions.length !== ALL_PERMISSIONS.length) {
        throw apiError(409, 'admin_role_locked', 'O perfil Administrador sempre tem todas as permissões.');
      }
      if (input.name !== undefined) await this.assertNameFree(input.name, m, role.id);

      const changes: Partial<Role> = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.description !== undefined) changes.description = input.description;
      if (Object.keys(changes).length > 0) await m.getRepository(Role).update(role.id, changes);

      let before: string[] | undefined;
      if (input.permissions) {
        const grants = m.getRepository(RolePermission);
        before = (await grants.findBy({ roleId: role.id })).map((g) => g.permission).sort();
        await grants.delete({ roleId: role.id });
        if (input.permissions.length > 0) {
          await grants.insert(input.permissions.map((permission) => ({ roleId: role.id, permission })));
        }
      }
      await this.audit.record(
        {
          action: 'role.updated',
          actorId,
          targetType: 'role',
          targetId: role.id,
          data: {
            fields: Object.keys(input),
            ...(before ? { before, after: [...(input.permissions ?? [])].sort() } : {}),
          },
          ip: meta.ip,
        },
        m,
      );
      return this.view(await m.getRepository(Role).findOneByOrFail({ id: role.id }), m);
    });
  }

  async remove(actorId: string, meta: RequestMeta, id: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const role = await m.getRepository(Role).findOneBy({ id });
      if (!role) throw notFound();
      if (role.isSystem) throw apiError(409, 'system_role', 'Perfis de fábrica não podem ser apagados.');
      if ((await m.getRepository(UserRoleScope).countBy({ roleId: role.id })) > 0) {
        throw apiError(409, 'role_in_use', 'O perfil está atribuído a usuários; retire-o antes de apagar.');
      }
      await m.getRepository(Role).delete(role.id);
      await this.audit.record(
        {
          action: 'role.deleted',
          actorId,
          targetType: 'role',
          targetId: role.id,
          data: { name: role.name },
          ip: meta.ip,
        },
        m,
      );
    });
  }
}
