import { Link } from '@tanstack/react-router';
import { Download, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEntities } from '../admin/queries';
import { entityOptionLabel, orderTree, AdminPage as Page, Pagination } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { useCan } from '../session';
import { useDates } from '../use-dates';
import { type IdeaSummary, useActiveCategories, useIdeaList, useMyIdeas } from './queries';
import { BatchBar, SavedFilters } from './queue-tools';
import { LateBadge, TriageLateBadge } from './steps-panel';
import { CategoryTag, IDEA_STATUSES, IdCode, type IdeaStatus, IdeaStatusBadge } from './ui';

const PAGE_SIZE = 20;

function StatusFilter({
  value,
  onChange,
  multiple,
}: {
  value: IdeaStatus[];
  onChange: (v: IdeaStatus[]) => void;
  multiple?: boolean;
}) {
  const { t } = useTranslation();
  const toggle = (s: IdeaStatus) =>
    onChange(multiple ? (value.includes(s) ? value.filter((x) => x !== s) : [...value, s]) : value[0] === s ? [] : [s]);
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">{t('ideas.queue.status')}</legend>
      {!multiple && (
        <button
          type="button"
          aria-pressed={value.length === 0}
          onClick={() => onChange([])}
          className={`rounded-full border px-3 py-1 text-sm ${value.length === 0 ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        >
          {t('ideas.mine.all')}
        </button>
      )}
      {IDEA_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={value.includes(s)}
          onClick={() => toggle(s)}
          className={`rounded-full border px-3 py-1 text-sm ${value.includes(s) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        >
          {t(`ideas.status.${s}`)}
        </button>
      ))}
    </fieldset>
  );
}

interface Selection {
  selected: ReadonlySet<string>;
  toggle: (code: string) => void;
  setAll: (codes: string[], on: boolean) => void;
}

/** Impacto e esforço (RN-56), quando a equipe já avaliou. */
function PriorityChip({ impact, effort }: { impact: number | null; effort: number | null }) {
  const { t } = useTranslation();
  if (impact === null || effort === null) return null;
  return (
    <span
      title={t('ideas.priority.chipTitle', { impact, effort })}
      className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[0.7rem] text-muted-foreground"
    >
      <span className="sr-only">{t('ideas.priority.chipTitle', { impact, effort })}</span>
      <span aria-hidden="true">
        I{impact} · E{effort}
      </span>
    </span>
  );
}

