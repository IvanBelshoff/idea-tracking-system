import { Lock } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, errorText, fieldErrors } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { SensitiveInput } from '@/components/form/sensitive';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  checkValue,
  type FieldConfig,
  fieldHint,
  fieldLabel,
  maskInput,
  numericMask,
  patternFor,
  placeholderFor,
  type ValueProblem,
} from '@/lib/user-fields';
import { FormError } from '../auth/auth-layout';
import type { FieldValue } from './queries';

export type ValueEntry = { fieldId: string; value?: string | null; optionId?: string | null };

const initialOf = (f: FieldValue) => (f.kind === 'choice' ? (f.optionId ?? '') : (f.value ?? ''));

/**
 * Os campos de uma pessoa (M25, RN-196, RN-197): cada tipo com o seu controle, conferido como o servidor
 * confere. Envia só o que mudou. O campo travado aparece só para leitura; o sensível, com o olho.
 */
export function ValuesForm({
  fields,
  missing,
  pending,
  error,
  submitLabel,
  extraActions,
  hideOn,
  markMissing = true,
  onSave,
}: {
  fields: FieldValue[];
  missing: string[];
  pending: boolean;
  error: unknown;
  submitLabel: string;
  extraActions?: ReactNode;
  /** Quando muda (ex.: salvou), o campo sensível volta a ocultar. */
  hideOn?: unknown;
  /** Marca "obrigatório e vazio" (fora do portão, onde todos os campos já são os que faltam). */
  markMissing?: boolean;
  onSave: (values: ValueEntry[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const tx = t as unknown as (key: string, options?: object) => string;
  const initial = useMemo(() => Object.fromEntries(fields.map((f) => [f.id, initialOf(f)])), [fields]);
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [tried, setTried] = useState(false);
  useEffect(() => setDraft(initial), [initial]);
  const server = fieldErrors(error);

  const problemOf = (f: FieldValue): ValueProblem | null => {
    const raw = draft[f.id] ?? '';
    if (raw.trim() === '') return f.required ? { key: 'required' } : null;
    if (f.kind === 'choice') return null;
    const result = checkValue(f.kind, f.config as FieldConfig, raw);
    return result.ok ? null : result.problem;
  };
  const changed = fields.filter((f) => f.editable && (draft[f.id] ?? '') !== initial[f.id]);
  const problems = new Map(fields.filter((f) => f.editable).map((f) => [f.id, problemOf(f)]));
  const valid = [...problems.values()].every((p) => p === null);
  const indexOf = (id: string) => changed.findIndex((f) => f.id === id);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!valid || changed.length === 0) return;
        onSave(
          changed.map((f) => {
            const raw = (draft[f.id] ?? '').trim();
            if (f.kind === 'choice') return { fieldId: f.id, optionId: raw || null };
            const checked = raw ? checkValue(f.kind, f.config as FieldConfig, raw) : null;
            return { fieldId: f.id, value: checked?.ok ? checked.value : raw || null };
          }),
        );
      }}
      className="grid gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const label = fieldLabel(f, lng);
          const problem = problems.get(f.id) ?? null;
          const shownProblem =
            (tried || (draft[f.id] ?? '') !== initial[f.id]) && problem
              ? tx(`userFields.values.problems.${problem.key}`, problem)
              : undefined;
          const i = indexOf(f.id);
          const message = shownProblem ?? (i >= 0 ? server[`values.${i}`] : undefined);
          const isMissing = markMissing && missing.includes(f.id) && (draft[f.id] ?? '') === '';
          const hint = [
            fieldHint(f, lng),
            !f.editable ? t('userFields.values.locked') : undefined,
            isMissing ? t('userFields.values.missing') : undefined,
          ]
            .filter(Boolean)
            .join(' · ');
          const fieldLabelText = f.required ? `${label} (${t('userFields.values.required')})` : label;
          const config = f.config as FieldConfig;
          // Texto com máscara: o formato se aplica a cada tecla (M25, RN-194).
          const set = (v: string) => setDraft((d) => ({ ...d, [f.id]: f.kind === 'mask' ? maskInput(config, v) : v }));
          const maskProps =
            f.kind === 'mask'
              ? {
                  maxLength: patternFor(config, '99999999999').length,
                  inputMode: numericMask(config) ? ('numeric' as const) : undefined,
                }
              : {};
          const common = { disabled: !f.editable, 'aria-required': f.required || undefined };
          let control: React.ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
          if (f.kind === 'choice') {
            control = (
              <NativeSelect value={draft[f.id] ?? ''} onChange={(e) => set(e.target.value)} {...common}>
                <option value="">{t('userFields.values.choose')}</option>
                {f.options.map((o) => (
                  <option key={o.id} value={o.id} disabled={!o.active && o.id !== initial[f.id]}>
                    {o.active ? o.label : t('userFields.values.inactiveOption', { label: o.label })}
                  </option>
                ))}
              </NativeSelect>
            );
          } else if (f.sensitive && initial[f.id] !== '') {
            control = (
              <SensitiveInput
                value={draft[f.id] ?? ''}
                fieldLabel={label}
                hideOn={hideOn}
                onChange={(e) => set(e.target.value)}
                placeholder={placeholderFor(f.kind, f.config as FieldConfig)}
                readOnly={!f.editable}
                {...maskProps}
              />
            );
          } else {
            control = (
              <Input
                type={f.kind === 'date' ? 'date' : 'text'}
                inputMode={f.kind === 'number' ? 'decimal' : undefined}
                {...maskProps}
                autoComplete="off"
                value={draft[f.id] ?? ''}
                onChange={(e) => set(e.target.value)}
                placeholder={placeholderFor(f.kind, f.config as FieldConfig)}
                {...common}
              />
            );
          }
          return (
            <Field key={f.id} label={fieldLabelText} hint={hint || undefined} error={message}>
              {control}
            </Field>
          );
        })}
      </div>
      {fields.some((f) => !f.editable) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock aria-hidden="true" className="size-3.5" />
          {t('userFields.values.locked')}
        </p>
      )}
      <FormError
        message={error && !(error instanceof ApiError && Object.keys(server).length > 0) ? errorText(t, error) : null}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || changed.length === 0}>
          {submitLabel}
        </Button>
        {extraActions}
      </div>
    </form>
  );
}
