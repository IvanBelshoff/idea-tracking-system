import type { EntityManager } from 'typeorm';
import { recordAudit } from '../audit/audit.service.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { getSetting } from '../organization/settings.service.js';
import { MuralPost, MuralStatus } from './entities.js';
import { notifyParticipants } from './mural-notify.js';
import { autoWithdrawCause } from './mural-rules.js';

/**
 * Retirada automática (RN-149), chamada a cada evento do histórico da ideia, na mesma transação.
 * Vale com o módulo ligado ou desligado (os dados ficam coerentes para quando religar). Grava o
 * próprio evento `mural_withdrawn` no histórico (autor: o sistema) e a auditoria.
 *
 * `record` é o `recordEvent` do histórico, passado por quem chama para não criar dependência circular.
 */
export async function withdrawForIdeaEvent(
  m: EntityManager,
  event: { ideaId: string; type: string; data: Record<string, unknown> },
  record: (
    m: EntityManager,
    e: { ideaId: string; type: string; actorId: null; reason: string; data: object },
  ) => Promise<void>,
): Promise<void> {
  const cause = autoWithdrawCause(event.type, event.data);
  if (!cause) return;
  const res = await m
    .createQueryBuilder()
    .update(MuralPost)
    .set({ status: MuralStatus.Withdrawn, withdrawnAt: () => 'now()', withdrawnById: null, withdrawnReason: cause })
    .where('idea_id = :id AND status = :published', { id: event.ideaId, published: MuralStatus.Published })
    .execute();
  if (!res.affected) return;
  await record(m, {
    ideaId: event.ideaId,
    type: 'mural_withdrawn',
    actorId: null,
    reason: cause,
    data: { automatic: true },
  });
  await recordAudit(m, {
    action: 'mural.withdrawn',
    actorId: null,
    targetType: 'idea',
    targetId: event.ideaId,
    data: { automatic: true, cause },
  });
  // Com o módulo desligado, nenhum aviso do mural (CA-RN-148.1).
  if (await getSetting(m, 'mural.enabled')) {
    const idea = await m.getRepository(Idea).findOneBy({ id: event.ideaId });
    if (idea) await notifyParticipants(m, idea, 'mural_withdrawn', { automatic: cause });
  }
}
