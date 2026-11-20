import { Table2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DASHBOARD, ENTITIES, type IdeaStatus } from '../data';
import { LateBadge, StatusBadge, statusLabel, statusVar } from '../status';

const ORDER: IdeaStatus[] = ['submitted', 'in_review', 'in_progress', 'implemented', 'rejected'];
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function Dashboard() {
  const total = ORDER.reduce((sum, s) => sum + DASHBOARD.byStatus[s], 0);

  return (
    <div className="mx-auto max-w-[78rem]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-bold">Indicadores</h1>
          <p className="mt-1 text-muted-foreground">
            <span className="font-num font-semibold text-foreground">{total}</span> ideias de {DASHBOARD.period}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select defaultValue="2026">
            <SelectTrigger aria-label="Período" className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2026">Jan. a out. de 2026</SelectItem>
              <SelectItem value="q3">3º trimestre de 2026</SelectItem>
              <SelectItem value="2025">2025</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="all">
            <SelectTrigger aria-label="Área" className="h-9 w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as áreas</SelectItem>
              {ENTITIES.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Distribuição por status: barra única, partes de um todo */}
      <section aria-labelledby="by-status" className="mt-8 rounded-lg border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="by-status" className="text-lg font-bold">
            Onde estão as ideias
          </h2>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LateBadge label={`${DASHBOARD.late} em andamento com etapa atrasada`} />
          </p>
        </div>
        <div className="mt-5 flex h-9 gap-0.5" role="img" aria-label="Distribuição das ideias por status">
          {ORDER.map((s) => {
            const n = DASHBOARD.byStatus[s];
            return (
              <Tooltip key={s}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${statusLabel(s)}: ${n} ideias`}
                    className="h-full first:rounded-l-[4px] last:rounded-r-[4px] hover:opacity-85"
                    style={{ width: `${(n / total) * 100}%`, background: statusVar(s, '-fill') }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {statusLabel(s)}: {n} ideias ({fmt((n / total) * 100)}%)
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          {ORDER.map((s) => (
            <li key={s} className="flex items-baseline justify-between gap-2 border-t pt-3 lg:block">
              <StatusBadge status={s} />
              <p className="mt-1 font-num text-2xl font-semibold">
                {DASHBOARD.byStatus[s]}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  {fmt((DASHBOARD.byStatus[s] / total) * 100)}%
                </span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <MonthlyChart />
        <AvgTimes />
      </div>

      <EntityTable />
    </div>
  );
}

function MonthlyChart() {
  const [asTable, setAsTable] = useState(false);
  const max = 20;
  const ticks = [0, 5, 10, 15, 20];
  const last = DASHBOARD.monthly.at(-1);

  return (
    <section aria-labelledby="monthly" className="rounded-lg border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="monthly" className="text-lg font-bold">
            Ideias por mês
          </h2>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 text-sm text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-chart-1" />
              Enviadas
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-chart-2" />
              Implementadas
            </li>
          </ul>
        </div>
        <Button variant="ghost" size="sm" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          <Table2 aria-hidden="true" />
          {asTable ? 'Ver gráfico' : 'Ver tabela'}
        </Button>
      </div>

      {asTable ? (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1.5 font-medium">Mês</th>
              <th className="py-1.5 pl-4 text-right font-medium">Enviadas</th>
              <th className="py-1.5 pl-4 text-right font-medium">Implementadas</th>
            </tr>
          </thead>
          <tbody className="font-num">
            {DASHBOARD.monthly.map((m) => (
              <tr key={m.m} className="border-b last:border-0">
                <td className="py-1.5 font-sans">{m.m}</td>
                <td className="py-1.5 pl-4 text-right">{m.sent}</td>
                <td className="py-1.5 pl-4 text-right">{m.done}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mt-5 grid grid-cols-[1.75rem_1fr] gap-x-2">
          <div className="relative h-48 text-right text-xs text-muted-foreground" aria-hidden="true">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute right-0 font-num"
                style={{ bottom: `calc(${(t / max) * 100}% - 0.5em)` }}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="relative h-48">
            {ticks.map((t) => (
              <span
                key={t}
                aria-hidden="true"
                className={`absolute inset-x-0 h-px ${t === 0 ? 'bg-foreground/35' : 'bg-border/70'}`}
                style={{ bottom: `${(t / max) * 100}%` }}
              />
            ))}
            <div className="relative flex h-full items-end justify-between gap-1">
              {DASHBOARD.monthly.map((m) => (
                <Tooltip key={m.m}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="group flex h-full flex-1 items-end justify-center gap-0.5 rounded-sm hover:bg-muted/70"
                      aria-label={`${m.m}: ${m.sent} enviadas, ${m.done} implementadas`}
                    >
                      <span
                        className="relative w-[34%] max-w-3 rounded-t-[4px] bg-chart-1"
                        style={{ height: `${(m.sent / max) * 100}%` }}
                      >
                        {m === last && (
                          <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-num text-xs font-semibold">
                            {m.sent}
                          </span>
                        )}
                      </span>
                      <span
                        className="relative w-[34%] max-w-3 rounded-t-[4px] bg-chart-2"
                        style={{ height: `${(m.done / max) * 100}%` }}
                      >
                        {m === last && (
                          <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-num text-xs font-semibold">
                            {m.done}
                          </span>
                        )}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-semibold">{m.m}</p>
                    <p>
                      {m.sent} enviadas · {m.done} implementadas
                    </p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
          <span />
          <div className="mt-1.5 flex justify-between gap-1 text-xs text-muted-foreground" aria-hidden="true">
            {DASHBOARD.monthly.map((m) => (
              <span key={m.m} className="flex-1 text-center">
                {m.m}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AvgTimes() {
  return (
    <section aria-labelledby="avg" className="rounded-lg border bg-card p-5 sm:p-6">
      <h2 id="avg" className="text-lg font-bold">
        Tempo médio
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Em dias corridos. A marca vertical é a meta da organização.</p>
      <ul className="mt-5 space-y-5">
        {DASHBOARD.avgDays.map((a) => {
          const scale = a.target * 1.25;
          return (
            <li key={a.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{a.label}</span>
                <span className="font-num font-semibold">
                  {fmt(a.days)} d <span className="font-normal text-muted-foreground">/ meta {a.target}</span>
                </span>
              </div>
              <div className="relative mt-2 h-2.5 rounded-[4px] bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-[4px] bg-chart-1"
                  style={{ width: `${(a.days / scale) * 100}%` }}
                />
                <span
                  aria-hidden="true"
                  className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground"
                  style={{ left: `${(a.target / scale) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 border-t pt-4 text-sm">
        <span className="font-num text-2xl font-semibold">{DASHBOARD.triageOnTimePct}%</span>
        <span className="ml-2 text-muted-foreground">das ideias receberam retorno no prazo</span>
      </p>
    </section>
  );
}

function EntityTable() {
  return (
    <section aria-labelledby="entities" className="mt-6 rounded-lg border bg-card p-5 sm:p-6">
      <h2 id="entities" className="text-lg font-bold">
        Comparação entre áreas
      </h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">Área</th>
              <th className="py-2 pl-4 text-right font-medium">Enviadas</th>
              <th className="py-2 pl-4 text-right font-medium">Implementadas</th>
              <th className="w-[34%] py-2 pl-6 font-medium">Taxa de implementação</th>
              <th className="py-2 pl-4 text-right font-medium">Retorno no prazo</th>
            </tr>
          </thead>
          <tbody>
            {DASHBOARD.byEntity.map((e) => {
              const rate = (e.implemented / e.sent) * 100;
              return (
                <tr key={e.entity} className="border-b last:border-0">
                  <td className="py-3 font-medium">{e.entity}</td>
                  <td className="py-3 pl-4 text-right font-num">{e.sent}</td>
                  <td className="py-3 pl-4 text-right font-num">{e.implemented}</td>
                  <td className="py-3 pl-6">
                    <div className="flex items-center gap-3">
                      <div className="h-2 flex-1 rounded-[4px] bg-muted">
                        <div className="h-full rounded-[4px] bg-chart-1" style={{ width: `${rate}%` }} />
                      </div>
                      <span className="w-12 text-right font-num font-semibold">{fmt(rate)}%</span>
                    </div>
                  </td>
                  <td className="py-3 pl-4 text-right">
                    {e.onTimePct < 80 ? (
                      <span className="inline-flex items-center gap-2">
                        <LateBadge label="Abaixo da meta" />
                        <span className="font-num font-semibold">{e.onTimePct}%</span>
                      </span>
                    ) : (
                      <span className="font-num font-semibold">{e.onTimePct}%</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
