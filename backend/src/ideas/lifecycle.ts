import { IdeaStatus } from './entities/idea.entity.js';

/**
 * Ciclo de vida da ideia (§4 das regras). Regras puras: sem banco, sem framework.
 *
 *   Enviada ──assumir──► Em análise ──aprovar──► Em andamento ──implementar──► Implementada
 *      │                     │                        │                           │
 *      └─recusar─► Não autorizada ◄─recusar     ◄─interromper─┘                       │
 *                        │                                                         │
 *                        └──reabrir (admin)──► Em análise    Em andamento ◄──reabrir (admin)
 *
 * O status nunca muda por edição livre (RN-10): só por estas ações. O atalho "aprovar direto de
 * Enviada" (D3) é feito pelo serviço como duas transições (assumir + aprovar), e as duas vão
 * para o histórico (CA-RN-06.3).
 */
export type IdeaAction = 'start_review' | 'approve' | 'reject' | 'interrupt' | 'implement' | 'reopen';

const S = IdeaStatus;

/** Transições permitidas: ação → origem → destino. */
const TRANSITIONS: Record<IdeaAction, Partial<Record<IdeaStatus, IdeaStatus>>> = {
  start_review: { [S.Submitted]: S.InReview },
  approve: { [S.InReview]: S.InProgress },
  /** Recusar na triagem. */
  reject: { [S.Submitted]: S.Rejected, [S.InReview]: S.Rejected },
  /** Interromper uma ideia em andamento (também termina em Não autorizada, com justificativa). */
  interrupt: { [S.InProgress]: S.Rejected },
  implement: { [S.InProgress]: S.Implemented },
  reopen: { [S.Implemented]: S.InProgress, [S.Rejected]: S.InReview },
};

/** Destino da ação a partir do estado atual, ou `null` se a ação não vale nesse estado. */
export function nextStatus(from: IdeaStatus, action: IdeaAction): IdeaStatus | null {
  return TRANSITIONS[action][from] ?? null;
}

/** O par (origem, destino) existe no diagrama? (matriz da CA-RN-10.2) */
export function canTransition(from: IdeaStatus, to: IdeaStatus): boolean {
  return Object.values(TRANSITIONS).some((byFrom) => byFrom[from] === to);
}

/** Encerrada = somente leitura (RN-08); comentar continua permitido (CA-RN-08.2). */
export function isClosed(status: IdeaStatus): boolean {
  return status === S.Implemented || status === S.Rejected;
}

/**
 * Pode implementar? (RN-07) Precisa de ao menos uma etapa, todas concluídas, e do resultado em
 * texto. Devolve o motivo da recusa para a mensagem da API.
 */
export function implementBlocker(
  steps: readonly { completedAt: Date | null }[],
  resultText: string | null | undefined,
): 'no_steps' | 'open_steps' | 'missing_result' | null {
  if (steps.length === 0) return 'no_steps';
  if (steps.some((s) => s.completedAt === null)) return 'open_steps';
  if (!resultText?.trim()) return 'missing_result';
  return null;
}

/** Identificador legível (RN-22): PREFIXO-AAAA-NNNN (mais dígitos se passar de 9999 no ano). */
export function formatIdeaCode(prefix: string, year: number, n: number): string {
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}
