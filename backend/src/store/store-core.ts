import type { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { todayInZone } from '../common/dates.js';
import { getSetting } from '../organization/settings.service.js';
import { StoreLedger } from './entities.js';
import { notifyPerson } from './store-notify.js';
import { expiredAmount, expiryCutoff, type LedgerKind, type LedgerLine } from './store-rules.js';

/**
 * Núcleo do saldo da loja (M22, RN-160 a RN-162, RN-168): funções que recebem o `EntityManager` da
 * transação, para o extrato nascer junto com a ação que o causou.
 */

export interface LedgerEntry {
  userId: string;
  kind: LedgerKind;
  amount: number;
  actorId?: string | null;
  ideaId?: string | null;
  pointId?: string | null;
  orderId?: string | null;
  reason?: string | null;
}

/** Grava linhas no extrato (só inserção; RN-160). */
export async function appendLedger(m: EntityManager, entries: readonly LedgerEntry[]): Promise<void> {
  const rows = entries.filter((e) => e.amount !== 0);
  if (rows.length === 0) return;
  await m
    .createQueryBuilder()
    .insert()
    .into(StoreLedger)
    .values(
      rows.map((e) => ({
        id: uuidv7(),
        userId: e.userId,
        kind: e.kind,
        amount: e.amount,
        actorId: e.actorId ?? null,
        ideaId: e.ideaId ?? null,
        pointId: e.pointId ?? null,
        orderId: e.orderId ?? null,
        reason: e.reason ?? null,
      })),
    )
    .execute();
}

/** Saldo de uma pessoa: a soma do extrato. */
export async function balanceOf(m: EntityManager, userId: string): Promise<number> {
  const [row]: { total: string | null }[] = await m.query(
    'SELECT sum(amount) AS total FROM store_ledger WHERE user_id = $1',
    [userId],
  );
  return Number(row?.total ?? 0);
}

/** A loja já foi ligada alguma vez (RN-161): daí em diante, todo ponto ganho credita o saldo. */
export async function storeInitialized(m: EntityManager): Promise<boolean> {
  return (await getSetting(m, 'store.initialized_at')) !== null;
}

/**
 * Saldo inicial (RN-161): na primeira vez que a loja é ligada, cada pessoa com pontos ganhos recebe uma
 * linha igual ao total. Quem chama grava a marca `store.initialized_at` na mesma transação.
 */
export async function initializeBalances(m: EntityManager, actorId: string | null): Promise<number> {
  const rows: { user_id: string; total: string }[] = await m.query(
    'SELECT user_id, sum(points) AS total FROM point_ledger GROUP BY user_id HAVING sum(points) > 0',
  );
  await appendLedger(
    m,
    rows.map((r) => ({
      userId: r.user_id,
      kind: 'initial' as const,
      amount: Number(r.total),
      actorId,
      reason: 'Saldo inicial: pontos ganhos até a loja ser ligada',
    })),
  );
  return rows.length;
}

/**
 * Crédito de um ponto ganho (RN-161), chamado logo depois de gravar o ponto, na mesma transação. Só
 * depois da primeira ativação da loja (antes, o saldo inicial cobre). Um crédito por ponto (índice único).
 */
export async function creditForPoint(
  m: EntityManager,
  point: { id: string; userId: string; ideaId: string | null; points: number },
): Promise<void> {
  if (point.points <= 0 || !(await storeInitialized(m))) return;
  await m.query(
    `INSERT INTO store_ledger (id, user_id, kind, amount, idea_id, point_id)
     VALUES ($1, $2, 'earned', $3, $4, $5) ON CONFLICT DO NOTHING`,
    [uuidv7(), point.userId, point.points, point.ideaId, point.id],
  );
}

/** As linhas de uma pessoa com o dia no fuso da instalação, para as regras de validade. */
async function linesOf(m: EntityManager, userId: string, zone: string): Promise<LedgerLine[]> {
  const rows: { kind: LedgerKind; amount: number; day: string }[] = await m.query(
    `SELECT kind, amount, to_char(created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day
       FROM store_ledger WHERE user_id = $1 ORDER BY created_at, id`,
    [userId, zone],
  );
  return rows.map((r) => ({ kind: r.kind, amount: Number(r.amount), day: r.day }));
}

/** Quanto vence nos próximos 30 dias, e quando (RN-162): para a tela e o aviso. */
export async function expiringSoon(
  m: EntityManager,
  userId: string,
  now = new Date(),
): Promise<{ amount: number; on: string } | null> {
  const months = await getSetting(m, 'store.expiry_months');
  if (months <= 0) return null;
  const zone = await getSetting(m, 'organization.timezone');
  const today = todayInZone(now, zone);
  const lines = await linesOf(m, userId, zone);
  const already = expiredAmount(lines, expiryCutoff(today, months));
  // Procura o primeiro dia, nos próximos 30, em que algo a mais venceria.
  for (let i = 1; i <= 30; i++) {
    const day = new Date(Date.parse(`${today}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    const extra = expiredAmount(lines, expiryCutoff(day, months)) - already;
    if (extra > 0) {
      // Soma tudo o que vence até o fim da janela de 30 dias, a partir desse dia.
      const end = new Date(Date.parse(`${today}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
      return { amount: expiredAmount(lines, expiryCutoff(end, months)) - already, on: day };
    }
  }
  return null;
}

/**
 * Expiração diária (RN-162): para cada pessoa com saldo, grava a linha de expiração do que venceu.
 * Idempotente (a conta desconta o que já expirou). Roda mesmo com a loja desligada depois de ligada
 * uma vez (o saldo continua existindo); sem validade, não faz nada.
 */
export async function runStoreExpiry(ds: DataSource, now = new Date()): Promise<number> {
  const m = ds.manager;
  const months = await getSetting(m, 'store.expiry_months');
  if (months <= 0 || !(await storeInitialized(m))) return 0;
  const zone = await getSetting(m, 'organization.timezone');
  const cutoff = expiryCutoff(todayInZone(now, zone), months);
  const users: { user_id: string }[] = await m.query(
    'SELECT user_id FROM store_ledger GROUP BY user_id HAVING sum(amount) > 0',
  );
  let count = 0;
  for (const { user_id: userId } of users) {
    const expired = await ds.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`store_balance:${userId}`]);
      const amount = expiredAmount(await linesOf(tx, userId, zone), cutoff);
      if (amount > 0) {
        await appendLedger(tx, [
          { userId, kind: 'expiration', amount: -amount, reason: `Pontos recebidos até ${cutoff} venceram` },
        ]);
        await notifyPerson(tx, userId, 'store_points_expired', { amount });
      }
      // Aviso 30 dias antes (RN-162): uma vez por pessoa e data de vencimento.
      const soon = await expiringSoon(tx, userId, now);
      if (soon && soon.amount > 0) {
        const fresh: unknown[] = await tx.query(
          `INSERT INTO store_expiry_notice (user_id, expires_on) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING user_id`,
          [userId, soon.on],
        );
        if (fresh.length > 0)
          await notifyPerson(tx, userId, 'store_points_expiring', { amount: soon.amount, on: soon.on });
      }
      return amount > 0;
    });
    if (expired) count += 1;
  }
  return count;
}

/** Trava do saldo de uma pessoa (pedido, ajuste, expiração), na transação de quem chama (CA-T.25). */
export async function lockBalance(m: EntityManager, userId: string): Promise<void> {
  await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`store_balance:${userId}`]);
}
