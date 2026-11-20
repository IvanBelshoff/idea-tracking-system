import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  axisMargin,
  axisTicks,
  axisTop,
  buildSlices,
  buildWorkerSlices,
  failingRoutes,
  formatBytes,
  formatMegabytes,
  formatMs,
  type HistoryHour,
  PERIODS,
  periodStart,
  routesOfPeriod,
  sliceEnd,
  sliceStart,
  slowestRoutes,
} from './ops-format.ts';

const BRASILIA = -180; // minutos a leste do UTC
const at = (iso: string) => new Date(iso).getTime();

const hour = (iso: string, extra: Partial<HistoryHour> = {}): HistoryHour => ({
  hour: iso,
  requests: 0,
  errors4xx: 0,
  errors5xx: 0,
  rateLimited: 0,
  loginsOk: 0,
  loginsFailed: 0,
  p50Ms: 0,
  p95Ms: 0,
  p99Ms: 0,
  memoryMb: 0,
  routes: [],
  ...extra,
});

describe('Eixos', () => {
  it('o topo é o primeiro número redondo (1, 2, 5 × 10ⁿ) acima do maior valor', () => {
    assert.equal(axisTop(0), 1);
    assert.equal(axisTop(1), 1);
    assert.equal(axisTop(3), 5);
    assert.equal(axisTop(5), 5);
    assert.equal(axisTop(6), 10);
    assert.equal(axisTop(180), 200);
    assert.equal(axisTop(1200), 2000);
  });

  it('as marcas são zero, o meio e o topo; contagem não tem meio quebrado', () => {
    assert.deepEqual(axisTicks(8), [0, 5, 10]);
    assert.deepEqual(axisTicks(3), [0, 5]);
    assert.deepEqual(axisTicks(0), [0, 1]);
  });

  it('a margem acompanha o rótulo mais largo', () => {
    const narrow = axisMargin(8, (value) => String(value));
    const wide = axisMargin(8, (value) => `${value} ms`);
    assert.ok(wide > narrow);
  });
});

describe('Fatias de período', () => {
  it('a fatia começa na hora local certa: hora, 6 horas e dia', () => {
    const now = at('2026-11-10T15:30:00Z'); // 12:30 em Brasília
    assert.equal(new Date(sliceStart(now, 1, BRASILIA)).toISOString(), '2026-11-10T15:00:00.000Z');
    assert.equal(new Date(sliceStart(now, 6, BRASILIA)).toISOString(), '2026-11-10T15:00:00.000Z'); // 12h local
    assert.equal(
      new Date(sliceStart(at('2026-11-10T14:30:00Z'), 6, BRASILIA)).toISOString(),
      '2026-11-10T09:00:00.000Z',
    ); // 06h local
    assert.equal(new Date(sliceStart(now, 24, BRASILIA)).toISOString(), '2026-11-10T03:00:00.000Z'); // meia-noite local
  });

  it('o período começa (fatias - 1) fatias antes da atual; o fim da fatia soma as horas dela', () => {
    const now = at('2026-11-10T15:30:00Z');
    assert.equal(new Date(periodStart('24h', now, BRASILIA)).toISOString(), '2026-11-09T16:00:00.000Z');
    assert.equal(new Date(periodStart('30d', now, BRASILIA)).toISOString(), '2026-10-12T03:00:00.000Z');
    const start = at('2026-11-10T09:00:00Z');
    assert.equal(sliceEnd(start, '7d') - start, 6 * 3_600_000);
  });

  it('o período mais longo cabe nos 31 dias que a API aceita', () => {
    const now = at('2026-11-10T23:59:00Z');
    const days = (now - periodStart('30d', now, BRASILIA)) / 86_400_000;
    assert.ok(days <= 31, `pedido de ${days} dias`);
  });

  it('as horas gravadas somam por fatia; o p95 e a memória ficam com o pior; fatia vazia fica sem p95', () => {
    const now = at('2026-11-10T15:30:00Z');
    const slices = buildSlices(
      [
        hour('2026-11-10T15:00:00Z', { requests: 10, errors5xx: 1, errors4xx: 2, p95Ms: 100, memoryMb: 120 }),
        hour('2026-11-10T14:00:00Z', { requests: 5, p95Ms: 250, memoryMb: 130 }),
        hour('2026-11-01T00:00:00Z', { requests: 999 }), // antes do período: não entra
      ],
      '24h',
      now,
      BRASILIA,
    );
    assert.equal(slices.length, PERIODS['24h'].slices);
    const last = slices.at(-1);
    assert.deepEqual(
      {
        requests: last?.requests,
        errors5xx: last?.errors5xx,
        errors4xx: last?.errors4xx,
        p95Ms: last?.p95Ms,
        memoryMb: last?.memoryMb,
      },
      { requests: 10, errors5xx: 1, errors4xx: 2, p95Ms: 100, memoryMb: 120 },
    );
    const before = slices.at(-2);
    assert.equal(before?.requests, 5);
    assert.equal(before?.p95Ms, 250);
    assert.equal(slices[0]?.p95Ms, null);
    assert.equal(slices[0]?.memoryMb, null);
    assert.equal(
      slices.reduce((sum, slice) => sum + slice.requests, 0),
      15,
    );
  });

  it('em 7 dias, as horas de uma mesma janela de 6 horas viram uma fatia só, com o pior p95', () => {
    const now = at('2026-11-10T15:30:00Z');
    const slices = buildSlices(
      [
        hour('2026-11-10T09:00:00Z', { requests: 3, p95Ms: 50 }),
        hour('2026-11-10T11:00:00Z', { requests: 4, p95Ms: 500 }),
        hour('2026-11-10T14:00:00Z', { requests: 1, p95Ms: 10 }),
      ],
      '7d',
      now,
      BRASILIA,
    );
    assert.equal(slices.length, 28);
    const window = slices.find((slice) => slice.start === at('2026-11-10T09:00:00Z'));
    // 09h, 11h e 14h (UTC) caem na mesma janela de 6 horas locais (06h às 12h em Brasília = 09h às 15h UTC)
    assert.equal(window?.requests, 8);
    assert.equal(window?.p95Ms, 500);
    assert.equal(slices.at(-1)?.start, at('2026-11-10T15:00:00Z'));
    assert.equal(slices.at(-1)?.requests, 0);
  });

  it('o worker soma disparos, falhas e e-mails por fatia', () => {
    const now = at('2026-11-10T15:30:00Z');
    const slices = buildWorkerSlices(
      [
        {
          hour: '2026-11-10T15:00:00Z',
          ticks: 30,
          tickFailures: 1,
          tickP95Ms: 100,
          emailsSent: 2,
          emailsFailed: 1,
          emailsRetried: 3,
        },
        {
          hour: '2026-11-10T15:00:00Z',
          ticks: 5,
          tickFailures: 0,
          tickP95Ms: 250,
          emailsSent: 1,
          emailsFailed: 0,
          emailsRetried: 0,
        },
      ],
      '24h',
      now,
      BRASILIA,
    );
    assert.deepEqual(slices.at(-1), {
      start: at('2026-11-10T15:00:00Z'),
      ticks: 35,
      tickFailures: 1,
      tickP95Ms: 250,
      emailsSent: 3,
      emailsRetried: 3,
      emailsFailed: 1,
    });
  });
});

