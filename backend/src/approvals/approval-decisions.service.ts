import { createHash, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, In } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError, parseInput } from '../common/api-error.js';
import { todayInZone } from '../common/dates.js';
import { RateLimiter } from '../common/rate-limit.js';
import { composeEmail, queueEmail } from '../communication/mail.js';
import { AttachmentStorage, cleanFileName, extensionOf, mimeFor } from '../ideas/attachment-storage.js';
import { Attachment } from '../ideas/entities/attachment.entity.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { ideaCapabilities } from '../ideas/idea-access.js';
import { IdeasService } from '../ideas/ideas.service.js';
import type { Access } from '../identity-access/access.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { User } from '../identity-access/entities/user.entity.js';
import { getSetting } from '../organization/settings.service.js';
import { applyDecision, hashToken } from './approval-core.js';
import {
  CODE_MAX_ATTEMPTS,
  CODE_MINUTES,
  DecisionSchema,
  LinkAttachmentSchema,
  LinkDecisionSchema,
  type LinkState,
  linkState,
  ManualDecisionSchema,
  TokenSchema,
} from './approval-rules.js';
import { ApprovalEvidence, ApprovalRecipient, ApprovalRequest, ApprovalRequestAttachment } from './entities.js';

/** Limite por IP nas rotas do link (RN-184): varredura de links não passa. */
export const approvalLinkLimiter = new RateLimiter(30, 60_000);
/** Pedir código: no máximo 3 a cada 10 minutos por link (RN-185). */
const codeLimiter = new RateLimiter(3, 10 * 60_000);
const MAX_EVIDENCE = 5;

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

export interface PendingSnapshot {
  ideaCode: string;
  ideaTitle: string;
  summary: string;
  area: string;
  name: string;
  requestedBy: string;
  dueOn: string;
  gain: ApprovalRequest['gainSnapshot'];
  attachments: { id: string; originalName: string; sizeBytes: number }[];
}

export interface LinkView {
  state: LinkState;
  /** Só com o link aberto: o que o pedido congelou para esta pessoa. */
  request: PendingSnapshot | null;
  codeRequired: boolean;
  /** Com a resposta já registrada: qual foi. */
  decision: 'approved' | 'rejected' | null;
}

export interface MyPendingApproval extends PendingSnapshot {
  recipientId: string;
  requestId: string;
  /** O botão para abrir a ideia só aparece para quem já pode vê-la (RN-186). */
  canOpenIdea: boolean;
}

export type IncomingFile = { originalname: string; size: number; buffer: Buffer };

/**
 * Decidir um pedido de aprovação (M24, RN-184 a RN-188): pelo link de uso único (sem login), dentro do
 * ITS ou pelo registro manual com evidência. Toda decisão passa por `applyDecision`.
 */
