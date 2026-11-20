import type { TFunction } from 'i18next';
import {
  AlarmClock,
  Award,
  BadgeCheck,
  Ban,
  Banknote,
  CalendarCheck,
  CalendarX,
  CircleCheck,
  CircleX,
  Clock,
  Coins,
  EyeOff,
  Flag,
  GitFork,
  GitMerge,
  HeartPulse,
  Hourglass,
  Inbox,
  ListChecks,
  type LucideIcon,
  Medal,
  Megaphone,
  MessageCircle,
  MessageSquareReply,
  PackageCheck,
  RotateCcw,
  Search,
  ServerCrash,
  Share2,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Stamp,
  Trophy,
  Undo2,
  UserCheck,
  Users,
} from 'lucide-react';
import { formatDay } from '@/lib/dates';
import type { NotificationItem, NotificationType } from './queries';

export const NOTIFICATION_ICONS: Record<NotificationType, LucideIcon> = {
  idea_received: Inbox,
  review_started: Search,
  idea_approved: CircleCheck,
  idea_rejected: CircleX,
  idea_interrupted: Ban,
  step_completed: ListChecks,
  idea_implemented: Trophy,
  idea_reopened: RotateCcw,
  all_steps_completed: Flag,
  deadline_soon: Clock,
  deadline_due: AlarmClock,
  idea_assigned: UserCheck,
  triage_overdue: Hourglass,
  sustainment_due: CalendarCheck,
  level_up: Medal,
  achievement_granted: Award,
  idea_highlighted: Trophy,
  coauthor_added: Users,
  idea_converged: GitMerge,
  idea_unconverged: GitFork,
  ops_failed: ServerCrash,
  ops_recovered: HeartPulse,
  mural_published: Megaphone,
  mural_withdrawn: Undo2,
  mural_digest: Sparkles,
  mural_reply: MessageCircle,
  mural_comment_hidden: EyeOff,
  mural_reports: ShieldAlert,
  mural_shared: Share2,
  store_order_approved: CircleCheck,
  store_order_rejected: CircleX,
  store_order_delivered: PackageCheck,
  store_order_cancelled: Ban,
  store_bonus_paid: Banknote,
  store_balance_adjusted: Coins,
  store_points_expiring: Hourglass,
  store_points_expired: Clock,
  store_orders_new: ShoppingBag,
  approval_requested: Stamp,
  approval_reminder: Hourglass,
  approval_answered: MessageSquareReply,
  approval_completed: BadgeCheck,
  approval_expired: CalendarX,
};

/** Tom do ícone: decisão boa, decisão ruim, prazo, neutro. */
export function notificationTone(type: NotificationType): string {
  if (
    type === 'idea_approved' ||
    type === 'idea_implemented' ||
    type === 'all_steps_completed' ||
    type === 'ops_recovered' ||
    type === 'store_order_approved' ||
    type === 'store_order_delivered' ||
    type === 'store_bonus_paid'
  )
    return 'text-(--st-done)';
  if (
    type === 'idea_rejected' ||
    type === 'idea_interrupted' ||
    type === 'ops_failed' ||
    type === 'store_order_rejected' ||
    type === 'store_order_cancelled'
  )
    return 'text-(--st-rejected)';
  if (
    type === 'deadline_soon' ||
    type === 'deadline_due' ||
    type === 'triage_overdue' ||
    type === 'store_points_expiring' ||
    type === 'approval_reminder' ||
    type === 'approval_expired'
  )
    return 'text-(--st-late)';
  return 'text-muted-foreground';
}

/** Texto do aviso no idioma da tela, a partir do tipo e dos dados guardados pela API. */
export function notificationText(t: TFunction, n: Pick<NotificationItem, 'type' | 'payload'>, lng: string): string {
  const p = n.payload as Record<string, unknown>;
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  // Alerta de saúde (RN-94): o aviso cita os itens pelo nome, no idioma da tela.
  const items = Array.isArray(p.items)
    ? p.items.map((key) => t(`admin.ops.health.items.${String(key)}.title` as never) as string).join(', ')
    : '';
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  // Quem enviou a ideia do mural pode vir sem nome (participante anônimo, RN-151): aí "um colega".
  // A resposta e o resultado da aprovação (M24) têm texto próprio para o "não".
  const type =
    n.type === 'mural_shared' && !p.senderName
      ? 'mural_shared_anonymous'
      : (n.type === 'approval_answered' && p.decision === 'rejected') ||
          (n.type === 'approval_completed' && p.outcome === 'rejected')
        ? `${n.type}_rejected`
        : n.type;
  return t(`notifications.types.${type}` as never, {
    items,
    position: str(p.position),
    name: str(p.name),
    date: typeof p.dueDate === 'string' ? formatDay(p.dueDate, lng) : '',
    reactions: num(p.reactions),
    comments: num(p.comments),
    replies: num(p.replies),
    reports: num(p.reports),
    sender: str(p.senderName),
    item: str(p.itemName),
    orders: num(p.orders),
    amount: n.type === 'store_balance_adjusted' && num(p.amount) > 0 ? `+${num(p.amount)}` : num(p.amount),
    ...(typeof p.on === 'string' ? { date: formatDay(p.on, lng) } : {}),
    area: str(p.area),
    code: str(p.code),
    title: str(p.title),
    ...(typeof p.dueOn === 'string' ? { date: formatDay(p.dueOn, lng) } : {}),
  }) as string;
}

/** Mensagem que acompanha a ideia enviada por um colega (RN-155). */
export function notificationMessage(n: Pick<NotificationItem, 'type' | 'payload'>): string | null {
  const message = (n.payload as Record<string, unknown>).message;
  return n.type === 'mural_shared' && typeof message === 'string' && message.trim() ? message : null;
}

export function notificationReason(n: Pick<NotificationItem, 'payload'>): string | null {
  const reason = (n.payload as Record<string, unknown>).reason;
  return typeof reason === 'string' && reason.trim() ? reason : null;
}
