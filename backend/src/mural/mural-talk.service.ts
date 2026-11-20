import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, IsNull } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import type { Idea } from '../ideas/entities/idea.entity.js';
import type { Access } from '../identity-access/access.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { photoVersions } from '../identity-access/photo-versions.js';
import { MuralComment, MuralCommentRevision, MuralPost, MuralReport, MuralShare, MuralStatus } from './entities.js';
import type { CommentRevisionView, MuralCommentView, ReportQueueItem } from './mural.dto.js';
import { MuralService } from './mural.service.js';
import { consentsOf, findPublished, participantsOf, personView } from './mural-common.js';
import { bumpDigest, bumpGrouped, bumpReports, notifyOne } from './mural-notify.js';
import type { ReportReason } from './mural-rules.js';
import { buildThread } from './mural-views.js';

/** Limites por pessoa e por hora (RN-153, RN-155), fixos no código. */
export const COMMENTS_PER_HOUR = 30;
export const SHARES_PER_HOUR = 20;

const commentNotFound = () => apiError(404, 'not_found', 'Comentário não encontrado.');

/**
 * A conversa do mural (RN-153), a denúncia e a moderação (RN-154) e o enviar a um colega (RN-155).
 * Separada dos comentários da ideia (RN-28): nada daqui aparece lá, nem o contrário.
 */
