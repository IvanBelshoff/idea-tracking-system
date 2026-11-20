'use client';

import { GitMerge, Undo2, Users } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Regra, Situacao } from '../components/doc-parts';
import { useLang } from '../components/use-lang';
import type { Lang } from '../i18n';
import { canBeConverged, formatDay, principalOf, type Status } from './regras';

const TEXT = {
  'pt-BR': {
    queue: 'Fila de triagem',
    pickTwo: 'Marque as duas ideias que pedem a mesma coisa.',
    select: (code: string) => `Selecionar ${code}`,
    by: 'por',
    on: 'enviada em',
    cannot: 'Em andamento não pode ser convergida: já tem execução, e o trabalho se perderia.',
    preview: (main: string, other: string) =>
      `${main} é a mais antiga e fica como principal; ${other} passa a ser convergida.`,
    reason: 'Justificativa (fica no histórico)',
    merge: 'Juntar as duas',
    needReason: 'A convergência pelo analista exige justificativa.',
    asked: (n: number) => `${n} pessoas pediram isso`,
    coauthor: (name: string) => `${name} agora é co-autor (o texto original fica guardado).`,
    convergedWith: (code: string) =>
      `Convergida com ${code}: não aparece mais como ideia separada na fila nem nos indicadores.`,
    undo: 'Desfazer a convergência',
    undone: 'Convergência desfeita: a ideia voltou a ter fluxo próprio, com a data de envio original.',
  },
  en: {
    queue: 'Triage queue',
    pickTwo: 'Tick the two ideas that ask for the same thing.',
    select: (code: string) => `Select ${code}`,
    by: 'by',
    on: 'submitted on',
    cannot: 'In progress cannot be merged: it already has work underway, which would be lost.',
    preview: (main: string, other: string) =>
      `${main} is the oldest and stays as the main idea; ${other} becomes merged.`,
    reason: 'Justification (kept in the history)',
    merge: 'Merge the two',
    needReason: 'A merge by the analyst requires a justification.',
    asked: (n: number) => `${n} people asked for this`,
    coauthor: (name: string) => `${name} is now a co-author (their original text is kept).`,
    convergedWith: (code: string) =>
      `Merged into ${code}: it no longer shows up as a separate idea in the queue or the indicators.`,
    undo: 'Undo the merge',
    undone: 'Merge undone: the idea has its own flow again, with its original submission date.',
  },
} satisfies Record<Lang, unknown>;

interface Idea {
  code: string;
  status: Status;
  submitted: string;
  author: string;
  title: Record<Lang, string>;
}
const IDEAS: Idea[] = [
  {
    code: 'ITS-2026-0040',
    status: 'submitted',
    submitted: '2026-11-18',
    author: 'Davi Rocha',
    title: { 'pt-BR': 'Etiqueta que não descola no frio', en: 'A label that does not peel off in the cold' },
  },
  {
    code: 'ITS-2026-0012',
    status: 'in_review',
    submitted: '2026-10-02',
    author: 'Bia Costa',
    title: {
      'pt-BR': 'Etiquetas resistentes à umidade nas câmaras frias',
      en: 'Moisture-proof labels in the cold rooms',
    },
  },
  {
    code: 'ITS-2026-0007',
    status: 'in_progress',
    submitted: '2026-09-21',
    author: 'Carla Dias',
    title: { 'pt-BR': 'Gabarito de regulagem na prensa 3', en: 'Setup jig on press 3' },
  },
];

/** Simulador da convergência: a mais antiga vira a principal, a outra entra como co-autoria. */
export function Convergencia() {
  const lang = useLang();
  const t = TEXT[lang];
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  const [merged, setMerged] = useState<{ main: Idea; other: Idea } | null>(null);
  const [undone, setUndone] = useState(false);
  const fieldId = useId();

  const chosen = IDEAS.filter((i) => picked.includes(i.code));
  const blocked = chosen.find((i) => !canBeConverged(i.status));
  const pair = chosen.length === 2 && !blocked ? principalOf(chosen[0] as Idea, chosen[1] as Idea) : null;
  const toggle = (code: string, on: boolean) => {
    setUndone(false);
    setPicked((p) => (on ? [...p, code].slice(-2) : p.filter((c) => c !== code)));
  };

  if (merged) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium">{t.queue}</p>
        <ul className="divide-y border-y">
          {IDEAS.filter((i) => i.code !== merged.other.code).map((i) => (
            <li key={i.code} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{i.code}</span>
                <Situacao s={i.status} />
              </div>
              <p className="mt-1 font-medium">{i.title[lang]}</p>
              {i.code === merged.main.code && (
                <div className="mt-2 space-y-1 text-sm">
                  <p className="flex items-center gap-1.5 font-medium">
                    <Users aria-hidden="true" className="size-4" />
                    {t.asked(2)} <Regra id="RN-87" />
                  </p>
                  <p className="text-muted-foreground">
                    {t.coauthor(merged.other.author)} <Regra id="RN-86" />
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="rounded-lg bg-muted/50 p-3 text-sm">
          <span className="font-mono text-xs">{merged.other.code}</span> · {t.convergedWith(merged.main.code)}{' '}
          <Regra id="RN-84" />
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setMerged(null);
            setPicked([]);
            setReason('');
            setUndone(true);
          }}
        >
          <Undo2 aria-hidden="true" />
          {t.undo}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {undone && (
        <p role="status" className="text-sm font-medium">
          {t.undone} <Regra id="RN-88" />
        </p>
      )}
      <p className="text-sm">{t.pickTwo}</p>
      <ul className="divide-y border-y">
        {IDEAS.map((i) => (
          <li key={i.code} className="flex items-start gap-3 p-3">
            <Checkbox
              className="mt-1"
              checked={picked.includes(i.code)}
              onCheckedChange={(v) => toggle(i.code, v === true)}
              aria-label={t.select(i.code)}
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{i.code}</span>
                <Situacao s={i.status} />
              </span>
              <span className="mt-0.5 block font-medium">{i.title[lang]}</span>
              <span className="block text-xs text-muted-foreground">
                {t.by} {i.author} · {t.on} <span className="font-num">{formatDay(i.submitted, lang)}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>

      {blocked && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t.cannot} <Regra id="RN-84" />
        </p>
      )}
      {pair && (
        <form
          className="space-y-3 rounded-lg bg-muted/50 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return setError(true);
            setMerged({ main: pair[0], other: pair[1] });
          }}
        >
          <p className="flex items-start gap-2 text-sm font-medium">
            <GitMerge aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              {t.preview(pair[0].code, pair[1].code)} <Regra id="RN-84" />
            </span>
          </p>
          <label htmlFor={fieldId} className="block text-sm font-medium">
            {t.reason} <Regra id="RN-85" />
          </label>
          <Textarea
            id={fieldId}
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
          <Button type="submit" size="sm">
            {t.merge}
          </Button>
        </form>
      )}
    </div>
  );
}
