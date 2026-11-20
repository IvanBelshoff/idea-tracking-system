'use client';

import { useId, useState } from 'react';
import { NativeSelect } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Regra, Situacao } from '../components/doc-parts';
import { useLang } from '../components/use-lang';
import type { Lang } from '../i18n';
import { formatDay, isTriageOverdue, priorityScore, SLA_DAYS, type Status, triageDueDate } from './regras';

/** "Hoje" fixo do simulador (uma sexta-feira), para os prazos darem sempre o mesmo resultado. */
const TODAY = '2026-11-20';

const TEXT = {
  'pt-BR': {
    today: (d: string) => `Hoje é ${d}. Prazo de retorno da instalação: ${SLA_DAYS} dias.`,
    business: 'Contar só dias úteis (configuração da instalação)',
    lateCount: (n: number) => (n === 1 ? '1 ideia com retorno atrasado' : `${n} ideias com retorno atrasado`),
    noneLate: 'Nenhuma ideia com retorno atrasado',
    order: 'Ordenar',
    byAge: 'Mais antigas primeiro',
    byPriority: 'Prioridade (impacto ÷ esforço)',
    submitted: 'Enviada em',
    due: 'Previsão de retorno',
    impact: 'Impacto',
    effort: 'Esforço',
    priority: 'Prioridade',
    none: '—',
    take: 'Assumir a análise',
    reject: 'Não autorizar',
    reason: 'Justificativa (o autor recebe este texto)',
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    needReason: 'Sem justificativa não dá: quem enviou merece saber o porquê.',
    done: 'Triagem concluída para esta ideia.',
  },
  en: {
    today: (d: string) => `Today is ${d}. The installation’s response deadline: ${SLA_DAYS} days.`,
    business: 'Count business days only (installation setting)',
    lateCount: (n: number) => (n === 1 ? '1 idea with a late response' : `${n} ideas with a late response`),
    noneLate: 'No ideas with a late response',
    order: 'Sort',
    byAge: 'Oldest first',
    byPriority: 'Priority (impact ÷ effort)',
    submitted: 'Submitted on',
    due: 'Expected response by',
    impact: 'Impact',
    effort: 'Effort',
    priority: 'Priority',
    none: '—',
    take: 'Take the review',
    reject: 'Do not approve',
    reason: 'Justification (the author receives this text)',
    confirm: 'Confirm',
    cancel: 'Cancel',
    needReason: 'A justification is required: whoever submitted it deserves to know why.',
    done: 'Triage done for this idea.',
  },
} satisfies Record<Lang, unknown>;

interface Row {
  code: string;
  title: Record<Lang, string>;
  submitted: string;
  status: Status;
  impact: number | null;
  effort: number | null;
}

const START: Row[] = [
  {
    code: 'ITS-2026-0029',
    title: { 'pt-BR': 'Tampa nas caixas de descarte', en: 'Lids on the waste bins' },
    submitted: '2026-11-03',
    status: 'in_review',
    impact: null,
    effort: null,
  },
  {
    code: 'ITS-2026-0031',
    title: { 'pt-BR': 'Corrimão na escada do mezanino', en: 'Handrail on the mezzanine stairs' },
    submitted: '2026-11-05',
    status: 'submitted',
    impact: null,
    effort: null,
  },
  {
    code: 'ITS-2026-0034',
    title: { 'pt-BR': 'Checklist digital na troca de turno', en: 'Digital checklist at shift change' },
    submitted: '2026-11-09',
    status: 'submitted',
    impact: null,
    effort: null,
  },
  {
    code: 'ITS-2026-0036',
    title: { 'pt-BR': 'Reaproveitar paletes danificados', en: 'Reuse damaged pallets' },
    submitted: '2026-11-12',
    status: 'submitted',
    impact: null,
    effort: null,
  },
  {
    code: 'ITS-2026-0038',
    title: { 'pt-BR': 'Sinalização de piso na doca 2', en: 'Floor markings at dock 2' },
    submitted: '2026-11-16',
    status: 'submitted',
    impact: null,
    effort: null,
  },
];

