import { TZDate, tz } from '@date-fns/tz';
import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  differenceInCalendarDays,
  differenceInSeconds,
  format,
  hoursToMilliseconds,
  isFuture,
  isPast,
  parseISO,
  startOfHour,
  startOfMinute,
  subDays,
  subMinutes,
} from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { ptBR } from 'date-fns/locale/pt-BR';

/**
 * ÚNICO ponto do backend que usa date-fns. Regra do projeto: datas só por aqui.
 *
 * Duas famílias de dado, tratadas de forma diferente de propósito:
 * - Instante (`Date`, timestamptz): o relógio do servidor. Quando precisa de "que dia/hora é na
 *   instalação", usa o fuso da instalação (`organization.timezone`), NUNCA o do processo (`TZ`).
 * - Dia de calendário (`AAAA-MM-DD`, prazos de etapa): não tem fuso. Aritmética sempre em UTC puro,
 *   para o horário de verão e o fuso do processo não deslocarem o dia.
 */

const UTC = tz('UTC');
const DAY_FORMAT = 'yyyy-MM-dd';

/** Meia-noite UTC do dia `AAAA-MM-DD` (base da aritmética de dias de calendário). */
const utcMidnight = (day: string): Date => parseISO(`${day}T00:00:00Z`);

// --- Instante → dia/hora no fuso da instalação ------------------------------------------------

/** Data de hoje (AAAA-MM-DD) no fuso dado, para datas sem hora (etapas, alertas). */
export function todayInZone(now: Date, timeZone: string): string {
  return format(now, DAY_FORMAT, { in: tz(timeZone) });
}

/** Ano corrente no fuso dado (a virada de ano segue o fuso, não o UTC; CA-T.3). */
export function yearInZone(now: Date, timeZone: string): number {
  return Number(format(now, 'yyyy', { in: tz(timeZone) }));
}

/** Hora local `HH:mm` no fuso dado. */
export function localTimeInZone(now: Date, timeZone: string): string {
  return format(now, 'HH:mm', { in: tz(timeZone) });
}

/** Nome de fuso IANA válido (ex.: America/Sao_Paulo)? Fuso desconhecido vira data inválida. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  return !Number.isNaN(new TZDate(0, timeZone).getTime());
}

/** Início do dia `AAAA-MM-DD` no fuso dado, como instante (limite de filtros por período). */
export function dayStartInZone(day: string, timeZone: string, plusDays = 0): Date {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(new TZDate(y, m - 1, d + plusDays, timeZone).getTime());
}

/** Data e hora legíveis no fuso dado (relatórios, CSV, PDF), ex.: 05/11/2026 14:55. */
export function formatDateTimeInZone(date: Date, timeZone: string): string {
  return format(date, 'dd/MM/yyyy HH:mm', { in: tz(timeZone) });
}

/** Só a data, no fuso dado, ex.: 05/11/2026. */
export function formatDateInZone(date: Date, timeZone: string): string {
  return format(date, 'dd/MM/yyyy', { in: tz(timeZone) });
}

/** Dia de calendário `AAAA-MM-DD` como dd/MM/yyyy (sem fuso). */
export function formatDayBr(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : day;
}

// --- Dias de calendário (AAAA-MM-DD) ---------------------------------------------------------

/** Dias entre duas datas AAAA-MM-DD (negativo se `to` é anterior a `from`). */
export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(utcMidnight(to), utcMidnight(from), { in: UTC });
}

/** `day` + `n` dias, como AAAA-MM-DD. */
export function addDaysToDay(day: string, n: number): string {
  return format(addDays(utcMidnight(day), n, { in: UTC }), DAY_FORMAT, { in: UTC });
}

// --- Meses (AAAA-MM) -----------------------------------------------------------------------------

/** Mês (AAAA-MM) de um instante no fuso dado. */
export function monthInZone(now: Date, timeZone: string): string {
  return format(now, 'yyyy-MM', { in: tz(timeZone) });
}

/** `month` + `n` meses, como AAAA-MM. */
export function addMonthsToMonth(month: string, n: number): string {
  return format(addMonths(utcMidnight(`${month}-01`), n, { in: UTC }), 'yyyy-MM', { in: UTC });
}

/** Meses de `from` a `to`, inclusive (AAAA-MM); vazio se `to` vem antes de `from`. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonthsToMonth(m, 1)) out.push(m);
  return out;
}

/** Texto de um dia de calendário no idioma da pessoa (ex.: "8 de nov. de 2026"). */
export function formatDayLocalized(day: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const en = locale === 'en';
  // Padrão explícito: o "PP" do date-fns abrevia pt-BR sem o "de" e o ponto que a interface usa.
  return format(utcMidnight(day), en ? 'MMM d, y' : "d 'de' MMM'.' 'de' y", { locale: en ? enUS : ptBR, in: UTC });
}

// --- Tempo a partir de um instante -----------------------------------------------------------

export const minutesFromNow = (minutes: number, now = new Date()): Date => addMinutes(now, minutes);
export const hoursFromNow = (hours: number, now = new Date()): Date => addHours(now, hours);
export const minutesAgo = (minutes: number, now = new Date()): Date => subMinutes(now, minutes);
export const hoursToMs = (hours: number): number => hoursToMilliseconds(hours);
export const daysAgo = (days: number, now = new Date()): Date => subDays(now, days);

/** Minutos (com fração) desde o instante; negativo se o instante está no futuro (relógios diferentes). */
export const minutesSince = (date: Date, now = new Date()): number => differenceInSeconds(now, date) / 60;

/** Início da hora cheia em UTC (chave das métricas por hora, M12). */
/** Início do minuto (chave do tráfego por minuto, M12). */
export const startOfMinuteOf = (date: Date): Date => startOfMinute(date);

export const startOfUtcHour = (date: Date): Date => new Date(startOfHour(date, { in: UTC }).getTime());

/** Já passou do instante (ex.: sessão ou link expirado). */
export const hasPassed = (date: Date): boolean => isPast(date);
/** Ainda está por vir (ex.: bloqueio temporário em vigor). */
export const isUpcoming = (date: Date): boolean => isFuture(date);

// --- Logs --------------------------------------------------------------------------------------

/** Carimbo dos logs: pt-BR fixo, no fuso do processo (`TZ` do contêiner), ex.: 05/11/2026, 14:55:51. */
export function formatLogTimestamp(now = new Date()): string {
  return format(now, 'dd/MM/yyyy, HH:mm:ss');
}
