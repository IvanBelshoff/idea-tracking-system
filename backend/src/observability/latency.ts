/**
 * Faixas de tempo de resposta (RN-92). Guardar as faixas, e não o p50/p95 pronto, deixa somar horas
 * e instâncias sem perder exatidão: os percentis saem na leitura, das faixas somadas.
 */

/** Limite de cada faixa, em ms. A última faixa pega tudo o que passar do maior limite. */
export const LATENCY_LIMITS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000] as const;
export const BUCKET_COUNT = LATENCY_LIMITS_MS.length + 1;

export type Buckets = number[];

export const emptyBuckets = (): Buckets => new Array<number>(BUCKET_COUNT).fill(0);

export function bucketIndex(ms: number): number {
  const index = LATENCY_LIMITS_MS.findIndex((limit) => ms <= limit);
  return index === -1 ? LATENCY_LIMITS_MS.length : index;
}

/** Soma duas listas de faixas (listas curtas ou ausentes valem zero). */
export function addBuckets(a: readonly number[], b: readonly number[]): Buckets {
  return Array.from({ length: BUCKET_COUNT }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
}

export const totalOf = (buckets: readonly number[]): number => buckets.reduce((sum, n) => sum + n, 0);

/**
 * O limite da faixa onde o percentil cai: arredonda para cima, nunca subestima. Sem medidas, 0.
 * Passou da última faixa, devolve o dobro do maior limite (a tela mostra "10 s ou mais").
 */
export function percentileMs(buckets: readonly number[], p: number): number {
  const total = totalOf(buckets);
  if (total === 0) return 0;
  const target = Math.ceil(total * p);
  let seen = 0;
  for (let i = 0; i < BUCKET_COUNT; i += 1) {
    seen += buckets[i] ?? 0;
    if (seen >= target) return LATENCY_LIMITS_MS[i] ?? (LATENCY_LIMITS_MS[LATENCY_LIMITS_MS.length - 1] as number) * 2;
  }
  return 0;
}
