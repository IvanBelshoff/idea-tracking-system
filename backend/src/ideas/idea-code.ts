import type { EntityManager } from 'typeorm';
import { IdeaSequence } from './entities/idea.entity.js';
import { formatIdeaCode } from './lifecycle.js';

/**
 * Próximo identificador do ano (RN-22), dentro da MESMA transação que insere a ideia (Spike 4):
 *  1) garante a linha do ano (insert ... on conflict do nothing);
 *  2) UPDATE ... SET last_value = last_value + 1 RETURNING: trava a linha até o commit e serializa
 *     as criações simultâneas; se a transação falhar, o incremento volta e não fica lacuna.
 */
export async function nextIdeaCode(manager: EntityManager, prefix: string, year: number): Promise<string> {
  await manager.createQueryBuilder().insert().into(IdeaSequence).values({ year, lastValue: 0 }).orIgnore().execute();
  const result = await manager
    .createQueryBuilder()
    .update(IdeaSequence)
    .set({ lastValue: () => '"last_value" + 1' })
    .where('year = :year', { year })
    .returning('last_value')
    .execute();
  const n = (result.raw as { last_value: number }[])[0]?.last_value;
  if (!n) throw new Error('Falha ao reservar o número da ideia.');
  return formatIdeaCode(prefix, year, n);
}
