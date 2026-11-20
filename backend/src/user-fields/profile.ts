import type { EntityManager } from 'typeorm';

/**
 * Os campos obrigatórios ativos que a pessoa ainda não preencheu (RN-197, RN-198). Uma consulta só, usada
 * pela guarda do 428 em todo pedido logado: sem campo obrigatório, volta vazia na hora.
 */
export async function missingRequired(m: EntityManager, userId: string): Promise<string[]> {
  const rows: { id: string }[] = await m.query(
    `SELECT f.id FROM user_field f
      WHERE f.active AND f.required
        AND NOT EXISTS (SELECT 1 FROM user_field_value v WHERE v.field_id = f.id AND v.user_id = $1)
      ORDER BY f.sort_order`,
    [userId],
  );
  return rows.map((r) => r.id);
}

/** Pedaço de SQL: o usuário `alias` tem algum obrigatório vazio (anonimizado não conta). */
export const INCOMPLETE_SQL = (alias: string) =>
  `(${alias}.status <> 'anonymized' AND EXISTS (SELECT 1 FROM user_field f WHERE f.active AND f.required
     AND NOT EXISTS (SELECT 1 FROM user_field_value v WHERE v.field_id = f.id AND v.user_id = ${alias}.id)))`;
