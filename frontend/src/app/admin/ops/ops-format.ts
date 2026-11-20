/**
 * Funções puras da tela de observabilidade (M12): eixos, fatias de período, rotas somadas e
 * formatação de números. Sem React e sem date-fns (as datas passam por `lib/dates.ts`), para rodar
 * nos testes do Node sem o navegador. Só `import type`: o Node apaga na hora de rodar.
 */
import type { components } from '@/api/schema';

export type HistoryHour = components['schemas']['HistoryHour'];
export type WorkerHour = components['schemas']['WorkerHour'];
export type RouteView = components['schemas']['RouteView'];

// --- Eixos --------------------------------------------------------------------------------------

/** Topo do eixo: o primeiro número redondo acima do maior valor (1, 2, 5 × 10ⁿ). */
export function axisTop(max: number): number {
  if (max <= 0) return 1;
  const order = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * order >= max) return step * order;
  }
  return 10 * order;
}

/** As marcas do eixo: zero, o meio (se for inteiro) e o topo. Contagem não tem meio quebrado. */
export function axisTicks(max: number): number[] {
  const top = axisTop(max);
  return [0, top / 2, top].filter((tick) => Number.isInteger(tick));
}

/** Espaço do rótulo mais largo do eixo (~7px por caractere em 12px), mais o respiro. */
export function axisMargin(max: number, format: (value: number) => string): number {
  return 12 + 7 * Math.max(...axisTicks(max).map((tick) => format(tick).length));
}

// --- Fatias de período ---------------------------------------------------------------------------

/** O que cada período mostra: quantas fatias e quantas horas por fatia. */
export const PERIODS = {
  '24h': { slices: 24, hoursPerSlice: 1 },
  '7d': { slices: 28, hoursPerSlice: 6 },
  '30d': { slices: 30, hoursPerSlice: 24 },
} as const;

export type Period = keyof typeof PERIODS;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** O começo da fatia em que `at` cai, na hora local (`offsetMinutes` a leste do UTC; o dia começa à meia-noite local). */
export function sliceStart(at: number, hoursPerSlice: number, offsetMinutes: number): number {
  const local = at + offsetMinutes * MINUTE_MS;
  const hourStart = Math.floor(local / HOUR_MS) * HOUR_MS;
  const hourOfDay = (((hourStart / HOUR_MS) % 24) + 24) % 24;
  return hourStart - (hourOfDay % hoursPerSlice) * HOUR_MS - offsetMinutes * MINUTE_MS;
}

/** O fim da fatia que começa em `start` (para a dica "14h às 15h"). */
export function sliceEnd(start: number, period: Period): number {
  return start + PERIODS[period].hoursPerSlice * HOUR_MS;
}

/** O primeiro instante do período, para pedir o histórico. */
export function periodStart(period: Period, now: number, offsetMinutes: number): number {
  const { slices, hoursPerSlice } = PERIODS[period];
  return sliceStart(now, hoursPerSlice, offsetMinutes) - (slices - 1) * hoursPerSlice * HOUR_MS;
}

export interface Slice {
  /** Início da fatia (ms desde 1970). */
  start: number;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  /** Nulo quando a fatia não tem nenhuma hora gravada: a linha falha ali. */
  p95Ms: number | null;
  /** Maior memória da API nas horas da fatia; nulo sem hora gravada. */
  memoryMb: number | null;
}

/** Fatias seguidas, da mais antiga à atual, vazias. */
function emptySlices<T>(period: Period, now: number, offsetMinutes: number, make: (start: number) => T): T[] {
  const { slices, hoursPerSlice } = PERIODS[period];
  const first = periodStart(period, now, offsetMinutes);
  return Array.from({ length: slices }, (_, i) => make(first + i * hoursPerSlice * HOUR_MS));
}

/** A fatia em que a hora cai (a última cujo início não passa dela), ou nada se a hora é anterior ao período. */
function sliceOf<T extends { start: number }>(list: T[], at: number): T | undefined {
  const first = list[0];
  if (!first || at < first.start) return undefined;
  return list.findLast((item) => item.start <= at);
}

/**
 * As horas gravadas viram fatias seguidas. Fatia sem hora gravada fica com zero requisições e sem
 * p95. O p95 da fatia é o pior das horas (a leitura já devolve o p95 de cada hora).
 */
