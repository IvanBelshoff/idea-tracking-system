import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as dates from '@/lib/dates';
import { usePublicSettings } from './session';

/**
 * Formatadores de data já presos ao idioma da interface e ao fuso da instalação
 * (`organization.timezone`, das configurações públicas). Re-renderiza quando algum dos dois muda.
 */
export function useDates() {
  const { i18n } = useTranslation();
  const { data: settings } = usePublicSettings();
  const lng = i18n.language;
  const zone = settings?.timezone ?? dates.browserTimeZone();
  return useMemo(
    () => ({
      zone,
      dateTime: (iso: string | null | undefined) => dates.formatDateTime(iso, lng, zone),
      date: (iso: string | null | undefined) => dates.formatDate(iso, lng, zone),
      day: (day: string) => dates.formatDay(day, lng),
      relative: (iso: string) => dates.relativeTime(iso, lng, zone),
      dayFromToday: (n: number) => dates.dayFromToday(n, zone),
      dayStartIso: (day: string, plusDays = 0) => dates.dayStartIso(day, zone, plusDays),
      hour: (at: number | string) => dates.formatHour(at, lng, zone),
      hourMinute: (at: number | string) => dates.formatHourMinute(at, lng, zone),
      dayMonth: (at: number | string) => dates.formatDayMonth(at, lng, zone),
      dayMonthHour: (at: number | string) => dates.formatDayMonthHour(at, lng, zone),
      offsetMinutes: (at: number = Date.now()) => dates.zoneOffsetMinutes(zone, at),
    }),
    [lng, zone],
  );
}
