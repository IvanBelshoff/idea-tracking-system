import type { AchievementRuleType, PointEvent } from './entities.js';

/** Evento da ideia → evento que pontua (RN-66). Outros eventos não pontuam. */
export function pointEventFor(type: string, data: Record<string, unknown> | undefined): PointEvent | null {
  if (type === 'created') return 'idea_submitted';
  if (type === 'highlighted') return 'idea_highlighted';
  if (type === 'status_changed' && data?.to === 'in_progress') return 'idea_approved';
  if (type === 'status_changed' && data?.to === 'implemented') return 'idea_implemented';
  return null;
}

export interface LevelLike {
  name: string;
  minPoints: number;
}

/**
 * Nível pela pontuação (CA-RN-67.1): o de maior `minPoints` que a pessoa já alcançou. Devolve o
 * índice na lista ordenada (0 = primeiro) para comparar subida de nível; -1 se nenhum se aplica.
 */
export function levelIndex(points: number, levels: readonly LevelLike[]): number {
  const sorted = [...levels].sort((a, b) => a.minPoints - b.minPoints);
  let index = -1;
  sorted.forEach((l, i) => {
    if (points >= l.minPoints) index = i;
  });
  return index;
}

export function sortedLevels<T extends LevelLike>(levels: readonly T[]): T[] {
  return [...levels].sort((a, b) => a.minPoints - b.minPoints);
}

export interface UserStats {
  ideasSubmitted: number;
  ideasImplemented: number;
  points: number;
}

/** A conquista foi alcançada (RN-68)? Regra simples: contagem ≥ limite. */
export function achievementMet(rule: { ruleType: AchievementRuleType; threshold: number }, stats: UserStats): boolean {
  const value =
    rule.ruleType === 'ideas_submitted'
      ? stats.ideasSubmitted
      : rule.ruleType === 'ideas_implemented'
        ? stats.ideasImplemented
        : stats.points;
  return value >= rule.threshold;
}
