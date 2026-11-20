import type { DataSource } from 'typeorm';

interface PgClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Adaptador para o pg-boss executar SQL pelo MESMO pool do TypeORM (sem segunda conexão).
 *
 * Devolve o resultado BRUTO do driver `pg`, como o pg-boss faz com a própria conexão: numa consulta
 * com várias instruções isso é um vetor com um resultado por instrução. A rotina de manutenção do
 * pg-boss ("bam") depende disso; devolver só as linhas da última instrução gera o erro
 * "a custom db must return the rows of every statement in a multi-statement query"
 * (encontrado ao subir o worker no Docker).
 */
export function pgBossTypeormAdapter(dataSource: DataSource) {
  return {
    async executeSql(text: string, values?: unknown[]) {
      const queryRunner = dataSource.createQueryRunner();
      try {
        const client = (await queryRunner.connect()) as PgClient;
        // biome-ignore lint/suspicious/noExplicitAny: contrato do pg-boss (IDatabase) usa any[]
        return (await client.query(text, values)) as { rows: any[] };
      } finally {
        await queryRunner.release();
      }
    },
  };
}