/** Simulador da fila de triagem: prazo de retorno, atraso, prioridade e as duas decisões iniciais. */
export function Triagem() {
  const lang = useLang();
  const t = TEXT[lang];
  const [rows, setRows] = useState(START);
  const [business, setBusiness] = useState(false);
  const [sort, setSort] = useState<'age' | 'priority'>('age');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  const ids = useId();

  const view = rows.map((r) => {
    const due = triageDueDate(r.submitted, SLA_DAYS, business);
    return { ...r, due, late: isTriageOverdue(r.status, due, TODAY), score: priorityScore(r.impact, r.effort) };
  });
  const ordered = [...view].sort((a, b) =>
    sort === 'priority'
      ? (b.score ?? -1) - (a.score ?? -1) || a.submitted.localeCompare(b.submitted)
      : a.submitted.localeCompare(b.submitted),
  );
  const late = view.filter((r) => r.late).length;
  const update = (code: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.code === code ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm">
        <p>{t.today(formatDay(TODAY, lang))}</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={business}
            onChange={(e) => setBusiness(e.target.checked)}
            className="size-4 accent-primary"
          />
          {t.business}
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium" aria-live="polite">
          {late ? <span className="text-(--st-late)">{t.lateCount(late)}</span> : t.noneLate} <Regra id="RN-54" />
        </p>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor={`${ids}-ordem`}>{t.order}</label>
          <NativeSelect
            id={`${ids}-ordem`}
            value={sort}
            onChange={(e) => setSort(e.target.value as 'age' | 'priority')}
            className="w-auto"
          >
            <option value="age">{t.byAge}</option>
            <option value="priority">{t.byPriority}</option>
          </NativeSelect>
        </div>
      </div>

      <ul className="divide-y border-y">
        {ordered.map((r) => {
          const open = r.status === 'submitted' || r.status === 'in_review';
          return (
            <li key={r.code} className="p-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                <Situacao s={r.status} />
                {r.late && <Situacao s="late" />}
              </div>
              <p className="mt-1 font-medium">{r.title[lang]}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">{t.submitted}</dt>
                  <dd className="font-num">{formatDay(r.submitted, lang)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t.due}</dt>
                  <dd className={`font-num ${r.late ? 'font-semibold text-(--st-late)' : ''}`}>
                    {formatDay(r.due, lang)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t.priority}</dt>
                  <dd className="font-num">
                    {r.score === null
                      ? t.none
                      : new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(r.score)}
                  </dd>
                </div>
              </dl>
              {open && (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  {(['impact', 'effort'] as const).map((field) => (
                    <div key={field} className="grid gap-1 text-sm">
                      <label htmlFor={`${ids}-${r.code}-${field}`}>{t[field]}</label>
                      <NativeSelect
                        id={`${ids}-${r.code}-${field}`}
                        value={r[field] ?? ''}
                        onChange={(e) => update(r.code, { [field]: e.target.value ? Number(e.target.value) : null })}
                        className="w-20"
                      >
                        <option value="">{t.none}</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  ))}
                  <span className="pb-1.5">
                    <Regra id="RN-56" />
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {r.status === 'submitted' && (
                      <Button size="sm" variant="outline" onClick={() => update(r.code, { status: 'in_review' })}>
                        {t.take}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      aria-expanded={rejecting === r.code}
                      onClick={() => {
                        setRejecting(r.code);
                        setReason('');
                        setError(false);
                      }}
                    >
                      {t.reject}
                    </Button>
                  </div>
                </div>
              )}
              {!open && <p className="mt-2 text-sm text-muted-foreground">{t.done}</p>}
              {rejecting === r.code && (
                <form
                  className="mt-3 space-y-2 rounded-lg bg-muted/50 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!reason.trim()) {
                      setError(true);
                      return;
                    }
                    update(r.code, { status: 'rejected' });
                    setRejecting(null);
                  }}
                >
                  <label htmlFor={`${ids}-${r.code}`} className="block text-sm font-medium">
                    {t.reason} <Regra id="RN-05" />
                  </label>
                  <Textarea
                    id={`${ids}-${r.code}`}
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    aria-invalid={error || undefined}
                  />
                  {error && (
                    <p role="alert" className="text-sm font-medium text-destructive">
                      {t.needReason}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">
                      {t.confirm}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                      {t.cancel}
                    </Button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
