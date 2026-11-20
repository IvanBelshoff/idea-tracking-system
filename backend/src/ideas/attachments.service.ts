import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, IsNull } from 'typeorm';
import { attachmentInOpenApproval } from '../approvals/approval-core.js';
import { apiError } from '../common/api-error.js';
import type { Access } from '../identity-access/access.js';
import { SettingsService } from '../organization/settings.service.js';
import { AttachmentStorage, cleanFileName, extensionOf, mimeFor } from './attachment-storage.js';
import { Attachment } from './entities/attachment.entity.js';
import { IdeaStatus } from './entities/idea.entity.js';
import { Step } from './entities/idea-related.entity.js';
import type { AttachmentView, IdeaAttachments } from './ideas.dto.js';
import { IdeasService, recordEvent } from './ideas.service.js';
import { isClosed } from './lifecycle.js';
import { VIEWABLE_MIMES } from './media-view.js';

/** Até quantos anexos a própria ideia aceita (RN-146); os das etapas não contam. */
export const IDEA_ATTACHMENT_LIMIT = 10;
/** Situações em que o autor ainda anexa e remove os anexos da ideia (RN-146). */
const AUTHOR_STATUSES: readonly IdeaStatus[] = [IdeaStatus.Submitted, IdeaStatus.InReview];

