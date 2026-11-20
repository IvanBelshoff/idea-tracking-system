import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { dispatchNotifications } from '../communication/notify.js';
import type { Access } from '../identity-access/access.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { canBeConverged, canSupport, principalOf } from './convergence-rules.js';
import { type Idea, Idea as IdeaEntity } from './entities/idea.entity.js';
import { IdeaParticipant, ParticipantOrigin, ParticipantRole, Visibility } from './entities/idea-related.entity.js';
import { ideaCapabilities } from './idea-access.js';
import type { IdeaDetail } from './ideas.dto.js';
import { IdeasService, recordEvent } from './ideas.service.js';

const forbidden = (message: string) => apiError(403, 'forbidden', message);

/**
 * Convergência de pedidos iguais e co-autoria (RN-84 a RN-88, RN-69).
 *
 * Sempre "achatada": toda convergida aponta direto para a principal final. Assim uma cadeia
 * (A em B, B em C) termina com A e B em C (CA-RN-84.3), e A↔B vira "mesma principal" e é recusado.
 * As duas ideias são travadas na mesma ordem (por id) para duas convergências simultâneas não
 * travarem uma à outra nem deixarem estado misturado (CA-T.2).
 */
@Injectable()
export class ConvergenceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ideas: IdeasService,
  ) {}

  /** Trava as ideias em ordem de id e devolve o estado atual, na mesma ordem pedida. */
  private async lockAll(m: EntityManager, ids: string[]): Promise<Idea[]> {
    const locked = new Map<string, Idea>();
    for (const id of [...new Set(ids)].sort()) locked.set(id, await this.ideas.lock(m, id));
    return ids.map((id) => locked.get(id) as Idea);
  }

  /** Principal final de uma ideia (ela mesma, se não for convergida). */
  private root(idea: Idea): string {
    return idea.convergedIntoId ?? idea.id;
  }

  private async addCoAuthor(
    m: EntityManager,
    ideaId: string,
    userId: string,
    origin: ParticipantOrigin,
    actorId: string,
    extra: { note?: string | null; sourceIdeaId?: string | null } = {},
  ): Promise<boolean> {
    const repo = m.getRepository(IdeaParticipant);
    if (await repo.existsBy({ ideaId, userId })) return false;
    await repo.save(
      repo.create({
        ideaId,
        userId,
        role: ParticipantRole.CoAuthor,
        origin,
        note: extra.note ?? null,
        sourceIdeaId: extra.sourceIdeaId ?? null,
        addedById: actorId,
      }),
    );
    return true;
  }

  /**
   * O analista marca duas ideias como a mesma coisa (RN-85b). A mais antiga vira a principal
   * (CA-RN-84.1); a outra perde o fluxo próprio, leva junto as que já convergiam nela (CA-RN-84.4),
   * e o autor dela vira co-autor da principal (RN-86). Justificativa obrigatória (CA-RN-85.2).
   */
  async converge(access: Access, refValue: string, targetRef: string, reason: string): Promise<IdeaDetail> {
    const principalId = await this.dataSource.transaction(async (m) => {
      const a = (await this.ideas.findVisible(access, refValue, m)).idea;
      const b = (await this.ideas.findVisible(access, targetRef, m)).idea;
      const rootA = this.root(a);
      const rootB = this.root(b);
      if (rootA === rootB) {
        throw apiError(422, 'convergence_cycle', 'As duas ideias já são a mesma (ou uma já converge na outra).');
      }
      const [x, y] = await this.lockAll(m, [rootA, rootB]);
      if (!x || !y) throw apiError(404, 'not_found', 'Ideia não encontrada.');
      // Relido com a trava: outra pessoa pode ter convergido uma delas no meio do caminho.
      if (x.convergedIntoId || y.convergedIntoId) {
        throw apiError(409, 'stale_state', 'Uma das ideias acabou de mudar. Confira de novo antes de converger.');
      }
      const [principal, child] = principalOf(x, y);
      if (!access.hasIn('idea.converge', principal.entityId) || !access.hasIn('idea.converge', child.entityId)) {
        throw forbidden('Você não converge ideias destas entidades.');
      }
      if (principal.archivedAt || child.archivedAt)
        throw apiError(409, 'idea_archived', 'Ideia arquivada não converge.');
      if (!canBeConverged(child.status)) {
        throw apiError(
          409,
          'cannot_converge',
          `A ideia mais recente (${child.code}) já está ${child.status === 'in_progress' ? 'em andamento' : 'encerrada'}; só ideias ainda sem execução perdem o fluxo próprio.`,
          { code: child.code, status: child.status },
        );
      }

      const now = new Date();
      const ideas = m.getRepository(IdeaEntity);
      await ideas.update(child.id, {
        convergedIntoId: principal.id,
        convergedAt: now,
        convergedById: access.userId,
        convergedReason: reason,
      });
      // As que convergiam na mais nova passam a apontar para a principal final (CA-RN-84.3/84.4).
      await ideas.update({ convergedIntoId: child.id }, { convergedIntoId: principal.id });

      // Co-autores da mais nova vêm junto; quem já participa da principal não se repete.
      const participants = m.getRepository(IdeaParticipant);
      const moving = await participants.findBy({ ideaId: child.id, role: ParticipantRole.CoAuthor });
      const added: string[] = [];
      for (const p of moving) {
        if (await participants.existsBy({ ideaId: principal.id, userId: p.userId })) continue;
        await participants.update(p.id, { ideaId: principal.id });
        added.push(p.userId);
      }
      if (
        child.authorId &&
        child.authorId !== principal.authorId &&
        (await this.addCoAuthor(m, principal.id, child.authorId, ParticipantOrigin.Converged, access.userId, {
          sourceIdeaId: child.id,
        }))
      ) {
        added.push(child.authorId);
      }

      await recordEvent(m, {
        ideaId: child.id,
        type: 'converged',
        actorId: access.userId,
        reason,
        data: { into: principal.code, intoTitle: principal.title },
      });
      // Na principal o registro é da equipe: o autor dela vê só quantos pediram (RN-86).
      await recordEvent(m, {
        ideaId: principal.id,
        type: 'convergence_received',
        actorId: access.userId,
        reason,
        visibility: Visibility.Internal,
        data: { from: child.code, fromTitle: child.title },
      });
      await dispatchNotifications(m, [
        ...(child.authorId
          ? [
              {
                userId: child.authorId,
                type: 'idea_converged' as const,
                ideaId: child.id,
                payload: { code: child.code, title: child.title, intoCode: principal.code, reason },
              },
            ]
          : []),
        ...added
          .filter((u) => u !== child.authorId)
          .map((userId) => ({
            userId,
            type: 'coauthor_added' as const,
            ideaId: principal.id,
            payload: { code: principal.code, title: principal.title, via: 'converged' },
          })),
      ]);
      return principal.id;
    });
    return this.ideas.detail(access, principalId);
  }

  /**
   * Desfazer (CA-RN-88.1): a ideia volta a ter fluxo próprio, com a data de envio original; a
   * co-autoria que veio dela sai da principal; o histórico fica nas duas. Só quem converge.
   */
  async unconverge(access: Access, refValue: string, reason: string | null): Promise<IdeaDetail> {
    const childId = await this.dataSource.transaction(async (m) => {
      const visible = (await this.ideas.findVisible(access, refValue, m)).idea;
      if (!visible.convergedIntoId) throw apiError(409, 'not_converged', 'Esta ideia não está convergida.');
      const [child, principal] = await this.lockAll(m, [visible.id, visible.convergedIntoId]);
      if (!child?.convergedIntoId || !principal) throw apiError(409, 'stale_state', 'A ideia acabou de mudar.');
      if (!access.hasIn('idea.converge', child.entityId)) {
        throw forbidden('Só a equipe que converge ideias desfaz a convergência.');
      }
      await m.getRepository(IdeaEntity).update(child.id, {
        convergedIntoId: null,
        convergedAt: null,
        convergedById: null,
        convergedReason: null,
      });
      await m.getRepository(IdeaParticipant).delete({ ideaId: principal.id, sourceIdeaId: child.id });
      await recordEvent(m, {
        ideaId: child.id,
        type: 'convergence_undone',
        actorId: access.userId,
        reason,
        data: { from: principal.code },
      });
      await recordEvent(m, {
        ideaId: principal.id,
        type: 'convergence_undone',
        actorId: access.userId,
        reason,
        visibility: Visibility.Internal,
        data: { child: child.code },
      });
      if (child.authorId) {
        await dispatchNotifications(m, [
          {
            userId: child.authorId,
            type: 'idea_unconverged',
            ideaId: child.id,
            payload: { code: child.code, title: child.title, fromCode: principal.code, reason },
          },
        ]);
      }
      return child.id;
    });
    return this.ideas.detail(access, childId);
  }

  /**
   * "Apoiar esta ideia" (RN-85a): o colaborador vira co-autor sem criar ideia nova (CA-RN-85.1).
   * Pode apoiar o que vê, ou, com `ideas.similar_show_titles` ligado, uma ideia da entidade onde
   * ele envia ideias (a sugestão mostrou só o título). Não apoia a própria nem duas vezes
   * (CA-RN-86.4); principal encerrada, só a equipe adiciona (CA-RN-86.3).
   */
  async support(access: Access, refValue: string, note: string | null): Promise<IdeaDetail> {
    const ideaId = await this.dataSource.transaction(async (m) => {
      const found = await this.ideas.findForSupport(access, refValue, m);
      const [idea] = await this.lockAll(m, [this.root(found)]);
      if (!idea) throw apiError(404, 'not_found', 'Ideia não encontrada.');
      if (idea.authorId === access.userId) throw apiError(409, 'own_idea', 'Você é o autor desta ideia.');
      if (!canSupport(idea.status) || idea.archivedAt) {
        throw apiError(409, 'idea_closed', 'Esta ideia já foi encerrada: só a equipe pode adicionar participantes.');
      }
      const added = await this.addCoAuthor(m, idea.id, access.userId, ParticipantOrigin.Support, access.userId, {
        note,
      });
      if (!added) throw apiError(409, 'already_supporting', 'Você já acompanha esta ideia.');
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'supported',
        actorId: access.userId,
        visibility: Visibility.Internal,
        data: {},
      });
      await dispatchNotifications(m, [
        {
          userId: access.userId,
          type: 'coauthor_added',
          ideaId: idea.id,
          payload: { code: idea.code, title: idea.title, via: 'support' },
        },
      ]);
      return idea.id;
    });
    return this.ideas.detail(access, ideaId);
  }

  /** Adicionar participante (RN-69): quem tria na entidade, enquanto a ideia não for convergida. */
  async addParticipant(
    access: Access,
    refValue: string,
    input: { userId: string; role: 'co_author' | 'executor'; note: string | null },
  ): Promise<IdeaDetail> {
    const ideaId = await this.dataSource.transaction(async (m) => {
      const visible = (await this.ideas.findVisible(access, refValue, m)).idea;
      const [idea] = await this.lockAll(m, [visible.id]);
      if (!idea) throw apiError(404, 'not_found', 'Ideia não encontrada.');
      if (!ideaCapabilities(access, idea).triage) throw forbidden('Só quem tria a ideia gerencia os participantes.');
      if (idea.convergedIntoId) throw apiError(409, 'idea_converged', 'Ideia convergida: gerencie pela principal.');
      const user = await m.getRepository(User).findOneBy({ id: input.userId });
      if (user?.status !== UserStatus.Active) {
        throw apiError(422, 'validation_failed', 'Escolha uma pessoa ativa.', [
          { path: 'userId', message: 'Pessoa inativa ou inexistente.' },
        ]);
      }
      const repo = m.getRepository(IdeaParticipant);
      if (await repo.existsBy({ ideaId: idea.id, userId: input.userId, role: input.role as ParticipantRole })) {
        throw apiError(409, 'already_participant', 'Esta pessoa já participa com este papel.');
      }
      await repo.save(
        repo.create({
          ideaId: idea.id,
          userId: input.userId,
          role: input.role as ParticipantRole,
          origin: ParticipantOrigin.Manual,
          note: input.note,
          addedById: access.userId,
        }),
      );
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'participant_added',
        actorId: access.userId,
        data: { userId: user.id, name: user.name, role: input.role },
      });
      if (input.role === 'co_author' && user.id !== idea.authorId) {
        await dispatchNotifications(m, [
          {
            userId: user.id,
            type: 'coauthor_added',
            ideaId: idea.id,
            payload: { code: idea.code, title: idea.title, via: 'manual' },
          },
        ]);
      }
      return idea.id;
    });
    return this.ideas.detail(access, ideaId);
  }

  /** Remover participante (RN-69): o autor nunca sai, a ideia precisa de um (CA-RN-69.1). */
  async removeParticipant(access: Access, refValue: string, participantId: string): Promise<IdeaDetail> {
    const ideaId = await this.dataSource.transaction(async (m) => {
      const visible = (await this.ideas.findVisible(access, refValue, m)).idea;
      const [idea] = await this.lockAll(m, [visible.id]);
      if (!idea) throw apiError(404, 'not_found', 'Ideia não encontrada.');
      if (!ideaCapabilities(access, idea).triage) throw forbidden('Só quem tria a ideia gerencia os participantes.');
      const repo = m.getRepository(IdeaParticipant);
      const p = await repo.findOne({ where: { id: participantId, ideaId: idea.id }, relations: { user: true } });
      if (!p) throw apiError(404, 'not_found', 'Participante não encontrado.');
      if (p.role === ParticipantRole.Author) {
        throw apiError(409, 'author_required', 'O autor não sai da ideia: ela precisa de pelo menos um autor.');
      }
      await repo.delete({ id: p.id });
      await recordEvent(m, {
        ideaId: idea.id,
        type: 'participant_removed',
        actorId: access.userId,
        data: { userId: p.userId, name: p.user.name, role: p.role },
      });
      return idea.id;
    });
    return this.ideas.detail(access, ideaId);
  }

  /** Para a exclusão física (RN-11): principal com convergidas não sai antes de desfazer. */
  static async assertNoConverged(m: EntityManager, ideaId: string): Promise<void> {
    if ((await m.getRepository(IdeaEntity).countBy({ convergedIntoId: ideaId })) > 0) {
      throw apiError(409, 'has_converged', 'Há ideias convergidas nesta. Desfaça as convergências antes de excluir.');
    }
  }
}
