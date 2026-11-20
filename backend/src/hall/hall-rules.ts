import { IdeaStatus } from '../ideas/entities/idea.entity.js';
import type { ConsentStatus } from './entities.js';

/**
 * Pode ser destaque (CA-RN-73.1)? Implementada sim; Em andamento só com a opção ligada; Não
 * autorizada nunca. (Convergida é tratada antes: destaca-se a principal.)
 */
export function eligibility(status: IdeaStatus, allowInProgress: boolean): 'ok' | 'rejected' | 'not_ready' {
  if (status === IdeaStatus.Implemented) return 'ok';
  if (status === IdeaStatus.Rejected) return 'rejected';
  if (status === IdeaStatus.InProgress && allowInProgress) return 'ok';
  return 'not_ready';
}

/**
 * O nome aparece no Hall (RN-74, RN-70)? Só com o aceite da própria pessoa e sem o opt-out de nome.
 * Sem resposta vale o padrão da instalação: aparecer sem nome (CA-RN-74.1).
 */
export function showsName(consent: ConsentStatus, hideName: boolean, anonymized: boolean): boolean {
  return consent === 'accepted' && !hideName && !anonymized;
}

/** Candidata automática (RN-72b): ganho validado ou curtidas acima do configurado (0 = critério desligado). */
export function candidateReason(
  stats: { validatedAnnual: number | null; likes: number },
  criteria: { minGain: number; minLikes: number },
): 'gain' | 'likes' | null {
  if (criteria.minGain > 0 && stats.validatedAnnual !== null && stats.validatedAnnual >= criteria.minGain)
    return 'gain';
  if (criteria.minLikes > 0 && stats.likes >= criteria.minLikes) return 'likes';
  return null;
}
