import { type InfiniteData, type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, Copy, Heart, Lightbulb, MessageSquare, PartyPopper, Send, Share2, Star, ThumbsUp } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field } from '@/components/form/field';
import { PersonAvatar } from '@/components/person-avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '../auth/auth-layout';
import { IdCode, type IdeaStatus, IdeaStatusBadge } from '../ideas/ui';
import { useDates } from '../use-dates';
import {
  type MuralCard,
  type MuralPage,
  type MuralPerson,
  muralKeys,
  REACTIONS,
  type Reaction,
  useMuralPeople,
  useReactors,
} from './queries';

/** Ícone de cada reação (RN-152): polegar, confete, coração, lâmpada, estrela. */
export const REACTION_ICONS = {
  like: ThumbsUp,
  congrats: PartyPopper,
  support: Heart,
  brilliant: Lightbulb,
  inspiring: Star,
} as const;

/** Endereço interno da ideia no mural (só abre com login; RN-155). */
export const muralLink = (code: string) => `${window.location.origin}/mural/${code}`;

/** Nome de quem aparece no mural: o nome, ou "Autor da ideia"/"Ex-colaborador" (RN-151). */
export function usePersonName() {
  const { t } = useTranslation();
  return (p: MuralPerson): string => {
    const label = p.label ? t(`mural.labels.${p.label}`) : null;
    if (p.revealed && p.name) return `${label} · ${p.name} (${t('mural.revealed')})`;
    return p.name ?? label ?? '';
  };
}

export function PersonLine({ person, size = 'sm' }: { person: MuralPerson; size?: 'sm' | 'default' }) {
  const name = usePersonName();
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <PersonAvatar
        person={{ id: person.userId, name: person.label ? null : person.name, photoVersion: person.photoVersion }}
        size={size}
      />
      <span className="truncate font-medium text-foreground">{name(person)}</span>
    </span>
  );
}

/** Atualiza o cartão em todas as listas e na página, sem recarregar tudo. */
export function patchCard(qc: QueryClient, code: string, patch: Partial<MuralCard>) {
  qc.setQueriesData<InfiniteData<components['schemas']['MuralFeed']>>({ queryKey: ['mural', 'feed'] }, (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((c) => (c.code === code ? { ...c, ...patch } : c)),
          })),
        }
      : old,
  );
  qc.setQueryData<MuralPage>(muralKeys.page(code), (old) => (old ? { ...old, card: { ...old.card, ...patch } } : old));
}

/**
 * As 5 reações (RN-152): cada uma é um botão com nome e estado (`aria-pressed`); a nova contagem é
 * anunciada ao leitor de tela. Quem participa da ideia não reage (os botões ficam desabilitados).
 */
