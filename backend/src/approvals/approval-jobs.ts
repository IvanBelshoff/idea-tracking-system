import type { DataSource, EntityManager } from 'typeorm';
import { recordAudit } from '../audit/audit.service.js';
import { daysBetween, formatDayLocalized, todayInZone } from '../common/dates.js';
import { composeEmail, isEmailActive, queueEmail } from '../communication/mail.js';
import { recordEvent } from '../ideas/ideas.service.js';
import { getSetting } from '../organization/settings.service.js';
import { newToken } from './approval-core.js';
import { notifyApprover, notifyTeam } from './approval-notify.js';
import { ApprovalRecipient, ApprovalRequest } from './entities.js';

/** Antecedência do primeiro lembrete (RN-189). */
export const REMINDER_DAYS = 3;

/**
 * Qual lembrete cabe hoje (RN-189), ou nenhum: o primeiro 3 dias antes do prazo e o segundo no dia, no
 * máximo dois. Um pedido feito com prazo curto não recebe o lembrete "3 dias antes" logo de cara, e
 * nenhum lembrete sai no mesmo dia do pedido.
 */
export function reminderDue(input: {
  today: string;
  createdOn: string;
  dueOn: string;
  remindersSent: number;
}): 'soon' | 'due' | null {
  if (input.remindersSent >= 2 || input.createdOn === input.today) return null;
  const left = daysBetween(input.today, input.dueOn);
  if (left === 0) return 'due';
  const span = daysBetween(input.createdOn, input.dueOn);
  if (left > 0 && left <= REMINDER_DAYS && input.remindersSent === 0 && span > REMINDER_DAYS) return 'soon';
  return null;
}

/**
 * Rotina do worker (RN-189): vence os pedidos cujo prazo passou e manda os lembretes. Idempotente: rodar
 * de novo não repete nada (CA-RN-189.1). Devolve quantos pedidos venceram e quantos lembretes saíram.
 */
export async function runApprovalJobs(dataSource: DataSource): Promise<{ expired: number; reminders: number }> {
  let expired = 0;
  let reminders = 0;
  const late: { id: string }[] = await dataSource.query(
    `SELECT id FROM approval_request WHERE status = 'pending' AND expires_at <= now()`,
  );
  for (const { id } of late) {
    if (await dataSource.transaction((m) => expire(m, id))) expired += 1;
  }

  const timeZone = await getSetting(dataSource.manager, 'organization.timezone');
  const today = todayInZone(new Date(), timeZone);
  const open: { id: string }[] = await dataSource.query(
    `SELECT r.id FROM approval_recipient r JOIN approval_request q ON q.id = r.request_id
      WHERE q.status = 'pending' AND q.expires_at > now() AND r.decision = 'pending' AND r.reminders_sent < 2`,
  );
  for (const { id } of open) {
    if (await dataSource.transaction((m) => remind(m, id, today, timeZone))) reminders += 1;
  }
  return { expired, reminders };
}

async function expire(m: EntityManager, requestId: string): Promise<boolean> {
  const requests = m.getRepository(ApprovalRequest);
  const request = await requests.findOne({ where: { id: requestId }, lock: { mode: 'pessimistic_write' } });
  if (request?.status !== 'pending' || request.expiresAt.getTime() > Date.now()) return false;
  await requests.update(request.id, { status: 'expired', closedAt: new Date() });
  await m.getRepository(ApprovalRecipient).update({ requestId: request.id, decision: 'pending' }, { decision: 'void' });
  await recordEvent(m, { ideaId: request.ideaId, type: 'approval_expired', actorId: null, data: { requestId } });
  await notifyTeam(m, request, 'approval_expired', {}, null);
  await recordAudit(m, {
    action: 'approval.expired',
    actorId: null,
    targetType: 'idea',
    targetId: request.ideaId,
    data: { requestId },
  });
  return true;
}

async function remind(m: EntityManager, recipientId: string, today: string, timeZone: string): Promise<boolean> {
  const recipients = m.getRepository(ApprovalRecipient);
  const recipient = await recipients.findOne({ where: { id: recipientId }, lock: { mode: 'pessimistic_write' } });
  if (recipient?.decision !== 'pending') return false;
  const request = await m.getRepository(ApprovalRequest).findOneBy({ id: recipient.requestId });
  if (request?.status !== 'pending') return false;
  const kind = reminderDue({
    today,
    createdOn: todayInZone(request.createdAt, timeZone),
    dueOn: request.dueOn,
    remindersSent: recipient.remindersSent,
  });
  if (!kind) return false;

  if (recipient.userId) {
    await notifyApprover(m, recipient.userId, 'approval_reminder', request, recipient.area);
  } else if (recipient.email && recipient.tokenHash) {
    // O banco não guarda o link (CA-T.28): o lembrete leva um link novo, que substitui o anterior.
    const appUrl = (await getSetting(m, 'email.app_url')).replace(/\/+$/, '');
    if (appUrl === '' || !(await isEmailActive(m))) return false;
    const link = newToken();
    await recipients.update(recipient.id, { tokenHash: link.hash });
    const locale = await getSetting(m, 'organization.default_locale');
    const text = await composeEmail(m, 'approval_reminder', locale, {
      name: recipient.name,
      idea: `${request.ideaCode} · ${request.ideaTitle}`,
      due: formatDayLocalized(request.dueOn, locale),
      link: `${appUrl}/aprovar#${link.token}`,
    });
    await queueEmail(m, { kind: 'approval_reminder', userId: null, to: recipient.email, ...text });
  } else {
    return false;
  }
  await recipients.update(recipient.id, { remindersSent: kind === 'due' ? 2 : 1 });
  return true;
}
