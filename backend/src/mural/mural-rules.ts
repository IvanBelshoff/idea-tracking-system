import { IdeaStatus } from '../ideas/entities/idea.entity.js';

/**
 * Regras puras do mural (M21, RN-148 a RN-158), sem banco, para testar sem infraestrutura.
 */

/** As 5 reações fixas (RN-152), na ordem em que aparecem. */
export const MURAL_REACTIONS = ['like', 'congrats', 'support', 'brilliant', 'inspiring'] as const;
export type MuralReaction = (typeof MURAL_REACTIONS)[number];

/** Motivos de denúncia (RN-154). */
export const REPORT_REASONS = ['offensive', 'personal_data', 'off_topic', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Só Em andamento e Implementada vão ao mural (RN-149). */
export function isPublishable(status: IdeaStatus): boolean {
  return status === IdeaStatus.InProgress || status === IdeaStatus.Implemented;
}

/** Motivos gravados na retirada automática (RN-149); a tela traduz. */
export type AutoWithdrawCause = 'idea_rejected' | 'idea_archived';

/**
 * Evento do histórico da ideia → retirada automática do mural (RN-149). Interromper (vai para Não
 * autorizada) e arquivar retiram; implementar e reabrir mantêm. Excluir apaga a publicação junto (FK).
 */
export function autoWithdrawCause(type: string, data: Record<string, unknown>): AutoWithdrawCause | null {
  if (type === 'status_changed' && data.to === IdeaStatus.Rejected) return 'idea_rejected';
  if (type === 'archived') return 'idea_archived';
  return null;
}

/** Nome mostrado no mural só com aceite, sem opt-out (RN-70) e de pessoa ativa (RN-151). */
export function muralShowsName(
  consent: 'pending' | 'accepted' | 'declined' | null,
  person: { hideName: boolean; active: boolean },
): boolean {
  return consent === 'accepted' && !person.hideName && person.active;
}
