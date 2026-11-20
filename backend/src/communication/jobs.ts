import { type DataSource, In, LessThan } from 'typeorm';
import { hoursFromNow, localTimeInZone, todayInZone } from '../common/dates.js';
import { IdeaStatus } from '../ideas/entities/idea.entity.js';
import { isTriageOverdue, triageDueDate } from '../ideas/triage-rules.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { usersWithPermissionIn } from '../identity-access/permission-holders.js';
import { getSetting } from '../organization/settings.service.js';
import { AlertDedup, EmailLog, EmailStatus, Notification, NotificationEmailState } from './entities.js';
import { composeEmail, isEmailActive, queueEmail } from './mail.js';
import { deadlineAlertKind } from './notification-rules.js';
import { describeNotification } from './notification-text.js';
import { dispatchNotifications } from './notify.js';

/**
 * Jobs da comunicação, chamados pelo worker a cada minuto. Todos idempotentes (CA-T.1): rodar de
 * novo, ou em dois workers ao mesmo tempo, não duplica alerta nem resumo, graças à chave única de
 * `alert_dedup` e às travas de linha.
 */

interface OpenStepRow {
  stepId: string;
  name: string;
  position: number;
  dueDate: string;
  assigneeId: string | null;
  ideaId: string;
  code: string;
  title: string;
  analystId: string | null;
}

/**
 * Alertas de prazo (RN-29): ao responsável da etapa e ao analista, `days` antes (padrão da
 * instalação ou o da pessoa) e no dia do vencimento. Só etapa aberta de ideia em andamento e não
 * arquivada (CA-RN-29.3). Um alerta de cada tipo por etapa, prazo e pessoa (CA-RN-29.2).
 */
export async function runDeadlineAlerts(ds: DataSource, now = new Date()): Promise<number> {
  const timeZone = await getSetting(ds.manager, 'organization.timezone');
  const defaultDays = await getSetting(ds.manager, 'notifications.deadline_alert_days');
  const today = todayInZone(now, timeZone);

  const steps: OpenStepRow[] = await ds.query(
    `SELECT s.id AS "stepId", s.name, s.position, to_char(s.due_date, 'YYYY-MM-DD') AS "dueDate",
            s.assignee_id AS "assigneeId", i.id AS "ideaId", i.code, i.title, i.assigned_to_id AS "analystId"
       FROM step s JOIN idea i ON i.id = s.idea_id
      WHERE s.completed_at IS NULL AND i.status = 'in_progress' AND i.archived_at IS NULL
        AND s.due_date BETWEEN $1::date AND $1::date + 30`,
    [today],
  );
  if (steps.length === 0) return 0;

  const recipientIds = [...new Set(steps.flatMap((s) => [s.assigneeId, s.analystId]).filter((id) => id !== null))];
  const users = await ds.getRepository(User).find({
    select: { id: true, deadlineAlertDays: true },
    where: { id: In(recipientIds), status: UserStatus.Active },
  });
  const daysOf = new Map(users.map((u) => [u.id, u.deadlineAlertDays ?? defaultDays]));

  let created = 0;
  for (const s of steps) {
    for (const userId of new Set([s.assigneeId, s.analystId])) {
      if (!userId || !daysOf.has(userId)) continue;
      const kind = deadlineAlertKind(today, s.dueDate, daysOf.get(userId) ?? defaultDays);
      if (!kind) continue;
      const type = kind === 'due' ? 'deadline_due' : 'deadline_soon';
      created += await ds.transaction(async (m) => {
        const inserted = await m
          .createQueryBuilder()
          .insert()
          .into(AlertDedup)
          .values({ kind: type, targetId: s.stepId, day: s.dueDate, userId })
          .orIgnore()
          .returning(['kind'])
          .execute();
        if (inserted.raw.length === 0) return 0; // já avisado
        return dispatchNotifications(m, [
          {
            userId,
            type,
            ideaId: s.ideaId,
            payload: { code: s.code, title: s.title, position: s.position, name: s.name, dueDate: s.dueDate },
          },
        ]);
      });
    }
  }
  return created;
}

/**
 * Resumo diário (RN-31): a partir do horário configurado, no fuso da instalação, junta num só
 * e-mail os avisos pendentes de cada pessoa (CA-RN-31.1). Sem avisos, nenhum e-mail (CA-RN-31.2).
 * Um resumo por pessoa por dia; o que chegar depois espera o de amanhã.
 */
export async function runDailyDigest(ds: DataSource, now = new Date()): Promise<number> {
  const m = ds.manager;
  if (!(await isEmailActive(m))) return 0;
  const appUrl = await getSetting(m, 'email.app_url');
  if (!appUrl) return 0;
  const timeZone = await getSetting(m, 'organization.timezone');
  if (localTimeInZone(now, timeZone) < (await getSetting(m, 'email.digest_time'))) return 0;
  const today = todayInZone(now, timeZone);

  const pending: { id: string }[] = await m.query(
    `SELECT DISTINCT user_id AS id FROM notification WHERE email_state = 'pending'`,
  );
  let queued = 0;
  for (const { id: userId } of pending) {
    const done = await ds.transaction(async (tx) => {
      const dedup = { kind: 'digest', targetId: userId, day: today, userId };
      if (await tx.getRepository(AlertDedup).existsBy(dedup)) return false;

      const items = await tx
        .getRepository(Notification)
        .createQueryBuilder('n')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('n.user_id = :userId AND n.email_state = :state', { userId, state: NotificationEmailState.Pending })
        .orderBy('n.created_at', 'ASC')
        .getMany();
      if (items.length === 0) return false;
      await tx
        .getRepository(Notification)
        .update({ id: In(items.map((n) => n.id)) }, { emailState: NotificationEmailState.Digested });

      const user = await tx.getRepository(User).findOneBy({ id: userId });
      if (!user || user.status !== UserStatus.Active) return false;
      await tx.getRepository(AlertDedup).insert(dedup);

      const lines = items.map((n) => {
        const code = typeof n.payload.code === 'string' ? n.payload.code : null;
        const text = `- ${describeNotification(n.type, n.payload, user.locale)}`;
        return code ? `${text}\n  ${appUrl}/ideias/${code}` : text;
      });
      const email = await composeEmail(tx, 'digest', user.locale, {
        name: user.name,
        count: items.length,
        items: lines.join('\n'),
        link: `${appUrl}/notificacoes`,
      });
      await queueEmail(tx, { kind: 'digest', userId, to: user.email, ...email });
      return true;
    });
    if (done) queued += 1;
  }
  return queued;
}

