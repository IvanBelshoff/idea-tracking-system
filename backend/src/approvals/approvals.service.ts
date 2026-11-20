import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, In } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError, parseInput } from '../common/api-error.js';
import { addDaysToDay, dayStartInZone, formatDayLocalized, todayInZone } from '../common/dates.js';
import { composeEmail, isEmailActive, queueEmail } from '../communication/mail.js';
import { Attachment } from '../ideas/entities/attachment.entity.js';
import type { Idea } from '../ideas/entities/idea.entity.js';
import { Visibility } from '../ideas/entities/idea-related.entity.js';
import { FinancialGain } from '../ideas/entities/result.entity.js';
import { ideaCapabilities } from '../ideas/idea-access.js';
import { IdeasService, recordEvent } from '../ideas/ideas.service.js';
import { isClosed } from '../ideas/lifecycle.js';
import type { Access } from '../identity-access/access.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { getSetting } from '../organization/settings.service.js';
import { type ApprovalState, approvalState, closeOpenRequest, newToken } from './approval-core.js';
import { notifyApprover } from './approval-notify.js';
import {
  type ApprovalRequestInput,
  ApprovalRequestSchema,
  holdAllowed,
  outsideDomains,
  ReasonSchema,
} from './approval-rules.js';
import { ApprovalEvidence, ApprovalRecipient, ApprovalRequest, ApprovalRequestAttachment } from './entities.js';

export interface RecipientView {
  id: string;
  kind: 'user' | 'external';
  userId: string | null;
  name: string;
  email: string | null;
  area: string;
  decision: ApprovalRecipient['decision'];
  source: ApprovalRecipient['source'];
  comment: string | null;
  decidedName: string | null;
  decidedAt: string | null;
  decidedOn: string | null;
  recordedBy: string | null;
  evidence: { id: string; originalName: string }[];
}

export interface RequestView {
  id: string;
  status: ApprovalRequest['status'];
  holds: ApprovalRequest['holds'];
  summary: string;
  ideaTitle: string;
  gain: ApprovalRequest['gainSnapshot'];
  dueOn: string;
  expiresAt: string;
  createdAt: string;
  closedAt: string | null;
  requestedBy: { id: string; name: string };
  cancelReason: string | null;
  overriddenAt: string | null;
  overriddenBy: string | null;
  overrideReason: string | null;
  attachments: { id: string; originalName: string }[];
  recipients: RecipientView[];
}

export interface ApprovalsView {
  /** Situação para qualquer um que vê a ideia (RN-190). */
  state: ApprovalState;
  /** Quem pode pedir, cancelar e seguir sem a aprovação (a equipe). */
  canManage: boolean;
  /** Pode ver os detalhes (equipe e gestores com acesso); senão, só a situação. */
  full: boolean;
  onReject: 'return' | 'block';
  requests: RequestView[];
  /** Só para a equipe: o que o formulário de pedir precisa. */
  form: { defaultDays: number; emailDomains: string[]; allowOutsideDomains: boolean; emailActive: boolean } | null;
}

const forbidden = (message: string) => apiError(403, 'forbidden', message);

