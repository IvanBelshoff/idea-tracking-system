import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, In } from 'typeorm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { apiError, parseInput } from '../common/api-error.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { UserField, UserFieldOption, UserFieldValue } from './entities.js';
import { missingRequired } from './profile.js';
import { normalizeValue, TEXT_MAX } from './user-field-rules.js';
import type { UserFieldFormView, UserFieldValueView } from './user-values.dto.js';

/** Corpo da gravação: os campos que mudam; vazio (ou nulo) apaga o valor de um campo não obrigatório. */
const SaveSchema = z.object({
  values: z
    .array(
      z
        .object({
          fieldId: z.uuid(),
          value: z
            .string()
            .max(TEXT_MAX * 2)
            .nullish(),
          optionId: z.uuid().nullish(),
        })
        .strict(),
    )
    .min(1)
    .max(50),
});

const problem = (index: number, message: string, code = 'validation_failed', status = 422) =>
  apiError(status, code, message, [{ path: `values.${index}`, message }]);

/**
 * Os valores dos campos de uma pessoa (M25, RN-196 a RN-199). A própria pessoa mexe só nos seus; com
 * `user.manage`, a administração mexe nos de qualquer um. A auditoria registra QUAIS campos mudaram,
 * nunca os valores (CA-T.29).
 */
@Injectable()
export class UserValuesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  form(userId: string, asAdmin: boolean): Promise<UserFieldFormView> {
    return this.view(this.dataSource.manager, userId, asAdmin);
  }

  async save(
    userId: string,
    actor: { id: string; asAdmin: boolean },
    meta: RequestMeta,
    body: unknown,
  ): Promise<UserFieldFormView> {
    const input = parseInput(SaveSchema, body, 422);
    return this.dataSource.transaction(async (m) => {
      // Uma pessoa por vez: duas gravações simultâneas não furam a trava nem o valor único.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`user_field_values:${userId}`]);
      const ids = input.values.map((v) => v.fieldId);
      if (new Set(ids).size !== ids.length) throw problem(0, 'Cada campo aparece uma vez só.');
      const fields = new Map((await m.getRepository(UserField).findBy({ id: In(ids) })).map((f) => [f.id, f]));
      const repo = m.getRepository(UserFieldValue);
      const current = new Map((await repo.findBy({ userId, fieldId: In(ids) })).map((v) => [v.fieldId, v]));
      const changed: string[] = [];

      for (const [index, entry] of input.values.entries()) {
        const field = fields.get(entry.fieldId);
        if (!field?.active) throw problem(index, 'Campo inexistente ou desativado.');
        const existing = current.get(field.id) ?? null;
        const empty = field.kind === 'choice' ? !entry.optionId : !entry.value?.trim();

        if (empty) {
          if (!existing) continue;
          if (field.required) throw problem(index, 'Campo obrigatório.');
          this.assertUnlocked(field, existing, actor.asAdmin, index);
          await repo.delete(existing.id);
          changed.push(field.labelPt);
          continue;
        }

        let next: { value: string | null; optionId: string | null; uniqueKey: string | null };
        if (field.kind === 'choice') {
          const option = await m
            .getRepository(UserFieldOption)
            .findOneBy({ id: entry.optionId as string, fieldId: field.id });
          // A opção desativada só vale para quem já a tinha (RN-195).
          if (!option || (!option.active && existing?.optionId !== option.id)) {
            throw problem(index, 'Escolha uma das opções do campo.');
          }
          next = { value: null, optionId: option.id, uniqueKey: null };
        } else {
          const result = normalizeValue(field.kind, field.config, entry.value ?? '');
          if (!result.ok) throw problem(index, result.reason);
          next = { value: result.value, optionId: null, uniqueKey: field.uniqueValues ? result.uniqueKey : null };
        }
        if (existing && existing.value === next.value && existing.optionId === next.optionId) continue;
        this.assertUnlocked(field, existing, actor.asAdmin, index);
        if (next.uniqueKey) {
          const clash = await repo
            .createQueryBuilder('v')
            .where('v.field_id = :f AND v.unique_key = :k AND v.user_id <> :u', {
              f: field.id,
              k: next.uniqueKey,
              u: userId,
            })
            .getExists();
          if (clash) throw problem(index, 'Outra pessoa já tem este valor.', 'custom_field_duplicate', 409);
        }
        if (existing) await repo.update(existing.id, next);
        else await repo.save(repo.create({ userId, fieldId: field.id, ...next }));
        changed.push(field.labelPt);
      }

      if (changed.length > 0) {
        await this.audit.record(
          {
            action: actor.id === userId ? 'user_field.values_changed_self' : 'user_field.values_changed',
            actorId: actor.id,
            targetType: 'user',
            targetId: userId,
            data: { fields: changed },
            ip: meta.ip,
          },
          m,
        );
      }
      return this.view(m, userId, actor.asAdmin);
    });
  }

  /** "Só a administração altera depois de preenchido" (RN-196): a pessoa preenche o vazio, e só. */
  private assertUnlocked(field: UserField, existing: UserFieldValue | null, asAdmin: boolean, index: number) {
    if (!asAdmin && field.adminLocked && existing) {
      throw problem(index, 'Só a administração altera este campo.', 'custom_field_locked', 403);
    }
  }

  private async view(m: EntityManager, userId: string, asAdmin: boolean): Promise<UserFieldFormView> {
    const fields = await m.getRepository(UserField).find({ where: { active: true }, order: { sortOrder: 'ASC' } });
    const ids = fields.map((f) => f.id);
    const values = ids.length ? await m.getRepository(UserFieldValue).findBy({ userId, fieldId: In(ids) }) : [];
    const options = ids.length
      ? await m.getRepository(UserFieldOption).find({ where: { fieldId: In(ids) }, order: { sortOrder: 'ASC' } })
      : [];
    const byField = new Map(values.map((v) => [v.fieldId, v]));
    return {
      missing: await missingRequired(m, userId),
      fields: fields.map((f): UserFieldValueView => {
        const v = byField.get(f.id) ?? null;
        const option = v?.optionId ? options.find((o) => o.id === v.optionId) : undefined;
        return {
          id: f.id,
          labelPt: f.labelPt,
          labelEn: f.labelEn,
          hintPt: f.hintPt,
          hintEn: f.hintEn,
          kind: f.kind,
          config: f.config,
          required: f.required,
          sensitive: f.sensitive,
          adminLocked: f.adminLocked,
          value: v?.value ?? null,
          optionId: v?.optionId ?? null,
          optionLabel: option?.label ?? null,
          editable: asAdmin || !(f.adminLocked && v),
          // As ativas, mais a desativada que a pessoa já tem (ela continua com ela).
          options: options
            .filter((o) => o.fieldId === f.id && (o.active || o.id === v?.optionId))
            .map((o) => ({ id: o.id, label: o.label, active: o.active })),
        };
      }),
    };
  }
}