@Injectable()
export class MuralTalkService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mural: MuralService,
    private readonly audit: AuditService,
  ) {}

  private thread(access: Access, idea: Pick<Idea, 'id' | 'authorId' | 'entityId'>): Promise<MuralCommentView[]> {
    return buildThread(this.dataSource.manager, access, idea, access.hasIn('mural.manage', idea.entityId));
  }

  /**
   * O comentário com a ideia dele, que precisa estar no mural agora (retirada: a conversa fica fora
   * da vista, CA-RN-153.7). Comentário removido conta como inexistente.
   */
  private async loadComment(m: EntityManager, id: string, lock = false): Promise<{ c: MuralComment; idea: Idea }> {
    const c = await m.getRepository(MuralComment).findOne({
      where: { id },
      relations: { idea: true },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const, tables: ['mural_comment'] } } : {}),
    });
    if (!c || c.deletedAt) throw commentNotFound();
    const published = await m.getRepository(MuralPost).existsBy({ ideaId: c.ideaId, status: MuralStatus.Published });
    if (!published) throw commentNotFound();
    return { c, idea: c.idea };
  }

  private assertManage(access: Access, idea: Pick<Idea, 'entityId'>): void {
    if (!access.hasIn('mural.manage', idea.entityId)) {
      throw apiError(403, 'forbidden', 'Você não modera o mural desta entidade.');
    }
  }

  /**
   * Comentar ou responder (RN-153): publicado na hora. Responder a uma resposta grava no comentário de
   * origem (um nível só). Não se responde a comentário removido ou oculto. 30 por hora por pessoa.
   */
  async comment(access: Access, ref: string, body: string, parentId: string | null): Promise<MuralCommentView[]> {
    await this.mural.assertEnabled();
    const m = this.dataSource.manager;
    const { idea } = await findPublished(m, ref);
    let parent: string | null = null;
    let repliedTo: MuralComment | null = null;
    if (parentId) {
      const p = await m.getRepository(MuralComment).findOneBy({ id: parentId, ideaId: idea.id });
      if (!p) throw apiError(422, 'invalid_parent', 'O comentário respondido não existe nesta ideia.');
      if (p.deletedAt || p.hiddenAt) {
        throw apiError(422, 'comment_unavailable', 'Não dá para responder a um comentário removido ou oculto.');
      }
      parent = p.parentId ?? p.id;
      repliedTo = p;
    }
    await this.dataSource.transaction(async (tx) => {
      // Trava por pessoa: duas gravações em paralelo não furam o limite.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`mural_comment:${access.userId}`]);
      const [row]: { n: string }[] = await tx.query(
        `SELECT count(*) AS n FROM mural_comment WHERE author_id = $1 AND created_at > now() - interval '1 hour'`,
        [access.userId],
      );
      if (Number(row?.n ?? 0) >= COMMENTS_PER_HOUR) {
        throw apiError(429, 'too_many_comments', `No máximo ${COMMENTS_PER_HOUR} comentários por hora.`);
      }
      const repo = tx.getRepository(MuralComment);
      await repo.save(repo.create({ ideaId: idea.id, parentId: parent, authorId: access.userId, body }));
      // Avisos agrupados (RN-156): o resumo do dia aos participantes e, na resposta, a quem foi respondido.
      await bumpDigest(tx, idea, access.userId, { comments: 1 });
      if (repliedTo?.authorId && repliedTo.authorId !== access.userId) {
        await bumpGrouped(tx, {
          userId: repliedTo.authorId,
          type: 'mural_reply',
          idea,
          group: repliedTo.id,
          counts: { replies: 1 },
        });
      }
    });
    return this.thread(access, idea);
  }

  /** Editar o próprio comentário (RN-153): marca "editado" e guarda o texto anterior para a equipe. */
  async edit(access: Access, id: string, body: string): Promise<MuralCommentView[]> {
    await this.mural.assertEnabled();
    const idea = await this.dataSource.transaction(async (m) => {
      const { c, idea } = await this.loadComment(m, id, true);
      if (c.authorId !== access.userId) throw apiError(403, 'forbidden', 'Só quem escreveu edita o comentário.');
      if (c.hiddenAt) throw apiError(409, 'comment_hidden', 'Comentário oculto pela equipe não pode ser editado.');
      if (c.body !== body) {
        const rev = m.getRepository(MuralCommentRevision);
        await rev.save(rev.create({ commentId: c.id, body: c.body }));
        await m.getRepository(MuralComment).update(c.id, { body, editedAt: new Date() });
      }
      return idea;
    });
    return this.thread(access, idea);
  }

  /**
   * Apagar o próprio comentário (RN-153): com respostas, fica "Comentário removido" no lugar (as
   * respostas continuam); sem respostas, sai de vez.
   */
  async remove(access: Access, id: string): Promise<MuralCommentView[]> {
    await this.mural.assertEnabled();
    const idea = await this.dataSource.transaction(async (m) => {
      const { c, idea } = await this.loadComment(m, id, true);
      if (c.authorId !== access.userId) throw apiError(403, 'forbidden', 'Só quem escreveu apaga o comentário.');
      const repo = m.getRepository(MuralComment);
      const hasReplies = c.parentId === null && (await repo.existsBy({ parentId: c.id }));
      if (hasReplies) await repo.update(c.id, { deletedAt: new Date() });
      else await repo.delete(c.id);
      return idea;
    });
    return this.thread(access, idea);
  }

  /** Textos anteriores de um comentário editado: só a equipe (RN-153). */
  async revisions(access: Access, id: string): Promise<CommentRevisionView[]> {
    await this.mural.assertEnabled();
    const { c, idea } = await this.loadComment(this.dataSource.manager, id);
    this.assertManage(access, idea);
    const rows = await this.dataSource
      .getRepository(MuralCommentRevision)
      .find({ where: { commentId: c.id }, order: { createdAt: 'ASC', id: 'ASC' } });
    return rows.map((r) => ({ body: r.body, replacedAt: r.createdAt.toISOString() }));
  }

  /** Denunciar (RN-154): uma vez por pessoa, nunca o próprio comentário nem um já oculto. */
  async report(access: Access, id: string, reason: ReportReason, note: string | null): Promise<MuralCommentView[]> {
    await this.mural.assertEnabled();
    const m = this.dataSource.manager;
    const { c, idea } = await this.loadComment(m, id);
    if (c.authorId === access.userId) throw apiError(422, 'own_comment', 'Não dá para denunciar o próprio comentário.');
    if (c.hiddenAt) throw apiError(422, 'comment_hidden', 'Este comentário já está oculto.');
    await this.dataSource.transaction(async (tx) => {
      // A unicidade (comentário, quem denunciou) decide, também em paralelo.
      const inserted: { id: string }[] = await tx.query(
        `INSERT INTO mural_report (id, comment_id, reporter_id, reason, note) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ON CONSTRAINT uq_mural_report_reporter DO NOTHING RETURNING id`,
        [uuidv7(), c.id, access.userId, reason, note || null],
      );
      if (inserted.length === 0) throw apiError(422, 'already_reported', 'Você já denunciou este comentário.');
      // A equipe que modera na entidade da ideia recebe o aviso agrupado (RN-154, RN-156).
      await bumpReports(tx, idea, access.userId);
    });
    return this.thread(access, idea);
  }

  /**
   * Ocultar (RN-154): a equipe, com motivo; resolve as denúncias pendentes como "ocultado". Quem
   * escreveu continua vendo o próprio texto, marcado; o aviso a ele sai com os avisos do mural.
   */
  async hide(access: Access, id: string, reason: string, meta: RequestMeta): Promise<MuralCommentView[]> {
    await this.mural.assertEnabled();
    const idea = await this.dataSource.transaction(async (m) => {
      const { c, idea } = await this.loadComment(m, id, true);
      this.assertManage(access, idea);
      if (c.hiddenAt) throw apiError(409, 'comment_hidden', 'Este comentário já está oculto.');
      await m
        .getRepository(MuralComment)
        .update(c.id, { hiddenAt: new Date(), hiddenById: access.userId, hiddenReason: reason });
      const resolved = await this.resolveReports(m, c.id, access.userId, 'hidden');
      // Quem escreveu é avisado, com o motivo; quem denunciou não é revelado (RN-154).
      if (c.authorId) await notifyOne(m, c.authorId, 'mural_comment_hidden', idea, { reason });
      await this.audit.record(
        {
          action: 'mural.comment_hidden',
          actorId: access.userId,
          targetType: 'mural_comment',
          targetId: c.id,
          data: { ideaCode: idea.code, reports: resolved },
          ip: meta.ip,
        },
        m,
      );
      return idea;
    });
    return this.thread(access, idea);
  }

  /** Restaurar um comentário oculto (RN-154). */
  async restore(access: Access, id: string, meta: RequestMeta): Promise<MuralCommentView[]> {
    await this.mural.assertEnabled();
    const idea = await this.dataSource.transaction(async (m) => {
      const { c, idea } = await this.loadComment(m, id, true);
      this.assertManage(access, idea);
      if (!c.hiddenAt) throw apiError(409, 'comment_visible', 'Este comentário não está oculto.');
      await m.getRepository(MuralComment).update(c.id, { hiddenAt: null, hiddenById: null, hiddenReason: null });
      await this.audit.record(
        {
          action: 'mural.comment_restored',
          actorId: access.userId,
          targetType: 'mural_comment',
          targetId: c.id,
          data: { ideaCode: idea.code },
          ip: meta.ip,
        },
        m,
      );
      return idea;
    });
    return this.thread(access, idea);
  }

  /** Dispensar as denúncias pendentes de um comentário (RN-154). */
  async dismiss(access: Access, id: string, meta: RequestMeta): Promise<ReportQueueItem[]> {
    await this.mural.assertEnabled();
    await this.dataSource.transaction(async (m) => {
      const { c, idea } = await this.loadComment(m, id, true);
      this.assertManage(access, idea);
      const resolved = await this.resolveReports(m, c.id, access.userId, 'dismissed');
      if (resolved === 0) throw apiError(409, 'no_pending_reports', 'Este comentário não tem denúncia pendente.');
      await this.audit.record(
        {
          action: 'mural.reports_dismissed',
          actorId: access.userId,
          targetType: 'mural_comment',
          targetId: c.id,
          data: { ideaCode: idea.code, reports: resolved },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.queue(access);
  }

  private async resolveReports(
    m: EntityManager,
    commentId: string,
    actorId: string,
    resolution: 'hidden' | 'dismissed',
  ): Promise<number> {
    const res = await m
      .getRepository(MuralReport)
      .update({ commentId, resolvedAt: IsNull() }, { resolvedAt: new Date(), resolvedById: actorId, resolution });
    return res.affected ?? 0;
  }

  /**
   * A fila de denúncias pendentes (RN-154), das ideias das entidades onde a pessoa modera, agrupadas
   * por comentário. Quem denunciou não aparece; o autor do comentário aparece pelo nome (a equipe vê).
   */
  async queue(access: Access): Promise<ReportQueueItem[]> {
    await this.mural.assertEnabled();
    const entities = access.entities('mural.manage');
    if (entities.length === 0) throw apiError(403, 'forbidden', 'Você não modera o mural.');
    const m = this.dataSource.manager;
    const pending = await m
      .getRepository(MuralReport)
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.comment', 'c')
      .innerJoinAndSelect('c.idea', 'i')
      .leftJoinAndSelect('c.author', 'a')
      .innerJoin(MuralPost, 'p', `p.idea_id = i.id AND p.status = 'published'`)
      .where('r.resolved_at IS NULL')
      .andWhere('c.deleted_at IS NULL AND c.hidden_at IS NULL')
      .andWhere('i.entity_id IN (:...entities)', { entities })
      .orderBy('r.created_at', 'ASC')
      .take(1000)
      .getMany();
    const ideas = [...new Map(pending.map((r) => [r.comment.ideaId, r.comment.idea])).values()];
    const [participants, consents, photos] = await Promise.all([
      participantsOf(m, ideas),
      consentsOf(
        m,
        ideas.map((i) => i.id),
      ),
      photoVersions(
        m,
        pending.map((r) => r.comment.authorId),
      ),
    ]);
    const groups = new Map<string, MuralReport[]>();
    for (const r of pending) groups.set(r.commentId, [...(groups.get(r.commentId) ?? []), r]);
    return [...groups.values()].map((list) => {
      const first = list[0] as MuralReport;
      const c = first.comment;
      const reasons = new Map<string, number>();
      for (const r of list) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
      return {
        commentId: c.id,
        ideaCode: c.idea.code,
        ideaTitle: c.idea.title,
        author: personView(c.author, {
          participant: c.authorId ? (participants.get(c.ideaId)?.get(c.authorId) ?? null) : null,
          consent: c.authorId ? (consents.get(c.ideaId)?.get(c.authorId) ?? null) : null,
          reveal: true,
          photos,
        }),
        body: c.body,
        commentedAt: c.createdAt.toISOString(),
        count: list.length,
        reasons: [...reasons].map(([reason, count]) => ({ reason, count })),
        notes: list.filter((r) => r.note).map((r) => ({ reason: r.reason, note: r.note as string })),
        firstReportedAt: first.createdAt.toISOString(),
      };
    });
  }

  /**
   * Enviar a um colega (RN-155): pessoa ativa da organização, mensagem opcional de até 300 caracteres;
   * 20 por hora por pessoa. O aviso no sino sai com os avisos do mural.
   */
  async share(access: Access, ref: string, recipientId: string, message: string | null): Promise<void> {
    await this.mural.assertEnabled();
    const m = this.dataSource.manager;
    const { idea } = await findPublished(m, ref);
    if (recipientId === access.userId) throw apiError(422, 'invalid_recipient', 'Escolha outra pessoa.');
    const recipient = await m
      .getRepository(User)
      .findOne({ where: { id: recipientId }, select: { id: true, status: true } });
    if (!recipient || recipient.status !== UserStatus.Active) {
      throw apiError(422, 'invalid_recipient', 'Escolha uma pessoa ativa da organização.');
    }
    await this.dataSource.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`mural_share:${access.userId}`]);
      const [row]: { n: string }[] = await tx.query(
        `SELECT count(*) AS n FROM mural_share WHERE sender_id = $1 AND created_at > now() - interval '1 hour'`,
        [access.userId],
      );
      if (Number(row?.n ?? 0) >= SHARES_PER_HOUR) {
        throw apiError(429, 'too_many_shares', `No máximo ${SHARES_PER_HOUR} envios por hora.`);
      }
      const repo = tx.getRepository(MuralShare);
      await repo.save(repo.create({ ideaId: idea.id, senderId: access.userId, recipientId, message: message || null }));
      // O nome de quem enviou, salvo se for participante anônimo da ideia: o aviso não pode ligar a
      // pessoa à ideia (RN-151); aí sai como "um colega".
      const sender = await tx.getRepository(User).findOneOrFail({
        where: { id: access.userId },
        select: { id: true, name: true, status: true, hideName: true },
      });
      const role = (await participantsOf(tx, [idea])).get(idea.id)?.get(access.userId) ?? null;
      const consent = role ? ((await consentsOf(tx, [idea.id])).get(idea.id)?.get(access.userId) ?? null) : null;
      const shown = personView(sender, { participant: role, consent, reveal: false, photos: new Map() });
      await notifyOne(tx, recipientId, 'mural_shared', idea, { senderName: shown.name, message: message || null });
    });
  }
}
