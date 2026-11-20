import { formatDayLocalized } from '../common/dates.js';
import { healthTitles } from '../observability/alert-text.js';
import type { NotificationType } from './notification-rules.js';

/**
 * Texto de uma notificação no idioma de quem lê, para o resumo por e-mail. A tela monta o próprio
 * texto pelo i18n do frontend a partir do mesmo `type` + `payload`.
 */
type Payload = Record<string, unknown>;

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const formatDay = (isoDay: unknown, locale: string) => formatDayLocalized(str(isoDay), locale);

/** Itens da saúde citados no aviso do alerta (RN-94), pelo nome no idioma. */
const opsItems = (p: Payload, locale: string) =>
  healthTitles(Array.isArray(p.items) ? p.items.map(String) : [], locale);

const PT: Record<NotificationType, (p: Payload) => string> = {
  idea_received: () => 'recebemos a sua ideia',
  review_started: () => 'a sua ideia entrou em análise',
  idea_approved: () => 'a sua ideia foi aprovada e está em andamento',
  idea_rejected: (p) => `a sua ideia não foi aprovada. Motivo: ${str(p.reason)}`,
  idea_interrupted: (p) => `a ideia foi interrompida. Motivo: ${str(p.reason)}`,
  step_completed: (p) => `etapa ${str(p.position)} concluída: ${str(p.name)}`,
  idea_implemented: () => 'a sua ideia foi implementada',
  idea_reopened: (p) => `a ideia foi reaberta. Motivo: ${str(p.reason)}`,
  all_steps_completed: () => 'todas as etapas foram concluídas: crie uma nova etapa ou marque como implementada',
  deadline_soon: (p) => `a etapa ${str(p.position)} (${str(p.name)}) vence em ${formatDay(p.dueDate, 'pt-BR')}`,
  deadline_due: (p) => `a etapa ${str(p.position)} (${str(p.name)}) vence hoje`,
  idea_assigned: () => 'a triagem desta ideia foi atribuída a você',
  coauthor_added: () => 'você agora acompanha esta ideia como co-autor',
  idea_converged: (p) => `a sua ideia foi unida à ${str(p.intoCode)}, que pede a mesma coisa`,
  idea_unconverged: () => 'a sua ideia voltou a ter acompanhamento próprio',
  triage_overdue: (p) => `a ideia passou da previsão de retorno (${formatDay(p.dueDate, 'pt-BR')}) sem ser assumida`,
  sustainment_due: () => 'chegou a revisão de sustentação: o ganho se mantém?',
  level_up: (p) => `você chegou ao nível ${str(p.level)}`,
  achievement_granted: (p) => `nova conquista: ${str(p.name)}`,
  idea_highlighted: () => 'a ideia foi destacada no Hall: escolha se aparece com o seu nome',
  ops_failed: (p) => `alerta de saúde: falha em ${opsItems(p, 'pt-BR')}`,
  ops_recovered: (p) => `saúde da instalação: ${opsItems(p, 'pt-BR')} voltou ao normal`,
  mural_published: () => 'a ideia foi publicada no mural; o seu nome não aparece. Quer mostrar?',
  mural_withdrawn: () => 'a ideia foi retirada do mural',
  mural_digest: (p) => `hoje no mural: ${num(p.reactions)} reação(ões) e ${num(p.comments)} comentário(s)`,
  mural_reply: (p) => `${num(p.replies)} resposta(s) ao seu comentário no mural`,
  mural_comment_hidden: (p) => `o seu comentário no mural foi ocultado pela equipe. Motivo: ${str(p.reason)}`,
  mural_reports: (p) => `${num(p.reports)} denúncia(s) pendente(s) na conversa do mural`,
  mural_shared: (p) => `${str(p.senderName) || 'um colega'} enviou esta ideia do mural para você`,
  approval_requested: (p) =>
    `${str(p.code)}: a sua aprovação foi pedida (${str(p.area)}), até ${formatDay(p.dueOn, 'pt-BR')}`,
  approval_reminder: (p) => `${str(p.code)}: a sua aprovação vence em ${formatDay(p.dueOn, 'pt-BR')}`,
  approval_answered: (p) => `${str(p.code)}: ${str(p.name)} ${p.decision === 'approved' ? 'aprovou' : 'não aprovou'}`,
  approval_completed: (p) =>
    `${str(p.code)}: a aprovação de outra área foi ${p.outcome === 'approved' ? 'obtida' : 'negada'}`,
  approval_expired: (p) => `${str(p.code)}: o pedido de aprovação venceu sem todas as respostas`,
  store_order_approved: (p) => `o seu pedido de ${str(p.itemName)} foi aprovado`,
  store_order_rejected: (p) =>
    `o seu pedido de ${str(p.itemName)} foi recusado e os pontos voltaram. Motivo: ${str(p.reason)}`,
  store_order_delivered: (p) => `o seu pedido de ${str(p.itemName)} foi entregue`,
  store_order_cancelled: (p) =>
    `o seu pedido de ${str(p.itemName)} foi cancelado pela equipe e os pontos voltaram. Motivo: ${str(p.reason)}`,
  store_bonus_paid: (p) => `a bonificação ${str(p.itemName)} foi marcada como paga`,
  store_balance_adjusted: (p) =>
    `o seu saldo da loja mudou ${num(p.amount) > 0 ? '+' : ''}${num(p.amount)} pontos. Motivo: ${str(p.reason)}`,
  store_points_expiring: (p) => `${num(p.amount)} ponto(s) do seu saldo vencem em ${formatDay(p.on, 'pt-BR')}`,
  store_points_expired: (p) => `${num(p.amount)} ponto(s) do seu saldo venceram`,
  store_orders_new: (p) => `${num(p.orders)} pedido(s) novo(s) na loja hoje`,
};

