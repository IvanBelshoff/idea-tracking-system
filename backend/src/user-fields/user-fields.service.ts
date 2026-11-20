import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, In } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError, parseInput } from '../common/api-error.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { IdeaFieldValue, UserField, UserFieldOption, UserFieldValue } from './entities.js';
import {
  CreateFieldSchema,
  cleanConfig,
  configProblem,
  defaultSearchable,
  duplicateLabel,
  type FieldKind,
  flagsProblem,
  MAX_ACTIVE_FIELDS,
  normalizeValue,
  OPTIONS_MAX,
  OptionSchema,
  OrderSchema,
  UpdateFieldSchema,
  UpdateOptionSchema,
} from './user-field-rules.js';
import type { UserFieldOptionView, UserFieldView } from './user-fields.dto.js';

/** Uma trava só para mexer nos campos: a contagem dos 8 ativos e a ordem não disputam. */
const FIELDS_LOCK = 7_262_025;

const notFound = () => apiError(404, 'not_found', 'Campo não encontrado.');
const optionNotFound = () => apiError(404, 'not_found', 'Opção não encontrada.');
const invalid = (path: string, message: string, code = 'validation_failed') =>
  apiError(422, code, message, [{ path, message }]);

/**
 * Campos personalizados do usuário (M25, RN-193 a RN-195, RN-199): criar, editar, ordenar, desativar e
 * excluir campos e opções. Só quem tem `user.manage` chega aqui.
 */
