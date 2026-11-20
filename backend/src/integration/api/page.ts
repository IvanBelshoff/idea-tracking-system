import { z } from 'zod';
import { apiError, parseInput } from '../../common/api-error.js';

/**
 * Convenções de lista da API de integração (RN-106): cursor opaco, `limit` (padrão 50, máximo 200),
 * `updated_since` e ordem estável por (`sync_at`, `id`). O cursor guarda o par da última linha
 * devolvida, com microssegundos (o texto vem do próprio banco), então percorrer a lista inteira
 * devolve cada item uma vez, sem repetir nem pular, mesmo com itens novos chegando no meio.
 */
export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(300).optional(),
  updated_since: z.iso.datetime({ offset: true }).optional(),
});

export interface PageParams {
  limit: number;
  cursor: { at: string; id: string } | null;
  updatedSince: Date | null;
}

/** Lê `limit`, `cursor` e `updated_since` da consulta; qualquer um inválido → 422. */
export function parsePage(query: unknown): PageParams {
  const q = parseInput(PageQuerySchema, query, 422);
  return {
    limit: q.limit,
    cursor: q.cursor ? decodeCursor(q.cursor) : null,
    updatedSince: q.updated_since ? new Date(q.updated_since) : null,
  };
}

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ a: at, i: id })).toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_MICRO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function decodeCursor(raw: string): { at: string; id: string } {
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { a?: unknown; i?: unknown };
    if (typeof value.a === 'string' && typeof value.i === 'string' && ISO_MICRO.test(value.a) && UUID.test(value.i)) {
      return { at: value.a, id: value.i };
    }
  } catch {
    // cai no erro abaixo
  }
  throw apiError(422, 'invalid_cursor', 'O cursor é inválido. Use o `next_cursor` devolvido pela lista.');
}

/** Acumula parâmetros de uma consulta SQL e devolve o marcador (`$1`, `$2`...). */
export class SqlParams {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** Texto de data com microssegundos, como o banco guarda: é o que vai no cursor e em `updated_at`. */
export const ISO_MICRO_SQL = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Condições de página sobre a subconsulta `alias` (que tem `sync_at` e `id`): depois do cursor e,
 * se pedido, `updated_since`. `updated_since` é inclusivo, para quem sincroniza nunca perder item.
 */
export function pagePredicates(alias: string, p: SqlParams, page: PageParams): string[] {
  const out: string[] = [];
  if (page.updatedSince) out.push(`${alias}.sync_at >= ${p.add(page.updatedSince)}::timestamptz`);
  if (page.cursor) {
    out.push(
      `(${alias}.sync_at, ${alias}.id) > (${p.add(page.cursor.at)}::timestamptz, ${p.add(page.cursor.id)}::uuid)`,
    );
  }
  return out;
}

export interface KeyRow {
  id: string;
  cur_at: string;
}

/** Corta a linha extra (pedida para saber se há mais) e monta o próximo cursor. */
export function sliceRows<T extends KeyRow>(rows: T[], limit: number): { rows: T[]; next: string | null } {
  if (rows.length <= limit) return { rows, next: null };
  const kept = rows.slice(0, limit);
  const last = kept.at(-1) as T;
  return { rows: kept, next: encodeCursor(last.cur_at, last.id) };
}