export function ReactionBar({ card }: { card: MuralCard }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [announce, setAnnounce] = useState('');
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const react = useMutation({
    meta: { silent: true },
    mutationFn: (kind: Reaction | null) =>
      kind
        ? unwrap(api.PUT('/api/mural/ideas/{ref}/reaction', { params: { path: { ref: card.code } }, body: { kind } }))
        : unwrap(api.DELETE('/api/mural/ideas/{ref}/reaction', { params: { path: { ref: card.code } } })),
    onSuccess: (data, kind) => {
      patchCard(qc, card.code, data);
      const shown = (kind ?? card.myReaction ?? 'like') as Reaction;
      setAnnounce(t('mural.announced', { label: t(`mural.reactions.${shown}`), count: data.reactions[shown] }));
    },
  });
  return (
    <div>
      <fieldset className="flex flex-wrap items-center gap-1">
        <legend className="sr-only">{t('mural.reactionsGroup')}</legend>
        {REACTIONS.map((kind) => {
          const Icon = REACTION_ICONS[kind];
          const mine = card.myReaction === kind;
          const count = card.reactions[kind];
          const label = t(`mural.reactions.${kind}`);
          return (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant={mine ? 'secondary' : 'ghost'}
              aria-pressed={mine}
              aria-label={t('mural.reactionButton', { label, count })}
              title={card.canReact ? label : t('mural.ownIdea')}
              disabled={!card.canReact || react.isPending}
              onClick={() => react.mutate(mine ? null : kind)}
              className="h-8 gap-1 px-2"
            >
              <Icon aria-hidden="true" className={mine ? 'fill-current' : ''} />
              <span aria-hidden="true" className="tabular-nums">
                {count}
              </span>
            </Button>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="link"
          className="h-8 px-1 text-xs text-muted-foreground"
          disabled={card.reactionTotal === 0}
          onClick={() => setReactorsOpen(true)}
        >
          {t('mural.whoReacted')}
        </Button>
      </fieldset>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <FormError message={react.isError ? errorText(t, react.error) : null} />
      {reactorsOpen && <ReactorsDialog code={card.code} onClose={() => setReactorsOpen(false)} />}
    </div>
  );
}

/** Quem reagiu (RN-152), filtrável por tipo, pelo teclado. */
function ReactorsDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Reaction | ''>('');
  const list = useReactors(code, kind, true);
  const groupId = useId();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('mural.reactorsTitle')}</DialogTitle>
        </DialogHeader>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">{t('mural.reactionsGroup')}</legend>
          {(['', ...REACTIONS] as const).map((k) => (
            <label
              key={k || 'all'}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm has-checked:border-primary has-checked:bg-primary/10 has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <input type="radio" name={groupId} className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
              {k === '' ? t('mural.reactorsAll') : t(`mural.reactions.${k}`)}
            </label>
          ))}
        </fieldset>
        <FormError message={list.isError ? errorText(t, list.error) : null} />
        {list.data && list.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('mural.reactorsEmpty')}</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {list.data?.map((r, i) => {
              const Icon = REACTION_ICONS[r.kind as Reaction];
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: a lista vem pronta do servidor e não reordena
                <li key={`${r.person.userId ?? 'x'}-${i}`} className="flex items-center justify-between gap-2">
                  <PersonLine person={r.person} />
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Icon aria-hidden="true" className="size-3.5" />
                    {t(`mural.reactions.${r.kind as Reaction}`)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Compartilhar (RN-155): copiar o link interno ou enviar a um colega. Nada sai da instalação. */
export function ShareMenu({ card }: { card: MuralCard }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 px-2">
            <Share2 aria-hidden="true" />
            {t('mural.share')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={async () => {
              try {
                await navigator.clipboard.writeText(muralLink(card.code));
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Copy aria-hidden="true" />
            {t('mural.copyLink')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSending(true)}>
            <Send aria-hidden="true" />
            {t('mural.sendToColleague')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="text-xs text-(--st-done)">
        {copied && (
          <>
            <Check aria-hidden="true" className="mr-1 inline size-3.5" />
            {t('mural.copied')}
          </>
        )}
      </span>
      {sending && <ShareDialog card={card} onClose={() => setSending(false)} />}
    </>
  );
}

function ShareDialog({ card, onClose }: { card: MuralCard; onClose: () => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const [message, setMessage] = useState('');
  const people = useMuralPeople(search.trim(), search.trim().length >= 2);
  const groupId = useId();
  const send = useMutation({
    meta: { success: t('mural.shared', { name: chosen?.name ?? '' }) },
    mutationFn: () =>
      unwrap(
        api.POST('/api/mural/ideas/{ref}/share', {
          params: { path: { ref: card.code } },
          body: { recipientId: chosen?.id ?? '', message: message.trim() || null },
        }),
      ),
    onSuccess: () => {
      setChosen(null);
      setMessage('');
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('mural.shareTitle')}</DialogTitle>
          <DialogDescription>{t('mural.shareHint')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen) send.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('mural.searchColleague')}>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
          </Field>
          {search.trim().length >= 2 && (
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t('mural.colleague')}</legend>
              {people.data && people.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('mural.noColleague')}</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {people.data?.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted has-checked:bg-primary/10 has-focus-visible:ring-2 has-focus-visible:ring-ring">
                        <input
                          type="radio"
                          name={groupId}
                          checked={chosen?.id === p.id}
                          onChange={() => setChosen({ id: p.id, name: p.name })}
                        />
                        <PersonAvatar person={{ id: p.id, name: p.name, photoVersion: p.photoVersion }} size="sm" />
                        {p.name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          )}
          <Field label={t('mural.message')}>
            <Textarea rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('admin.common.close')}
            </Button>
            <Button type="submit" disabled={!chosen || send.isPending}>
              <Send aria-hidden="true" />
              {t('mural.shareSend')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O cartão do mural (RN-150): título, situação, categoria, entidade, data, quem consentiu, reações,
 * comentários e compartilhar. "Abrir a ideia" só para quem já a abre pela RN-01.
 */
export function MuralCardView({ card, headingLevel = 'h3' }: { card: MuralCard; headingLevel?: 'h1' | 'h3' }) {
  const { t } = useTranslation();
  const dates = useDates();
  const Heading = headingLevel;
  return (
    <article className="rounded-lg border bg-card p-5" aria-labelledby={`mural-${card.code}`}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <IdeaStatusBadge status={card.status as IdeaStatus} />
        {card.category && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="size-2 rounded-sm"
              style={{ backgroundColor: card.category.color ?? undefined }}
            />
            {card.category.name}
          </span>
        )}
        <span>{card.entity.name}</span>
        <IdCode code={card.code} />
      </p>
      <Heading
        id={`mural-${card.code}`}
        className={`mt-2 leading-snug font-semibold ${headingLevel === 'h1' ? 'text-2xl' : 'text-lg'}`}
      >
        <Link to="/mural/$ref" params={{ ref: card.code }} className="underline-offset-4 hover:underline">
          {card.title}
        </Link>
      </Heading>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('mural.publishedOn', { date: dates.date(card.publishedAt) })}
      </p>
      {card.people.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {card.people.map((p) => (
            <li key={p.userId} className="flex items-center gap-2">
              <PersonAvatar person={{ id: p.userId, name: p.name, photoVersion: p.photoVersion }} size="sm" />
              <span>
                {p.name} <span className="text-xs text-muted-foreground">· {t(`mural.roles.${p.role}`)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <ReactionBar card={card} />
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 gap-1 px-2" asChild>
            <Link to="/mural/$ref" params={{ ref: card.code }} hash="conversa">
              <MessageSquare aria-hidden="true" />
              {t('mural.commentCount', { count: card.commentCount })}
            </Link>
          </Button>
          <ShareMenu card={card} />
          {card.canOpen && (
            <Button size="sm" variant="ghost" className="h-8 px-2" asChild>
              <Link to="/ideias/$ref" params={{ ref: card.code }}>
                {t('mural.openIdea')}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
