import { Check, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { formatDate, type Idea, TODAY } from './data';
import { StatusBadge, statusVar } from './status';

// A jornada da ideia: o autor sempre vê em que pé está e qual é o próximo passo.
// Fases do ciclo (envio, análise, implementação) intercaladas com as etapas de execução.

type State = 'done' | 'current' | 'future' | 'rejected';

interface Station {
  id: string;
  kind: 'phase' | 'step';
  label: string;
  position?: number;
  who?: string;
  when?: string;
  fields?: [string, string][];
  state: State;
  late?: boolean;
}

function buildStations(idea: Idea): Station[] {
  const s = idea.status;
  const analysisDone = s === 'in_progress' || s === 'implemented';
  const stations: Station[] = [
    { id: 'sent', kind: 'phase', label: 'Ideia enviada', when: formatDate(idea.submittedAt), state: 'done' },
    {
      id: 'review',
      kind: 'phase',
      label: s === 'rejected' ? 'Não autorizada' : analysisDone ? 'Aprovada' : 'Análise da equipe',
      who: idea.assignedTo,
      when:
        s === 'rejected'
          ? 'Análise concluída'
          : !analysisDone && idea.slaDueAt
            ? `Retorno até ${formatDate(idea.slaDueAt)}`
            : undefined,
      state: s === 'rejected' ? 'rejected' : analysisDone ? 'done' : s === 'in_review' ? 'current' : 'future',
      late: !analysisDone && s !== 'rejected' && !!idea.slaDueAt && idea.slaDueAt < TODAY,
    },
  ];
  if (s === 'rejected') return stations;

  let currentTaken = false;
  for (const step of idea.steps) {
    const done = !!step.completedAt;
    const state: State = done ? 'done' : currentTaken ? 'future' : 'current';
    if (!done) currentTaken = true;
    stations.push({
      id: `step-${step.position}`,
      kind: 'step',
      position: step.position,
      label: step.name,
      who: step.assignee,
      when: done ? `Concluída em ${formatDate(step.completedAt as string)}` : `Previsão ${formatDate(step.dueDate)}`,
      fields: [
        ['Responsável', step.assignee],
        ['Início', formatDate(step.startDate)],
        ['Previsão', formatDate(step.dueDate)],
        ['Conclusão', step.completedAt ? formatDate(step.completedAt) : '—'],
      ],
      state,
      late: !done && step.dueDate < TODAY,
    });
  }
  if (idea.steps.length === 0 && s !== 'implemented') {
    stations.push({
      id: 'exec',
      kind: 'phase',
      label: 'Execução em etapas',
      when: 'As etapas são criadas na aprovação',
      state: 'future',
    });
  }
  const last = idea.steps.at(-1);
  stations.push({
    id: 'done',
    kind: 'phase',
    label: 'Implementada',
    when: s === 'implemented' && last?.completedAt ? formatDate(last.completedAt) : undefined,
    state: s === 'implemented' ? 'done' : 'future',
  });
  return stations;
}

/** publicView: consulta sem login (RN-35) – sem nomes de pessoas. */
export function Journey({ idea, publicView = false }: { idea: Idea; publicView?: boolean }) {
  const stations = buildStations(idea).map((st) =>
    publicView ? { ...st, who: undefined, fields: st.fields?.filter(([k]) => k !== 'Responsável') } : st,
  );
  const lineStyle = {
    '--line': statusVar(idea.status, '-fill'),
    '--line-ink': statusVar(idea.status),
  } as CSSProperties;
  return <StepperJourney stations={stations} style={lineStyle} />;
}

type JourneyProps = { stations: Station[]; style: CSSProperties };

/* Stepper vertical: concluída = marca preenchida, atual = anel, futura = contorno. */
function StepperJourney({ stations, style }: JourneyProps) {
  return (
    <ol style={style} aria-label="Jornada da ideia">
      {stations.map((st, i) => {
        const next = stations[i + 1];
        return (
          <li key={st.id} className="grid grid-cols-[1.5rem_1fr] gap-x-3">
            <div className="relative flex justify-center">
              {next && <span aria-hidden="true" className="absolute top-6 bottom-0.5 w-px bg-border" />}
              {st.state === 'done' && (
                <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check aria-hidden="true" className="size-3" strokeWidth={3} />
                </span>
              )}
              {st.state === 'rejected' && (
                <span className="grid size-5 place-items-center rounded-full bg-(--st-rejected) text-(--st-on)">
                  <X aria-hidden="true" className="size-3" strokeWidth={3} />
                </span>
              )}
              {st.state === 'current' && (
                <span className="grid size-5 place-items-center rounded-full border-2 border-primary bg-card">
                  <span className="size-2 rounded-full bg-primary" />
                </span>
              )}
              {st.state === 'future' && <span className="size-5 rounded-full border-2 border-border bg-card" />}
            </div>
            <div className={`min-w-0 ${next ? 'pb-5' : ''}`}>
              <p
                className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.95rem] leading-snug font-medium ${st.state === 'future' ? 'text-muted-foreground' : ''}`}
              >
                {st.position ? `${st.position}. ${st.label}` : st.label}
                {st.state === 'current' && (
                  <span className="rounded-full border border-primary/40 px-2 py-px text-xs font-medium text-primary">
                    Etapa atual
                  </span>
                )}
                {st.late && <StatusBadge status="late" />}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{[st.who, st.when].filter(Boolean).join(' · ')}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────────── Versão compacta (celular): só as 4 fases ───────────── */

const PHASES = ['Enviada', 'Análise', 'Execução', 'Implementada'];

function phaseIndex(idea: Idea) {
  return { submitted: 0, in_review: 1, in_progress: 2, implemented: 3, rejected: 1 }[idea.status];
}

export function JourneyMini({ idea }: { idea: Idea }) {
  const at = phaseIndex(idea);
  const rejected = idea.status === 'rejected';
  const done = idea.status === 'implemented';
  const stateOf = (i: number): State =>
    rejected && i === at ? 'rejected' : i < at || (done && i === at) ? 'done' : i === at ? 'current' : 'future';
  const label = `Fase atual: ${rejected ? 'não autorizada na análise' : PHASES[at]}`;

  return (
    <div role="img" aria-label={label}>
      <div className="flex gap-1">
        {PHASES.map((p, i) => {
          const st = stateOf(i);
          return (
            <span
              key={p}
              className={`h-1.5 flex-1 rounded-full ${st === 'done' && done ? 'bg-(--st-done)' : st === 'done' ? 'bg-primary' : st === 'current' ? 'bg-primary/45' : st === 'rejected' ? 'bg-(--st-rejected)' : 'bg-muted'}`}
            />
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {rejected ? 'Encerrada na análise' : `${PHASES[at]} · fase ${at + 1} de 4`}
      </p>
    </div>
  );
}