@Injectable()
export class UserFieldsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<UserFieldView[]> {
    return this.views(this.dataSource.manager);
  }

  async create(actorId: string, meta: RequestMeta, body: unknown): Promise<UserFieldView> {
    const input = parseInput(CreateFieldSchema, body, 422);
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [FIELDS_LOCK]);
      const fields = m.getRepository(UserField);
      if ((await fields.countBy({ active: true })) >= MAX_ACTIVE_FIELDS) {
        throw apiError(422, 'custom_field_limit', `A organização já tem ${MAX_ACTIVE_FIELDS} campos ativos.`);
      }
      const problem = configProblem(input.kind, input.config);
      if (problem) throw invalid(problem.path, problem.message);
      const sensitive = input.sensitive ?? false;
      const flags = {
        required: input.required ?? false,
        searchable: input.searchable ?? defaultSearchable(input.kind, sensitive),
        sensitive,
        adminLocked: input.adminLocked ?? false,
        integration: input.integration ?? false,
        uniqueValues: input.uniqueValues ?? false,
      };
      const flagProblem = flagsProblem(input.kind, flags);
      if (flagProblem) throw invalid(flagProblem.path, flagProblem.message);
      const options = input.kind === 'choice' ? (input.options ?? []) : [];
      if (input.kind === 'choice') this.assertOptions(options);

      const max = await fields
        .createQueryBuilder('f')
        .select('COALESCE(MAX(f.sort_order), 0)', 'max')
        .getRawOne<{ max: string }>();
      const created = await fields.save(
        fields.create({
          labelPt: input.labelPt,
          labelEn: input.labelEn,
          hintPt: input.hintPt,
          hintEn: input.hintEn,
          kind: input.kind,
          config: cleanConfig(input.kind, input.config),
          ...flags,
          active: true,
          sortOrder: Number(max?.max ?? 0) + 10,
        }),
      );
      const repo = m.getRepository(UserFieldOption);
      for (const [i, label] of options.entries()) {
        await repo.save(
          repo.create({ fieldId: created.id, label: label.trim(), active: true, sortOrder: (i + 1) * 10 }),
        );
      }
      await this.record(m, actorId, meta, 'user_field.created', created.id, {
        label: created.labelPt,
        kind: created.kind,
        options: options.length,
        ...flags,
      });
      return this.view(m, created.id);
    });
  }

  async update(actorId: string, meta: RequestMeta, id: string, body: unknown): Promise<UserFieldView> {
    const input = parseInput(UpdateFieldSchema, body, 422);
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [FIELDS_LOCK]);
      const fields = m.getRepository(UserField);
      const field = await fields.findOneBy({ id });
      if (!field) throw notFound();
      const inUse = await this.fieldInUse(m, id);
      const kind: FieldKind = input.kind ?? field.kind;

      if (kind !== field.kind) {
        if (inUse) throw apiError(409, 'custom_field_has_values', 'O tipo não muda depois de haver valor gravado.');
        if (kind === 'choice') throw invalid('kind', 'Para um campo fechado, crie um campo novo com as opções.');
      }
      const config = input.config ? { ...field.config, ...input.config } : field.config;
      const problem = configProblem(kind, config);
      if (problem) throw invalid(problem.path, problem.message);

      const flags = {
        required: input.required ?? field.required,
        searchable: input.searchable ?? field.searchable,
        sensitive: input.sensitive ?? field.sensitive,
        adminLocked: input.adminLocked ?? field.adminLocked,
        integration: input.integration ?? field.integration,
        uniqueValues: input.uniqueValues ?? field.uniqueValues,
      };
      const flagProblem = flagsProblem(kind, flags);
      if (flagProblem) throw invalid(flagProblem.path, flagProblem.message);

      if (input.active === true && !field.active && (await fields.countBy({ active: true })) >= MAX_ACTIVE_FIELDS) {
        throw apiError(422, 'custom_field_limit', `A organização já tem ${MAX_ACTIVE_FIELDS} campos ativos.`);
      }
      // Ligar "valor único" com valores repetidos é recusado; desligar apaga as chaves.
      if (flags.uniqueValues !== field.uniqueValues)
        await this.syncUniqueKeys(m, field, kind, config, flags.uniqueValues);
      if (kind !== field.kind && field.kind === 'choice')
        await m.getRepository(UserFieldOption).delete({ fieldId: id });

      await fields.update(id, {
        ...(input.labelPt !== undefined ? { labelPt: input.labelPt } : {}),
        ...(input.labelEn !== undefined ? { labelEn: input.labelEn } : {}),
        ...(input.hintPt !== undefined ? { hintPt: input.hintPt } : {}),
        ...(input.hintEn !== undefined ? { hintEn: input.hintEn } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        kind,
        config: cleanConfig(kind, config),
        ...flags,
      });
      const action =
        input.active === false && field.active
          ? 'user_field.deactivated'
          : input.active === true && !field.active
            ? 'user_field.activated'
            : 'user_field.updated';
      await this.record(m, actorId, meta, action, id, {
        label: input.labelPt ?? field.labelPt,
        changed: Object.keys(input),
      });
      return this.view(m, id);
    });
  }

  async remove(actorId: string, meta: RequestMeta, id: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [FIELDS_LOCK]);
      const field = await m.getRepository(UserField).findOneBy({ id });
      if (!field) throw notFound();
      if (await this.fieldInUse(m, id)) {
        throw apiError(409, 'custom_field_in_use', 'O campo tem valores gravados: desative em vez de excluir.');
      }
      await m.getRepository(UserField).delete(id);
      await this.record(m, actorId, meta, 'user_field.deleted', id, { label: field.labelPt });
    });
  }

  /** A ordem dos campos (RN-193): a lista completa, regravada de 10 em 10. */
  async reorder(actorId: string, meta: RequestMeta, body: unknown): Promise<UserFieldView[]> {
    const { ids } = parseInput(OrderSchema, body, 422);
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [FIELDS_LOCK]);
      const repo = m.getRepository(UserField);
      const known = new Set((await repo.find({ select: { id: true } })).map((f) => f.id));
      this.assertFullOrder(ids, known, 'A ordem precisa trazer todos os campos, cada um uma só vez.');
      for (const [i, fid] of ids.entries()) await repo.update(fid, { sortOrder: (i + 1) * 10 });
      await this.record(m, actorId, meta, 'user_field.reordered', null, { order: ids });
      return this.views(m);
    });
  }

  async addOption(actorId: string, meta: RequestMeta, fieldId: string, body: unknown): Promise<UserFieldView> {
    const { label } = parseInput(OptionSchema, body, 422);
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [FIELDS_LOCK]);
      await this.choiceField(m, fieldId);
      const repo = m.getRepository(UserFieldOption);
      const current = await repo.find({ where: { fieldId }, order: { sortOrder: 'DESC' } });
      if (current.length >= OPTIONS_MAX) throw invalid('label', `Até ${OPTIONS_MAX} opções por campo.`);
      if (duplicateLabel([...current.map((o) => o.label), label]))
        throw invalid('label', 'Esta opção já existe no campo.');
      const created = await repo.save(
        repo.create({ fieldId, label, active: true, sortOrder: (current[0]?.sortOrder ?? 0) + 10 }),
      );
      await this.record(m, actorId, meta, 'user_field.option_created', fieldId, { option: created.id, label });
      return this.view(m, fieldId);
    });
  }

  async updateOption(
    actorId: string,
    meta: RequestMeta,
    fieldId: string,
    optionId: string,
    body: unknown,
  ): Promise<UserFieldView> {
    const input = parseInput(UpdateOptionSchema, body, 422);
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [FIELDS_LOCK]);
      await this.choiceField(m, fieldId);
      const repo = m.getRepository(UserFieldOption);
      const all = await repo.findBy({ fieldId });
      const option = all.find((o) => o.id === optionId);
      if (!option) throw optionNotFound();
      if (input.label !== undefined) {
        const others = all.filter((o) => o.id !== optionId).map((o) => o.label);
        if (duplicateLabel([...others, input.label])) throw invalid('label', 'Esta opção já existe no campo.');
      }
      if (input.active === false && option.active && all.filter((o) => o.active).length === 1) {
        throw invalid('active', 'O campo precisa de pelo menos uma opção ativa.', 'custom_field_options_required');
      }
      await repo.update(optionId, input);
      const action =
        input.active === false && option.active
          ? 'user_field.option_deactivated'
          : input.active === true && !option.active
            ? 'user_field.option_activated'
            : 'user_field.option_updated';
      await this.record(m, actorId, meta, action, fieldId, { option: optionId, label: input.label ?? option.label });
      return this.view(m, fieldId);
    });
  }

  async removeOption(actorId: string, meta: RequestMeta, fieldId: string, optionId: string): Promise<UserFieldView> {
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [FIELDS_LOCK]);
      await this.choiceField(m, fieldId);
      const repo = m.getRepository(UserFieldOption);
      const all = await repo.findBy({ fieldId });
      const option = all.find((o) => o.id === optionId);
      if (!option) throw optionNotFound();
      if ((await this.optionsInUse(m, [optionId])).has(optionId)) {
        throw apiError(409, 'custom_field_option_in_use', 'Alguém já escolheu esta opção: desative em vez de excluir.');
      }
      if (option.active && all.filter((o) => o.active).length === 1) {
        throw invalid('id', 'O campo precisa de pelo menos uma opção ativa.', 'custom_field_options_required');
      }
      await repo.delete(optionId);
      await this.record(m, actorId, meta, 'user_field.option_deleted', fieldId, {
        option: optionId,
        label: option.label,
      });
      return this.view(m, fieldId);
    });
  }

  async reorderOptions(actorId: string, meta: RequestMeta, fieldId: string, body: unknown): Promise<UserFieldView> {
    const { ids } = parseInput(OrderSchema, body, 422);
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [FIELDS_LOCK]);
      await this.choiceField(m, fieldId);
      const repo = m.getRepository(UserFieldOption);
      const known = new Set((await repo.findBy({ fieldId })).map((o) => o.id));
      this.assertFullOrder(ids, known, 'A ordem precisa trazer todas as opções, cada uma uma só vez.');
      for (const [i, oid] of ids.entries()) await repo.update(oid, { sortOrder: (i + 1) * 10 });
      await this.record(m, actorId, meta, 'user_field.options_reordered', fieldId, { order: ids });
      return this.view(m, fieldId);
    });
  }

  // --- apoio ------------------------------------------------------------------------------------

  private assertOptions(options: string[]) {
    if (options.length === 0) {
      throw invalid('options', 'Cadastre pelo menos uma opção.', 'custom_field_options_required');
    }
    const repeated = duplicateLabel(options);
    if (repeated) throw invalid('options', `A opção "${repeated}" aparece duas vezes.`);
  }

  private assertFullOrder(ids: string[], known: Set<string>, message: string) {
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((x) => !known.has(x))) {
      throw apiError(422, 'invalid_order', message);
    }
  }

  private async choiceField(m: EntityManager, fieldId: string): Promise<UserField> {
    const field = await m.getRepository(UserField).findOneBy({ id: fieldId });
    if (!field) throw notFound();
    if (field.kind !== 'choice') throw invalid('kind', 'Só campos fechados têm opções.');
    return field;
  }

  /**
   * Liga ou desliga "valor único" (RN-194). Ao ligar, calcula a chave de cada valor e recusa se houver
   * repetido (409); o valor que não cabe mais na regra atual usa a chave do próprio texto.
   */
  private async syncUniqueKeys(
    m: EntityManager,
    field: UserField,
    kind: FieldKind,
    config: UserField['config'],
    on: boolean,
  ) {
    const repo = m.getRepository(UserFieldValue);
    if (!on) {
      await repo.update({ fieldId: field.id }, { uniqueKey: null });
      return;
    }
    const values = await repo.findBy({ fieldId: field.id });
    const keys = new Map<string, string>();
    for (const v of values) {
      const result = normalizeValue(kind, config, v.value ?? '');
      const key = result.ok
        ? result.uniqueKey
        : (v.value ?? '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
      if ([...keys.values()].includes(key)) {
        throw apiError(
          409,
          'custom_field_duplicate',
          'Há valores repetidos neste campo: corrija antes de exigir valor único.',
        );
      }
      keys.set(v.id, key);
    }
    for (const [vid, key] of keys) await repo.update(vid, { uniqueKey: key });
  }

  private async fieldInUse(m: EntityManager, fieldId: string): Promise<boolean> {
    return (
      (await m.getRepository(UserFieldValue).existsBy({ fieldId })) ||
      (await m.getRepository(IdeaFieldValue).existsBy({ fieldId }))
    );
  }

  private async optionsInUse(m: EntityManager, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows: { option_id: string }[] = await m.query(
      `SELECT option_id FROM user_field_value WHERE option_id = ANY($1)
        UNION SELECT option_id FROM idea_field_value WHERE option_id = ANY($1)`,
      [ids],
    );
    return new Set(rows.map((r) => r.option_id));
  }

  private async view(m: EntityManager, id: string): Promise<UserFieldView> {
    const all = await this.views(m, [id]);
    if (!all[0]) throw notFound();
    return all[0];
  }

  private async views(m: EntityManager, only?: string[]): Promise<UserFieldView[]> {
    const fields = await m.getRepository(UserField).find({
      where: only ? { id: In(only) } : {},
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    if (fields.length === 0) return [];
    const ids = fields.map((f) => f.id);
    const options = await m
      .getRepository(UserFieldOption)
      .find({ where: { fieldId: In(ids) }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    const used: { field_id: string }[] = await m.query(
      `SELECT DISTINCT field_id FROM user_field_value WHERE field_id = ANY($1)
        UNION SELECT DISTINCT field_id FROM idea_field_value WHERE field_id = ANY($1)`,
      [ids],
    );
    const fieldsInUse = new Set(used.map((r) => r.field_id));
    const optionsUsed = await this.optionsInUse(
      m,
      options.map((o) => o.id),
    );
    return fields.map((f) => ({
      id: f.id,
      labelPt: f.labelPt,
      labelEn: f.labelEn,
      hintPt: f.hintPt,
      hintEn: f.hintEn,
      kind: f.kind,
      config: f.config,
      required: f.required,
      searchable: f.searchable,
      sensitive: f.sensitive,
      adminLocked: f.adminLocked,
      integration: f.integration,
      uniqueValues: f.uniqueValues,
      active: f.active,
      sortOrder: f.sortOrder,
      inUse: fieldsInUse.has(f.id),
      options: options
        .filter((o) => o.fieldId === f.id)
        .map(
          (o): UserFieldOptionView => ({
            id: o.id,
            label: o.label,
            active: o.active,
            sortOrder: o.sortOrder,
            inUse: optionsUsed.has(o.id),
          }),
        ),
    }));
  }

  private record(
    m: EntityManager,
    actorId: string,
    meta: RequestMeta,
    action: string,
    targetId: string | null,
    data: Record<string, unknown>,
  ) {
    return this.audit.record(
      { action, actorId, targetType: 'user_field', ...(targetId ? { targetId } : {}), data, ip: meta.ip },
      m,
    );
  }
}
