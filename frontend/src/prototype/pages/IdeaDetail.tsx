import { Link, useParams } from '@tanstack/react-router';
import { Check, ChevronLeft, CircleCheck, Lock, MessageSquare, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { deadlineOf, findIdea, formatDate, IDEAS, isLate, progressOf } from '../data';
import { Journey } from '../journey';
import { CategoryTag, IdCode, LateBadge, StatusBadge } from '../status';

const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2);

export function IdeaDetail() {
  const { code } = useParams({ from: '/prototipo/moldura/ideias/$code' });
  const idea = findIdea(code ?? '') ?? IDEAS[0];
  const [internal, setInternal] = useState(false);
  if (!idea) return null;
  const deadline = deadlineOf(idea);
  const closed = idea.status === 'implemented' || idea.status === 'rejected';
  const openStep = idea.steps.some((s) => !s.completedAt);
  const currentStep = idea.steps.find((s) => !s.completedAt);
  const publicComments = idea.comments.length;

  return (
    <div className="mx-auto max-w-[78rem]">
      <Link
        to="/prototipo/fila"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Fila de ideias
      </Link>

      <header className="mt-3 border-b pb-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <IdCode code={idea.code} size="lg" />
          <StatusBadge status={idea.status} size="lg" />
          {isLate(idea) && <LateBadge size="lg" />}
        </div>
        <h1 className="mt-3 max-w-[40ch] text-[2rem] leading-[1.15] font-bold">{idea.title}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <CategoryTag name={idea.category} />
          <span>{idea.entity}</span>
          <span>Enviada em {formatDate(idea.submittedAt)}</span>
        </p>
      </header>

      <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-10">
          {idea.status === 'rejected' && idea.rejectionReason && (
            <section
              aria-labelledby="reason"
              className="rounded-md bg-[color-mix(in_oklch,var(--st-rejected)_9%,transparent)] px-4 py-3"
            >
              <h2 id="reason" className="font-semibold text-(--st-rejected)">
                Por que não foi autorizada
              </h2>
              <p className="mt-1 max-w-[65ch]">{idea.rejectionReason}</p>
            </section>
          )}
          {idea.status === 'implemented' && idea.result && (
            <section
              aria-labelledby="result"
              className="rounded-md bg-[color-mix(in_oklch,var(--st-done)_9%,transparent)] px-4 py-3"
            >
              <h2 id="result" className="font-semibold text-(--st-done)">
                Resultado
              </h2>
              <p className="mt-1 max-w-[65ch]">{idea.result}</p>
            </section>
          )}

          <section className="grid gap-6 sm:grid-cols-2">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground">Situação atual</h2>
              <p className="mt-1.5 max-w-[60ch]">{idea.description}</p>
            </div>
            {idea.proposedSolution && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground">Solução proposta</h2>
                <p className="mt-1.5 max-w-[60ch]">{idea.proposedSolution}</p>
              </div>
            )}
          </section>

          <section aria-labelledby="journey-title">
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="journey-title" className="text-xl font-bold">
                Jornada
              </h2>
              {idea.steps.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-num font-semibold text-foreground">{progressOf(idea)}%</span> das etapas
                  concluídas
                  {deadline && (
                    <>
                      {' · prazo '}
                      <span className="font-num font-semibold text-foreground">{formatDate(deadline)}</span>
                    </>
                  )}
                </p>
              )}
            </div>
            <Journey idea={idea} />
            {!closed && idea.steps.length > 0 && (
              <Button variant="outline" className="mt-4" disabled={openStep}>
                Nova etapa
              </Button>
            )}
            {!closed && openStep && (
              <p className="mt-2 text-xs text-muted-foreground">
                Uma nova etapa só pode ser criada depois que a atual for concluída.
              </p>
            )}
          </section>

          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">Comentários ({publicComments})</TabsTrigger>
              <TabsTrigger value="timeline">Histórico</TabsTrigger>
            </TabsList>

            <TabsContent value="comments" className="space-y-5 pt-4">
              {idea.comments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhum comentário ainda. Um retorno curto já faz o autor saber que foi ouvido.
                </p>
              )}
              {idea.comments.map((c) => (
                <div key={`${c.at}-${c.body}`} className="flex gap-3">
                  <Avatar>
                    <AvatarFallback>{initials(c.author)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                      {c.author}
                      <span className="font-num text-xs font-normal text-muted-foreground">{formatDate(c.at)}</span>
                      {c.internal && (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium">
                          <Lock aria-hidden="true" className="size-3" />
                          Interno · o autor não vê
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 max-w-[65ch]">{c.body}</p>
                  </div>
                </div>
              ))}
              <div className="space-y-2 border-t pt-5">
                <Label htmlFor="comment">Escrever comentário</Label>
                <Textarea id="comment" rows={3} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Checkbox id="internal" checked={internal} onCheckedChange={(v) => setInternal(v === true)} />
                    <Label htmlFor="internal" className="font-normal">
                      Interno (o autor não vê)
                    </Label>
                  </div>
                  <Button>
                    <MessageSquare aria-hidden="true" />
                    {internal ? 'Comentar só para a equipe' : 'Comentar'}
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="timeline" className="pt-4">
              <ol className="divide-y">
                {idea.timeline.map((e) => (
                  <li key={`${e.at}-${e.text}`} className="grid grid-cols-[6.5rem_1fr] gap-3 py-2.5 text-sm">
                    <span className="font-num text-muted-foreground">{formatDate(e.at)}</span>
                    <span>
                      {e.text} <span className="text-muted-foreground">· {e.actor}</span>
                      {e.internal && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs">
                          <Lock aria-hidden="true" className="size-3" />
                          interno
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-8 lg:sticky lg:top-8 lg:self-start">
          <section aria-labelledby="actions-title">
            <h2 id="actions-title" className="sr-only">
              Ações
            </h2>
            <div className="flex flex-col gap-2">
              {(idea.status === 'submitted' || idea.status === 'in_review') && (
                <>
                  <Button size="lg">
                    <ThumbsUp aria-hidden="true" />
                    Aprovar e criar etapas
                  </Button>
                  <Button size="lg" variant="outline">
                    Convergir com outra ideia
                  </Button>
                  <Button size="lg" variant="destructive">
                    <ThumbsDown aria-hidden="true" />
                    Não autorizar
                  </Button>
                </>
              )}
              {idea.status === 'in_progress' && (
                <>
                  {currentStep && (
                    <Button size="lg">
                      <CircleCheck aria-hidden="true" />
                      Concluir etapa {currentStep.position}
                    </Button>
                  )}
                  <Button size="lg" variant={openStep ? 'outline' : 'default'} disabled={openStep}>
                    <Check aria-hidden="true" />
                    Marcar como implementada
                  </Button>
                  {openStep && (
                    <p className="text-xs text-muted-foreground">Disponível quando todas as etapas forem concluídas.</p>
                  )}
                </>
              )}
              {closed && (
                <Button size="lg" variant="outline">
                  <RotateCcw aria-hidden="true" />
                  Reabrir (administrador)
                </Button>
              )}
            </div>
          </section>

          <section aria-labelledby="people-title" className="border-t pt-5">
            <h2 id="people-title" className="text-sm font-semibold text-muted-foreground">
              Pessoas
            </h2>
            <ul className="mt-3 space-y-3 text-sm">
              <Person label="Enviou a ideia" name={idea.author} />
              {idea.coAuthors.map((n) => (
                <Person key={n} label="Coautor" name={n} />
              ))}
              {idea.assignedTo && <Person label="Analista responsável" name={idea.assignedTo} />}
            </ul>
          </section>

          <section aria-labelledby="dates-title" className="border-t pt-5">
            <h2 id="dates-title" className="text-sm font-semibold text-muted-foreground">
              Datas
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <DateRow label="Enviada" value={formatDate(idea.submittedAt)} />
              {idea.slaDueAt && <DateRow label="Retorno até" value={formatDate(idea.slaDueAt)} />}
              {deadline && <DateRow label="Prazo de execução" value={formatDate(deadline)} />}
              <DateRow label="Apoios" value={String(idea.supporters)} />
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Person({ label, name }: { label: string; name: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <Avatar size="sm">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="leading-tight">
        <p className="font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </li>
  );
}

function DateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-num font-semibold">{value}</dd>
    </div>
  );
}
