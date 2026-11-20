import { Link } from '@tanstack/react-router';
import { ArrowDownWideNarrow, MoreHorizontal, Search, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { daysBetween } from '@/lib/dates';
import { CATEGORIES, ENTITIES, formatDate, IDEAS, type IdeaStatus, isLate, isTriageLate, TODAY } from '../data';
import { CategoryTag, IdCode, LateBadge, StatusBadge, statusLabel } from '../status';

const ALL = 'all';
const STATUSES: IdeaStatus[] = ['submitted', 'in_review', 'in_progress', 'implemented', 'rejected'];

/** Prioridade = impacto ÷ esforço (RN-56); sem avaliação fica por último. */
const priority = (impact?: number, effort?: number) => (impact && effort ? impact / effort : -1);

export function AnalystQueue() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string>(ALL);
  const [entity, setEntity] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(
    () =>
      IDEAS.filter(
        (i) =>
          (status === ALL || i.status === status) &&
          (entity === ALL || i.entity === entity) &&
          (category === ALL || i.category === category) &&
          (query === '' || `${i.code} ${i.title} ${i.author}`.toLowerCase().includes(query.toLowerCase())),
      ).sort((a, b) => priority(b.impact, b.effort) - priority(a.impact, a.effort)),
    [query, status, entity, category],
  );

  const toggle = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.code));
  const filtered = query !== '' || status !== ALL || entity !== ALL || category !== ALL;
  const triageLate = IDEAS.filter(isTriageLate).length;
  const execLate = IDEAS.filter(isLate).length;
  const waiting = IDEAS.filter((i) => i.status === 'submitted').length;

  return (
    <div className="mx-auto max-w-[90rem]">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-bold">Fila de ideias</h1>
          <p className="mt-1 text-muted-foreground">Unidade Norte e Unidade Sul · ordenada por prioridade</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Aguardando triagem</dt>
            <dd className="font-num text-base font-semibold">{waiting}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt>
              <LateBadge label="Retorno atrasado" />
            </dt>
            <dd className="font-num text-base font-semibold">{triageLate}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt>
              <LateBadge label="Etapa atrasada" />
            </dt>
            <dd className="font-num text-base font-semibold">{execLate}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,1.4fr)_1fr_1fr_1fr]">
        <div className="relative">
          <Search aria-hidden="true" className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Buscar"
            placeholder="Buscar por código, título ou autor"
            className="h-9 pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={STATUSES.map((s) => [s, statusLabel(s)])}
        />
        <FilterSelect label="Área" value={entity} onChange={setEntity} options={ENTITIES.map((e) => [e, e])} />
        <FilterSelect label="Tipo" value={category} onChange={setCategory} options={CATEGORIES.map((c) => [c, c])} />
      </div>

      <div className="mt-3 flex min-h-10 flex-wrap items-center gap-2 text-sm">
        {selected.size > 0 ? (
          <div role="toolbar" aria-label="Ações em lote" className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{selected.size} selecionadas</span>
            <Button size="sm" variant="outline">
              Atribuir a…
            </Button>
            <Button size="sm" variant="outline">
              Mudar tipo
            </Button>
            <Button size="sm" variant="outline">
              Convergir
            </Button>
            <Button size="sm" variant="destructive">
              Não autorizar…
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <ArrowDownWideNarrow aria-hidden="true" className="size-4" />
            {rows.length} de {IDEAS.length} ideias · selecione linhas para agir em lote
          </p>
        )}
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              setQuery('');
              setStatus(ALL);
              setEntity(ALL);
              setCategory(ALL);
            }}
          >
            <X aria-hidden="true" />
            Limpar filtros
          </Button>
        )}
      </div>

      <div className="mt-1 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <Checkbox
                  aria-label="Selecionar todas"
                  checked={allSelected}
                  onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.code)) : new Set())}
                />
              </TableHead>
              <TableHead>Ideia</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Área</TableHead>
              <TableHead>Retorno / prazo</TableHead>
              <TableHead className="text-right">
                <span title="Impacto × esforço, de 1 a 5">Imp. × esf.</span>
              </TableHead>
              <TableHead className="text-right">Apoios</TableHead>
              <TableHead className="w-10 pr-3">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="py-12 text-center whitespace-normal">
                  <p className="font-medium">Nenhuma ideia com esses filtros.</p>
                  <p className="text-sm text-muted-foreground">Tente outro status ou limpe os filtros.</p>
                </TableCell>
              </TableRow>
            )}
            {rows.map((i) => {
              const deadline = i.status === 'in_progress' ? i.steps.at(-1)?.dueDate : i.slaDueAt;
              const closed = i.status === 'implemented' || i.status === 'rejected';
              const daysLeft = deadline ? daysBetween(TODAY, deadline) : undefined;
              return (
                <TableRow
                  key={i.code}
                  data-state={selected.has(i.code) ? 'selected' : undefined}
                  className="data-[state=selected]:bg-[color-mix(in_oklch,var(--primary)_9%,transparent)]"
                >
                  <TableCell className="pl-4">
                    <Checkbox
                      aria-label={`Selecionar ${i.code}`}
                      checked={selected.has(i.code)}
                      onCheckedChange={() => toggle(i.code)}
                    />
                  </TableCell>
                  <TableCell className="max-w-[26rem] py-2.5">
                    <Link
                      to="/prototipo/ideias/$code"
                      params={{ code: i.code }}
                      className="block truncate font-semibold hover:underline"
                    >
                      {i.title}
                    </Link>
                    <span className="mt-0.5 flex items-center gap-x-2.5 text-xs text-muted-foreground">
                      <IdCode code={i.code} />
                      <CategoryTag name={i.category} />
                      <span className="truncate">{i.author}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={i.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{i.entity}</TableCell>
                  <TableCell className="text-sm">
                    {closed || !deadline ? (
                      <span className="text-muted-foreground">—</span>
                    ) : isTriageLate(i) || isLate(i) ? (
                      <span className="flex items-center gap-2">
                        <LateBadge label={`${-(daysLeft ?? 0)} d atrasado`} />
                        <span className="font-num text-muted-foreground">{formatDate(deadline)}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="font-num">{formatDate(deadline)}</span>
                        <span className="text-xs text-muted-foreground">
                          {daysLeft === 0 ? 'hoje' : `em ${daysLeft} d`}
                        </span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-num">
                    {i.impact && i.effort ? (
                      `${i.impact} × ${i.effort}`
                    ) : (
                      <span className="font-sans text-muted-foreground">a avaliar</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-num">
                    <span className="inline-flex items-center gap-1">
                      <Users aria-hidden="true" className="size-3.5 text-muted-foreground" />
                      {i.supporters}
                    </span>
                  </TableCell>
                  <TableCell className="pr-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" aria-label={`Ações para ${i.code}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>Assumir triagem</DropdownMenuItem>
                        <DropdownMenuItem>Aprovar…</DropdownMenuItem>
                        <DropdownMenuItem>Convergir com outra ideia…</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive">Não autorizar…</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-9 w-full data-[size=default]:h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: todos</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
