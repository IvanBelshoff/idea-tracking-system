import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { apiError } from '../common/api-error.js';
import type { RichDoc } from '../common/rich-text.js';
import type { User } from '../identity-access/entities/user.entity.js';
import { photoVersions } from '../identity-access/photo-versions.js';

/** O autor com a foto; quem ligou o opt-out (RN-70) mostra a foto só a si e a quem administra (RN-91). */
function personRef(u: User, photos: Map<string, string>, access: Access) {
  const hidden = u.hideName && u.id !== access.userId && !access.has('user.manage');
  return { id: u.id, name: u.name, photoVersion: hidden ? null : (photos.get(u.id) ?? null) };
}

import type { Access } from '../identity-access/access.js';
import { Comment, IdeaEvent, Visibility } from './entities/idea-related.entity.js';
import type { CommentView, TimelineEvent } from './ideas.dto.js';
import { IdeasService, recordEvent } from './ideas.service.js';

/**
 * Comentários (RN-28) e linha do tempo (RN-38, RN-58). O que é interno só aparece para quem tem
 * `idea.comment_internal` na entidade; o autor nunca vê, nem pela API (CA-RN-28.1, CA-RN-38.3).
 * Comentar continua permitido em ideia encerrada (CA-RN-08.2).
 */
@Injectable()
export class IdeaActivityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ideas: IdeasService,
  ) {}

  async comments(access: Access, refValue: string): Promise<CommentView[]> {
    const { idea, can } = await this.ideas.findVisible(access, refValue);
    const qb = this.dataSource
      .getRepository(Comment)
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.author', 'author')
      .leftJoinAndSelect('c.sourceIntegration', 'via')
      .where('c.idea_id = :id', { id: idea.id })
      .orderBy('c.created_at', 'ASC');
    if (!can.commentInternal) qb.andWhere('c.visibility = :pub', { pub: Visibility.Public });
    const comments = await qb.getMany();
    const photos = await photoVersions(
      this.dataSource.manager,
      comments.map((c) => c.authorId),
    );
    return comments.map((c) => ({
      id: c.id,
      body: c.body,
      bodyRich: c.bodyRich,
      visibility: c.visibility,
      author: c.author ? personRef(c.author, photos, access) : null,
      viaIntegration: c.sourceIntegration?.name ?? null,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  async addComment(
    access: Access,
    refValue: string,
    input: { body: string; bodyRich?: RichDoc | null; visibility: Visibility },
  ): Promise<CommentView> {
    return this.dataSource.transaction(async (m) => {
      const { idea, can } = await this.ideas.findVisible(access, refValue, m);
      if (!can.comment) throw apiError(403, 'forbidden', 'Você não pode comentar nesta ideia.');
      if (input.visibility === Visibility.Internal && !can.commentInternal) {
        throw apiError(403, 'forbidden', 'Só a equipe escreve comentários internos.');
      }
      const repo = m.getRepository(Comment);
      const c = await repo.save(
        repo.create({
          ideaId: idea.id,
          authorId: access.userId,
          body: input.body,
          bodyRich: input.bodyRich ?? null,
          visibility: input.visibility,
        }),
      );
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'comment_added',
        actorId: access.userId,
        visibility: input.visibility,
        data: { commentId: c.id },
      });
      const author = await m.getRepository(Comment).findOneOrFail({ where: { id: c.id }, relations: { author: true } });
      return {
        id: c.id,
        body: c.body,
        bodyRich: c.bodyRich,
        visibility: c.visibility,
        author: author.author ? personRef(author.author, await photoVersions(m, [author.author.id]), access) : null,
        viaIntegration: null,
        createdAt: c.createdAt.toISOString(),
      };
    });
  }

  /** Linha do tempo em ordem: cada mudança com quem fez e quando (CA-RN-58.1). */
  async timeline(access: Access, refValue: string): Promise<TimelineEvent[]> {
    const { idea, can } = await this.ideas.findVisible(access, refValue);
    const qb = this.dataSource
      .getRepository(IdeaEvent)
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.actor', 'actor')
      .where('e.idea_id = :id', { id: idea.id })
      .orderBy('e.id', 'ASC');
    if (!can.commentInternal) qb.andWhere('e.visibility = :pub', { pub: Visibility.Public });
    return (await qb.getMany()).map((e) => ({
      id: e.id,
      type: e.type,
      at: e.at.toISOString(),
      actor: e.actor ? { id: e.actor.id, name: e.actor.name } : null,
      reason: e.reason,
      data: e.data,
      visibility: e.visibility,
    }));
  }
}
