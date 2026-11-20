import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ApiError, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';

/** Aprovação de outras áreas (M24): tipos e consultas. */
export type ApprovalsView = components['schemas']['ApprovalsView'];
export type ApprovalRequest = components['schemas']['ApprovalRequestView'];
export type ApprovalRecipient = components['schemas']['ApprovalRecipientView'];
export type ApprovalSnapshot = components['schemas']['ApprovalSnapshotView'];
export type ApprovalLinkView = components['schemas']['ApprovalLinkView'];
export type MyPendingApproval = components['schemas']['MyPendingApprovalView'];
export type ApprovalGain = components['schemas']['ApprovalGainView'];

export const approvalKeys = {
  all: ['approvals'] as const,
  idea: (code: string) => ['approvals', 'idea', code] as const,
  pending: ['approvals', 'pending'] as const,
};

export function useIdeaApprovals(code: string) {
  return useQuery({
    queryKey: approvalKeys.idea(code),
    queryFn: () => unwrap(api.GET('/api/ideas/{ref}/approvals', { params: { path: { ref: code } } })),
  });
}

/** As aprovações que a pessoa precisa dar (RN-186); também alimenta o item do menu. */
export function useMyPendingApprovals() {
  return useQuery({
    queryKey: approvalKeys.pending,
    queryFn: () => unwrap(api.GET('/api/approvals/pending')),
    staleTime: 60_000,
  });
}

export const evidenceUrl = (code: string, evidenceId: string) =>
  `/api/ideas/${encodeURIComponent(code)}/approvals/evidence/${evidenceId}`;
export const myAttachmentUrl = (recipientId: string, attachmentId: string) =>
  `/api/approvals/recipients/${recipientId}/attachments/${attachmentId}`;

async function failure(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: unknown };
  return new ApiError(res.status, body.code ?? 'unknown', body.message ?? '', body.details);
}

/** Registro manual com evidência (RN-187): multipart, com os arquivos no campo `files`. */
export async function recordDecision(
  code: string,
  requestId: string,
  recipientId: string,
  fields: { decision: 'approved' | 'rejected'; decidedName: string; decidedOn: string; comment: string },
  files: File[],
): Promise<void> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) form.append('files', file);
  let res: Response;
  try {
    res = await fetch(
      `/api/ideas/${encodeURIComponent(code)}/approvals/${requestId}/recipients/${recipientId}/record`,
      { method: 'POST', body: form, credentials: 'same-origin' },
    );
  } catch {
    throw new ApiError(0, 'network', 'Falha de rede');
  }
  if (!res.ok) throw await failure(res);
}

/**
 * Anexo pelo link (RN-184): o link vai no corpo, nunca no endereço, então o download é um POST que
 * vira um arquivo salvo pelo navegador.
 */
export async function downloadWithToken(token: string, attachmentId: string, name: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/approvals/link/attachment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, attachmentId }),
      credentials: 'omit',
    });
  } catch {
    throw new ApiError(0, 'network', 'Falha de rede');
  }
  if (!res.ok) throw await failure(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
