import 'reflect-metadata';
import { Column, type DataSource, Entity, PrimaryColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../support/test-db.js';

/**
 * SPIKE 2 – Ideias semelhantes por trigramas (RN-57; CA-RN-57.1 e 57.2).
 * Perguntas:
 *  (a) a coluna de busca pode ser GERADA pelo próprio TypeORM (generatedType/asExpression)?
 *  (b) a consulta sai por QueryBuilder (parametrizada), com escopo, ignorando arquivadas/convergidas?
 *  (c) acentos do português não atrapalham (unaccent)?
 *  (d) o índice GIN de trigramas é realmente usado?
 */
@Entity('spike_idea_search')
class SearchIdea {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) title!: string;
  @Column({ type: 'text' }) description!: string;
  @Column({ name: 'entity_id', type: 'uuid' }) entityId!: string;
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true }) archivedAt!: Date | null;
  @Column({ name: 'converged_into_id', type: 'uuid', nullable: true }) convergedIntoId!: string | null;
  // Coluna gerada pelo banco, declarada na entidade. Somente leitura para a aplicação.
  @Column({
    name: 'search_text',
    type: 'text',
    generatedType: 'STORED',
    asExpression: "immutable_unaccent(lower(title || ' ' || description))",
    select: false,
    insert: false,
    update: false,
  })
  searchText!: string;
}

// No projeto real isto vai para uma migração (extensões, função e índice).
async function setupExtensions(admin: DataSource) {
  await admin.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await admin.query('CREATE EXTENSION IF NOT EXISTS unaccent');
  await admin.query(`CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
    AS $$ SELECT public.unaccent('public.unaccent', $1) $$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT`);
}
async function createIndex(ds: DataSource) {
  await ds.query('CREATE INDEX idx_spike_idea_search_trgm ON spike_idea_search USING gin (search_text gin_trgm_ops)');
}

/** Repositório: busca de semelhantes só com QueryBuilder (parâmetros, escopo, sem arquivadas/convergidas). */
async function findSimilar(ds: DataSource, text: string, scopeEntityIds: string[], threshold = 0.5) {
  return ds.transaction(async (m) => {
    // o operador <% (similaridade de palavras: as palavras da consulta aparecem no texto) usa o índice
    // e depende deste limite, que vale só nesta transação
    await m.query("SELECT set_config('pg_trgm.word_similarity_threshold', $1, true)", [String(threshold)]);
    return m
      .createQueryBuilder(SearchIdea, 'i')
      .select(['i.id', 'i.title'])
      .addSelect('word_similarity(immutable_unaccent(lower(:q)), i.searchText)', 'score')
      .where('immutable_unaccent(lower(:q)) <% i.searchText', { q: text })
      .andWhere('i.entityId IN (:...scope)', { scope: scopeEntityIds })
      .andWhere('i.archivedAt IS NULL')
      .andWhere('i.convergedIntoId IS NULL')
      .orderBy('score', 'DESC')
      .limit(5)
      .getRawMany<{ i_id: string; i_title: string; score: string }>();
  });
}

describe('Spike 2 – ideias semelhantes', () => {
  let db: TestDatabase;
  const entityA = uuidv7();
  const entityB = uuidv7();

  const seed = async (
    title: string,
    description: string,
    entityId: string,
    extra: Partial<SearchIdea> = {},
  ): Promise<string> => {
    const id = uuidv7();
    await db.dataSource.getRepository(SearchIdea).insert({ id, title, description, entityId, ...extra });
    return id;
  };

  beforeAll(async () => {
    db = await createTestDatabase({ entities: [SearchIdea], beforeSync: (admin) => setupExtensions(admin) });
    await createIndex(db.dataSource);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('CA-RN-57.1 sugere a ideia parecida (ignorando acentos) e não sugere a sem relação', async () => {
    const similar = await seed(
      'Substituição de lâmpada no corredor B',
      'A lâmpada do corredor queima com frequência e deixa o local escuro.',
      entityA,
    );
    await seed('Comprar cadeiras ergonômicas', 'Cadeiras novas para o setor de montagem.', entityA);

    const result = await findSimilar(db.dataSource, 'Trocar lampada do corredor', [entityA]);
    expect(result.map((r) => r.i_id)).toEqual([similar]);
    expect(Number(result[0]!.score)).toBeGreaterThanOrEqual(0.5);
  });

  it('CA-RN-57.2 respeita o escopo: ideia de outra entidade não aparece', async () => {
    await seed('Trocar lâmpada do corredor da expedição', 'Lâmpada do corredor queimada.', entityB);
    const result = await findSimilar(db.dataSource, 'Trocar lampada do corredor', [entityA]);
    expect(result.every((r) => r.i_title !== 'Trocar lâmpada do corredor da expedição')).toBe(true);
    const withB = await findSimilar(db.dataSource, 'Trocar lampada do corredor', [entityA, entityB]);
    expect(withB.map((r) => r.i_title)).toContain('Trocar lâmpada do corredor da expedição');
  });

  it('não sugere ideias arquivadas nem convergidas', async () => {
    const principal = await seed('Pintura da faixa de pedestre', 'Refazer a faixa de pedestre na entrada.', entityA);
    await seed('Pintura da faixa de pedestre da entrada', 'Faixa de pedestre apagada na entrada.', entityA, {
      archivedAt: new Date(),
    });
    await seed('Refazer pintura da faixa de pedestre', 'Faixa de pedestre apagada, refazer pintura.', entityA, {
      convergedIntoId: principal,
    });
    const result = await findSimilar(db.dataSource, 'pintura da faixa de pedestre', [entityA]);
    expect(result.map((r) => r.i_id)).toEqual([principal]);
  });

  it('o índice GIN de trigramas é usado pelo operador <%', async () => {
    const plan = await db.dataSource.transaction(async (m) => {
      await m.query('SET LOCAL enable_seqscan = off'); // tabela minúscula: força a decisão do planner
      await m.query("SELECT set_config('pg_trgm.word_similarity_threshold', '0.5', true)");
      const rows = await m.query(
        "EXPLAIN SELECT id FROM spike_idea_search WHERE immutable_unaccent(lower('lampada corredor')) <% search_text",
      );
      return (rows as Array<Record<string, string>>).map((r) => r['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('idx_spike_idea_search_trgm');
  });

  it('a coluna search_text não é gravada pela aplicação (somente leitura)', async () => {
    const id = await seed('Teste de coluna gerada', 'Descrição qualquer', entityA);
    const row = await db.dataSource
      .getRepository(SearchIdea)
      .createQueryBuilder('i')
      .addSelect('i.searchText')
      .where('i.id = :id', { id })
      .getOneOrFail();
    expect(row.searchText).toBe('teste de coluna gerada descricao qualquer');
  });
});