/** Linha de ideia em lista: código, título (link), situação, entidade, categoria e data. */
function IdeaRows({
  items,
  empty,
  selection,
}: {
  items: IdeaSummary[] | undefined;
  empty: string;
  selection?: Selection;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const codes = items?.map((i) => i.code) ?? [];
  const allOn = selection !== undefined && codes.length > 0 && codes.every((c) => selection.selected.has(c));
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {selection && (
              <TableHead className="w-10">
                <Checkbox
                  aria-label={t('ideas.batch.selectAll')}
                  checked={allOn}
                  onCheckedChange={(v) => selection.setAll(codes, v === true)}
                />
              </TableHead>
            )}
            <TableHead>{t('ideas.queue.columns.title')}</TableHead>
            <TableHead className="w-36">{t('ideas.queue.columns.status')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('ideas.queue.columns.entity')}</TableHead>
            <TableHead className="hidden w-32 sm:table-cell">{t('ideas.queue.columns.submitted')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items?.map((i) => (
            <TableRow key={i.id} data-state={selection?.selected.has(i.code) ? 'selected' : undefined}>
              {selection && (
                <TableCell>
                  <Checkbox
                    aria-label={t('ideas.batch.select', { code: i.code })}
                    checked={selection.selected.has(i.code)}
                    onCheckedChange={() => selection.toggle(i.code)}
                  />
                </TableCell>
              )}
              <TableCell className="max-w-[28rem]">
                <IdCode code={i.code} />
                <Link
                  to="/ideias/$ref"
                  params={{ ref: i.code }}
                  className="block truncate font-semibold hover:underline"
                >
                  {i.title}
                </Link>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  <CategoryTag category={i.category} />
                  <span className="md:hidden"> · {i.entity.name}</span>
                </span>
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  <IdeaStatusBadge status={i.status} />
                  {i.late && <LateBadge />}
                  {i.triageOverdue && <TriageLateBadge />}
                  <PriorityChip impact={i.impact} effort={i.effort} />
                  {i.convergedInto && (
                    <Badge variant="outline">
                      {t('ideas.convergence.convergedWith', { code: i.convergedInto.code })}
                    </Badge>
                  )}
                  {i.relation === 'co_author' && (
                    <Badge variant="secondary">{t('ideas.participants.roles.co_author')}</Badge>
                  )}
                </span>
              </TableCell>
              <TableCell className="hidden md:table-cell">{i.entity.name}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">{dates.date(i.submittedAt)}</TableCell>
            </TableRow>
          ))}
          {items?.length === 0 && (
            <TableRow>
              <TableCell colSpan={selection ? 5 : 4} className="py-10 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Minhas ideias: tudo o que a pessoa enviou (o autor sempre vê as suas; CA-RN-01.4). */
export function MyIdeasPage() {
  const { t } = useTranslation();
  const can = useCan();
  const [status, setStatus] = useState<IdeaStatus[]>([]);
  const [page, setPage] = useState(1);
  const mine = useMyIdeas({ status: status.length ? status : undefined, page, pageSize: PAGE_SIZE });
  const empty = mine.data && mine.data.meta.total === 0 && status.length === 0;

  return (
    <Page
      title={t('ideas.mine.title')}
      intro={t('ideas.mine.intro')}
      help="myIdeas"
      actions={
        can('idea.submit') && (
          <Link to="/ideias/nova" className={buttonVariants()}>
            <Plus aria-hidden="true" />
            {t('shell.nav.submit')}
          </Link>
        )
      }
    >
      {mine.isError && <FormError message={errorText(t, mine.error)} />}
      {empty ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-muted-foreground">{t('ideas.mine.empty')}</p>
          {can('idea.submit') && (
            <Link to="/ideias/nova" className={`${buttonVariants()} mt-4`}>
              {t('ideas.mine.emptyAction')}
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="mb-4">
            <StatusFilter
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            />
          </div>
          <IdeaRows items={mine.data?.items} empty={t('ideas.queue.empty')} />
          {mine.data && <Pagination page={page} pageSize={PAGE_SIZE} total={mine.data.meta.total} onPage={setPage} />}
        </>
      )}
    </Page>
  );
}

/** Fila da equipe: ideias das entidades do escopo, com filtros (RN-01, CA-RN-25.2, CA-RN-23.1). */
export function QueuePage() {
  const { t } = useTranslation();
  const can = useCan();
  const canTriage = can('idea.triage');
  const entities = useEntities();
  const categories = useActiveCategories();
  const [status, setStatus] = useState<IdeaStatus[]>(['submitted', 'in_review']);
  const [entityId, setEntityId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [sort, setSort] = useState<'oldest' | 'newest' | 'priority'>('oldest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const reset =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setPage(1);
    };
  const filters = {
    status: status.length ? status : undefined,
    entityId: entityId || undefined,
    categoryId: categoryId || undefined,
    search: search.trim() || undefined,
    assignedToMe: assignedToMe ? ('true' as const) : undefined,
    sort,
  };
  const list = useIdeaList({ ...filters, page, pageSize: PAGE_SIZE });
  // Exportação (RN-48): os mesmos filtros da tela, sem paginação.
  const exportQuery = new URLSearchParams();
  for (const s of filters.status ?? []) exportQuery.append('status', s);
  for (const k of ['entityId', 'categoryId', 'search', 'assignedToMe', 'sort'] as const) {
    if (filters[k]) exportQuery.set(k, String(filters[k]));
  }

  return (
    <Page title={t('ideas.queue.title')} intro={t('ideas.queue.intro')} help="queue">
      <div className="mb-4 grid gap-3">
        <StatusFilter value={status} onChange={reset(setStatus)} multiple />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_14rem_12rem_12rem]">
          <Field label={t('ideas.queue.search')}>
            <Input type="search" value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
          </Field>
          <Field label={t('ideas.queue.entity')}>
            <NativeSelect value={entityId} onChange={(e) => reset(setEntityId)(e.target.value)}>
              <option value="">{t('ideas.queue.allEntities')}</option>
              {orderTree(entities.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {entityOptionLabel(e)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('ideas.queue.category')}>
            <NativeSelect value={categoryId} onChange={(e) => reset(setCategoryId)(e.target.value)}>
              <option value="">{t('ideas.queue.allCategories')}</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('ideas.queue.sort')}>
            <NativeSelect
              value={sort}
              onChange={(e) => reset(setSort)(e.target.value as 'oldest' | 'newest' | 'priority')}
            >
              <option value="oldest">{t('ideas.queue.oldest')}</option>
              <option value="newest">{t('ideas.queue.newest')}</option>
              <option value="priority">{t('ideas.queue.priority')}</option>
            </NativeSelect>
          </Field>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id="assigned-to-me"
            checked={assignedToMe}
            onCheckedChange={(v) => reset(setAssignedToMe)(v === true)}
          />
          <label htmlFor="assigned-to-me">{t('ideas.queue.assignedToMe')}</label>
        </div>
      </div>
      {list.isError && <FormError message={errorText(t, list.error)} />}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <SavedFilters
          current={{
            status,
            entityId: entityId || null,
            categoryId: categoryId || null,
            search: search.trim(),
            assignedToMe,
            sort,
          }}
          onApply={(d) => {
            setStatus(d.status as IdeaStatus[]);
            setEntityId(d.entityId ?? '');
            setCategoryId(d.categoryId ?? '');
            setSearch(d.search);
            setAssignedToMe(d.assignedToMe);
            setSort(d.sort as 'oldest' | 'newest' | 'priority');
            setPage(1);
            setSelected(new Set());
          }}
        />
        <Button asChild variant="outline" size="sm">
          <a href={`/api/ideas/export.csv?${exportQuery}`} download>
            <Download aria-hidden="true" />
            {t('ideas.queue.export')}
          </a>
        </Button>
      </div>
      {canTriage && <BatchBar codes={[...selected]} onDone={() => setSelected(new Set())} />}
      <IdeaRows
        items={list.data?.items}
        empty={t('ideas.queue.empty')}
        selection={
          canTriage
            ? {
                selected,
                toggle: (code) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(code)) next.delete(code);
                    else next.add(code);
                    return next;
                  }),
                setAll: (codes, on) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    for (const code of codes) {
                      if (on) next.add(code);
                      else next.delete(code);
                    }
                    return next;
                  }),
              }
            : undefined
        }
      />
      {list.data && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.meta.total} onPage={setPage} />}
    </Page>
  );
}
