import type { EntityManager } from 'typeorm';
import { IdeaFieldValue } from './entities.js';

/**
 * Grava na ideia o valor dos campos fechados do autor naquele momento (M25, RN-201): o relatório conta a
 * ideia pelo que o autor era quando a enviou. Vale para o envio normal, em nome de outra pessoa e pela
 * API (todos passam por `IdeasService.submit`). Campo desativado ou vazio não grava nada.
 */
export async function snapshotAuthorFields(m: EntityManager, ideaId: string, authorId: string): Promise<void> {
  const rows: { field_id: string; option_id: string; label: string }[] = await m.query(
    `SELECT v.field_id, v.option_id, o.label
       FROM user_field_value v
       JOIN user_field f ON f.id = v.field_id
       JOIN user_field_option o ON o.id = v.option_id
      WHERE v.user_id = $1 AND f.active AND f.kind = 'choice'`,
    [authorId],
  );
  if (rows.length === 0) return;
  const repo = m.getRepository(IdeaFieldValue);
  for (const r of rows) {
    await repo.save(repo.create({ ideaId, fieldId: r.field_id, optionId: r.option_id, label: r.label }));
  }
}

/** Os campos fechados ativos, na ordem: as colunas e os agrupamentos dos relatórios. */
export async function reportFields(
  m: EntityManager,
): Promise<{ id: string; labelPt: string; labelEn: string | null }[]> {
  const rows: { id: string; label_pt: string; label_en: string | null }[] = await m.query(
    `SELECT id, label_pt, label_en FROM user_field WHERE active AND kind = 'choice' ORDER BY sort_order, created_at`,
  );
  return rows.map((r) => ({ id: r.id, labelPt: r.label_pt, labelEn: r.label_en }));
}