export function buildSlices(
  hours: readonly HistoryHour[],
  period: Period,
  now: number,
  offsetMinutes: number,
): Slice[] {
  const list = emptySlices<Slice>(period, now, offsetMinutes, (start) => ({
    start,
    requests: 0,
    errors4xx: 0,
    errors5xx: 0,
    p95Ms: null,
    memoryMb: null,
  }));
  for (const hour of hours) {
    const slice = sliceOf(list, new Date(hour.hour).getTime());
    if (!slice) continue;
    slice.requests += hour.requests;
    slice.errors4xx += hour.errors4xx;
    slice.errors5xx += hour.errors5xx;
    slice.p95Ms = Math.max(slice.p95Ms ?? 0, hour.p95Ms);
    slice.memoryMb = Math.max(slice.memoryMb ?? 0, hour.memoryMb);
  }
  return list;
}

export interface WorkerSlice {
  start: number;
  ticks: number;
  tickFailures: number;
  tickP95Ms: number | null;
  emailsSent: number;
  emailsRetried: number;
  emailsFailed: number;
}

/** O mesmo para o worker: disparos, falhas, duração (pior p95) e e-mails por fatia. */
export function buildWorkerSlices(
  hours: readonly WorkerHour[],
  period: Period,
  now: number,
  offsetMinutes: number,
): WorkerSlice[] {
  const list = emptySlices<WorkerSlice>(period, now, offsetMinutes, (start) => ({
    start,
    ticks: 0,
    tickFailures: 0,
    tickP95Ms: null,
    emailsSent: 0,
    emailsRetried: 0,
    emailsFailed: 0,
  }));
  for (const hour of hours) {
    const slice = sliceOf(list, new Date(hour.hour).getTime());
    if (!slice) continue;
    slice.ticks += hour.ticks;
    slice.tickFailures += hour.tickFailures;
    slice.tickP95Ms = Math.max(slice.tickP95Ms ?? 0, hour.tickP95Ms);
    slice.emailsSent += hour.emailsSent;
    slice.emailsRetried += hour.emailsRetried;
    slice.emailsFailed += hour.emailsFailed;
  }
  return list;
}

// --- Rotas ----------------------------------------------------------------------------------------

/** As rotas do período somadas; o p95 de cada uma é o pior das horas. */
export function routesOfPeriod(hours: readonly Pick<HistoryHour, 'routes'>[]): RouteView[] {
  const sums = new Map<string, RouteView>();
  for (const route of hours.flatMap((hour) => hour.routes)) {
    const current = sums.get(route.route) ?? { route: route.route, requests: 0, errors: 0, p95Ms: 0 };
    current.requests += route.requests;
    current.errors += route.errors;
    current.p95Ms = Math.max(current.p95Ms, route.p95Ms);
    sums.set(route.route, current);
  }
  return [...sums.values()];
}

/** As mais lentas (p95), com o mais pedido como desempate. */
export function slowestRoutes(routes: readonly RouteView[], count = 10): RouteView[] {
  return [...routes].sort((a, b) => b.p95Ms - a.p95Ms || b.requests - a.requests).slice(0, count);
}

/** As que tiveram erro 5xx, das que mais falharam. */
export function failingRoutes(routes: readonly RouteView[], count = 10): RouteView[] {
  return routes
    .filter((route) => route.errors > 0)
    .sort((a, b) => b.errors - a.errors || b.requests - a.requests)
    .slice(0, count);
}

// --- Números --------------------------------------------------------------------------------------

export const formatNumber = (value: number, lng: string): string => new Intl.NumberFormat(lng).format(value);

/** "1,2 mil" / "1.2K": para o eixo e os rótulos curtos. */
export const formatCompact = (value: number, lng: string): string =>
  new Intl.NumberFormat(lng, { notation: 'compact', maximumFractionDigits: 1 }).format(value);

/** Tempo em ms; a partir de 1 s, em segundos. O que passa de 10 s (última faixa) vira "> 10 s". */
export function formatMs(ms: number, lng: string): string {
  if (ms > 10_000) return '> 10 s';
  if (ms >= 1000) return `${new Intl.NumberFormat(lng, { maximumFractionDigits: 1 }).format(ms / 1000)} s`;
  return `${new Intl.NumberFormat(lng).format(ms)} ms`;
}

/** "180 MB" até 1 GB; depois, "1,2 GB". */
export function formatMegabytes(mb: number, lng: string): string {
  if (mb >= 1024) return `${new Intl.NumberFormat(lng, { maximumFractionDigits: 1 }).format(mb / 1024)} GB`;
  return `${new Intl.NumberFormat(lng).format(Math.round(mb))} MB`;
}

/** Tamanho em bytes, na maior unidade com um número legível. */
export function formatBytes(bytes: number, lng: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${new Intl.NumberFormat(lng, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
