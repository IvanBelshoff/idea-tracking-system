'use client';

import { Check, CircleDot, Plus } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Regra, Situacao } from '../components/doc-parts';
import { useLang } from '../components/use-lang';
import type { Lang } from '../i18n';
import {
  canAddStep,
  formatDay,
  ideaDeadline,
  isLate,
  progressBySteps,
  type Status,
  type Step,
  validStepDates,
} from './regras';

/** "Hoje" fixo do simulador: a etapa aberta começa um dia atrasada, de propósito. */
const TODAY = '2026-11-20';

const TEXT = {
  'pt-BR': {
    idea: 'Gabarito de regulagem na prensa 3',
    today: (d: string) => `Hoje é ${d}.`,
    deadline: 'Prazo da ideia',
    progress: 'Progresso',
    stepsDone: (a: number, b: number) => `${a} de ${b} etapas concluídas`,
    open: 'Aberta',
    done: 'Concluída',
    due: 'Prevista',
    complete: 'Concluir etapa',
    add: 'Nova etapa',
    addBlocked: 'Conclua a etapa aberta antes de criar outra.',
    name: 'Nome da etapa',
    start: 'Início',
    dueLabel: 'Prevista',
    save: 'Criar etapa',
    cancel: 'Cancelar',
    required: 'Campo obrigatório.',
    badDates: 'A prevista não pode ser antes do início.',
    allDone: 'Todas as etapas concluídas: crie uma nova etapa ou marque como implementada.',
    implement: 'Marcar como implementada',
    result: 'Resultado obtido',
    needResult: 'Conte o resultado obtido antes de encerrar.',
    confirm: 'Confirmar',
    history: 'Histórico de prazo',
    moved: (a: string, b: string) => `Prazo alterado de ${a} para ${b}`,
    implemented: 'Ideia implementada. Ela fica só para leitura, e o autor é avisado.',
  },
  en: {
    idea: 'Setup jig on press 3',
    today: (d: string) => `Today is ${d}.`,
    deadline: 'Idea deadline',
    progress: 'Progress',
    stepsDone: (a: number, b: number) => `${a} of ${b} steps completed`,
    open: 'Open',
    done: 'Completed',
    due: 'Due',
    complete: 'Complete step',
    add: 'New step',
    addBlocked: 'Complete the open step before creating another one.',
    name: 'Step name',
    start: 'Start',
    dueLabel: 'Due',
    save: 'Create step',
    cancel: 'Cancel',
    required: 'Required field.',
    badDates: 'The due date cannot be before the start.',
    allDone: 'All steps completed: create a new step or mark it as implemented.',
    implement: 'Mark as implemented',
    result: 'Result achieved',
    needResult: 'Describe the result achieved before closing it.',
    confirm: 'Confirm',
    history: 'Deadline history',
    moved: (a: string, b: string) => `Deadline changed from ${a} to ${b}`,
    implemented: 'Idea implemented. It becomes read-only, and the author is notified.',
  },
} satisfies Record<Lang, unknown>;

const START: Record<Lang, Step[]> = {
  'pt-BR': [
    { name: 'Desenhar o gabarito', startDate: '2026-11-10', dueDate: '2026-11-14', done: true },
    { name: 'Fabricar e testar na prensa', startDate: '2026-11-15', dueDate: '2026-11-19', done: false },
  ],
  en: [
    { name: 'Design the jig', startDate: '2026-11-10', dueDate: '2026-11-14', done: true },
    { name: 'Build and test it on the press', startDate: '2026-11-15', dueDate: '2026-11-19', done: false },
  ],
};

