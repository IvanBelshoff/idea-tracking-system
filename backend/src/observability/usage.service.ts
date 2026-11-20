import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { hoursFromNow } from '../common/dates.js';
import { PtBrLogger } from '../common/pt-br-logger.js';
import type { UsageReport } from './ops.dto.js';

const logger = new PtBrLogger('Uso');

/** Tabelas que só crescem (o log é imutável): o tamanho delas ajuda a prever o disco do banco. */
const GROWING_TABLES = ['audit_log', 'idea_event', 'email_log', 'notification'] as const;

/** Cada número isolado dos outros: o que falhar vira `null` e o resto da tela segue. */
async function orNull<T>(name: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    logger.warn(`Não foi possível ler "${name}": ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Uso e segurança da instalação (RN-92): quantas contas e sessões estão ativas, quantas entradas,
 * falhas e bloqueios houve nas últimas 24 horas e quanto o banco cresceu. Só contagens: ninguém
 * é identificado (CA-T.11).
 */
@Injectable()
export class UsageService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async report(now = new Date()): Promise<UsageReport> {
    const since = hoursFromNow(-24, now);
    const count = async (sql: string, params: unknown[] = []) => {
      const rows: { n: string }[] = await this.dataSource.query(sql, params);
      return Number(rows[0]?.n ?? 0);
    };
    const audit = (action: string) =>
      count(`SELECT count(*) AS n FROM audit_log WHERE action = $1 AND at >= $2`, [action, since]);

    const [activeUsers, activeSessions, logins, loginsFailed, lockouts, databaseBytes, tables] = await Promise.all([
      orNull('contas ativas', () => count(`SELECT count(*) AS n FROM "user" WHERE status = 'active'`)),
      orNull('sessões ativas', () =>
        count(`SELECT count(*) AS n FROM session WHERE revoked_at IS NULL AND expires_at > $1`, [now]),
      ),
      orNull('entradas', () => audit('auth.login')),
      orNull('falhas de login', () => audit('auth.login_failed')),
      orNull('bloqueios', () => audit('auth.locked')),
      orNull('tamanho do banco', () => count('SELECT pg_database_size(current_database()) AS n')),
      orNull('tabelas', async () => {
        const rows: { name: string; rows: string }[] = await this.dataSource.query(
          `SELECT c.relname AS name, GREATEST(c.reltuples, 0)::bigint AS rows
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname = ANY($1)`,
          [GROWING_TABLES],
        );
        return GROWING_TABLES.map((name) => ({ name, rows: Number(rows.find((r) => r.name === name)?.rows ?? 0) }));
      }),
    ]);

    return {
      activeUsers,
      activeSessions,
      loginsLast24h: logins,
      loginsFailedLast24h: loginsFailed,
      lockoutsLast24h: lockouts,
      databaseBytes,
      tables: tables ?? [],
    };
  }
}
