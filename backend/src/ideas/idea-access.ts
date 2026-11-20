import type { Access } from '../identity-access/access.js';
import { type Idea, IdeaStatus } from './entities/idea.entity.js';
import { isClosed } from './lifecycle.js';

/**
 * O que um usuário pode fazer numa ideia (RN-01, §3.2). Regra pura.
 * - Vê: o autor sempre (exceção fixa); quem tem `idea.view_scope` na entidade da ideia; quem valida
 *   ganhos ali (`gain.validate`, só leitura: precisa ver a ideia para validar, RN-63); e o
 *   responsável de alguma etapa, como o autor (só o público), para concluir a etapa e abrir o alerta.
 * - Edita: o autor enquanto Enviada; quem tria na entidade enquanto aberta. Encerrada: ninguém (RN-08).
 * - Comenta: quem vê (o autor só público); interno exige `idea.comment_internal` (RN-28).
 */
export interface IdeaCapabilities {
  view: boolean;
  isAuthor: boolean;
  edit: boolean;
  triage: boolean;
  reopen: boolean;
  archive: boolean;
  delete: boolean;
  /** Criar, editar, excluir e concluir etapas e anexos (`step.manage` na entidade). */
  manageSteps: boolean;
  comment: boolean;
  commentInternal: boolean;
}

export function ideaCapabilities(
  access: Access,
  idea: Pick<Idea, 'entityId' | 'authorId' | 'status'>,
  isStepAssignee = false,
): IdeaCapabilities {
  const isAuthor = idea.authorId === access.userId;
  const inEntity = (p: Parameters<Access['hasIn']>[0]) => access.hasIn(p, idea.entityId);
  const team = inEntity('idea.view_scope');
  const view = isAuthor || team || isStepAssignee || inEntity('gain.validate');
  const closed = isClosed(idea.status);
  const triage = inEntity('idea.triage');
  return {
    view,
    isAuthor,
    edit: view && !closed && ((isAuthor && idea.status === IdeaStatus.Submitted) || triage),
    triage,
    reopen: inEntity('idea.reopen'),
    archive: inEntity('idea.archive'),
    delete: inEntity('idea.delete'),
    manageSteps: view && inEntity('step.manage'),
    comment: view && (isAuthor || team || inEntity('idea.comment')),
    commentInternal: view && inEntity('idea.comment_internal'),
  };
}