/** Arquivo recebido pelo multer (só o que usamos). */
export interface IncomingFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/**
 * Anexos de etapa (RN-21). Tipos e tamanho vêm da configuração e valem na requisição seguinte
 * (CA-RN-21.2). Download só para quem vê a ideia (CA-RN-21.4); nunca público.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ideas: IdeasService,
    private readonly settings: SettingsService,
    private readonly storage: AttachmentStorage,
  ) {}

  private view(a: Attachment, deletable: boolean): AttachmentView {
    return {
      id: a.id,
      stepId: a.stepId,
      originalName: a.originalName,
      mime: a.mime,
      sizeBytes: a.sizeBytes,
      uploadedBy: { id: a.uploadedBy.id, name: a.uploadedBy.name },
      createdAt: a.createdAt.toISOString(),
      deletable,
      viewable: VIEWABLE_MIMES.includes(a.mime),
    };
  }

  /** Tamanho e extensão pela configuração (RN-21): valem para anexo de etapa e da ideia. */
  private async checkFile(
    file: IncomingFile | undefined,
  ): Promise<{ file: IncomingFile; originalName: string; extension: string }> {
    if (!file) throw apiError(422, 'validation_failed', 'Envie um arquivo no campo "file".');
    const maxMb = await this.settings.get('attachments.max_mb');
    if (file.size > maxMb * 1024 * 1024) {
      throw apiError(413, 'file_too_large', `O arquivo passa do limite de ${maxMb} MB.`, { maxMb });
    }
    const originalName = cleanFileName(file.originalname);
    const extension = extensionOf(originalName);
    const allowed = await this.settings.get('attachments.allowed_extensions');
    if (!extension || !allowed.includes(extension)) {
      throw apiError(415, 'file_type_not_allowed', 'Tipo de arquivo não permitido.', { allowed });
    }
    return { file, originalName, extension };
  }

  /**
   * Quem mexe nos anexos da própria ideia (RN-146): o autor (ou quem cadastrou por ele) enquanto ela está
   * Enviada ou Em análise; quem tria a entidade enquanto ela não está encerrada.
   */
  private ideaRights(
    access: Access,
    idea: { authorId: string | null; registeredById: string | null; status: IdeaStatus; entityId: string },
  ) {
    const own = idea.authorId === access.userId || idea.registeredById === access.userId;
    const triage = access.hasIn('idea.triage', idea.entityId) && !isClosed(idea.status);
    const authorWindow = AUTHOR_STATUSES.includes(idea.status);
    return {
      upload: triage || (own && authorWindow),
      remove: (a: { uploadedById: string }) => triage || (a.uploadedById === access.userId && authorWindow),
    };
  }

  /** Anexos da própria ideia (RN-146), para quem vê a ideia. */
  async listIdea(access: Access, refValue: string): Promise<IdeaAttachments> {
    const { idea } = await this.ideas.findVisible(access, refValue);
    const rows = await this.dataSource.getRepository(Attachment).find({
      where: { ideaId: idea.id, stepId: IsNull() },
      relations: { uploadedBy: true },
      order: { createdAt: 'ASC' },
    });
    const rights = this.ideaRights(access, idea);
    return {
      items: rows.map((a) => this.view(a, rights.remove(a))),
      canUpload: rights.upload && rows.length < IDEA_ATTACHMENT_LIMIT,
      limit: IDEA_ATTACHMENT_LIMIT,
    };
  }

  /** Envio de anexo da própria ideia (RN-146): a ideia já existe; o anexo nunca a impede. */
  async uploadIdea(access: Access, refValue: string, incoming: IncomingFile | undefined): Promise<AttachmentView> {
    const { file, originalName, extension } = await this.checkFile(incoming);
    const storedName = AttachmentStorage.storedName(extension);
    const saved = await this.dataSource
      .transaction(async (m) => {
        const visible = await this.ideas.findVisible(access, refValue, m);
        const idea = await this.ideas.lock(m, visible.idea.id);
        if (isClosed(idea.status)) throw apiError(409, 'idea_closed', 'Ideia encerrada: somente leitura.');
        if (!this.ideaRights(access, idea).upload) {
          throw apiError(403, 'forbidden', 'Você não pode anexar arquivos a esta ideia agora.');
        }
        const repo = m.getRepository(Attachment);
        if ((await repo.countBy({ ideaId: idea.id, stepId: IsNull() })) >= IDEA_ATTACHMENT_LIMIT) {
          throw apiError(422, 'attachment_limit', `A ideia já tem ${IDEA_ATTACHMENT_LIMIT} anexos.`, {
            limit: IDEA_ATTACHMENT_LIMIT,
          });
        }
        const row = await repo.save(
          repo.create({
            ideaId: idea.id,
            stepId: null,
            originalName,
            storedName,
            mime: mimeFor(extension),
            sizeBytes: file.size,
            uploadedById: access.userId,
          }),
        );
        await this.storage.save(storedName, file.buffer);
        await recordEvent(m, {
          ideaId: idea.id,
          type: 'attachment_added',
          actorId: access.userId,
          data: { position: null, name: originalName },
        });
        return row;
      })
      .catch(async (e: unknown) => {
        await this.storage.remove([storedName]);
        throw e;
      });
    const row = await this.dataSource
      .getRepository(Attachment)
      .findOneOrFail({ where: { id: saved.id }, relations: { uploadedBy: true } });
    return this.view(row, true);
  }

  async list(access: Access, refValue: string, stepId: string): Promise<AttachmentView[]> {
    const { idea, can } = await this.ideas.findVisible(access, refValue);
    const step = await this.dataSource.getRepository(Step).findOneBy({ id: stepId, ideaId: idea.id });
    if (!step) throw apiError(404, 'not_found', 'Etapa não encontrada.');
    const rows = await this.dataSource
      .getRepository(Attachment)
      .find({ where: { stepId }, relations: { uploadedBy: true }, order: { createdAt: 'ASC' } });
    const deletable = can.manageSteps && !isClosed(idea.status) && step.completedAt === null;
    return rows.map((a) => this.view(a, deletable));
  }

  /** Envio: etapa aberta, ideia em andamento; quem gerencia etapas ou o responsável pela etapa. */
  async upload(
    access: Access,
    refValue: string,
    stepId: string,
    file: IncomingFile | undefined,
  ): Promise<AttachmentView> {
    const { originalName, extension } = await this.checkFile(file);
    const content = (file as IncomingFile).buffer;
    const size = (file as IncomingFile).size;
    const storedName = AttachmentStorage.storedName(extension);

    const saved = await this.dataSource
      .transaction(async (m) => {
        const visible = await this.ideas.findVisible(access, refValue, m);
        const idea = await this.ideas.lock(m, visible.idea.id);
        if (isClosed(idea.status)) throw apiError(409, 'idea_closed', 'Ideia encerrada: somente leitura.');
        if (idea.status !== IdeaStatus.InProgress)
          throw apiError(409, 'idea_not_in_progress', 'A ideia não está em andamento.');
        const step = await m.getRepository(Step).findOneBy({ id: stepId, ideaId: idea.id });
        if (!step) throw apiError(404, 'not_found', 'Etapa não encontrada.');
        const canManage = access.hasIn('step.manage', idea.entityId);
        if (!canManage && step.assigneeId !== access.userId) {
          throw apiError(403, 'forbidden', 'Só o responsável pela etapa ou quem gerencia etapas anexa arquivos.');
        }
        if (step.completedAt) throw apiError(409, 'step_completed', 'A etapa já foi concluída.');
        const repo = m.getRepository(Attachment);
        const row = await repo.save(
          repo.create({
            ideaId: idea.id,
            stepId: step.id,
            originalName,
            storedName,
            mime: mimeFor(extension),
            sizeBytes: size,
            uploadedById: access.userId,
          }),
        );
        // O arquivo é gravado antes do commit; se a gravação falhar, a transação é desfeita.
        await this.storage.save(storedName, content);
        await recordEvent(m, {
          ideaId: idea.id,
          type: 'attachment_added',
          actorId: access.userId,
          data: { position: step.position, name: originalName },
        });
        return { row, canManage };
      })
      .catch(async (e: unknown) => {
        await this.storage.remove([storedName]);
        throw e;
      });
    const row = await this.dataSource
      .getRepository(Attachment)
      .findOneOrFail({ where: { id: saved.row.id }, relations: { uploadedBy: true } });
    return this.view(row, saved.canManage);
  }

  /** Download com escopo (CA-RN-21.4). */
  async download(
    access: Access,
    refValue: string,
    attachmentId: string,
  ): Promise<{ attachment: Attachment; content: Buffer }> {
    const { idea } = await this.ideas.findVisible(access, refValue);
    const attachment = await this.dataSource.getRepository(Attachment).findOneBy({ id: attachmentId, ideaId: idea.id });
    if (!attachment) throw apiError(404, 'not_found', 'Anexo não encontrado.');
    try {
      return { attachment, content: await this.storage.read(attachment.storedName) };
    } catch {
      throw apiError(404, 'not_found', 'Arquivo não encontrado no armazenamento.');
    }
  }

  /**
   * Remover. Anexo de etapa: só em etapa aberta, por quem tem `step.manage` (CA-RN-21.3). Anexo da ideia:
   * quem o enviou enquanto a ideia está Enviada ou Em análise, ou quem tria (RN-146).
   */
  async remove(access: Access, refValue: string, attachmentId: string): Promise<void> {
    const storedName = await this.dataSource.transaction(async (m) => {
      const visible = await this.ideas.findVisible(access, refValue, m);
      const idea = await this.ideas.lock(m, visible.idea.id);
      const attachment = await m.getRepository(Attachment).findOneBy({ id: attachmentId, ideaId: idea.id });
      if (!attachment) throw apiError(404, 'not_found', 'Anexo não encontrado.');
      if (attachment.stepId === null) {
        if (isClosed(idea.status)) throw apiError(409, 'idea_closed', 'Ideia encerrada: somente leitura.');
        if (!this.ideaRights(access, idea).remove(attachment)) {
          throw apiError(403, 'forbidden', 'Você não pode remover este anexo agora.');
        }
      } else if (!access.hasIn('step.manage', idea.entityId)) {
        throw apiError(403, 'forbidden', 'Você não gerencia etapas desta entidade.');
      }
      if (isClosed(idea.status)) throw apiError(409, 'idea_closed', 'Ideia encerrada: somente leitura.');
      // Um anexo mostrado num pedido de aprovação aberto fica até o pedido fechar (M24, CA-RN-184.5).
      if (await attachmentInOpenApproval(m, attachment.id)) {
        throw apiError(409, 'attachment_in_approval', 'Este anexo está num pedido de aprovação aberto.');
      }
      const step = attachment.stepId ? await m.getRepository(Step).findOneBy({ id: attachment.stepId }) : null;
      if (step?.completedAt) throw apiError(409, 'step_completed', 'A etapa já foi concluída: o anexo fica.');
      await m.getRepository(Attachment).delete(attachment.id);
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'attachment_removed',
        actorId: access.userId,
        data: { position: step?.position ?? null, name: attachment.originalName },
      });
      return attachment.storedName;
    });
    await this.storage.remove([storedName]);
  }
}