/**
 * Triagem atrasada (RN-54): ideia ainda Enviada depois da previsão de retorno avisa o analista
 * atribuído (sem atribuição, quem tria na entidade) e o gestor (quem vê os indicadores da
 * entidade). Um aviso por ideia e pessoa (CA-RN-54.2), mesmo com o job rodando de novo.
 */
export async function runTriageSlaAlerts(ds: DataSource, now = new Date()): Promise<number> {
  const m = ds.manager;
  const [zone, sla, business] = await Promise.all([
    getSetting(m, 'organization.timezone'),
    getSetting(m, 'triage.sla_days'),
    getSetting(m, 'triage.business_days'),
  ]);
  const today = todayInZone(now, zone);
  const ideas: {
    id: string;
    code: string;
    title: string;
    entity_id: string;
    assigned_to_id: string | null;
    submitted_at: Date;
  }[] = await m.query(
    `SELECT id, code, title, entity_id, assigned_to_id, submitted_at FROM idea
        WHERE status = 'submitted' AND archived_at IS NULL AND converged_into_id IS NULL`,
  );
  const holders = new Map<string, string[]>();
  const holdersOf = async (permission: 'idea.triage' | 'report.view', entityId: string) => {
    const key = `${permission}:${entityId}`;
    if (!holders.has(key)) holders.set(key, await usersWithPermissionIn(m, permission, entityId));
    return holders.get(key) ?? [];
  };

  let created = 0;
  for (const idea of ideas) {
    const due = triageDueDate(todayInZone(idea.submitted_at, zone), sla, business);
    if (!isTriageOverdue(IdeaStatus.Submitted, due, today)) continue;
    const recipients = new Set<string>(await holdersOf('report.view', idea.entity_id));
    if (idea.assigned_to_id) recipients.add(idea.assigned_to_id);
    else for (const id of await holdersOf('idea.triage', idea.entity_id)) recipients.add(id);
    for (const userId of recipients) {
      created += await ds.transaction(async (tx) => {
        const inserted = await tx
          .createQueryBuilder()
          .insert()
          .into(AlertDedup)
          .values({ kind: 'triage_overdue', targetId: idea.id, day: due, userId })
          .orIgnore()
          .returning(['kind'])
          .execute();
        if (inserted.raw.length === 0) return 0;
        return dispatchNotifications(tx, [
          {
            userId,
            type: 'triage_overdue',
            ideaId: idea.id,
            payload: { code: idea.code, title: idea.title, dueDate: due },
          },
        ]);
      });
    }
  }
  return created;
}

/**
 * Sustentação (RN-65, CA-RN-65.1): no dia da revisão, lembra o responsável pela ideia (o analista
 * atribuído; sem ele, o responsável da última etapa). Um lembrete por revisão e pessoa.
 */
export async function runSustainmentReminders(ds: DataSource, now = new Date()): Promise<number> {
  const m = ds.manager;
  const today = todayInZone(now, await getSetting(m, 'organization.timezone'));
  const due: { id: string; due_on: string; idea_id: string; code: string; title: string; user_id: string | null }[] =
    await m.query(
      `SELECT r.id, to_char(r.due_on, 'YYYY-MM-DD') AS due_on, i.id AS idea_id, i.code, i.title,
              COALESCE(i.assigned_to_id,
                (SELECT s.assignee_id FROM step s WHERE s.idea_id = i.id ORDER BY s.position DESC LIMIT 1)) AS user_id
         FROM sustainment_review r JOIN idea i ON i.id = r.idea_id
        WHERE r.status = 'pending' AND r.due_on <= $1::date
          AND i.status = 'implemented' AND i.archived_at IS NULL`,
      [today],
    );
  let created = 0;
  for (const r of due) {
    if (!r.user_id) continue;
    const userId = r.user_id;
    created += await ds.transaction(async (tx) => {
      const inserted = await tx
        .createQueryBuilder()
        .insert()
        .into(AlertDedup)
        .values({ kind: 'sustainment_due', targetId: r.id, day: r.due_on, userId })
        .orIgnore()
        .returning(['kind'])
        .execute();
      if (inserted.raw.length === 0) return 0;
      return dispatchNotifications(tx, [
        {
          userId,
          type: 'sustainment_due',
          ideaId: r.idea_id,
          payload: { code: r.code, title: r.title, dueDate: r.due_on },
        },
      ]);
    });
  }
  return created;
}

/** E-mail que virou job mas nunca terminou (worker parado, job expirado): vira falha visível. */
export async function expireStuckEmails(ds: DataSource, now = new Date()): Promise<number> {
  const result = await ds
    .getRepository(EmailLog)
    .update(
      { status: EmailStatus.Pending, queuedAt: LessThan(hoursFromNow(-2, now)) },
      { status: EmailStatus.Failed, lastError: 'O envio não terminou a tempo; use "Tentar de novo".' },
    );
  return result.affected ?? 0;
}
