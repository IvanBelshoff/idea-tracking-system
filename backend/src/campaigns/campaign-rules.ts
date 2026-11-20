import { subtreeIds, type TreeNode } from '../organization/tree.js';
import { CampaignStatus, type GoalType } from './entities.js';

/** Estados válidos (CA-RN-50.2): rascunho → ativa → encerrada; encerrada não volta. */
export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return (
    (from === CampaignStatus.Draft && to === CampaignStatus.Active) ||
    (from === CampaignStatus.Active && to === CampaignStatus.Closed)
  );
}

export interface CampaignLike {
  status: CampaignStatus;
  startsOn: string;
  endsOn: string;
  entityIds: readonly string[];
  categoryIds: readonly string[];
}

/**
 * Pode receber esta ideia (CA-RN-51.1)? Ativa, dentro do período (dias no fuso da instalação) e com
 * entidades e categorias-alvo que incluem a ideia. Entidade-alvo vale com as sub-entidades; lista
 * vazia = todas. Campanha com categorias-alvo exige que a ideia tenha uma delas.
 */
export function isEligible(
  c: CampaignLike,
  idea: { entityId: string; categoryId: string | null },
  tree: readonly TreeNode[],
  today: string,
): boolean {
  if (c.status !== CampaignStatus.Active || today < c.startsOn || today > c.endsOn) return false;
  if (c.entityIds.length > 0 && !c.entityIds.some((t) => subtreeIds(t, tree).includes(idea.entityId))) return false;
  if (c.categoryIds.length > 0 && (idea.categoryId === null || !c.categoryIds.includes(idea.categoryId))) return false;
  return true;
}

/**
 * Atingimento da meta (CA-RN-52.1), sem teto (passar da meta mostra mais de 100%): ideias recebidas
 * ou ganho validado ÷ meta. Meta qualitativa não tem percentual.
 */
export function goalProgress(
  goalType: GoalType,
  goalValue: number | null,
  received: number,
  validatedGain: number,
): number | null {
  if (goalType === 'qualitative' || !goalValue) return null;
  return (goalType === 'ideas' ? received : validatedGain) / goalValue;
}
