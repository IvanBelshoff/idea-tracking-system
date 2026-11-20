import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import type { Access } from '../identity-access/access.js';
import { AccessService } from '../identity-access/access.service.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { Category } from '../organization/entities/category.entity.js';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import { TriageRule } from './entities/triage-rule.entity.js';
import type { TriageRuleInput, TriageRuleView } from './triage-rules.dto.js';

interface Actor {
  access: Access;
  meta: RequestMeta;
}

const notFound = () => apiError(404, 'not_found', 'Regra não encontrada.');

/**
 * Regras de atribuição automática da triagem (RN-55), na tela do admin (`setting.manage`).
 * O analista da regra precisa poder triar na entidade da regra (ou em alguma, se a regra vale para
 * todas): regra que nunca poderia valer é recusada na gravação.
 */
@Injectable()
export class TriageRulesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accessService: AccessService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<TriageRuleView[]> {
    const rows = await this.dataSource.getRepository(TriageRule).find({
      relations: { entity: true, category: true, assignee: true },
      order: { priority: 'DESC', createdAt: 'ASC' },
    });
    return rows.map(toView);
  }

  private async validate(m: EntityManager, input: TriageRuleInput): Promise<void> {
    const problems: { path: string; message: string }[] = [];
    if (input.entityId && !(await m.getRepository(OrgEntity).existsBy({ id: input.entityId }))) {
      problems.push({ path: 'entityId', message: 'Entidade inexistente.' });
    }
    if (input.categoryId && !(await m.getRepository(Category).existsBy({ id: input.categoryId }))) {
      problems.push({ path: 'categoryId', message: 'Categoria inexistente.' });
    }
    const assignee = await m.getRepository(User).findOneBy({ id: input.assigneeId });
    const access = assignee?.status === UserStatus.Active ? await this.accessService.load(assignee.id) : null;
    const canTriage = input.entityId ? access?.hasIn('idea.triage', input.entityId) : access?.has('idea.triage');
    if (!canTriage) {
      problems.push({ path: 'assigneeId', message: 'Escolha alguém ativo que tria ideias nesta entidade.' });
    }
    if (problems.length > 0) throw apiError(422, 'validation_failed', 'Confira a regra.', problems);
  }

  async create({ access, meta }: Actor, input: TriageRuleInput): Promise<TriageRuleView> {
    const id = await this.dataSource.transaction(async (m) => {
      await this.validate(m, input);
      const repo = m.getRepository(TriageRule);
      const rule = await repo.save(repo.create({ ...input, active: input.active ?? true }));
      await this.audit.record(
        {
          action: 'triage_rule.created',
          actorId: access.userId,
          targetType: 'triage_rule',
          targetId: rule.id,
          data: input,
          ip: meta.ip,
        },
        m,
      );
      return rule.id;
    });
    return this.get(id);
  }

  async update({ access, meta }: Actor, id: string, input: TriageRuleInput): Promise<TriageRuleView> {
    await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(TriageRule);
      if (!(await repo.existsBy({ id }))) throw notFound();
      await this.validate(m, input);
      await repo.update(id, { ...input, active: input.active ?? true });
      await this.audit.record(
        {
          action: 'triage_rule.updated',
          actorId: access.userId,
          targetType: 'triage_rule',
          targetId: id,
          data: input,
          ip: meta.ip,
        },
        m,
      );
    });
    return this.get(id);
  }

  async remove({ access, meta }: Actor, id: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const result = await m.getRepository(TriageRule).delete({ id });
      if (!result.affected) throw notFound();
      await this.audit.record(
        { action: 'triage_rule.deleted', actorId: access.userId, targetType: 'triage_rule', targetId: id, ip: meta.ip },
        m,
      );
    });
  }

  private async get(id: string): Promise<TriageRuleView> {
    const rule = await this.dataSource
      .getRepository(TriageRule)
      .findOne({ where: { id }, relations: { entity: true, category: true, assignee: true } });
    if (!rule) throw notFound();
    return toView(rule);
  }
}

function toView(r: TriageRule): TriageRuleView {
  return {
    id: r.id,
    entity: r.entity ? { id: r.entity.id, name: r.entity.name } : null,
    category: r.category ? { id: r.category.id, name: r.category.name, color: r.category.color } : null,
    assignee: { id: r.assignee.id, name: r.assignee.name },
    priority: r.priority,
    active: r.active,
  };
}
