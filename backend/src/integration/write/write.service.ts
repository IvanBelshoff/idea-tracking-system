import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service.js';
import { apiError } from '../../common/api-error.js';
import { Idea, IdeaStatus } from '../../ideas/entities/idea.entity.js';
import { Comment, Visibility } from '../../ideas/entities/idea-related.entity.js';
import { convergedError, IdeasService, notFound, recordEvent } from '../../ideas/ideas.service.js';
import { isClosed } from '../../ideas/lifecycle.js';
import { ResultsService } from '../../ideas/results.service.js';
import { AccessService } from '../../identity-access/access.service.js';
import { User, UserStatus } from '../../identity-access/entities/user.entity.js';
import type { IntegrationPrincipal } from '../principal.js';
import type { GainWriteInput, IdeaSubmitInput } from './write-schemas.js';

export interface IdeaSubmitResult {
  code: string;
  status: string;
  entity_id: string;
}

/**
 * As quatro gravações da API de integração (M18, RN-127 a RN-133). Cada uma passa pelo MESMO serviço
 * da tela (mesmas validações, histórico, avisos e travas) e confere o escopo da integração; a
 * integração nunca decide nada (RN-132). O que ela grava leva a origem ("via Integração X") e vai
 * para a auditoria, sem o texto do comentário nem o corpo da chamada (RN-133).
 */
@Injectable()
export class IntegrationWriteService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly ideas: IdeasService,
    private readonly results: ResultsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Enviar ideia (RN-127): a autoria vem do e-mail. A pessoa precisa estar ativa e ter permissão de
   * enviar naquela entidade; a integração nunca dá a ninguém mais do que a pessoa teria na tela.
   */
  async submitIdea(p: IntegrationPrincipal, input: IdeaSubmitInput): Promise<IdeaSubmitResult> {
    if (!p.scopeEntityIds.includes(input.entity_id)) {
      throw apiError(422, 'entity_not_in_scope', 'A entidade não está no escopo desta integração.');
    }
    const author = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .where('lower(u.email) = :email', { email: input.author_email })
      .getOne();
    if (!author || author.status !== UserStatus.Active) {
      throw apiError(422, 'author_not_found', 'Não há uma pessoa ativa com este e-mail.');
    }
    const authorAccess = await this.access.load(author.id);
    if (!authorAccess.hasIn('idea.submit', input.entity_id)) {
      throw apiError(422, 'author_cannot_submit', 'Esta pessoa não pode enviar ideias para esta entidade.');
    }
    const detail = await this.ideas.submit(
      authorAccess,
      {
        title: input.title,
        description: input.description,
        entityId: input.entity_id,
        categoryId: input.category_id ?? null,
        tagIds: [],
        proposedSolution: input.proposed_solution,
        expectedGain: null,
        externalRef: input.external_ref,
        campaignId: input.campaign_id ?? null,
        sourceIntegration: { id: p.id, name: p.name },
      },
      {
        eventData: {},
        // Na mesma transação do envio: se a auditoria falhar, a ideia não fica sem registro.
        run: (m, idea) =>
          this.record(m, 'integration.idea_submitted', p, idea, { code: idea.code, entityId: idea.entityId }),
      },
    );
    return { code: detail.code, status: detail.status, entity_id: input.entity_id };
  }

  /** Comentar (RN-128): sempre público, em nome da integração, e permitido em ideia encerrada. */
  comment(p: IntegrationPrincipal, code: string, body: string) {
    return this.dataSource.transaction(async (m) => {
      const idea = await this.inScope(m, p, code);
      const repo = m.getRepository(Comment);
      const saved = await repo.save(
        repo.create({
          ideaId: idea.id,
          authorId: null,
          sourceIntegrationId: p.id,
          body,
          visibility: Visibility.Public,
        }),
      );
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'comment_added',
        actorId: null,
        visibility: Visibility.Public,
        data: { commentId: saved.id, integrationId: p.id, integrationName: p.name },
      });
      await this.record(m, 'integration.comment_added', p, idea, { code: idea.code });
      return { id: saved.id, idea_code: idea.code, created_at: saved.createdAt.toISOString() };
    });
  }

  /** Atualizar a referência externa (RN-129): só ideia não encerrada (RN-08); a mesma referência não gera histórico. */
  setExternalRef(p: IntegrationPrincipal, code: string, externalRef: string | null) {
    return this.dataSource.transaction(async (m) => {
      const found = await this.inScope(m, p, code);
      const idea = await this.ideas.lock(m, found.id);
      this.assertOpen(idea);
      if (idea.externalRef !== externalRef) {
        await m.getRepository(Idea).update(idea.id, { externalRef });
        await recordEvent(m, {
          ideaId: idea.id,
          type: 'external_ref_changed',
          actorId: null,
          data: { from: idea.externalRef, to: externalRef, integrationId: p.id, integrationName: p.name },
        });
        await this.record(m, 'integration.external_ref_changed', p, idea, { code: idea.code });
      }
      return { idea_code: idea.code, external_ref: externalRef };
    });
  }

  /** Registrar ganho declarado (RN-130): nunca valida e nunca mexe num ganho já validado. */
  declareGain(p: IntegrationPrincipal, code: string, input: GainWriteInput) {
    return this.dataSource.transaction(async (m) => {
      const found = await this.inScope(m, p, code);
      const idea = await this.ideas.lock(m, found.id);
      // Como na tela: o realizado só entra depois de implementada, então Implementada ainda aceita ganho.
      if (idea.convergedIntoId) throw convergedError();
      if (idea.archivedAt || idea.status === IdeaStatus.Rejected) {
        throw apiError(409, 'idea_closed', 'Ideia não autorizada ou arquivada não recebe resultado.');
      }
      await this.results.saveGain(
        m,
        idea,
        {
          currency: input.currency,
          periodicity: input.periodicity,
          estimated: input.estimated,
          realized: input.realized,
          implementationCost: input.implementation_cost,
        },
        { actorId: null, declaredOnly: true, eventData: { integrationId: p.id, integrationName: p.name } },
      );
      await this.record(m, 'integration.gain_declared', p, idea, { code: idea.code });
      return { idea_code: idea.code, status: 'declared' as const };
    });
  }

  // --- auxiliares ---------------------------------------------------------------------------------

  /** A ideia pelo identificador, só se estiver no escopo da integração: o resto é 404, sem revelar (RN-132). */
  private async inScope(m: EntityManager, p: IntegrationPrincipal, code: string): Promise<Idea> {
    const idea = await m
      .getRepository(Idea)
      .createQueryBuilder('i')
      .where('lower(i.code) = lower(:code)', { code: code.trim() })
      .getOne();
    if (!idea || !p.scopeEntityIds.includes(idea.entityId)) throw notFound();
    return idea;
  }

  /** Ideia encerrada, arquivada ou unida a outra não tem a referência alterada (RN-08, RN-64). */
  private assertOpen(idea: Idea): void {
    if (idea.convergedIntoId) throw convergedError();
    if (isClosed(idea.status) || idea.archivedAt) {
      throw apiError(409, 'idea_closed', 'Ideia encerrada: somente leitura.');
    }
  }

  /** Auditoria da escrita (RN-133): quem agiu foi a integração, então o autor do registro é nulo. */
  private record(
    m: EntityManager,
    action: string,
    p: IntegrationPrincipal,
    idea: Idea,
    data: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(
      {
        action,
        actorId: null,
        targetType: 'idea',
        targetId: idea.id,
        data: { integrationId: p.id, integration: p.name, ...data },
      },
      m,
    );
  }
}