const EN: Record<NotificationType, (p: Payload) => string> = {
  idea_received: () => 'we received your idea',
  review_started: () => 'your idea is under review',
  idea_approved: () => 'your idea was approved and is now in progress',
  idea_rejected: (p) => `your idea was not approved. Reason: ${str(p.reason)}`,
  idea_interrupted: (p) => `the idea was interrupted. Reason: ${str(p.reason)}`,
  step_completed: (p) => `step ${str(p.position)} completed: ${str(p.name)}`,
  idea_implemented: () => 'your idea was implemented',
  idea_reopened: (p) => `the idea was reopened. Reason: ${str(p.reason)}`,
  all_steps_completed: () => 'all steps are completed: create a new step or mark it as implemented',
  deadline_soon: (p) => `step ${str(p.position)} (${str(p.name)}) is due on ${formatDay(p.dueDate, 'en')}`,
  deadline_due: (p) => `step ${str(p.position)} (${str(p.name)}) is due today`,
  idea_assigned: () => 'the triage of this idea was assigned to you',
  coauthor_added: () => 'you now follow this idea as a co-author',
  idea_converged: (p) => `your idea was merged into ${str(p.intoCode)}, which asks for the same thing`,
  idea_unconverged: () => 'your idea is tracked on its own again',
  triage_overdue: (p) => `the idea passed its expected reply date (${formatDay(p.dueDate, 'en')}) without being taken`,
  sustainment_due: () => 'the sustainment review is due: is the gain holding?',
  level_up: (p) => `you reached the ${str(p.level)} level`,
  achievement_granted: (p) => `new achievement: ${str(p.name)}`,
  idea_highlighted: () => 'the idea was highlighted in the Hall: choose whether your name appears',
  ops_failed: (p) => `health alert: failure in ${opsItems(p, 'en')}`,
  ops_recovered: (p) => `installation health: ${opsItems(p, 'en')} back to normal`,
  mural_published: () => 'the idea was published on the idea wall; your name does not appear. Want to show it?',
  mural_withdrawn: () => 'the idea was removed from the idea wall',
  mural_digest: (p) => `today on the idea wall: ${num(p.reactions)} reaction(s) and ${num(p.comments)} comment(s)`,
  mural_reply: (p) => `${num(p.replies)} reply(ies) to your comment on the idea wall`,
  mural_comment_hidden: (p) => `your comment on the idea wall was hidden by the team. Reason: ${str(p.reason)}`,
  mural_reports: (p) => `${num(p.reports)} pending report(s) in the idea wall conversation`,
  mural_shared: (p) => `${str(p.senderName) || 'a colleague'} sent you this idea from the idea wall`,
  approval_requested: (p) =>
    `${str(p.code)}: your approval was requested (${str(p.area)}), by ${formatDay(p.dueOn, 'en')}`,
  approval_reminder: (p) => `${str(p.code)}: your approval is due on ${formatDay(p.dueOn, 'en')}`,
  approval_answered: (p) =>
    `${str(p.code)}: ${str(p.name)} ${p.decision === 'approved' ? 'approved' : 'did not approve'}`,
  approval_completed: (p) =>
    `${str(p.code)}: the approval from another area was ${p.outcome === 'approved' ? 'granted' : 'denied'}`,
  approval_expired: (p) => `${str(p.code)}: the approval request expired without all answers`,
  store_order_approved: (p) => `your order of ${str(p.itemName)} was approved`,
  store_order_rejected: (p) =>
    `your order of ${str(p.itemName)} was rejected and the points came back. Reason: ${str(p.reason)}`,
  store_order_delivered: (p) => `your order of ${str(p.itemName)} was delivered`,
  store_order_cancelled: (p) =>
    `your order of ${str(p.itemName)} was cancelled by the team and the points came back. Reason: ${str(p.reason)}`,
  store_bonus_paid: (p) => `the ${str(p.itemName)} bonus was marked as paid`,
  store_balance_adjusted: (p) =>
    `your store balance changed by ${num(p.amount) > 0 ? '+' : ''}${num(p.amount)} points. Reason: ${str(p.reason)}`,
  store_points_expiring: (p) => `${num(p.amount)} point(s) of your balance expire on ${formatDay(p.on, 'en')}`,
  store_points_expired: (p) => `${num(p.amount)} point(s) of your balance expired`,
  store_orders_new: (p) => `${num(p.orders)} new store order(s) today`,
};

export function describeNotification(type: string, payload: Payload, locale: string): string {
  const table = locale === 'en' ? EN : PT;
  const text = (table as Record<string, ((p: Payload) => string) | undefined>)[type]?.(payload) ?? type;
  const head = [str(payload.code), str(payload.title)].filter(Boolean).join(' · ');
  return head ? `${head}: ${text}` : text;
}
