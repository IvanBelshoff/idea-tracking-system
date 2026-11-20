import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import type { Access } from '../identity-access/access.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { UserRoleScope } from '../identity-access/entities/user-role-scope.entity.js';
import { OrgEntity } from './entities/org-entity.entity.js';
import type { EntityView } from './organization.dto.js';
import { SettingsService } from './settings.service.js';
import { depthOf, type TreeNode, wouldCreateCycle } from './tree.js';

/** Trava das mudanças na árvore: duas movimentações simultâneas não formam ciclo juntas. */
const TREE_LOCK = 7_262_004;

const notFound = () => apiError(404, 'not_found', 'Entidade não encontrada.');
const forbidden = () => apiError(403, 'forbidden', 'Você não administra esta entidade.');

interface Row extends TreeNode {
  name: string;
  active: boolean;
  parent_id: string | null;
}

/**
 * Entidades da organização (RN-25, RN-26). Todos os usuários logados enxergam a estrutura (para
 * escolher a entidade ao enviar uma ideia); só quem tem `entity.manage` NA entidade a altera.
 * A raiz é a própria organização: criada pelo assistente, não se move, não se inativa, não se apaga.
 */
@Injectable()
export class EntitiesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private rows(m: EntityManager = this.dataSource.manager): Promise<Row[]> {
    return m
      .getRepository(OrgEntity)
      .createQueryBuilder('e')
      .select(['e.id AS id', 'e.name AS name', 'e.active AS active', 'e.mpath AS mpath', 'e.parent_id AS parent_id'])
      .orderBy('e.name', 'ASC')
      .getRawMany<Row>();
  }

  private view(r: Row, access: Access): EntityView {
    return {
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
      active: r.active,
      depth: depthOf(r.mpath),
      canManage: access.hasIn('entity.manage', r.id),
      canSubmit: r.active && access.hasIn('idea.submit', r.id),
    };
  }

  async list(access: Access): Promise<EntityView[]> {
    return (await this.rows()).map((r) => this.view(r, access));
  }

  private async assertNameFree(m: EntityManager, parentId: string, name: string, exceptId?: string) {
    const clash = await m
      .getRepository(OrgEntity)
      .createQueryBuilder('e')
      .where('e.parent_id = :parentId AND lower(e.name) = lower(:name)', { parentId, name })
      .getOne();
    if (clash && clash.id !== exceptId) {
      throw apiError(409, 'entity_name_taken', 'Já existe uma entidade com este nome no mesmo nível.');
    }
  }

  async create(access: Access, meta: RequestMeta, input: { name: string; parentId: string }): Promise<EntityView> {
    if (!access.hasIn('entity.manage', input.parentId)) throw forbidden();
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [TREE_LOCK]);
      const repo = m.getTreeRepository(OrgEntity);
      const parent = await repo.findOneBy({ id: input.parentId });
      if (!parent) throw apiError(422, 'entity_not_found', 'Entidade-pai inexistente.');
      await this.assertNameFree(m, parent.id, input.name);
      const created = await repo.save(repo.create({ name: input.name, parent, active: true }));
      await this.audit.record(
        {
          action: 'entity.created',
          actorId: access.userId,
          targetType: 'entity',
          targetId: created.id,
          data: { name: input.name, parentId: parent.id },
          ip: meta.ip,
        },
        m,
      );
      const row = (await this.rows(m)).find((r) => r.id === created.id);
      if (!row) throw notFound();
      return this.view(row, access);
    });
  }

  /** Renomear, mover (sem ciclo; CA-RN-25.1) ou ativar/inativar (RN-26). */
  async update(
    access: Access,
    meta: RequestMeta,
    id: string,
    input: Partial<{ name: string; parentId: string; active: boolean }>,
  ): Promise<EntityView> {
    if (!access.hasIn('entity.manage', id)) throw notFound(); // fora do escopo: não revela
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [TREE_LOCK]);
      const repo = m.getTreeRepository(OrgEntity);
      const node = await repo.findOne({ where: { id }, relations: { parent: true } });
      if (!node) throw notFound();
      const isRoot = node.parent === null;
      const tree = await this.rows(m);

      if (input.parentId !== undefined && input.parentId !== node.parent?.id) {
        if (isRoot) throw apiError(409, 'root_entity', 'A organização (raiz) não pode ser movida.');
        if (!access.hasIn('entity.manage', input.parentId)) throw forbidden();
        if (wouldCreateCycle(node.id, input.parentId, tree)) {
          throw apiError(
            409,
            'entity_cycle',
            'Não é possível mover uma entidade para dentro de si mesma ou de uma descendente.',
          );
        }
        const parent = await repo.findOneBy({ id: input.parentId });
        if (!parent) throw apiError(422, 'entity_not_found', 'Entidade-pai inexistente.');
        node.parent = parent;
      }
      if (input.active === false && isRoot)
        throw apiError(409, 'root_entity', 'A organização (raiz) não pode ser inativada.');
      if (input.name !== undefined) node.name = input.name;
      if (input.active !== undefined) node.active = input.active;
      if (node.parent && (input.name !== undefined || input.parentId !== undefined)) {
        await this.assertNameFree(m, node.parent.id, node.name, node.id);
      }

      // O save() reescreve o caminho do nó e de todos os descendentes ao mudar o pai (Spike 1).
      await repo.save(node);
      // A raiz é a organização: o nome dela e a configuração andam juntos.
      if (isRoot && input.name !== undefined) {
        await this.settings.set('organization.name', node.name, access.userId, m);
      }
      await this.audit.record(
        {
          action: 'entity.updated',
          actorId: access.userId,
          targetType: 'entity',
          targetId: node.id,
          data: { ...input },
          ip: meta.ip,
        },
        m,
      );
      const row = (await this.rows(m)).find((r) => r.id === node.id);
      if (!row) throw notFound();
      return this.view(row, access);
    });
  }

  /**
   * Apaga só entidade sem uso: sem filhas e sem perfis atribuídos (as ideias, a partir do M2,
   * também seguram pela chave estrangeira). Com uso, o caminho é inativar (RN-26).
   */
  async remove(access: Access, meta: RequestMeta, id: string): Promise<void> {
    if (!access.hasIn('entity.manage', id)) throw notFound();
    await this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [TREE_LOCK]);
      const repo = m.getTreeRepository(OrgEntity);
      const node = await repo.findOne({ where: { id }, relations: { parent: true } });
      if (!node) throw notFound();
      if (node.parent === null) throw apiError(409, 'root_entity', 'A organização (raiz) não pode ser apagada.');
      if ((await repo.countBy({ parent: { id } })) > 0) {
        throw apiError(409, 'entity_in_use', 'A entidade tem sub-entidades; mova-as ou apague-as antes.');
      }
      if ((await m.getRepository(UserRoleScope).countBy({ entityId: id })) > 0) {
        throw apiError(409, 'entity_in_use', 'Há usuários com perfil nesta entidade; inative-a em vez de apagar.');
      }
      await repo.delete(id);
      await this.audit.record(
        {
          action: 'entity.deleted',
          actorId: access.userId,
          targetType: 'entity',
          targetId: id,
          data: { name: node.name },
          ip: meta.ip,
        },
        m,
      );
    });
  }
}
