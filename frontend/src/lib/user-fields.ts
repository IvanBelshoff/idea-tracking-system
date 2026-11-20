/**
 * Campos personalizados do usuário (M25, RN-193 a RN-195): a mesma regra do servidor
 * (`backend/src/user-fields/user-field-rules.ts`), sem React, testada nos dois lados. O servidor confere
 * de novo; aqui só se evita mandar o que ele vai recusar e se mostra o formato esperado.
 */

export const MAX_ACTIVE_FIELDS = 8;
export const LABEL_MAX = 60;
export const HINT_MAX = 200;
export const TEXT_MAX = 200;
export const OPTIONS_MAX = 100;
export const OPTION_MAX = 80;
export const PATTERN_MAX = 40;

export type FieldKind = 'text' | 'number' | 'date' | 'mask' | 'choice';
export type MaskPreset = 'cpf' | 'phone' | 'custom';
export const OPEN_KINDS: readonly FieldKind[] = ['text', 'number', 'date', 'mask'];

export interface FieldConfig {
  min?: number | null;
  max?: number | null;
  integer?: boolean;
  preset?: MaskPreset;
  pattern?: string | null;
}

/** A máscara livre precisa de pelo menos um lugar para digitar e nenhum espaço. */
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

const isSlot = (c: string) => c === '9' || c === 'A' || c === '*';
const fits = (slot: string, ch: string) =>
  slot === '9' ? /^\d$/.test(ch) : slot === 'A' ? /^\p{L}$/u.test(ch) : /^[\p{L}\p{N}]$/u.test(ch);

/**
 * Aplica a máscara enquanto a pessoa digita: põe os caracteres fixos no lugar, descarta o que não cabe
 * (letra onde vai dígito) e para no fim do formato. Os fixos só entram quando há algo digitado depois
 * deles, para apagar com o backspace funcionar.
 */
export function maskAsTyped(pattern: string, raw: string): string {
  const chars = [...raw];
  let out = '';
  let i = 0;
  for (const p of pattern) {
    if (isSlot(p)) {
      while (i < chars.length && !fits(p, chars[i] as string)) i++;
      if (i >= chars.length) break;
      const ch = chars[i++] as string;
      out += p === 'A' ? ch.toLocaleUpperCase('pt-BR') : ch;
    } else {
      if (!chars.slice(i).some((c) => /[\p{L}\p{N}]/u.test(c))) break;
      out += p;
      if (chars[i] === p) i++;
    }
  }
  return out;
}

/** O formato de cada máscara: o pronto (CPF, telefone de 10 ou 11 dígitos) ou o do administrador. */
export function patternFor(c: FieldConfig, raw = ''): string {
  if (c.preset === 'cpf') return '999.999.999-99';
  // Até 10 dígitos, fixo; o 11º passa para o celular, com 5 dígitos antes do hífen.
  if (c.preset === 'phone') return raw.replace(/\D/g, '').length > 10 ? '(99) 99999-9999' : '(99) 9999-9999';
  return c.pattern ?? '';
}

/** A máscara aplicada ao digitar, para os três tipos de máscara. */
export function maskInput(c: FieldConfig, raw: string): string {
  return maskAsTyped(patternFor(c, raw), raw);
}

/** Um exemplo preenchido do formato, para o administrador ver como fica: "(99) 9999" → "(12) 3456". */
export function patternExample(pattern: string): string {
  let digit = 1;
  let letter = 0;
  return [...pattern]
    .map((c) => {
      if (c === '9') return String(digit++ % 10);
      if (c === 'A' || c === '*') return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[letter++ % 26];
      return c;
    })
    .join('');
}

/** Só dígitos no formato: o celular abre o teclado numérico. */
export function numericMask(c: FieldConfig): boolean {
  return c.preset !== 'custom' || !/[A*]/.test(c.pattern ?? '');
}

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

/** Encaixa o valor na máscara livre, com ou sem os caracteres fixos; nulo se não couber. */
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

/** Os motivos, como chaves de texto da tela (`userFields.problems.*`), com os valores para interpolar. */
export type ValueProblem =
  | { key: 'required' }
  | { key: 'tooLong'; max: number }
  | { key: 'tooShort'; min: number }
  | { key: 'number' }
  | { key: 'integer' }
  | { key: 'min'; min: number }
  | { key: 'max'; max: number }
  | { key: 'date' }
  | { key: 'cpf' }
  | { key: 'phone' }
  | { key: 'pattern'; pattern: string };

export type ValueCheck = { ok: true; value: string } | { ok: false; problem: ValueProblem };
const fail = (problem: ValueProblem): ValueCheck => ({ ok: false, problem });

/** Confere e formata o valor digitado de um campo aberto (RN-194), como o servidor faz. */
export function checkValue(kind: FieldKind, c: FieldConfig, raw: string): ValueCheck {
  const value = raw.trim();
  if (value === '') return fail({ key: 'required' });
  switch (kind) {
    case 'text': {
      const max = c.max ?? TEXT_MAX;
      if (value.length > max) return fail({ key: 'tooLong', max });
      if (c.min && value.length < c.min) return fail({ key: 'tooShort', min: c.min });
      return { ok: true, value };
    }
    case 'number': {
      const text = value.replace(',', '.');
      if (!/^-?\d+(\.\d+)?$/.test(text)) return fail({ key: 'number' });
      const n = Number(text);
      if (c.integer && !Number.isInteger(n)) return fail({ key: 'integer' });
      if (c.min !== undefined && c.min !== null && n < c.min) return fail({ key: 'min', min: c.min });
      if (c.max !== undefined && c.max !== null && n > c.max) return fail({ key: 'max', max: c.max });
      return { ok: true, value: String(n) };
    }
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
      if (!m || !date || date.toISOString().slice(0, 10) !== value) return fail({ key: 'date' });
      return { ok: true, value };
    }
    case 'mask': {
      if (c.preset === 'cpf') {
        if (!cpfValid(value)) return fail({ key: 'cpf' });
        const d = value.replace(/\D/g, '');
        return { ok: true, value: `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` };
      }
      if (c.preset === 'phone') {
        const formatted = phone(value);
        return formatted ? { ok: true, value: formatted } : fail({ key: 'phone' });
      }
      const formatted = applyPattern(c.pattern ?? '', value);
      return formatted ? { ok: true, value: formatted } : fail({ key: 'pattern', pattern: c.pattern ?? '' });
    }
    default:
      return fail({ key: 'required' });
  }
}

/** O exemplo do formato, para o campo vazio mostrar o que se espera. */
export function placeholderFor(kind: FieldKind, c: FieldConfig): string | undefined {
  if (kind !== 'mask') return undefined;
  if (c.preset === 'cpf') return '000.000.000-00';
  if (c.preset === 'phone') return '(00) 00000-0000';
  return (c.pattern ?? '').replace(/9/g, '0');
}

/** O nome do campo no idioma da tela; sem o inglês, vale o pt-BR. */
export function fieldLabel(f: { labelPt: string; labelEn?: string | null }, lng: string): string {
  return lng.startsWith('en') && f.labelEn ? f.labelEn : f.labelPt;
}

export function fieldHint(f: { hintPt?: string | null; hintEn?: string | null }, lng: string): string | undefined {
  return (lng.startsWith('en') && f.hintEn ? f.hintEn : f.hintPt) || undefined;
}
