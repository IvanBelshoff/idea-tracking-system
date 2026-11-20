import 'reflect-metadata';
import { Column, Entity, type EntityManager, PrimaryColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../support/test-db.js';

/**
 * SPIKE 4 – Identificador sequencial sob concorrência (RN-22; CA-RN-22.1 a 22.3).
 * Pergunta: dá para gerar ITS-AAAA-NNNN sem repetição e SEM lacuna com 50 criações simultâneas,
 * usando só QueryBuilder do TypeORM (sem SQL cru)?
 */
@Entity('idea_sequence')
class IdeaSequence {
  @PrimaryColumn('int') year!: number;
  @Column({ name: 'last_value', type: 'int' }) lastValue!: number;
}

@Entity('spike_idea')
class SpikeIdea {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'varchar', unique: true }) code!: string;
}

/** Próximo número do ano, dentro da transação que também insere a ideia. */
// TypeORM 1.x removeu `onConflict`, e `orUpdate` só sobrescreve com o valor novo (não incrementa).
// Solução só com QueryBuilder, em dois passos dentro da mesma transação:
//  1) garante a linha do ano (insert ... on conflict do nothing);
//  2) UPDATE ... SET last_value = last_value + 1 RETURNING: o UPDATE trava a linha até o commit,
//     serializando as criações; se a transação falhar, o incremento é desfeito (sem lacuna).
async function nextNumber(manager: EntityManager, year: number): Promise<number> {
  await manager.createQueryBuilder().insert().into(IdeaSequence).values({ year, lastValue: 0 }).orIgnore().execute();
  const result = await manager
    .createQueryBuilder()
    .update(IdeaSequence)
    .set({ lastValue: () => '"last_value" + 1' })
    .where('year = :year', { year })
    .returning('last_value')
    .execute();
  return (result.raw as Array<{ last_value: number }>)[0]!.last_value;
}

async function createIdea(db: TestDatabase, year: number, failAfterNumber = false): Promise<string> {
  return db.dataSource.transaction(async (manager) => {
    const n = await nextNumber(manager, year);
    if (failAfterNumber) throw new Error('falha simulada depois de reservar o número');
    const code = `ITS-${year}-${String(n).padStart(4, '0')}`;
    await manager.insert(SpikeIdea, { id: uuidv7(), code });
    return code;
  });
}

describe('Spike 4 – identificador sequencial', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase({ entities: [IdeaSequence, SpikeIdea] });
  });
  afterAll(async () => {
    await db.drop();
  });

  it('CA-RN-22.1 duas ideias seguidas recebem 0001 e 0002', async () => {
    const a = await createIdea(db, 2026);
    const b = await createIdea(db, 2026);
    expect([a, b]).toEqual(['ITS-2026-0001', 'ITS-2026-0002']);
  });

  it('CA-RN-22.2 50 criações simultâneas geram 50 códigos distintos e sem lacuna', async () => {
    const codes = await Promise.all(Array.from({ length: 50 }, () => createIdea(db, 2026)));
    expect(new Set(codes).size).toBe(50);
    const numbers = codes.map((c) => Number(c.split('-')[2])).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 3)); // continua do 0003 ao 0052
  });

  it('CA-RN-22.2 transação que falha devolve o número (não cria lacuna)', async () => {
    await expect(createIdea(db, 2026, true)).rejects.toThrow('falha simulada');
    expect(await createIdea(db, 2026)).toBe('ITS-2026-0053');
  });

  it('CA-RN-22.3 virada de ano reinicia a sequência', async () => {
    expect(await createIdea(db, 2027)).toBe('ITS-2027-0001');
    expect(await createIdea(db, 2026)).toBe('ITS-2026-0054');
  });
});
