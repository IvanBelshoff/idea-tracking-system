import type { FinancialGain, Measurement } from './entities/result.entity.js';
import { GainStatus } from './entities/result.entity.js';
import type { GainView, MeasurementView } from './ideas.dto.js';
import { annualize, attainment, roi, variation } from './results-rules.js';

export function measurementView(m: Measurement | null): MeasurementView | null {
  if (!m) return null;
  const v = variation(m.baseline, m.achieved);
  return {
    indicator: m.indicator,
    unit: m.unit,
    direction: m.direction,
    baseline: m.baseline,
    target: m.target,
    achieved: m.achieved,
    attainment: attainment(m),
    variation: v?.absolute ?? null,
    variationPercent: v?.percent ?? null,
  };
}

export function gainView(g: FinancialGain | null): GainView | null {
  if (!g) return null;
  const annual = g.realized === null ? null : annualize(g.realized, g.periodicity);
  const validated = g.status === GainStatus.Validated;
  return {
    currency: g.currency,
    periodicity: g.periodicity,
    estimated: g.estimated,
    realized: g.realized,
    implementationCost: g.implementationCost,
    annualizedRealized: annual,
    roi: roi(validated ? annual : null, g.implementationCost),
    status: g.status,
    validatedBy: g.validatedBy ? { id: g.validatedBy.id, name: g.validatedBy.name } : null,
    validatedAt: g.validatedAt?.toISOString() ?? null,
  };
}
