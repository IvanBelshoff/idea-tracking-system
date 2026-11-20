'use client';

import { Check, CircleDot } from 'lucide-react';
import { useId, useState } from 'react';
import { NativeSelect } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Regra, Situacao } from '../components/doc-parts';
import { useLang, useMessages } from '../components/use-lang';
import type { Lang } from '../i18n';
import {
  ACTION_META,
  type Action,
  type ApplyError,
  apply,
  availableActions,
  INITIAL,
  isClosed,
  type SimState,
  STATUSES,
} from './ciclo-de-vida.logic';

const TEXT: Record<
  Lang,
  {
    idea: string;
    path: string;
    actions: string;
    closedNote: string;
    who: Record<'analyst' | 'admin', string>;
    verb: Record<Action, string>;
    done: Record<Action, string>;
    input: { reason: string; responsible: string; result: string };
    pick: string;
    confirm: string;
    cancel: string;
    errors: Record<ApplyError, string>;
    timeline: string;
    submitted: string;
    people: string[];
  }
> = {
  'pt-BR': {
    idea: 'Gabarito de regulagem na prensa 3',
    path: 'Caminho da ideia',
    actions: 'O que pode acontecer agora',
    closedNote:
      'Ideia encerrada: fica só para leitura. Comentar ainda pode; para mudar a situação, só reabrindo, e isso é com o administrador.',
    who: { analyst: 'analista', admin: 'administrador' },
    verb: {
      start_review: 'Assumir a análise',
      approve: 'Aprovar',
      reject: 'Não autorizar',
      interrupt: 'Interromper',
      implement: 'Marcar como implementada',
      reopen: 'Reabrir',
    },
    done: {
      start_review: 'O analista assumiu a análise',
      approve: 'Aprovada, com a primeira etapa',
      reject: 'Não autorizada',
      interrupt: 'Interrompida',
      implement: 'Implementada',
      reopen: 'Reaberta pelo administrador',
    },
    input: {
      reason: 'Justificativa (o autor recebe este texto)',
      responsible: 'Responsável pela primeira etapa',
      result: 'Resultado obtido',
    },
    pick: 'Escolha alguém',
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    errors: {
      invalid: 'Essa ação não vale nesta situação.',
      needs_reason: 'Sem justificativa não dá: quem enviou a ideia merece saber o porquê.',
      needs_responsible: 'Toda etapa precisa de um responsável. Escolha alguém.',
      needs_result: 'Conte o resultado obtido antes de encerrar como implementada.',
    },
    timeline: 'Linha do tempo',
    submitted: 'Carla enviou a ideia',
    people: ['Bruno Lima', 'Davi Rocha', 'Ana Souza'],
  },
  en: {
    idea: 'Setup jig on press 3',
    path: 'The idea’s path',
    actions: 'What can happen now',
    closedNote:
      'Closed idea: it is now read-only. Comments are still allowed; changing the status means reopening it, which is up to the administrator.',
    who: { analyst: 'analyst', admin: 'administrator' },
    verb: {
      start_review: 'Take the review',
      approve: 'Approve',
      reject: 'Do not approve',
      interrupt: 'Interrupt',
      implement: 'Mark as implemented',
      reopen: 'Reopen',
    },
    done: {
      start_review: 'The analyst took on the review',
      approve: 'Approved, with the first step',
      reject: 'Not approved',
      interrupt: 'Interrupted',
      implement: 'Implemented',
      reopen: 'Reopened by the administrator',
    },
    input: {
      reason: 'Justification (the author receives this text)',
      responsible: 'Responsible for the first step',
      result: 'Result achieved',
    },
    pick: 'Choose someone',
    confirm: 'Confirm',
    cancel: 'Cancel',
    errors: {
      invalid: 'That action does not apply to this status.',
      needs_reason: 'A justification is required: whoever submitted the idea deserves to know why.',
      needs_responsible: 'Every step needs someone responsible. Choose a person.',
      needs_result: 'Describe the result achieved before closing it as implemented.',
    },
    timeline: 'Timeline',
    submitted: 'Carla submitted the idea',
    people: ['Bruno Lima', 'Davi Rocha', 'Ana Souza'],
  },
};

