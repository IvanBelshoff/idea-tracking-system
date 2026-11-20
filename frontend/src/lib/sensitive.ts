/**
 * Campos sensíveis (M19, RN-135): funções puras, sem React, que rodam nos testes do Node. O que é
 * sensível abre mascarado e o valor NÃO fica na página enquanto oculto; a máscara tem tamanho fixo,
 * para não revelar o tamanho do valor.
 */
export const MASK = '••••••••';

/** Quanto tempo um campo revelado fica à vista antes de ocultar sozinho (RN-135). */
export const REVEAL_MS = 60_000;

/** A máscara de um valor: vazio continua vazio (não há o que esconder). */
export function maskValue(value: string | null | undefined): string {
  return value ? MASK : '';
}

const SENSITIVE_KEY = /^(e-?mail|ip|ip_?address|user_?ip|client_?ip)$/i;
const EMAIL = /[^\s@"',;<>()]+@[^\s@"',;<>()]+\.[^\s@"',;<>()]+/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
/** Sem a bandeira `g`: `test` com ela guarda estado entre chamadas. */
const HAS_IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

/** Há algo sensível (e-mail ou IP) neste valor da auditoria, por nome de chave ou pelo próprio texto? */
export function hasSensitive(data: unknown, key = ''): boolean {
  if (typeof data === 'string') return SENSITIVE_KEY.test(key) || /@/.test(data) || HAS_IPV4.test(data);
  if (Array.isArray(data)) return data.some((v) => hasSensitive(v, key));
  if (data && typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>).some(([k, v]) => hasSensitive(v, k));
  }
  return false;
}

/**
 * Os detalhes de um registro da auditoria sem os e-mails e IPs: a chave `email`/`ip` vira a máscara e
 * o e-mail ou IPv4 dentro de um texto também. Nada do original sobra na saída (CA-RN-135.8).
 */
export function maskAuditData(data: unknown, key = ''): unknown {
  if (typeof data === 'string') {
    if (SENSITIVE_KEY.test(key) && data) return MASK;
    return data.replace(EMAIL, MASK).replace(IPV4, MASK);
  }
  if (Array.isArray(data)) return data.map((v) => maskAuditData(v, key));
  if (data && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, maskAuditData(v, k)]),
    );
  }
  return data;
}
