import { TZDate, tz } from '@date-fns/tz';
import {
  addDays,
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  formatDuration,
  intervalToDuration,
  parseISO,
} from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { ptBR } from 'date-fns/locale/pt-BR';

/**
 * ÚNICO ponto do frontend que usa date-fns. Regra do projeto: datas só por aqui.
 *
 * - Instante (ISO com hora): mostrado no fuso da INSTALAÇÃO, igual para todos e coerente com os
 *   prazos, o resumo diário e o código da ideia (não no fuso do navegador).
 * - Dia de calendário (`AAAA-MM-DD`, prazos de etapa): sem fuso; nunca é deslocado.
 */

const localeOf = (lng: string) => (lng === 'en' ? enUS : ptBR);

/** Padrões fixos (preservam o visual da interface; o "PP" do date-fns abrevia pt-BR de outro jeito). */
const DATE_TIME = { pt: 'dd/MM/yyyy, HH:mm', en: 'MM/dd/yyyy, h:mm a' };
const DATE = { pt: "d 'de' MMM'.' 'de' y", en: 'MMM d, y' };
const pick = (lng: string, p: { pt: string; en: string }) => (lng === 'en' ? p.en : p.pt);

/** Hora, dia e mês, e hora do dia curtos: eixos e dicas dos gráficos da observabilidade (M12). */
const HOUR_ONLY = { pt: "HH'h'", en: 'h a' };
const HOUR_MINUTE = { pt: 'HH:mm', en: 'h:mm a' };
const DAY_MONTH = { pt: 'dd/MM', en: 'MM/dd' };
const DAY_MONTH_HOUR = { pt: "dd/MM HH'h'", en: 'MM/dd h a' };

/** Fuso do navegador: reserva enquanto as configurações da instalação ainda carregam. */
export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Data e hora curtas no fuso dado. */
export function formatDateTime(iso: string | null | undefined, lng: string, timeZone: string): string {
  if (!iso) return '';
  return format(new Date(iso), pick(lng, DATE_TIME), { locale: localeOf(lng), in: tz(timeZone) });
}

/** Só a data (dia que o instante cai no fuso dado). */
export function formatDate(iso: string | null | undefined, lng: string, timeZone: string): string {
  if (!iso) return '';
  return format(new Date(iso), pick(lng, DATE), { locale: localeOf(lng), in: tz(timeZone) });
}

const MONTH = {
  short: { pt: 'MMM', en: 'MMM' },
  shortYear: { pt: 'MMM yy', en: 'MMM yy' },
  long: { pt: "MMMM 'de' y", en: 'MMMM y' },
};

/** Mês `AAAA-MM` (evolução mensal dos indicadores): "nov", "jan 26" ou "novembro de 2026". */
export function formatMonth(month: string, lng: string, style: keyof typeof MONTH = 'long'): string {
  if (!month) return '';
  return format(parseISO(`${month}-01`), pick(lng, MONTH[style]), { locale: localeOf(lng) });
}

/** Dia de calendário `AAAA-MM-DD` (prazos de etapa): sem fuso, sem deslocar o dia. */
export function formatDay(day: string, lng: string): string {
  return format(parseISO(day), pick(lng, DATE), { locale: localeOf(lng) });
}

/** Dias entre duas datas `AAAA-MM-DD` (negativo se `to` é anterior). */
export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

/** Hoje + n dias no fuso dado, como AAAA-MM-DD (sugestão de prazo e mínimo dos campos de data). */
export function dayFromToday(n: number, timeZone: string, now = new Date()): string {
  return format(addDays(now, n, { in: tz(timeZone) }), 'yyyy-MM-dd');
}

/**
 * Dia do campo (AAAA-MM-DD, no fuso dado) → início do dia em ISO UTC, para filtros da API.
 * `plusDays` serve para limites exclusivos (fim do período = início do dia seguinte).
 */
export function dayStartIso(day: string, timeZone: string, plusDays = 0): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(new TZDate(y, m - 1, d + plusDays, timeZone).getTime()).toISOString();
}

/** "há 5 minutos", "ontem"; passou de uma semana, mostra a data. */
export function relativeTime(iso: string, lng: string, timeZone: string, now = new Date()): string {
  const date = new Date(iso);
  if (Math.abs(differenceInCalendarDays(date, now)) >= 7) return formatDate(iso, lng, timeZone);
  return formatDistanceToNowStrict(date, { addSuffix: true, locale: localeOf(lng), roundingMethod: 'floor' });
}

/** Duração em texto ("2 dias 3 horas"), para tempos médios; até as duas maiores unidades. */
export function formatSeconds(seconds: number, lng: string): string {
  const duration = intervalToDuration({ start: 0, end: seconds * 1000 });
  const units = (['years', 'months', 'days', 'hours', 'minutes'] as const).filter((u) => (duration[u] ?? 0) > 0);
  if (units.length === 0) return lng === 'en' ? 'under 1 minute' : 'menos de 1 minuto';
  return formatDuration(duration, { format: units.slice(0, 2), locale: localeOf(lng) });
}

const inZone = (at: number | string, lng: string, timeZone: string, pattern: { pt: string; en: string }) =>
  format(new Date(at), pick(lng, pattern), { locale: localeOf(lng), in: tz(timeZone) });

/** "14h" (pt-BR) ou "2 PM" (en), no fuso dado. */
export const formatHour = (at: number | string, lng: string, timeZone: string) => inZone(at, lng, timeZone, HOUR_ONLY);

/** "14:35" (pt-BR) ou "2:35 PM" (en), no fuso dado. */
export const formatHourMinute = (at: number | string, lng: string, timeZone: string) =>
  inZone(at, lng, timeZone, HOUR_MINUTE);

/** "27/10" (pt-BR) ou "10/27" (en), no fuso dado. */
export const formatDayMonth = (at: number | string, lng: string, timeZone: string) =>
  inZone(at, lng, timeZone, DAY_MONTH);

/** "27/10 14h" (pt-BR) ou "10/27 2 PM" (en), no fuso dado. */
export const formatDayMonthHour = (at: number | string, lng: string, timeZone: string) =>
  inZone(at, lng, timeZone, DAY_MONTH_HOUR);

/** Minutos a leste do UTC que o fuso tem no instante dado (para alinhar fatias de gráfico ao dia local). */
export const zoneOffsetMinutes = (timeZone: string, at: number = Date.now()): number =>
  -new TZDate(at, timeZone).getTimezoneOffset();
