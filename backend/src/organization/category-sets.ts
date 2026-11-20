/**
 * Conjuntos prontos de categorias (RN-24), importados sob demanda pelo administrador. Os nomes
 * saem no idioma padrão da instalação; importar de novo não duplica (comparação sem diferenciar
 * maiúsculas). Cores escolhidas para ter contraste ≥ 3:1 sobre fundo claro (gráficos, WCAG 1.4.11).
 */
export type CategorySetKey = 'safety_qdcep' | 'generic';

interface CategorySeed {
  color: string;
  name: { 'pt-BR': string; en: string };
}

export const CATEGORY_SETS: Record<CategorySetKey, readonly CategorySeed[]> = {
  /** Segurança + QDCEP: Qualidade, Entrega, Custo, Meio ambiente, Pessoas */
  safety_qdcep: [
    { color: '#c2410c', name: { 'pt-BR': 'Segurança', en: 'Safety' } },
    { color: '#4f46e5', name: { 'pt-BR': 'Qualidade', en: 'Quality' } },
    { color: '#0f766e', name: { 'pt-BR': 'Entrega', en: 'Delivery' } },
    { color: '#a16207', name: { 'pt-BR': 'Custo', en: 'Cost' } },
    { color: '#15803d', name: { 'pt-BR': 'Meio ambiente', en: 'Environment' } },
    { color: '#be185d', name: { 'pt-BR': 'Pessoas', en: 'People' } },
  ],
  /** Genérico: serve para programas de ideias fora da manufatura. */
  generic: [
    { color: '#4f46e5', name: { 'pt-BR': 'Processo', en: 'Process' } },
    { color: '#0369a1', name: { 'pt-BR': 'Cliente', en: 'Customer' } },
    { color: '#a16207', name: { 'pt-BR': 'Custo', en: 'Cost' } },
    { color: '#c2410c', name: { 'pt-BR': 'Segurança', en: 'Safety' } },
    { color: '#15803d', name: { 'pt-BR': 'Sustentabilidade', en: 'Sustainability' } },
    { color: '#be185d', name: { 'pt-BR': 'Pessoas', en: 'People' } },
    { color: '#7e22ce', name: { 'pt-BR': 'Tecnologia', en: 'Technology' } },
  ],
};