describe('Rotas', () => {
  const hours = [
    {
      routes: [
        { route: 'GET /api/a', requests: 10, errors: 0, p95Ms: 50 },
        { route: 'POST /api/b', requests: 2, errors: 2, p95Ms: 1000 },
      ],
    },
    { routes: [{ route: 'GET /api/a', requests: 5, errors: 1, p95Ms: 250 }] },
  ];

  it('somam por rota; o p95 é o pior das horas', () => {
    const routes = routesOfPeriod(hours);
    assert.deepEqual(
      routes.find((r) => r.route === 'GET /api/a'),
      { route: 'GET /api/a', requests: 15, errors: 1, p95Ms: 250 },
    );
  });

  it('as mais lentas e as que falharam vêm em ordem; sem erro não entra na lista de falhas', () => {
    const routes = routesOfPeriod(hours);
    assert.deepEqual(
      slowestRoutes(routes, 1).map((r) => r.route),
      ['POST /api/b'],
    );
    assert.deepEqual(
      failingRoutes(routes).map((r) => r.route),
      ['POST /api/b', 'GET /api/a'],
    );
    assert.deepEqual(failingRoutes([{ route: 'GET /x', requests: 9, errors: 0, p95Ms: 5 }]), []);
  });
});

describe('Números', () => {
  it('tempo em ms; a partir de 1 s em segundos; passou de 10 s vira "> 10 s"', () => {
    assert.equal(formatMs(5, 'en'), '5 ms');
    assert.equal(formatMs(250, 'en'), '250 ms');
    assert.equal(formatMs(1500, 'en'), '1.5 s');
    assert.equal(formatMs(10_000, 'en'), '10 s');
    assert.equal(formatMs(20_000, 'en'), '> 10 s');
  });

  it('memória e tamanhos na maior unidade legível', () => {
    assert.equal(formatMegabytes(180, 'en'), '180 MB');
    assert.equal(formatMegabytes(1536, 'en'), '1.5 GB');
    assert.equal(formatBytes(512, 'en'), '512 B');
    assert.equal(formatBytes(10 * 1024 * 1024, 'en'), '10 MB');
    assert.equal(formatBytes(5 * 1024 ** 3, 'en'), '5 GB');
  });
});
