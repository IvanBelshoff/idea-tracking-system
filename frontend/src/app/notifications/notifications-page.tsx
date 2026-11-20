import { Link } from '@tanstack/react-router';
import { BellOff, CheckCheck, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { Pagination } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { IdCode } from '../ideas/ui';
import { usePageTitle } from '../page-title';
import { usePublicSettings } from '../session';
import { useDates } from '../use-dates';
import {
  NOTIFICATION_ICONS,
  notificationMessage,
  notificationReason,
  notificationText,
  notificationTone,
} from './notification-ui';
import { type NotificationItem, useMarkAllRead, useMarkRead, useNotifications } from './queries';

/** Avisos do mural que abrem a página da ideia no mural (RN-156). */
const MURAL_PAGE_TYPES = new Set<string>(['mural_digest', 'mural_reply', 'mural_comment_hidden', 'mural_shared']);

function Row({ n, onOpen }: { n: NotificationItem; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const dates = useDates();
  const Icon = NOTIFICATION_ICONS[n.type];
  const unread = n.readAt === null;
  const reason = notificationReason(n);
  const message = notificationMessage(n);
  const body = (
    <>
      <span className="relative mt-0.5 shrink-0">
        <Icon aria-hidden="true" className={`size-5 ${notificationTone(n.type)}`} />
        {unread && <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${unread ? 'font-semibold' : ''}`}>
          {unread && <span className="sr-only">{t('notifications.unreadMark')} </span>}
          {notificationText(t, n, i18n.language)}
        </span>
        {reason && (
          <span className="mt-0.5 block text-sm text-muted-foreground">{t('notifications.reason', { reason })}</span>
        )}
        {message && (
          <span className="mt-0.5 block text-sm whitespace-pre-wrap text-muted-foreground">
            {t('notifications.message', { message })}
          </span>
        )}
        {n.idea && (
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <IdCode code={n.idea.code} />
            <span className="truncate">{n.idea.title}</span>
          </span>
        )}
      </span>
      <time dateTime={n.createdAt} className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
        {dates.relative(n.createdAt)}
      </time>
    </>
  );
  const rowClass = `flex items-start gap-3 px-4 py-3 ${unread ? 'bg-primary/4' : ''}`;
  return (
    <li className="border-b last:border-b-0">
      {n.type === 'ops_failed' || n.type === 'ops_recovered' ? (
        <Link
          to="/admin/observabilidade"
          onClick={onOpen}
          className={`${rowClass} hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none`}
        >
          {body}
        </Link>
      ) : n.type === 'store_orders_new' ? (
        <Link
          to="/loja/gerenciar"
          onClick={onOpen}
          className={`${rowClass} hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none`}
        >
          {body}
        </Link>
      ) : n.type.startsWith('store_') ? (
        <Link
          to="/loja"
          onClick={onOpen}
          className={`${rowClass} hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none`}
        >
          {body}
        </Link>
      ) : n.type === 'approval_requested' || n.type === 'approval_reminder' ? (
        <Link
          to="/aprovacoes"
          onClick={onOpen}
          className={`${rowClass} hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none`}
        >
          {body}
        </Link>
      ) : n.type === 'mural_reports' ? (
        <Link
          to="/mural/denuncias"
          onClick={onOpen}
          className={`${rowClass} hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none`}
        >
          {body}
        </Link>
      ) : n.idea && MURAL_PAGE_TYPES.has(n.type) ? (
        // A conversa, a ideia enviada por um colega e o resumo vão para a página do mural: quem recebe
        // pode não abrir a ideia (RN-01).
        <Link
          to="/mural/$ref"
          params={{ ref: n.idea.code }}
          onClick={onOpen}
          className={`${rowClass} hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none`}
        >
          {body}
        </Link>
      ) : n.idea ? (
        <Link
          to="/ideias/$ref"
          params={{ ref: n.idea.code }}
          onClick={onOpen}
          className={`${rowClass} hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none`}
        >
          {body}
        </Link>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

/** Notificações da pessoa (RN-27, RN-29): mais recentes primeiro; abrir marca como lida. */
export function NotificationsPage() {
  const { t } = useTranslation();
  const { data: settings } = usePublicSettings();
  usePageTitle(t('notifications.pageTitle'), settings?.organizationName);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const list = useNotifications(page, unreadOnly);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const unreadCount = list.data?.unreadCount ?? 0;

  const filter = (value: boolean, label: string) => (
    <Button
      type="button"
      size="sm"
      variant={unreadOnly === value ? 'default' : 'outline'}
      aria-pressed={unreadOnly === value}
      onClick={() => {
        setUnreadOnly(value);
        setPage(1);
      }}
    >
      {label}
    </Button>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-bold">{t('notifications.title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('notifications.intro')}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/minha-conta" hash="notificacoes">
            <Settings2 aria-hidden="true" />
            {t('notifications.preferencesLink')}
          </Link>
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex gap-2">
          <legend className="sr-only">{t('notifications.filter')}</legend>
          {filter(false, t('notifications.all'))}
          {filter(true, t('notifications.unreadCount', { count: unreadCount }))}
        </fieldset>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={unreadCount === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          <CheckCheck aria-hidden="true" />
          {t('notifications.markAll')}
        </Button>
      </div>

      <FormError message={list.isError ? errorText(t, list.error) : null} />
      {list.data && list.data.items.length === 0 && (
        <div className="mt-4 rounded-lg border bg-card px-6 py-12 text-center">
          <BellOff aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">
            {unreadOnly ? t('notifications.emptyUnread') : t('notifications.empty')}
          </p>
        </div>
      )}
      {list.data && list.data.items.length > 0 && (
        <>
          <ul aria-label={t('notifications.title')} className="mt-4 overflow-hidden rounded-lg border bg-card">
            {list.data.items.map((n) => (
              <Row key={n.id} n={n} onOpen={() => n.readAt === null && markRead.mutate(n.id)} />
            ))}
          </ul>
          {list.data.meta.total > list.data.meta.pageSize && (
            <Pagination
              page={list.data.meta.page}
              pageSize={list.data.meta.pageSize}
              total={list.data.meta.total}
              onPage={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
