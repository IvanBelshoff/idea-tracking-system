import { describe, expect, it } from 'vitest';
import {
  addDaysToDay,
  daysBetween,
  formatDayLocalized,
  formatLogTimestamp,
  hasPassed,
  hoursToMs,
  isUpcoming,
  isValidTimeZone,
  localTimeInZone,
  minutesAgo,
  minutesFromNow,
  todayInZone,
  yearInZone,
} from '../../src/common/dates.js';

describe('Módulo de datas (date-fns + @date-fns/tz)', () => {
  it('hoje, ano e hora seguem o fuso pedido, não o UTC nem o do processo', () => {
    const instant = new Date('2030-01-01T02:30:00Z');
    expect(todayInZone(instant, 'UTC')).toBe('2030-01-01');
    expect(todayInZone(instant, 'America/Sao_Paulo')).toBe('2029-12-31'); // UTC-3
    expect(todayInZone(instant, 'Pacific/Kiritimati')).toBe('2030-01-01'); // UTC+14
    expect(todayInZone(new Date('2030-01-01T10:30:00Z'), 'Pacific/Kiritimati')).toBe('2030-01-02');
    // CA-T.3: a virada de ano segue o fuso da instalação.
    expect(yearInZone(instant, 'America/Sao_Paulo')).toBe(2029);
    expect(yearInZone(instant, 'UTC')).toBe(2030);
    expect(localTimeInZone(new Date('2030-01-10T10:01:00Z'), 'America/Sao_Paulo')).toBe('07:01');
    expect(localTimeInZone(new Date('2030-01-10T23:59:00Z'), 'UTC')).toBe('23:59');
    expect(localTimeInZone(new Date('2030-01-10T00:00:00Z'), 'UTC')).toBe('00:00'); // sem "24:00"
  });

  it('horário de verão: o dia local muda no instante certo', () => {
    // Nova York volta ao horário padrão em 03/11/2030 às 06:00 UTC.
    expect(todayInZone(new Date('2030-11-03T03:59:00Z'), 'America/New_York')).toBe('2030-11-02');
    expect(todayInZone(new Date('2030-11-03T04:00:00Z'), 'America/New_York')).toBe('2030-11-03');
    expect(localTimeInZone(new Date('2030-11-03T05:30:00Z'), 'America/New_York')).toBe('01:30');
    expect(localTimeInZone(new Date('2030-11-03T06:30:00Z'), 'America/New_York')).toBe('01:30');
  });

  it('valida nome de fuso IANA', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/New_Yrok')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('lixo')).toBe(false);
  });

  it('dias entre datas de calendário não sofrem com virada de ano, bissexto nem horário de verão', () => {
    expect(daysBetween('2026-11-05', '2026-11-08')).toBe(3);
    expect(daysBetween('2026-11-08', '2026-11-05')).toBe(-3);
    expect(daysBetween('2026-11-05', '2026-11-05')).toBe(0);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // 2028 é bissexto
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2); // vizinho de mudança de horário nos EUA
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('soma dias a uma data de calendário', () => {
    expect(addDaysToDay('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDaysToDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToDay('2026-11-05', 0)).toBe('2026-11-05');
  });

  it('texto do dia no idioma da pessoa', () => {
    expect(formatDayLocalized('2026-11-08', 'pt-BR')).toBe('8 de nov. de 2026');
    expect(formatDayLocalized('2026-11-08', 'en')).toBe('Nov 8, 2026');
    expect(formatDayLocalized('não-é-data', 'pt-BR')).toBe('não-é-data');
  });

  it('somas a partir de um instante e comparações com o relógio', () => {
    const base = new Date('2030-01-01T00:00:00Z');
    expect(minutesFromNow(15, base).toISOString()).toBe('2030-01-01T00:15:00.000Z');
    expect(minutesAgo(2, base).toISOString()).toBe('2029-12-31T23:58:00.000Z');
    expect(hoursToMs(12)).toBe(43_200_000);
    expect(hasPassed(new Date(Date.now() - 1000))).toBe(true);
    expect(hasPassed(new Date(Date.now() + 60_000))).toBe(false);
    expect(isUpcoming(new Date(Date.now() + 60_000))).toBe(true);
    expect(isUpcoming(new Date(Date.now() - 1000))).toBe(false);
  });

  it('carimbo dos logs em pt-BR', () => {
    const stamp = formatLogTimestamp(new Date(2026, 10, 5, 14, 55, 51)); // hora local do processo
    expect(stamp).toBe('05/11/2026, 14:55:51');
  });
});
