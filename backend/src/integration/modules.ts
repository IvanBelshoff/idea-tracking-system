import { isHttpsOrLocal } from '../identity-access/sso/sso-rules.js';

/**
 * Módulos da API de integração (M16, RN-102). O administrador liga cada um; a integração usa um
 * subconjunto dos ligados. Sem banco: constantes e regras puras.
 */
export const INTEGRATION_MODULES = [
  'ideas',
  'indicators',
  'campaigns',
  'hall',
  'entities',
  'users',
  // Loja (M22, RN-172): leitura dos pedidos; vale para a loja inteira (sem escopo de entidade).
  'store',
  // Escrita (M18, RN-126): separados dos de leitura, desligados de fábrica.
  'ideas_write',
  'gains_write',
] as const;
export type IntegrationModuleId = (typeof INTEGRATION_MODULES)[number];

export function isIntegrationModule(value: string): value is IntegrationModuleId {
  return (INTEGRATION_MODULES as readonly string[]).includes(value);
}

/** Módulos que gravam (M18, RN-126): a tela os marca como "grava". */
export const WRITE_MODULES: readonly IntegrationModuleId[] = ['ideas_write', 'gains_write'];

export const isWriteModule = (id: string) => (WRITE_MODULES as readonly string[]).includes(id);

/** Módulos que levam dado pessoal: a tela os destaca (RN-112, RN-115). */
export const SENSITIVE_MODULES: readonly IntegrationModuleId[] = ['users', 'store'];

/** Estados da integração (RN-103). */
export const INTEGRATION_STATUSES = ['active', 'suspended', 'revoked'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** Limites fixos (RN-103 a RN-105). */
export const INTEGRATION_LIMITS = {
  /** Limite de chamadas por minuto: padrão e teto (RN-105). */
  defaultRatePerMinute: 60,
  maxRatePerMinute: 600,
  /** IPs ou faixas por integração (RN-103). */
  maxIpEntries: 20,
  /** Validade máxima do token, em dias (RN-104). */
  maxTokenDays: 365,
  /** Tokens ativos ao mesmo tempo, por integração (RN-104). */
  maxActiveTokens: 2,
  /** Janela de sobreposição na rotação, em horas: padrão e máximo (RN-104). */
  defaultOverlapHours: 24,
  maxOverlapHours: 72,
  /** Chamadas de escrita por integração, por minuto: fixo no código, além do limite geral (RN-134). */
  writePerMinute: 30,
  /** Validade da chave de idempotência, em horas (RN-131). */
  idempotencyHours: 24,
  /** Tentativas com token inválido por IP, por minuto (RN-105). */
  invalidPerIpPerMinute: 20,
  /** A "última chamada" do token é gravada no máximo uma vez por minuto (CA-RN-104.10). */
  lastUsedWriteMs: 60_000,
} as const;

/** Lista de módulos válida: só códigos conhecidos, sem repetição, na ordem do contrato. */
export function normalizeModules(input: readonly string[]): IntegrationModuleId[] | null {
  if (!input.every(isIntegrationModule)) return null;
  const wanted = new Set(input);
  return INTEGRATION_MODULES.filter((m) => wanted.has(m));
}

/**
 * Pré-condições para ligar a chave geral (RN-102): o endereço do sistema preenchido e em HTTPS fora
 * de `localhost`, para o token não trafegar aberto. Vazia = pode ligar.
 */
export type IntegrationBlocker = 'app_url_required' | 'https_required';

export function enableBlockers(appUrl: string): IntegrationBlocker[] {
  const url = appUrl.trim();
  if (!url) return ['app_url_required'];
  return isHttpsOrLocal(url) ? [] : ['https_required'];
}