@Injectable()
export class ApprovalDecisionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ideas: IdeasService,
    private readonly audit: AuditService,
    private readonly storage: AttachmentStorage,
  ) {}

  // --- Link de uso único (sem login) ------------------------------------------------------

  async linkView(body: unknown): Promise<LinkView> {
    const { token } = parseInput(TokenSchema, body, 404);
    const m = this.dataSource.manager;
    const { recipient, request } = await this.byToken(m, token);
    const state = linkState(recipient, request);
    const decided = recipient.decision === 'approved' || recipient.decision === 'rejected';
    return {
      state,
      request: state === 'open' ? await this.snapshot(m, request, recipient) : null,
      codeRequired: state === 'open' && (await getSetting(m, 'approval.email_code')),
      decision: decided ? (recipient.decision as 'approved' | 'rejected') : null,
    };
  }

  /** Envia o código de 6 dígitos ao e-mail do aprovador (RN-185). */
  async sendCode(body: unknown): Promise<void> {
    const { token } = parseInput(TokenSchema, body, 404);
    await this.dataSource.transaction(async (m) => {
      if (!(await getSetting(m, 'approval.email_code'))) {
        throw apiError(409, 'approval_code_off', 'Esta organização não usa código de confirmação.');
      }
      const { recipient, request } = await this.byToken(m, token);
      if (linkState(recipient, request) !== 'open' || !recipient.email) {
        throw apiError(409, 'approval_not_open', 'Este link não vale mais.');
      }
      codeLimiter.hit(recipient.id);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await m.getRepository(ApprovalRecipient).update(recipient.id, {
        codeHash: sha(`${recipient.id}:${code}`),
        codeExpiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
        codeAttempts: 0,
      });
      const locale = await getSetting(m, 'organization.default_locale');
      const text = await composeEmail(m, 'approval_code', locale, {
        name: recipient.name,
        code,
        minutes: CODE_MINUTES,
      });
      await queueEmail(m, { kind: 'approval_code', userId: null, to: recipient.email, ...text });
    });
  }

  async linkDecide(body: unknown, meta: RequestMeta): Promise<LinkView> {
    const input = parseInput(LinkDecisionSchema, body, 422);
    // O código errado conta a tentativa: a transação grava a tentativa e só depois o erro sai.
    const codeError = await this.dataSource.transaction(async (m) => {
      const { recipient, request } = await this.byToken(m, input.token);
      const state = linkState(recipient, request);
      if (state === 'decided') throw apiError(409, 'approval_already_decided', 'Esta resposta já foi registrada.');
      if (state !== 'open') throw apiError(409, 'approval_not_open', 'Este link não vale mais.');
      return (await getSetting(m, 'approval.email_code')) ? this.checkCode(m, recipient, input.code) : null;
    });
    if (codeError) throw codeError;
    await this.dataSource.transaction(async (m) => {
      const { recipient } = await this.byToken(m, input.token);
      const { request } = await applyDecision(m, recipient.id, {
        decision: input.decision,
        source: 'link',
        comment: input.comment || null,
        decidedName: input.name,
        ip: meta.ip,
        actorId: null,
      });
      await this.audit.record(
        {
          action: 'approval.decided',
          actorId: null,
          targetType: 'idea',
          targetId: request.ideaId,
          data: { requestId: request.id, recipientId: recipient.id, decision: input.decision, source: 'link' },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.linkView({ token: input.token });
  }

  async linkAttachment(body: unknown): Promise<{ attachment: Attachment; content: Buffer }> {
    const { token, attachmentId } = parseInput(LinkAttachmentSchema, body, 404);
    const m = this.dataSource.manager;
    const { recipient, request } = await this.byToken(m, token);
    if (linkState(recipient, request) !== 'open') throw apiError(404, 'not_found', 'Anexo não encontrado.');
    return this.requestFile(m, request.id, attachmentId);
  }

  // --- Dentro do ITS (RN-186) --------------------------------------------------------------

  async myPending(access: Access): Promise<MyPendingApproval[]> {
    const m = this.dataSource.manager;
    const mine = await m
      .getRepository(ApprovalRecipient)
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.request', 'q')
      .where('r.user_id = :me', { me: access.userId })
      .andWhere(`r.decision = 'pending' AND q.status = 'pending' AND q.expires_at > now()`)
      .orderBy('q.expires_at', 'ASC')
      .getMany();
    const ideas = mine.length ? await m.getRepository(Idea).findBy({ id: In(mine.map((r) => r.request.ideaId)) }) : [];
    const byId = new Map(ideas.map((i) => [i.id, i]));
    const out: MyPendingApproval[] = [];
    for (const r of mine) {
      const idea = byId.get(r.request.ideaId);
      out.push({
        ...(await this.snapshot(m, r.request, r)),
        recipientId: r.id,
        requestId: r.requestId,
        canOpenIdea: !!idea && ideaCapabilities(access, idea).view,
      });
    }
    return out;
  }

  async decide(access: Access, recipientId: string, body: unknown, meta: RequestMeta): Promise<{ ok: true }> {
    const input = parseInput(DecisionSchema, body, 422);
    await this.dataSource.transaction(async (m) => {
      const recipient = await m.getRepository(ApprovalRecipient).findOneBy({ id: recipientId });
      if (!recipient) throw apiError(404, 'not_found', 'Aprovação não encontrada.');
      if (recipient.userId !== access.userId) {
        throw apiError(403, 'forbidden', 'Só a pessoa escolhida decide esta aprovação.');
      }
      const user = await m.getRepository(User).findOneByOrFail({ id: access.userId });
      const { request } = await applyDecision(m, recipient.id, {
        decision: input.decision,
        source: 'its',
        comment: input.comment || null,
        decidedName: user.name,
        ip: meta.ip,
        actorId: access.userId,
      });
      await this.audit.record(
        {
          action: 'approval.decided',
          actorId: access.userId,
          targetType: 'idea',
          targetId: request.ideaId,
          data: { requestId: request.id, recipientId, decision: input.decision, source: 'its' },
          ip: meta.ip,
        },
        m,
      );
    });
    return { ok: true };
  }

  async myAttachment(access: Access, recipientId: string, attachmentId: string) {
    const m = this.dataSource.manager;
    const recipient = await m.getRepository(ApprovalRecipient).findOne({
      where: { id: recipientId, userId: access.userId },
      relations: { request: true },
    });
    if (!recipient || linkState(recipient, recipient.request) !== 'open') {
      throw apiError(404, 'not_found', 'Anexo não encontrado.');
    }
    return this.requestFile(m, recipient.requestId, attachmentId);
  }

  // --- Registro manual com evidência (RN-187) ----------------------------------------------

  async record(
    access: Access,
    refValue: string,
    requestId: string,
    recipientId: string,
    body: unknown,
    files: IncomingFile[],
    meta: RequestMeta,
  ): Promise<{ ok: true }> {
    const input = parseInput(ManualDecisionSchema, body, 422);
    if (files.length === 0) {
      throw apiError(422, 'approval_evidence_required', 'Anexe pelo menos um arquivo de evidência.', [
        { path: 'files', message: 'Anexe a evidência.' },
      ]);
    }
    if (files.length > MAX_EVIDENCE) throw apiError(422, 'validation_failed', `No máximo ${MAX_EVIDENCE} arquivos.`);
    const checked: { file: IncomingFile; originalName: string; extension: string }[] = [];
    for (const f of files) checked.push(await this.checkFile(f));
    const saved: string[] = [];
    try {
      await this.dataSource.transaction(async (m) => {
        const visible = await this.ideas.findVisible(access, refValue, m);
        const idea = await this.ideas.lock(m, visible.idea.id);
        if (!ideaCapabilities(access, idea).triage) {
          throw apiError(403, 'forbidden', 'Você não tria ideias desta entidade.');
        }
        const recipient = await m.getRepository(ApprovalRecipient).findOne({
          where: { id: recipientId, requestId },
          relations: { request: true },
        });
        if (!recipient || recipient.request.ideaId !== idea.id) {
          throw apiError(404, 'not_found', 'Aprovador não encontrado.');
        }
        const timeZone = await getSetting(m, 'organization.timezone');
        if (input.decidedOn > todayInZone(new Date(), timeZone)) {
          throw apiError(422, 'validation_failed', 'A data da decisão não pode estar no futuro.', [
            { path: 'decidedOn', message: 'Data no futuro.' },
          ]);
        }
        const { request } = await applyDecision(m, recipient.id, {
          decision: input.decision,
          source: 'manual',
          comment: input.comment || null,
          decidedName: input.decidedName,
          ip: meta.ip,
          actorId: access.userId,
          recordedById: access.userId,
          decidedOn: input.decidedOn,
        });
        const evidence = m.getRepository(ApprovalEvidence);
        for (const c of checked) {
          const storedName = AttachmentStorage.storedName(c.extension);
          await this.storage.save(storedName, c.file.buffer);
          saved.push(storedName);
          await evidence.save(
            evidence.create({
              recipientId: recipient.id,
              originalName: c.originalName,
              storedName,
              mimeType: mimeFor(c.extension),
              sizeBytes: c.file.size,
              uploadedById: access.userId,
            }),
          );
        }
        await this.audit.record(
          {
            action: 'approval.recorded',
            actorId: access.userId,
            targetType: 'idea',
            targetId: idea.id,
            data: { requestId: request.id, recipientId, decision: input.decision, evidence: checked.length },
            ip: meta.ip,
          },
          m,
        );
      });
    } catch (error) {
      await this.storage.remove(saved);
      throw error;
    }
    return { ok: true };
  }

  /** A evidência do registro manual: só para quem vê os detalhes do pedido (RN-190). */
  async evidence(access: Access, refValue: string, evidenceId: string) {
    const { idea, can } = await this.ideas.findVisible(access, refValue);
    if (!(can.triage || access.hasIn('idea.view_scope', idea.entityId))) {
      throw apiError(404, 'not_found', 'Evidência não encontrada.');
    }
    const row: { stored_name: string; original_name: string; mime_type: string }[] = await this.dataSource.query(
      `SELECT e.stored_name, e.original_name, e.mime_type FROM approval_evidence e
         JOIN approval_recipient r ON r.id = e.recipient_id
         JOIN approval_request q ON q.id = r.request_id
        WHERE e.id = $1 AND q.idea_id = $2`,
      [evidenceId, idea.id],
    );
    const found = row[0];
    if (!found) throw apiError(404, 'not_found', 'Evidência não encontrada.');
    return {
      originalName: found.original_name,
      mime: found.mime_type,
      content: await this.storage.read(found.stored_name),
    };
  }

  // --- auxiliares ---------------------------------------------------------------------------

  /** O link vale pelo SHA-256 (CA-T.28): inventado ou alterado → 404, sem dizer mais nada. */
  private async byToken(m: EntityManager, token: string) {
    const recipient = await m.getRepository(ApprovalRecipient).findOne({
      where: { tokenHash: hashToken(token) },
      relations: { request: true },
    });
    if (!recipient) throw apiError(404, 'not_found', 'Link não encontrado.');
    return { recipient, request: recipient.request };
  }

  /** Confere o código (RN-185); o código errado soma uma tentativa. Devolve o erro, sem lançar. */
  private async checkCode(
    m: EntityManager,
    recipient: ApprovalRecipient,
    code: string | undefined,
  ): Promise<Error | null> {
    if (!recipient.codeHash || !recipient.codeExpiresAt) {
      return apiError(422, 'approval_code_required', 'Peça o código de confirmação e digite-o para responder.');
    }
    if (recipient.codeExpiresAt.getTime() <= Date.now() || recipient.codeAttempts >= CODE_MAX_ATTEMPTS) {
      return apiError(422, 'approval_code_expired', 'O código venceu ou as tentativas acabaram. Peça outro código.');
    }
    if (!code || sha(`${recipient.id}:${code}`) !== recipient.codeHash) {
      await m.getRepository(ApprovalRecipient).increment({ id: recipient.id }, 'codeAttempts', 1);
      return apiError(422, 'approval_code_invalid', 'Código incorreto.');
    }
    return null;
  }

  private async snapshot(
    m: EntityManager,
    request: ApprovalRequest,
    recipient: ApprovalRecipient,
  ): Promise<PendingSnapshot> {
    const links = await m.getRepository(ApprovalRequestAttachment).find({
      where: { requestId: request.id },
      relations: { attachment: true },
    });
    const requester = await m.getRepository(User).findOneBy({ id: request.requestedById });
    return {
      ideaCode: request.ideaCode,
      ideaTitle: request.ideaTitle,
      summary: request.summary,
      area: recipient.area,
      name: recipient.name,
      requestedBy: requester?.name ?? '',
      dueOn: request.dueOn,
      gain: request.gainSnapshot,
      attachments: links.map((l) => ({
        id: l.attachmentId,
        originalName: l.attachment.originalName,
        sizeBytes: l.attachment.sizeBytes,
      })),
    };
  }

  private async requestFile(m: EntityManager, requestId: string, attachmentId: string) {
    const link = await m.getRepository(ApprovalRequestAttachment).findOne({
      where: { requestId, attachmentId },
      relations: { attachment: true },
    });
    if (!link) throw apiError(404, 'not_found', 'Anexo não encontrado.');
    try {
      return { attachment: link.attachment, content: await this.storage.read(link.attachment.storedName) };
    } catch {
      throw apiError(404, 'not_found', 'Arquivo não encontrado no armazenamento.');
    }
  }

  /** As regras de anexo da instalação (RN-21) valem para a evidência. */
  private async checkFile(file: IncomingFile) {
    const m = this.dataSource.manager;
    const maxMb = await getSetting(m, 'attachments.max_mb');
    if (file.size > maxMb * 1024 * 1024) {
      throw apiError(413, 'file_too_large', `O arquivo passa do limite de ${maxMb} MB.`, { maxMb });
    }
    const originalName = cleanFileName(file.originalname);
    const extension = extensionOf(originalName);
    const allowed = await getSetting(m, 'attachments.allowed_extensions');
    if (!extension || !allowed.includes(extension)) {
      throw apiError(415, 'file_type_not_allowed', 'Tipo de arquivo não permitido.', { allowed });
    }
    return { file, originalName, extension };
  }
}
