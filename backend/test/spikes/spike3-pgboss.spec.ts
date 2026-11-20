import 'reflect-metadata';
import { PgBoss } from 'pg-boss';
import { Column, type DataSource, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgBossTypeormAdapter } from '../../src/jobs/pg-boss-typeorm.adapter.js';
import { createTestDatabase, type TestDatabase } from '../support/test-db.js';

/**
 * SPIKE 3 – pg-boss com a conexão do TypeORM (CA-T.1; RN-29, RN-31, RN-90).
 * Perguntas:
 *  (a) o pg-boss funciona reaproveitando a conexão (pool) do TypeORM, sem segunda conexão própria?
 *  (b) nova tentativa com espera funciona (falha de envio de e-mail)?
 *  (c) reexecutar o mesmo alerta não duplica o efeito (idempotência por chave única)?
 *  (d) o agendamento (cron) pode ser registrado?
 */
@Entity('alert_dedup')
@Unique(['kind', 'targetId', 'day', 'userId'])
class AlertDedup {
  @PrimaryGeneratedColumn('increment') id!: number;
  @Column({ type: 'varchar' }) kind!: string;
  @Column({ name: 'target_id', type: 'varchar' }) targetId!: string;
  @Column({ type: 'date' }) day!: string;
  @Column({ name: 'user_id', type: 'varchar' }) userId!: string;
}

// O adaptador validado aqui virou código de produção: src/jobs/pg-boss-typeorm.adapter.ts
const typeormAdapter = (ds: DataSource) => pgBossTypeormAdapter(ds);

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando condição');
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('Spike 3 – pg-boss + TypeORM', () => {
  let db: TestDatabase;
  let boss: PgBoss;

  beforeAll(async () => {
    db = await createTestDatabase({ entities: [AlertDedup] });
    boss = new PgBoss({ db: typeormAdapter(db.dataSource), schema: 'pgboss' });
    boss.on('error', (e) => console.error('[pg-boss error]', e));
    await boss.start();
  });
  afterAll(async () => {
    await boss.stop({ graceful: true });
    await db.drop();
  });

  it('(a2) o adaptador devolve o resultado de TODAS as instruções de uma consulta múltipla', async () => {
    // Regressão: a manutenção do pg-boss falhava quando só a última instrução era devolvida.
    const result = (await pgBossTypeormAdapter(db.dataSource).executeSql(
      'SELECT 1 AS a; SELECT 2 AS b',
    )) as unknown as Array<{ rows: unknown[] }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result.map((r) => r.rows)).toEqual([[{ a: 1 }], [{ b: 2 }]]);
  });

  it('(a3) a manutenção do pg-boss roda sem erro com o adaptador', async () => {
    const errors: unknown[] = [];
    const probe = new PgBoss({ db: typeormAdapter(db.dataSource), schema: 'pgboss' });
    probe.on('error', (e) => errors.push(e));
    await probe.start();
    await new Promise((r) => setTimeout(r, 3_000)); // dá tempo de a rotina de manutenção rodar
    await probe.stop({ graceful: true });
    expect(errors).toEqual([]);
  });

  it('(a) o pg-boss instala o próprio esquema usando a conexão do TypeORM', async () => {
    const rows = await db.dataSource.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'pgboss'",
    );
    expect(rows).toHaveLength(1);
  });

  it('(b) e-mail que falha é repetido com espera e termina concluído', async () => {
    await boss.createQueue('email', { retryLimit: 3, retryDelay: 1 });
    const attempts: number[] = [];
    await boss.work<{ to: string }>('email', { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      attempts.push(job!.retryCount);
      if (job!.retryCount === 0) throw new Error('provedor indisponível (simulado)');
    });
    const id = await boss.send('email', { to: 'alguem@example.test' });
    expect(id).toBeTruthy();

    await waitFor(async () => (await boss.getJobById('email', id!))?.state === 'completed');
    expect(attempts).toEqual([0, 1]); // 1ª tentativa falhou, a 2ª passou
  });

  it('CA-T.1 reexecutar o mesmo alerta não duplica o efeito (chave única)', async () => {
    await boss.createQueue('deadline-alert');
    await boss.work<{ stepId: string; userId: string; day: string }>(
      'deadline-alert',
      { pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        for (const job of jobs) {
          // o envio real só aconteceria se o INSERT criasse a linha; o resto é ignorado
          await db.dataSource
            .createQueryBuilder()
            .insert()
            .into(AlertDedup)
            .values({ kind: 'deadline', targetId: job.data.stepId, day: job.data.day, userId: job.data.userId })
            .orIgnore()
            .execute();
        }
      },
    );
    const payload = { stepId: 'etapa-1', userId: 'u1', day: '2026-11-04' };
    await boss.send('deadline-alert', payload);
    await boss.send('deadline-alert', payload); // reexecução do job do dia
    await boss.send('deadline-alert', payload);

    await waitFor(async () => {
      const [{ count }] = await db.dataSource.query(
        'SELECT count(*)::int AS count FROM pgboss.job WHERE name = $1 AND state = $2',
        ['deadline-alert', 'completed'],
      );
      return count === 3;
    });
    const rows = await db.dataSource.getRepository(AlertDedup).count();
    expect(rows).toBe(1); // três execuções do job, um único registro de alerta
  });

  it('(d) o agendamento diário pode ser registrado e removido', async () => {
    await boss.createQueue('daily-digest');
    await boss.schedule('daily-digest', '0 7 * * *', { kind: 'digest' }, { tz: 'America/Sao_Paulo' });
    const schedules = await boss.getSchedules();
    expect(schedules.map((s) => s.name)).toContain('daily-digest');
    await boss.unschedule('daily-digest');
    expect((await boss.getSchedules()).map((s) => s.name)).not.toContain('daily-digest');
  });
});
