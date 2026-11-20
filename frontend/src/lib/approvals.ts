/**
 * Regras de tela da aprovação de outras áreas (M24, RN-183 a RN-192), sem React: o servidor confere
 * tudo de novo; aqui só se evita mandar o que ele vai recusar e se resume o que mostrar.
 */

export const MAX_RECIPIENTS = 10;
export const SUMMARY_MAX = 2000;
export const NAME_MAX = 120;
export const AREA_MAX = 80;
export const COMMENT_MAX = 1000;
export const REASON_MAX = 1000;
export const MAX_ATTACHMENTS = 5;
export const MAX_EVIDENCE = 5;
export const DAYS_MIN = 1;
export const DAYS_MAX = 60;

export type Hold = 'approve' | 'implement';

/** O que um pedido pode segurar na situação atual da ideia (RN-183); vazio = não dá para pedir. */
export function holdOptions(status: string): Hold[] {
  if (status === 'in_review') return ['approve', 'implement'];
  if (status === 'in_progress') return ['implement'];
  return [];
}

/** E-mail fora dos domínios da empresa (RN-190); sem domínios cadastrados, nenhum é de fora. */
export function isOutsideDomain(email: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return false;
  const domain = email.trim().split('@')[1]?.toLowerCase() ?? '';
  if (domain === '') return false;
  return !domains.some((d) => d.toLowerCase() === domain);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RecipientRow =
  | { kind: 'user'; userId: string; area: string }
  | { kind: 'external'; name: string; email: string; area: string };

export type RowProblem = 'user' | 'name' | 'email' | 'area' | 'duplicate' | 'outside';

/**
 * Confere as linhas de aprovadores antes de enviar: pessoa escolhida, nome, e-mail e área de quem é de
 * fora, ninguém repetido e, com `allowOutside` desligado, e-mail dentro dos domínios.
 */
export function recipientProblems(
  rows: readonly RecipientRow[],
  domains: readonly string[],
  allowOutside: boolean,
): Map<number, RowProblem[]> {
  const problems = new Map<number, RowProblem[]>();
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const list: RowProblem[] = [];
    if (row.area.trim().length > AREA_MAX) list.push('area');
    let key = '';
    if (row.kind === 'user') {
      if (!row.userId) list.push('user');
      key = `u:${row.userId}`;
    } else {
      const email = row.email.trim().toLowerCase();
      if (!row.name.trim() || row.name.trim().length > NAME_MAX) list.push('name');
      if (!EMAIL.test(email)) list.push('email');
      else if (!allowOutside && isOutsideDomain(email, domains)) list.push('outside');
      if (!row.area.trim()) list.push('area');
      key = `e:${email}`;
    }
    if (key.length > 2 && seen.has(key)) list.push('duplicate');
    seen.add(key);
    if (list.length > 0) problems.set(index, list);
  });
  return problems;
}

/** O corpo do pedido para a API, a partir das linhas. */
export function recipientsBody(rows: readonly RecipientRow[]) {
  return rows.map((row) =>
    row.kind === 'user'
      ? { userId: row.userId, area: row.area.trim() }
      : { name: row.name.trim(), email: row.email.trim().toLowerCase(), area: row.area.trim() },
  );
}

/** "Aguardando aprovação: 1 de 2" (RN-188): quantos já aprovaram, de quantos. */
export function approvalProgress(recipients: readonly { decision: string }[]): { approved: number; total: number } {
  return { approved: recipients.filter((r) => r.decision === 'approved').length, total: recipients.length };
}

/**
 * "Seguir sem a aprovação" (RN-188): só no modo devolver, para a equipe, depois de o último pedido ter
 * sido recusado ou vencido, e uma vez só.
 */
export function canOverride(view: {
  canManage: boolean;
  onReject: string;
  requests: readonly { status: string; overriddenAt: string | null }[];
}): boolean {
  const latest = view.requests[0];
  if (!view.canManage || view.onReject !== 'return' || !latest) return false;
  return (latest.status === 'rejected' || latest.status === 'expired') && latest.overriddenAt === null;
}

/** Não aprovar exige o motivo (RN-184). */
export function decisionReady(decision: 'approved' | 'rejected' | null, comment: string): boolean {
  if (decision === null) return false;
  if (comment.trim().length > COMMENT_MAX) return false;
  return decision === 'approved' || comment.trim().length > 0;
}

/** O link vem depois do # (nunca vai ao servidor no endereço); só aceita o formato do token. */
export function tokenFromHash(hash: string): string | null {
  const token = hash.replace(/^#/, '');
  return /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null;
}