/** Simulador de etapas: sequência, prazo, atraso, progresso e o encerramento guiado. */
export function Etapas() {
  const lang = useLang();
  const t = TEXT[lang];
  const [steps, setSteps] = useState<Step[]>(START[lang]);
  const [status, setStatus] = useState<Status>('in_progress');
  const [moves, setMoves] = useState<[string, string][]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', startDate: TODAY, dueDate: '' });
  const [draftError, setDraftError] = useState<'name' | 'dates' | 'due' | null>(null);
  const [closing, setClosing] = useState(false);
  const [result, setResult] = useState('');
  const [resultError, setResultError] = useState(false);

  const deadline = ideaDeadline(steps);
  const late = isLate(status, steps, TODAY);
  const doneCount = steps.filter((s) => s.done).length;
  const pct = status === 'implemented' ? 100 : progressBySteps(steps);
  const allDone = status === 'in_progress' && steps.length > 0 && canAddStep(steps);

  const create = () => {
    if (!draft.name.trim()) return setDraftError('name');
    if (!draft.dueDate) return setDraftError('due');
    if (!validStepDates(draft.startDate, draft.dueDate)) return setDraftError('dates');
    const before = deadline;
    setSteps((s) => [...s, { ...draft, name: draft.name.trim(), done: false }]);
    if (before && before !== draft.dueDate) setMoves((m) => [...m, [before, draft.dueDate]]);
    setAdding(false);
    setDraft({ name: '', startDate: TODAY, dueDate: '' });
    setDraftError(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-xs text-muted-foreground">ITS-2026-0007</span>
        <span className="font-semibold">{t.idea}</span>
        <span className="flex gap-1.5" aria-live="polite">
          <Situacao s={status} />
          {late && <Situacao s="late" />}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{t.today(formatDay(TODAY, lang))}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-sm text-muted-foreground">
            {t.deadline} <Regra id="RN-17" />
          </p>
          <p className="font-num font-semibold">{deadline ? formatDay(deadline, lang) : '—'}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">
            {t.progress} <Regra id="RN-19" />
          </p>
          <div className="mt-1 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <span className="font-num text-sm font-medium">{pct}%</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t.stepsDone(doneCount, steps.length)}</p>
        </div>
      </div>

      <ol className="divide-y border-y">
        {steps.map((s, i) => {
          const stepLate = !s.done && status === 'in_progress' && s.dueDate < TODAY;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: as etapas só crescem, na ordem (RN-14)
            <li key={i} className="flex flex-wrap items-center gap-3 p-3">
              {s.done ? (
                <Check aria-hidden="true" className="size-4 text-(--st-done)" />
              ) : (
                <CircleDot aria-hidden="true" className="size-4 text-primary" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {i + 1}. {s.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {s.done ? t.done : t.open} · {t.due}: <span className="font-num">{formatDay(s.dueDate, lang)}</span>
                </span>
              </span>
              {stepLate && <Situacao s="late" />}
              {!s.done && status === 'in_progress' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSteps((all) => all.map((x, j) => (j === i ? { ...x, done: true } : x)))}
                >
                  {t.complete}
                </Button>
              )}
            </li>
          );
        })}
      </ol>

      {status === 'in_progress' && (
        <div className="space-y-3">
          {allDone && (
            <p role="status" className="rounded-lg bg-muted/50 p-3 text-sm font-medium">
              {t.allDone} <Regra id="RN-20" />
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!canAddStep(steps)} onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              {t.add}
            </Button>
            {allDone && (
              <Button size="sm" onClick={() => setClosing(true)} aria-expanded={closing}>
                {t.implement}
              </Button>
            )}
            {!canAddStep(steps) && (
              <span className="text-xs text-muted-foreground">
                {t.addBlocked} <Regra id="RN-12" />
              </span>
            )}
          </div>

          {adding && (
            <form
              noValidate
              className="grid gap-3 rounded-lg bg-muted/50 p-4 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <Field label={t.name} error={draftError === 'name' ? t.required : undefined} className="sm:col-span-3">
                <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </Field>
              <Field label={t.start}>
                <Input
                  type="date"
                  value={draft.startDate}
                  onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
                />
              </Field>
              <Field
                label={t.dueLabel}
                error={draftError === 'due' ? t.required : draftError === 'dates' ? t.badDates : undefined}
              >
                <Input
                  type="date"
                  value={draft.dueDate}
                  onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
                />
              </Field>
              <div className="flex items-end gap-2">
                <Button type="submit" size="sm">
                  {t.save}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  {t.cancel}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-3">
                <Regra id="RN-16" />
              </p>
            </form>
          )}

          {closing && (
            <form
              className="space-y-2 rounded-lg bg-muted/50 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!result.trim()) return setResultError(true);
                setStatus('implemented');
                setClosing(false);
              }}
            >
              <Field label={t.result} error={resultError ? t.needResult : undefined}>
                <Textarea rows={2} value={result} onChange={(e) => setResult(e.target.value)} />
              </Field>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm">
                  {t.confirm}
                </Button>
                <Regra id="RN-07" />
              </div>
            </form>
          )}
        </div>
      )}

      {status === 'implemented' && (
        <p role="status" className="text-sm font-medium">
          {t.implemented}
        </p>
      )}

      {moves.length > 0 && (
        <div>
          <p className="text-sm font-medium">{t.history}</p>
          <ul className="mt-1 space-y-1 border-l pl-4 text-sm text-muted-foreground">
            {moves.map(([a, b]) => (
              <li key={`${a}-${b}`}>{t.moved(formatDay(a, lang), formatDay(b, lang))}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
