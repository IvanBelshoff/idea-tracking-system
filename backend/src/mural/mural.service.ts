import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import type { Idea } from '../ideas/entities/idea.entity.js';
import { IdeasService, recordEvent } from '../ideas/ideas.service.js';
import type { Access } from '../identity-access/access.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { SettingsService } from '../organization/settings.service.js';
import { MuralConsent, MuralPost, MuralStatus } from './entities.js';
import type { MuralPublicationView } from './mural.dto.js';
import { findIdeaByRef, ideaNotFound as notFound, participantsOf } from './mural-common.js';
import { notifyParticipants } from './mural-notify.js';
import { isPublishable } from './mural-rules.js';

/**
 * Mural de ideias (M21, RN-148 a RN-158). Esta parte: publicar, retirar e o consentimento do nome.
 * Com o módulo desligado, toda rota responde 404 (CA-RN-148.1).
 */
@Injectable()
export class MuralService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly ideas: IdeasService,
    private readonly audit: AuditService,
  ) {}

  async assertEnabled(): Promise<void> {
    if (!(await this.settings.get('mural.enabled'))) throw apiError(404, 'not_found', 'O mural está desligado.');
  }

  private async canSee(access: Access, ideaId: string): Promise<boolean> {
    try {
      await this.ideas.findVisible(access, ideaId);
      return true;
    } catch {
      return false;
    }
  }

  private isPublished(ideaId: string): Promise<boolean> {
    return this.dataSource.getRepository(MuralPost).existsBy({ ideaId, status: MuralStatus.Published });
  }

  /**
   * A ideia para publicar ou retirar: exige `mural.manage` na entidade dela (RN-148). Sem a
   * permissão, 403 para quem enxerga a ideia (pela RN-01 ou no mural) e 404 para quem nem a vê (CA-T.5).
   */
  private async managed(access: Access, ref: string): Promise<Idea> {
    const idea = await findIdeaByRef(this.dataSource.manager, ref);
    if (access.hasIn('mural.manage', idea.entityId)) return idea;
    const sees = (await this.isPublished(idea.id)) || (await this.canSee(access, idea.id));
    throw sees ? apiError(403, 'forbidden', 'Você não publica no mural ideias desta entidade.') : notFound();
  }

  /** Estado da publicação, para quem vê a ideia (RN-149, RN-151). */
  async publication(access: Access, ref: string): Promise<MuralPublicationView> {
    await this.assertEnabled();
    const { idea } = await this.ideas.findVisible(access, ref);
    const [post, consent] = await Promise.all([
      this.dataSource.getRepository(MuralPost).findOneBy({ ideaId: idea.id }),
      this.dataSource.getRepository(MuralConsent).findOneBy({ ideaId: idea.id, userId: access.userId }),
    ]);
    return {
      status: post ? post.status : 'none',
      publishable: isPublishable(idea.status) && !idea.archivedAt && !idea.convergedIntoId,
      publishedAt: post?.publishedAt.toISOString() ?? null,
      withdrawnAt: post?.status === MuralStatus.Withdrawn ? (post.withdrawnAt?.toISOString() ?? null) : null,
      withdrawnReason: post?.status === MuralStatus.Withdrawn ? post.withdrawnReason : null,
      withdrawnAutomatically: post?.status === MuralStatus.Withdrawn && post.withdrawnById === null,
      canManage: access.hasIn('mural.manage', idea.entityId),
      myConsent: consent?.status ?? null,
    };
  }

  /**
   * Publicar (RN-149): só Em andamento ou Implementada, não arquivada nem convergida. Publicar de
   * novo uma retirada reusa a linha (reações e conversa voltam). Os participantes (autor e
   * co-autores) ganham o consentimento pendente: anônimos até aceitarem (RN-151).
   */
  async publish(access: Access, ref: string, meta: RequestMeta): Promise<MuralPublicationView> {
    await this.assertEnabled();
    const target = await this.managed(access, ref);
    await this.dataSource.transaction(async (m) => {
      const idea = await this.ideas.lock(m, target.id);
      if (idea.archivedAt) throw notFound();
      if (idea.convergedIntoId) {
        throw apiError(422, 'idea_converged', 'Ideia convergida: publique a principal.');
      }
      if (!isPublishable(idea.status)) {
        throw apiError(422, 'not_publishable', 'Só ideias Em andamento ou Implementadas vão ao mural.');
      }
      const repo = m.getRepository(MuralPost);
      const post = await repo.findOneBy({ ideaId: idea.id });
      if (post?.status === MuralStatus.Published) {
        throw apiError(409, 'already_published', 'Esta ideia já está no mural.');
      }
      const now = new Date();
      const values = {
        status: MuralStatus.Published,
        publishedAt: now,
        publishedById: access.userId,
        withdrawnAt: null,
        withdrawnById: null,
        withdrawnReason: null,
      };
      if (post) await repo.update({ ideaId: idea.id }, values);
      else await repo.insert({ ideaId: idea.id, ...values });

      const people = (await participantsOf(m, [idea])).get(idea.id) ?? new Map();
      if (people.size > 0) {
        await m
          .getRepository(MuralConsent)
          .createQueryBuilder()
          .insert()
          .values([...people].map(([userId, role]) => ({ ideaId: idea.id, userId, role })))
          .orIgnore()
          .execute();
      }
      await recordEvent(m, { ideaId: idea.id, type: 'mural_published', actorId: access.userId });
      // Os participantes ficam sabendo e podem escolher mostrar o nome (RN-151, RN-156).
      await notifyParticipants(m, idea, 'mural_published');
      await this.audit.record(
        {
          action: 'mural.published',
          actorId: access.userId,
          targetType: 'idea',
          targetId: idea.id,
          data: { code: idea.code, republished: post !== null },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.publication(access, target.id);
  }

  /** Retirar (RN-149): com motivo; reações, conversa e consentimentos ficam guardados. */
  async withdraw(access: Access, ref: string, reason: string, meta: RequestMeta): Promise<MuralPublicationView> {
    await this.assertEnabled();
    const target = await this.managed(access, ref);
    await this.dataSource.transaction(async (m) => {
      const idea = await this.ideas.lock(m, target.id);
      const repo = m.getRepository(MuralPost);
      const post = await repo.findOneBy({ ideaId: idea.id });
      if (post?.status !== MuralStatus.Published) {
        throw apiError(409, 'not_published', 'Esta ideia não está no mural.');
      }
      await repo.update(
        { ideaId: idea.id },
        {
          status: MuralStatus.Withdrawn,
          withdrawnAt: new Date(),
          withdrawnById: access.userId,
          withdrawnReason: reason,
        },
      );
      await recordEvent(m, { ideaId: idea.id, type: 'mural_withdrawn', actorId: access.userId, reason });
      await notifyParticipants(m, idea, 'mural_withdrawn', { reason });
      await this.audit.record(
        {
          action: 'mural.withdrawn',
          actorId: access.userId,
          targetType: 'idea',
          targetId: idea.id,
          data: { code: idea.code, automatic: false },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.publication(access, target.id);
  }

  /** O participante decide por si se mostra o nome; pode mudar a qualquer momento (RN-151). */
  async consent(access: Access, ref: string, accept: boolean): Promise<MuralPublicationView> {
    await this.assertEnabled();
    const { idea } = await this.ideas.findVisible(access, ref);
    const m = this.dataSource.manager;
    // Participante ATUAL (quem virou co-autor depois de publicar também responde) de ideia já publicada.
    const role = (await participantsOf(m, [idea])).get(idea.id)?.get(access.userId);
    const posted = await m.getRepository(MuralPost).existsBy({ ideaId: idea.id });
    if (!role || !posted) {
      throw apiError(403, 'forbidden', 'Só quem participa de uma ideia publicada responde ao consentimento.');
    }
    await m.query(
      `INSERT INTO mural_consent (idea_id, user_id, role, status, answered_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (idea_id, user_id) DO UPDATE SET status = EXCLUDED.status, answered_at = now()`,
      [idea.id, access.userId, role, accept ? 'accepted' : 'declined'],
    );
    return this.publication(access, idea.id);
  }
}
