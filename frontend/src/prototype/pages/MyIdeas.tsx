import { Link } from '@tanstack/react-router';
import { ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CURRENT_USER, formatDate, IDEAS, type Idea, isLate } from '../data';
import { JourneyMini } from '../journey';
import { CategoryTag, IdCode, LateBadge, StatusBadge } from '../status';

/** O que o autor quer saber: em que pé está e qual o próximo passo (RN-58). */
function nextStepText(idea: Idea) {
  switch (idea.status) {
    case 'submitted':
      return `A equipe ainda vai olhar sua ideia. Retorno até ${idea.slaDueAt ? formatDate(idea.slaDueAt) : '—'}.`;
    case 'in_review':
      return `A equipe está analisando. Retorno até ${idea.slaDueAt ? formatDate(idea.slaDueAt) : '—'}.`;
    case 'in_progress': {
      const open = idea.steps.find((s) => !s.completedAt);
      return open ? `Agora: ${open.name}, previsto para ${formatDate(open.dueDate)}.` : 'Todas as etapas concluídas.';
    }
    case 'implemented':
      return idea.result ?? 'Sua ideia foi implementada.';
    case 'rejected':
      return idea.rejectionReason ?? 'Não autorizada.';
  }
}

export function MyIdeas() {
  const mine = IDEAS.filter((i) => i.author === CURRENT_USER || i.coAuthors.includes(CURRENT_USER));

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-bold">Minhas ideias</h1>
          <p className="mt-1 text-muted-foreground">{mine.length} ideias enviadas ou apoiadas por você</p>
        </div>
        <Button asChild size="lg" className="h-11 sm:h-9">
          <Link to="/prototipo/enviar">
            <Plus aria-hidden="true" />
            Nova ideia
          </Link>
        </Button>
      </div>

      <ul className="mt-6 divide-y rounded-lg border bg-card">
        {mine.map((idea) => (
          <li key={idea.code}>
            <Link
              to="/prototipo/ideias/$code"
              params={{ code: idea.code }}
              className="group block space-y-3 px-4 py-4 transition-colors hover:bg-muted/60 sm:px-5"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <IdCode code={idea.code} />
                <CategoryTag name={idea.category} />
                {idea.author !== CURRENT_USER && <span className="text-sm text-muted-foreground">Você apoiou</span>}
              </div>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[1.05rem] leading-snug font-semibold group-hover:underline">{idea.title}</p>
                <ChevronRight aria-hidden="true" className="mt-1 size-5 shrink-0 text-muted-foreground" />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                <StatusBadge status={idea.status} />
                {isLate(idea) && <LateBadge />}
              </div>
              <JourneyMini idea={idea} />
              <p className="text-sm text-muted-foreground">{nextStepText(idea)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