/**
 * Aprovação de outras áreas (M24, RN-183 a RN-192): pedir, cancelar, seguir sem a aprovação e ver.
 * A decisão (link, dentro do ITS, registro manual) fica em `approval-decisions.service.ts` (fatia 2).
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ideas: IdeasService,
    private readonly audit: AuditService,
  ) {}

  async view(access: Access, refValue: string): Promise<ApprovalsView> {
    const { idea, can } = await this.ideas.findVisible(access, refValue);
    const m = this.dataSource.manager;
    const full = can.triage || access.hasIn('idea.view_scope', idea.entityId);
    return {
      state: await approvalState(m, idea.id),
      canManage: can.triage,
      full,
      onReject: await getSetting(m, 'approval.on_reject'),
      requests: full ? await this.requestViews(m, idea.id) : [],
      form: can.triage ? await this.formInfo(m) : null,
    };
  }

  /** O que o formulário de pedir precisa saber (RN-183, RN-190): prazo padrão, domínios e se o e-mail sai. */
  private async formInfo(m: EntityManager) {
    const appUrl = (await getSetting(m, 'email.app_url')).trim();
    return {
      defaultDays: await getSetting(m, 'approval.default_days'),
      emailDomains: await getSetting(m, 'auth.email_domains'),
      allowOutsideDomains: await getSetting(m, 'approval.allow_outside_domains'),
      emailActive: appUrl !== '' && (await isEmailActive(m)),
    };
  }

  async request(access: Access, refValue: string, body: unknown, meta: RequestMeta): Promise<ApprovalsView> {
    const input = parseInput(ApprovalRequestSchema, body, 422);
    const ideaId = await this.dataSource.transaction(async (m) => {
      const idea = await this.lockForTeam(m, access, refValue);
      if (idea.archivedAt || isClosed(idea.status) || !holdAllowed(idea.status, input.holds)) {
        throw apiError(409, 'approval_invalid_state', 'Esta aprovação não vale na situação atual da ideia.', {
          status: idea.status,
        });
      }
      if (await m.getRepository(ApprovalRequest).existsBy({ ideaId: idea.id, status: 'pending' })) {
        throw apiError(409, 'approval_open', 'A ideia já tem um pedido de aprovação aberto.');
      }
      const recipients = await this.resolveRecipients(m, access, input);
      const attachments = await this.checkAttachments(m, idea, input.attachmentIds);
      const gain = input.showGain ? await m.getRepository(FinancialGain).findOneBy({ ideaId: idea.id }) : null;
      const timeZone = await getSetting(m, 'organization.timezone');
      const days = input.days ?? (await getSetting(m, 'approval.default_days'));
      const dueOn = addDaysToDay(todayInZone(new Date(), timeZone), days);

      const requests = m.getRepository(ApprovalRequest);
      const request = await requests.save(
        requests.create({
          ideaId: idea.id,
          holds: input.holds,
          ideaCode: idea.code,
          ideaTitle: idea.title.slice(0, 200),
          summary: input.summary,
          gainSnapshot:
            gain?.estimated != null
              ? { estimated: String(gain.estimated), currency: gain.currency, periodicity: gain.periodicity }
              : null,
          dueOn,
          // Vence no fim do último dia, no fuso da instalação.
          expiresAt: dayStartInZone(dueOn, timeZone, 1),
          requestedById: access.userId,
        }),
      );
      for (const a of attachments) {
        await m.getRepository(ApprovalRequestAttachment).insert({ requestId: request.id, attachmentId: a.id });
      }

      // Quem é de fora recebe o link por e-mail (RN-184); sem envio de e-mail, só o registro manual (RN-187).
      const appUrl = (await getSetting(m, 'email.app_url')).replace(/\/+$/, '');
      const mail = appUrl !== '' && (await isEmailActive(m));
      const requester = await m.getRepository(User).findOneByOrFail({ id: access.userId });
      const locale = await getSetting(m, 'organization.default_locale');
      const repo = m.getRepository(ApprovalRecipient);
      for (const r of recipients) {
        const link = r.userId === null && mail ? newToken() : null;
        await repo.save(
          repo.create({
            requestId: request.id,
            userId: r.userId,
            name: r.name,
            email: r.email,
            area: r.area,
            tokenHash: link?.hash ?? null,
          }),
        );
        if (r.userId) await notifyApprover(m, r.userId, 'approval_requested', request, r.area);
        if (link && r.email) {
          const text = await composeEmail(m, 'approval_request', locale, {
            name: r.name,
            requester: requester.name,
            area: r.area,
            idea: `${idea.code} · ${idea.title}`,
            summary: input.summary,
            due: formatDayLocalized(dueOn, locale),
            link: `${appUrl}/aprovar#${link.token}`,
          });
          await queueEmail(m, { kind: 'approval_request', userId: null, to: r.email, ...text });
        }
      }

      await recordEvent(m, {
        ideaId: idea.id,
        type: 'approval_requested',
        actorId: access.userId,
        data: { requestId: request.id, holds: input.holds },
      });
      await this.audit.record(
        {
          action: 'approval.requested',
          actorId: access.userId,
          targetType: 'idea',
          targetId: idea.id,
          data: {
            requestId: request.id,
            holds: input.holds,
            recipients: recipients.length,
            external: recipients.filter((r) => r.userId === null).length,
          },
          ip: meta.ip,
        },
        m,
      );
      return idea.id;
    });
    return this.viewById(access, ideaId);
  }

  async cancel(access: Access, refValue: string, requestId: string, body: unknown, meta: RequestMeta) {
    const { reason } = parseInput(ReasonSchema, body, 422);
    const ideaId = await this.dataSource.transaction(async (m) => {
      const idea = await this.lockForTeam(m, access, refValue);
      const open = await m.getRepository(ApprovalRequest).findOneBy({ id: requestId, ideaId: idea.id });
      if (!open) throw apiError(404, 'not_found', 'Pedido de aprovação não encontrado.');
      if (open.status !== 'pending') throw apiError(409, 'approval_not_open', 'Este pedido já foi encerrado.');
      await closeOpenRequest(m, idea.id, { actorId: access.userId, reason });
      await this.audit.record(
        {
          action: 'approval.cancelled',
          actorId: access.userId,
          targetType: 'idea',
          targetId: idea.id,
          data: { requestId, reason },
          ip: meta.ip,
        },
        m,
      );
      return idea.id;
    });
    return this.viewById(access, ideaId);
  }

  /** "Seguir sem a aprovação" (RN-188): só no modo devolver, com justificativa, depois de uma recusa. */
  async override(access: Access, refValue: string, requestId: string, body: unknown, meta: RequestMeta) {
    const { reason } = parseInput(ReasonSchema, body, 422);
    const ideaId = await this.dataSource.transaction(async (m) => {
      const idea = await this.lockForTeam(m, access, refValue);
      if ((await getSetting(m, 'approval.on_reject')) === 'block') {
        throw apiError(
          403,
          'approval_override_blocked',
          'Nesta organização, só um novo pedido aprovado libera a ideia.',
        );
      }
      const requests = m.getRepository(ApprovalRequest);
      const request = await requests.findOneBy({ id: requestId, ideaId: idea.id });
      if (!request) throw apiError(404, 'not_found', 'Pedido de aprovação não encontrado.');
      const latest = await requests.findOne({
        where: { ideaId: idea.id, holds: request.holds },
        order: { createdAt: 'DESC' },
      });
      if (
        latest?.id !== request.id ||
        !(request.status === 'rejected' || request.status === 'expired') ||
        request.overriddenAt
      ) {
        throw apiError(
          409,
          'approval_not_overridable',
          'Só dá para seguir sem a aprovação depois de uma recusa ou do prazo vencido.',
        );
      }
      await requests.update(request.id, {
        overriddenAt: new Date(),
        overriddenById: access.userId,
        overrideReason: reason,
      });
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'approval_overridden',
        actorId: access.userId,
        // A justificativa é da equipe: o autor vê só a situação (RN-190).
        visibility: Visibility.Internal,
        reason,
        data: { requestId },
      });
      await this.audit.record(
        {
          action: 'approval.overridden',
          actorId: access.userId,
          targetType: 'idea',
          targetId: idea.id,
          data: { requestId, reason },
          ip: meta.ip,
        },
        m,
      );
      return idea.id;
    });
    return this.viewById(access, ideaId);
  }

  // --- auxiliares ---------------------------------------------------------------------------

  private async viewById(access: Access, ideaId: string) {
    return this.view(access, ideaId);
  }

  /** Carrega com escopo, TRAVA a ideia e exige `idea.triage` na entidade dela. */
  private async lockForTeam(m: EntityManager, access: Access, refValue: string): Promise<Idea> {
    const visible = await this.ideas.findVisible(access, refValue, m);
    const idea = await this.ideas.lock(m, visible.idea.id);
    if (!ideaCapabilities(access, idea).triage) throw forbidden('Você não tria ideias desta entidade.');
    return idea;
  }

  private async resolveRecipients(m: EntityManager, access: Access, input: ApprovalRequestInput) {
    const domains = await getSetting(m, 'auth.email_domains');
    const allowOutside = await getSetting(m, 'approval.allow_outside_domains');
    const users = m.getRepository(User);
    const out: { userId: string | null; name: string; email: string | null; area: string }[] = [];
    const invalid = (message: string, index: number) =>
      apiError(422, 'approval_invalid_recipient', message, [{ path: `recipients.${index}`, message }]);
    for (const [index, r] of input.recipients.entries()) {
      let user: User | null = null;
      if ('userId' in r) {
        user = await users.findOneBy({ id: r.userId, status: UserStatus.Active });
        if (!user) throw invalid('Escolha uma pessoa ativa do ITS.', index);
      } else {
        // Quem já tem usuário ativo não recebe link: decide dentro do ITS (RN-186).
        user = await users.findOneBy({ email: r.email, status: UserStatus.Active });
        if (!user && outsideDomains(r.email, domains) && !allowOutside) {
          throw apiError(422, 'approval_outside_domain', 'Este e-mail é de fora dos domínios da empresa.', [
            { path: `recipients.${index}.email`, message: 'E-mail de fora dos domínios da empresa.' },
          ]);
        }
      }
      if (user?.id === access.userId) {
        throw apiError(422, 'approval_self', 'Quem pede a aprovação não pode ser um dos aprovadores.');
      }
      const entry = user
        ? { userId: user.id, name: user.name, email: null, area: r.area ?? '' }
        : { userId: null, name: 'name' in r ? r.name : '', email: 'email' in r ? r.email : null, area: r.area ?? '' };
      const duplicate = out.some((o) => (entry.userId ? o.userId === entry.userId : o.email === entry.email));
      if (duplicate) throw invalid('Este aprovador aparece duas vezes.', index);
      out.push(entry);
    }
    return out;
  }

  private async checkAttachments(m: EntityManager, idea: Idea, ids: string[]): Promise<Attachment[]> {
    if (ids.length === 0) return [];
    const found = await m.getRepository(Attachment).findBy({ id: In(ids), ideaId: idea.id });
    if (found.length !== new Set(ids).size) {
      throw apiError(422, 'validation_failed', 'Escolha anexos desta ideia.', [
        { path: 'attachmentIds', message: 'Anexo que não é desta ideia.' },
      ]);
    }
    return found;
  }

  private async requestViews(m: EntityManager, ideaId: string): Promise<RequestView[]> {
    const requests = await m.getRepository(ApprovalRequest).find({ where: { ideaId }, order: { createdAt: 'DESC' } });
    if (requests.length === 0) return [];
    const ids = requests.map((r) => r.id);
    const recipients = await m.getRepository(ApprovalRecipient).find({
      where: { requestId: In(ids) },
      order: { createdAt: 'ASC' },
    });
    const evidence = recipients.length
      ? await m.getRepository(ApprovalEvidence).findBy({ recipientId: In(recipients.map((r) => r.id)) })
      : [];
    const links = await m.getRepository(ApprovalRequestAttachment).find({
      where: { requestId: In(ids) },
      relations: { attachment: true },
    });
    const userIds = [
      ...new Set(
        [
          ...requests.flatMap((r) => [r.requestedById, r.overriddenById]),
          ...recipients.map((r) => r.recordedById),
        ].filter((v): v is string => !!v),
      ),
    ];
    const names = new Map(
      (userIds.length ? await m.getRepository(User).findBy({ id: In(userIds) }) : []).map((u) => [u.id, u.name]),
    );
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return requests.map((r) => ({
      id: r.id,
      status: r.status,
      holds: r.holds,
      summary: r.summary,
      ideaTitle: r.ideaTitle,
      gain: r.gainSnapshot,
      dueOn: r.dueOn,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      closedAt: iso(r.closedAt),
      requestedBy: { id: r.requestedById, name: names.get(r.requestedById) ?? '' },
      cancelReason: r.cancelReason,
      overriddenAt: iso(r.overriddenAt),
      overriddenBy: r.overriddenById ? (names.get(r.overriddenById) ?? null) : null,
      overrideReason: r.overrideReason,
      attachments: links
        .filter((l) => l.requestId === r.id)
        .map((l) => ({ id: l.attachmentId, originalName: l.attachment.originalName })),
      recipients: recipients
        .filter((x) => x.requestId === r.id)
        .map((x) => ({
          id: x.id,
          kind: x.userId ? ('user' as const) : ('external' as const),
          userId: x.userId,
          name: x.name,
          email: x.email,
          area: x.area,
          decision: x.decision,
          source: x.source,
          comment: x.comment,
          decidedName: x.decidedName,
          decidedAt: iso(x.decidedAt),
          decidedOn: x.decidedOn,
          recordedBy: x.recordedById ? (names.get(x.recordedById) ?? null) : null,
          evidence: evidence
            .filter((e) => e.recipientId === x.id)
            .map((e) => ({ id: e.id, originalName: e.originalName })),
        })),
    }));
  }
}
