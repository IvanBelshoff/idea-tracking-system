/**
 * Códigos de permissão (§3.2 das regras). Vivem aqui, no backend, e são entregues ao frontend
 * pela API; não há tabela de permissões. Um perfil é um conjunto destes códigos.
 *
 * Regra fixa que não depende de permissão: o autor sempre vê a própria ideia (§3.2).
 */
export const PERMISSIONS = {
  // Ideias
  'idea.submit': 'Enviar ideias',
  'idea.view_scope': 'Ver todas as ideias das entidades do escopo',
  'idea.comment': 'Comentar ideias visíveis',
  'idea.comment_internal': 'Ver e escrever comentários internos',
  'idea.triage': 'Triar, aprovar e recusar ideias',
  'idea.register_for_other': 'Cadastrar ideia em nome de outra pessoa (RN-04)',
  'idea.reopen': 'Reabrir ideia encerrada (RN-09)',
  'idea.archive': 'Arquivar ideia (RN-11)',
  'idea.delete': 'Excluir ideia definitivamente (RN-11; só o administrador)',
  'idea.converge': 'Convergir ideias semelhantes (RN-85)',
  'step.manage': 'Criar e gerenciar etapas e anexos',
  // Indicadores e resultado
  'report.view': 'Ver indicadores e relatórios do escopo',
  'gain.validate': 'Validar ganho financeiro (RN-63)',
  // Foco e reconhecimento
  'campaign.manage': 'Criar e gerenciar campanhas',
  'hall.highlight_entity': 'Destacar ideias no Hall da entidade',
  'hall.highlight_org': 'Destacar ideias no Hall da organização',
  'hall.moderate': 'Moderar elogios do Hall',
  'mural.manage': 'Publicar no mural e moderar a conversa (RN-148)',
  'store.manage': 'Gerenciar a loja: itens, pedidos, bonificações e ajustes de saldo (RN-159)',
  'reward.register': 'Registrar recompensas concedidas (informativo; RN-71)',
  // Administração
  'user.manage': 'Gerenciar usuários e seus perfis',
  'role.manage': 'Gerenciar perfis e permissões',
  'entity.manage': 'Gerenciar entidades',
  'category.manage': 'Gerenciar categorias',
  'setting.manage': 'Alterar configurações da instalação',
  'email.manage': 'Configurar o envio de e-mail, os modelos e ver os envios (RN-90)',
  'sso.manage': 'Configurar o acesso corporativo: domínios e login Microsoft/Google (RN-95 a RN-98)',
  'integration.manage':
    'Gerenciar as integrações (API e webhooks): chave geral, módulos, integrações, tokens e webhooks (RN-102, RN-117)',
  'audit.view': 'Ler o log de auditoria',
  'ops.view': 'Ler a saúde e as métricas operacionais (observabilidade, RN-92)',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
