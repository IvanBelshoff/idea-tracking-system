import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { CATEGORY_SETS, type CategorySetKey } from './category-sets.js';
import { Category } from './entities/category.entity.js';
import { CategoryView, type ImportCategoriesResponse } from './organization.dto.js';
import { SettingsService } from './settings.service.js';

const IMPORT_LOCK = 7_262_005;
const ORDER_LOCK = 7_262_006;
const notFound = () => apiError(404, 'not_found', 'Categoria não encontrada.');

/**
 * Categorias (RN-24, RN-26): cadastradas pelo administrador, inativadas em vez de apagadas
 * (as ideias antigas continuam com a categoria e filtráveis).
 */
@Injectable()
export class CategoriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive: boolean): Promise<CategoryView[]> {
    const rows = await this.dataSource.getRepository(Category).find({
      where: includeInactive ? {} : { active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows.map(CategoryView.from);
  }

  private async assertNameFree(m: EntityManager, name: string, exceptId?: string) {
    const clash = await m
      .getRepository(Category)
      .createQueryBuilder('c')
      .where('lower(c.name) = lower(:name)', { name })
      .getOne();
    if (clash && clash.id !== exceptId)
      throw apiError(409, 'category_name_taken', 'Já existe uma categoria com este nome.');
  }

  async create(actorId: string, meta: RequestMeta, input: { name: string; color: string; sortOrder: number }) {
    return this.dataSource.transaction(async (m) => {
      await this.assertNameFree(m, input.name);
      const repo = m.getRepository(Category);
      const created = await repo.save(repo.create({ ...input, active: true }));
      await this.audit.record(
        {
          action: 'category.created',
          actorId,
          targetType: 'category',
          targetId: created.id,
          data: { name: input.name },
          ip: meta.ip,
        },
        m,
      );
      return CategoryView.from(created);
    });
  }

  async update(
    actorId: string,
    meta: RequestMeta,
    id: string,
    input: Partial<{ name: string; color: string; sortOrder: number; active: boolean }>,
  ): Promise<CategoryView> {
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(Category);
      const category = await repo.findOneBy({ id });
      if (!category) throw notFound();
      if (input.name !== undefined) await this.assertNameFree(m, input.name, id);
      await repo.update(id, input);
      await this.audit.record(
        { action: 'category.updated', actorId, targetType: 'category', targetId: id, data: { ...input }, ip: meta.ip },
        m,
      );
      return CategoryView.from(await repo.findOneByOrFail({ id }));
    });
  }

  /**
   * Reordena arrastando (M19, RN-137): recebe a lista COMPLETA, na ordem nova, e regrava `sort_order` de 10 em
   * 10 (sem lacuna nem repetição). Lista incompleta, repetida ou com id desconhecido → 422 e nada muda.
   * Duas reordenações simultâneas se enfileiram (trava) e a última vale inteira.
   */
  async reorder(actorId: string, meta: RequestMeta, ids: string[]): Promise<CategoryView[]> {
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [ORDER_LOCK]);
      const repo = m.getRepository(Category);
      const known = new Set((await repo.find({ select: { id: true } })).map((c) => c.id));
      if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
        throw apiError(422, 'invalid_order', 'A ordem precisa trazer todas as categorias, cada uma uma só vez.');
      }
      for (const [i, id] of ids.entries()) await repo.update(id, { sortOrder: (i + 1) * 10 });
      await this.audit.record(
        {
          action: 'category.reordered',
          actorId,
          targetType: 'category',
          data: { count: ids.length, order: ids },
          ip: meta.ip,
        },
        m,
      );
      return (await repo.find({ order: { sortOrder: 'ASC', name: 'ASC' } })).map(CategoryView.from);
    });
  }

  /** Importa um conjunto pronto, no idioma da instalação. Idempotente: não duplica pelo nome (CA-RN-24.2). */
  async importSet(actorId: string, meta: RequestMeta, set: CategorySetKey): Promise<ImportCategoriesResponse> {
    const locale = (await this.settings.get('organization.default_locale')) === 'en' ? 'en' : 'pt-BR';
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [IMPORT_LOCK]);
      const repo = m.getRepository(Category);
      const existing = new Set((await repo.find()).map((c) => c.name.toLocaleLowerCase(locale)));
      const maxOrder = Number(
        (
          await repo
            .createQueryBuilder('c')
            .select('COALESCE(MAX(c.sort_order), 0)', 'max')
            .getRawOne<{ max: string }>()
        )?.max ?? 0,
      );
      const created: Category[] = [];
      let skipped = 0;
      for (const [i, seed] of CATEGORY_SETS[set].entries()) {
        const name = seed.name[locale];
        if (existing.has(name.toLocaleLowerCase(locale))) {
          skipped++;
          continue;
        }
        created.push(
          await repo.save(repo.create({ name, color: seed.color, active: true, sortOrder: maxOrder + (i + 1) * 10 })),
        );
        existing.add(name.toLocaleLowerCase(locale));
      }
      await this.audit.record(
        {
          action: 'category.imported',
          actorId,
          targetType: 'category',
          data: { set, created: created.length, skipped },
          ip: meta.ip,
        },
        m,
      );
      return { created: created.map(CategoryView.from), skipped };
    });
  }
}
