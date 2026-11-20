import { IdeaStatus } from './entities/idea.entity.js';

/**
 * Regras puras da convergência e da co-autoria (RN-84 a RN-89, RN-69). Sem banco.
 */

export interface ConvergeCandidate {
  id: string;
  submittedAt: Date;
}

/**
 * A principal é a mais antiga pela data de envio; com datas iguais, a de menor identificador
 * (CA-RN-84.1). Devolve [principal, convergida].
 */
export function principalOf<T extends ConvergeCandidate>(a: T, b: T): [T, T] {
  const ta = a.submittedAt.getTime();
  const tb = b.submittedAt.getTime();
  if (ta !== tb) return ta < tb ? [a, b] : [b, a];
  return a.id < b.id ? [a, b] : [b, a];
}

/**
 * Só ideia ainda sem execução pode perder o fluxo próprio: Enviada ou Em análise. Em andamento já
 * tem etapas (trabalho que se perderia); encerrada não muda mais.
 */
export function canBeConverged(status: IdeaStatus): boolean {
  return status === IdeaStatus.Submitted || status === IdeaStatus.InReview;
}

/**
 * Entrada como co-autor pelo próprio colaborador ("Apoiar"): só enquanto a principal está aberta
 * (CA-RN-86.3). Depois de encerrada, só a equipe adiciona.
 */
export function canSupport(status: IdeaStatus): boolean {
  return status === IdeaStatus.Submitted || status === IdeaStatus.InReview || status === IdeaStatus.InProgress;
}

/** Quantas pessoas pediram a mesma coisa: o autor mais os co-autores (CA-RN-87.2). */
export function requesterCount(coAuthors: number): number {
  return 1 + Math.max(0, coAuthors);
}

/**
 * Divisão de pontos entre autor e co-autores (RN-69, RN-89): o autor fica com `authorSharePct` e o
 * resto é dividido igualmente entre os co-autores. Sem co-autor, tudo vai para o autor. A soma fecha
 * exatamente no total, sem perda no arredondamento (CA-RN-69.2, CA-RN-89.1): as sobras vão, um ponto
 * por vez, para os primeiros co-autores.
 */
export function splitPoints(
  total: number,
  authorSharePct: number,
  coAuthors: number,
): { author: number; coAuthors: number[] } {
  if (coAuthors <= 0) return { author: total, coAuthors: [] };
  const author = Math.round((total * authorSharePct) / 100);
  const rest = total - author;
  const base = Math.floor(rest / coAuthors);
  const extra = rest - base * coAuthors;
  return { author, coAuthors: Array.from({ length: coAuthors }, (_, i) => base + (i < extra ? 1 : 0)) };
}