/** Simulador do ciclo de vida: a pessoa conduz uma ideia fictícia pelas situações do ITS. */
export function CicloDeVida() {
  const lang = useLang();
  const t = TEXT[lang];
  const status = useMessages().status;
  const [state, setState] = useState<SimState>(INITIAL);
  const [pending, setPending] = useState<Action | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<ApplyError | null>(null);
  const fieldId = useId();
  const visited = new Set([INITIAL.status, ...state.history.map((h) => h.to)]);

  const run = (action: Action, value = '') => {
    const result = apply(state, action, value);
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    setState(result);
    setPending(null);
    setInput('');
    setError(null);
  };
  const choose = (action: Action) => {
    setError(null);
    setInput('');
    if (ACTION_META[action].needs) setPending(action);
    else run(action);
  };
  const needs = pending ? ACTION_META[pending].needs : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-xs text-muted-foreground">ITS-2026-0042</span>
        <span className="font-semibold">{t.idea}</span>
        <span aria-live="polite">
          <Situacao s={state.status} size="lg" />
        </span>
      </div>

      <div>
        <p className="text-sm font-medium">{t.path}</p>
        <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {STATUSES.map((s) => {
            const current = s === state.status;
            const seen = visited.has(s);
            return (
              <li
                key={s}
                aria-current={current ? 'step' : undefined}
                className={`flex items-center gap-1.5 ${current ? 'font-semibold' : seen ? '' : 'text-muted-foreground'}`}
              >
                {current ? (
                  <CircleDot aria-hidden="true" className="size-4 text-primary" />
                ) : seen ? (
                  <Check aria-hidden="true" className="size-4 text-primary" />
                ) : (
                  <span aria-hidden="true" className="size-4 rounded-full border" />
                )}
                {status[s]}
              </li>
            );
          })}
        </ol>
      </div>

      <div>
        <p className="text-sm font-medium">{t.actions}</p>
        {isClosed(state.status) && <p className="mt-1 text-sm text-muted-foreground">{t.closedNote}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {availableActions(state.status).map((action) => (
            <Button
              key={action}
              variant={pending === action ? 'default' : 'outline'}
              size="sm"
              aria-expanded={ACTION_META[action].needs ? pending === action : undefined}
              onClick={() => choose(action)}
            >
              {t.verb[action]}
              <span className="font-normal">· {t.who[ACTION_META[action].who]}</span>
            </Button>
          ))}
        </div>

        {pending && needs && (
          <form
            className="mt-4 space-y-3 rounded-lg bg-muted/50 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(pending, input);
            }}
          >
            <label htmlFor={fieldId} className="block text-sm font-medium">
              {t.input[needs]} <Regra id={ACTION_META[pending].rule} />
            </label>
            {needs === 'responsible' ? (
              <NativeSelect
                id={fieldId}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-invalid={error ? true : undefined}
                className="max-w-xs"
              >
                <option value="">{t.pick}</option>
                {t.people.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </NativeSelect>
            ) : (
              <Textarea
                id={fieldId}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
            )}
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {t.errors[error]}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                {t.confirm}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPending(null)}>
                {t.cancel}
              </Button>
            </div>
          </form>
        )}
      </div>

      <div>
        <p className="text-sm font-medium">{t.timeline}</p>
        <ol className="mt-2 space-y-2 border-l pl-4 text-sm">
          <li>{t.submitted}</li>
          {state.history.map((h, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a linha do tempo só cresce, nunca reordena
            <li key={i}>
              <span className="font-medium">{t.done[h.action]}</span>{' '}
              <span className="text-muted-foreground">
                ({status[h.from]} → {status[h.to]})
              </span>
              {h.note && <span className="block text-muted-foreground">“{h.note}”</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
