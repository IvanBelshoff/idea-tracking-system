import { z } from 'zod';

/**
 * Campos personalizados do usuário (M25, RN-193 a RN-202): regras puras, sem banco. A mesma regra de
 * máscara existe no frontend (`frontend/src/lib/user-fields.ts`), testada nos dois lados.
 */

/** Limites (RN-193 a RN-195). */
export const MAX_ACTIVE_FIELDS = 8;
export const LABEL_MAX = 60;
export const HINT_MAX = 200;
export const TEXT_MAX = 200;
export const OPTIONS_MAX = 100;
export const OPTION_MAX = 80;
export const PATTERN_MAX = 40;

/** Abertos: texto, número, data e texto com máscara (RN-194). Fechado: escolha numa lista (RN-195). */
export const FIELD_KINDS = ['text', 'number', 'date', 'mask', 'choice'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
export const OPEN_KINDS: readonly FieldKind[] = ['text', 'number', 'date', 'mask'];
export const MASK_PRESETS = ['cpf', 'phone', 'custom'] as const;
export type MaskPreset = (typeof MASK_PRESETS)[number];

export interface FieldConfig {
  /** Texto: tamanho mínimo e máximo. Número: valor mínimo e máximo. */
  min?: number | null;
  max?: number | null;
  /** Número: só inteiros. */
  integer?: boolean;
  /** Texto com máscara. */
  preset?: MaskPreset;
  /** Máscara livre: `9` dígito, `A` letra, `*` letra ou dígito; o resto é fixo. */
  pattern?: string | null;
}

const label = z.string().trim().min(1).max(LABEL_MAX);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const optionLabel = z.string().trim().min(1).max(OPTION_MAX);

/** A máscara livre precisa ter pelo menos um lugar para digitar e só caracteres visíveis. */
export function patternValid(pattern: string): boolean {
  // Espaço no meio vale (ex.: "(99) 99999-9999"); nas pontas, tabulação ou quebra de linha, não.
  return (
    pattern.length > 0 &&
    pattern.length <= PATTERN_MAX &&
    /[9A*]/.test(pattern) &&
    pattern === pattern.trim() &&
    !/[\t\r\n]/.test(pattern)
  );
}

const config = z
  .object({
    min: z.number().nullish(),
    max: z.number().nullish(),
    integer: z.boolean().optional(),
    preset: z.enum(MASK_PRESETS).optional(),
    pattern: z.string().trim().nullish(),
  })
  .strict();

/** Confere a configuração de cada tipo; devolve o caminho e a mensagem do primeiro problema. */
export function configProblem(kind: FieldKind, c: FieldConfig): { path: string; message: string } | null {
  const has = (v: unknown) => v !== undefined && v !== null;
  if (kind === 'text') {
    if (has(c.min) && (!Number.isInteger(c.min) || (c.min as number) < 0 || (c.min as number) > TEXT_MAX))
      return { path: 'config.min', message: `De 0 a ${TEXT_MAX}.` };
    if (has(c.max) && (!Number.isInteger(c.max) || (c.max as number) < 1 || (c.max as number) > TEXT_MAX))
      return { path: 'config.max', message: `De 1 a ${TEXT_MAX}.` };
  }
  if ((kind === 'text' || kind === 'number') && has(c.min) && has(c.max) && (c.min as number) > (c.max as number))
    return { path: 'config.min', message: 'O mínimo passa do máximo.' };
  if (kind === 'mask') {
    if (!c.preset) return { path: 'config.preset', message: 'Escolha a máscara.' };
    if (c.preset === 'custom' && !patternValid(c.pattern ?? ''))
      return { path: 'config.pattern', message: 'Use 9 (dígito), A (letra) ou * (letra ou dígito).' };
  }
  return null;
}

/** Só guarda o que cada tipo usa. */
export function cleanConfig(kind: FieldKind, c: FieldConfig): FieldConfig {
  if (kind === 'text') return { min: c.min ?? null, max: c.max ?? null };
  if (kind === 'number') return { min: c.min ?? null, max: c.max ?? null, integer: c.integer ?? false };
  if (kind === 'mask') return { preset: c.preset, pattern: c.preset === 'custom' ? (c.pattern ?? null) : null };
  return {};
}

const flags = {
  required: z.boolean().optional(),
  searchable: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  adminLocked: z.boolean().optional(),
  integration: z.boolean().optional(),
  uniqueValues: z.boolean().optional(),
};

export const CreateFieldSchema = z
  .object({
    labelPt: label,
    labelEn: optionalText(LABEL_MAX),
    hintPt: optionalText(HINT_MAX),
    hintEn: optionalText(HINT_MAX),
    kind: z.enum(FIELD_KINDS),
    config: config.optional().default({}),
    options: z.array(optionLabel).max(OPTIONS_MAX).optional(),
    ...flags,
  })
  .strict();
export type CreateFieldInput = z.infer<typeof CreateFieldSchema>;

export const UpdateFieldSchema = z
  .object({
    labelPt: label.optional(),
    labelEn: optionalText(LABEL_MAX).optional(),
    hintPt: optionalText(HINT_MAX).optional(),
    hintEn: optionalText(HINT_MAX).optional(),
    kind: z.enum(FIELD_KINDS).optional(),
    config: config.optional(),
    active: z.boolean().optional(),
    ...flags,
  })
  .strict();
export type UpdateFieldInput = z.infer<typeof UpdateFieldSchema>;

export const OptionSchema = z.object({ label: optionLabel }).strict();
export const UpdateOptionSchema = z.object({ label: optionLabel.optional(), active: z.boolean().optional() }).strict();
export const OrderSchema = z.object({ ids: z.array(z.uuid()).max(500) });

/** As opções de um campo, sem repetir (sem diferença de maiúsculas). */
export function duplicateLabel(labels: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const l of labels) {
    const key = l.trim().toLocaleLowerCase('pt-BR');
    if (seen.has(key)) return l;
    seen.add(key);
  }
  return null;
}

/**
 * Regras entre as opções (RN-193, RN-199): valor único só nos abertos; dado sensível nunca sai na
 * integração; "pesquisável" vem ligado de fábrica nos de texto e de máscara que não são sensíveis.
 */
export function flagsProblem(kind: FieldKind, f: { uniqueValues: boolean; sensitive: boolean; integration: boolean }) {
  if (f.uniqueValues && !OPEN_KINDS.includes(kind)) return { path: 'uniqueValues', message: 'Só campos abertos.' };
  if (f.sensitive && f.integration) return { path: 'integration', message: 'Dado sensível não sai na integração.' };
  return null;
}
export const defaultSearchable = (kind: FieldKind, sensitive: boolean) =>
  !sensitive && (kind === 'text' || kind === 'mask');

// --- Valores (RN-194) ---------------------------------------------------------------------------

/** CPF pelos dígitos verificadores (sequências repetidas não valem). */
export function cpfValid(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

/** Encaixa o valor na máscara livre: aceita com ou sem os caracteres fixos. Devolve o valor formatado ou nulo. */
export function applyPattern(pattern: string, raw: string): string | null {
  const slots = [...pattern].filter((c) => c === '9' || c === 'A' || c === '*').length;
  const typed = [...raw.trim()].filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (typed.length !== slots) return null;
  let out = '';
  let i = 0;
  for (const c of pattern) {
    if (c === '9' || c === 'A' || c === '*') {
      const ch = typed[i++] as string;
      if (c === '9' && !/^\d$/.test(ch)) return null;
      if (c === 'A' && !/^\p{L}$/u.test(ch)) return null;
      out += c === 'A' ? ch.toLocaleUpperCase('pt-BR') : ch;
    } else out += c;
  }
  // Com os fixos digitados, eles precisam estar no lugar certo.
  const fixed = raw.trim();
  if (fixed.length === pattern.length && fixed.toLocaleUpperCase('pt-BR') !== out.toLocaleUpperCase('pt-BR'))
    return null;
  return out;
}

function phone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return null;
}

export type ValueResult = { ok: true; value: string; uniqueKey: string } | { ok: false; reason: string };

const fail = (reason: string): ValueResult => ({ ok: false, reason });

/**
 * Confere e formata o valor digitado de um campo aberto (RN-194). A chave de "valor único" ignora
 * maiúsculas e a pontuação: "AB-1234" e "ab1234" são o mesmo valor.
 */
export function normalizeValue(kind: FieldKind, c: FieldConfig, raw: string): ValueResult {
  const value = raw.trim();
  if (value === '') return fail('Preencha este campo.');
  const key = (v: string) => v.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
  switch (kind) {
    case 'text': {
      const max = c.max ?? TEXT_MAX;
      if (value.length > max) return fail(`Até ${max} caracteres.`);
      if (c.min && value.length < c.min) return fail(`Pelo menos ${c.min} caracteres.`);
      return { ok: true, value, uniqueKey: value.toLocaleLowerCase('pt-BR') };
    }
    case 'number': {
      const text = value.replace(',', '.');
      if (!/^-?\d+(\.\d+)?$/.test(text)) return fail('Digite um número.');
      const n = Number(text);
      if (c.integer && !Number.isInteger(n)) return fail('Digite um número inteiro.');
      if (c.min !== undefined && c.min !== null && n < c.min) return fail(`O mínimo é ${c.min}.`);
      if (c.max !== undefined && c.max !== null && n > c.max) return fail(`O máximo é ${c.max}.`);
      const canonical = String(n);
      return { ok: true, value: canonical, uniqueKey: canonical };
    }
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
      if (!m || !date || date.toISOString().slice(0, 10) !== value) return fail('Data inválida.');
      return { ok: true, value, uniqueKey: value };
    }
    case 'mask': {
      if (c.preset === 'cpf') {
        if (!cpfValid(value)) return fail('CPF inválido.');
        const d = value.replace(/\D/g, '');
        return { ok: true, value: `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`, uniqueKey: d };
      }
      if (c.preset === 'phone') {
        const formatted = phone(value);
        return formatted ? { ok: true, value: formatted, uniqueKey: key(formatted) } : fail('Telefone inválido.');
      }
      const formatted = applyPattern(c.pattern ?? '', value);
      return formatted
        ? { ok: true, value: formatted, uniqueKey: key(formatted) }
        : fail(`Use o formato ${c.pattern}.`);
    }
    default:
      return fail('Escolha uma opção.');
  }
}
