import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { EyeOff, FileDown, Heart, MessageSquare, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '../auth/auth-layout';
import { HelpLink } from '../help';
import { usePageTitle } from '../page-title';
import { useCan, usePublicSettings } from '../session';
import { useDates } from '../use-dates';

type Card = components['schemas']['HallCard'];
const keys = {
  hall: ['hall'] as const,
  detail: (id: string) => ['hall', 'detail', id] as const,
  candidates: ['hall', 'candidates'] as const,
};

function People({ card }: { card: Card }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {card.people.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a lista vem pronta do servidor e não reordena
        <li key={`${p.userId ?? 'anon'}-${i}`} className="flex items-center gap-2">
          <PersonAvatar person={{ id: p.userId, name: p.name, photoVersion: p.photoVersion }} size="sm" />
          <span>{p.name ?? t('hall.anonymous')}</span>
        </li>
      ))}
    </ul>
  );
}

function LikeButton({ card }: { card: Card }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toggle = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      card.likedByMe
        ? unwrap(api.DELETE('/api/ideas/{ref}/like', { params: { path: { ref: card.idea.code } } }))
        : unwrap(api.PUT('/api/ideas/{ref}/like', { params: { path: { ref: card.idea.code } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.hall }),
  });
  if (card.likes === null) return null;
  const label = card.likedByMe
    ? t('hall.unlike', { title: card.idea.title })
    : t('hall.like', { title: card.idea.title });
  return (
    <Button
      size="sm"
      variant={card.likedByMe ? 'secondary' : 'ghost'}
      disabled={!card.canLike || toggle.isPending}
      aria-pressed={card.likedByMe}
      aria-label={`${label}: ${card.likes}`}
      title={card.canLike ? label : t('hall.ownIdea')}
      onClick={() => toggle.mutate()}
    >
      <Heart aria-hidden="true" className={card.likedByMe ? 'fill-current' : ''} />
      <span className="tabular-nums">{card.likes}</span>
    </Button>
  );
}

/** Cartão do destaque (RN-75): título, categoria, entidade, antes e depois, quem fez, período. */
function HallCardView({ card }: { card: Card }) {
  const { t } = useTranslation();
  const dates = useDates();
  return (
    <article className="flex h-full flex-col rounded-lg border bg-card p-5">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={card.scope === 'organization' ? 'default' : 'outline'}>
          {t(`hall.scopes.${card.scope}` as never)}
        </Badge>
        {card.idea.category && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="size-2 rounded-sm"
              style={{ backgroundColor: card.idea.category.color ?? undefined }}
            />
            {card.idea.category.name}
          </span>
        )}
        <span>{card.idea.entity}</span>
      </p>
      <h3 className="mt-2 text-lg font-semibold leading-snug">
        <Link to="/hall/$id" params={{ id: card.id }} className="underline-offset-4 hover:underline">
          {card.idea.title}
        </Link>
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{card.justification}</p>
      {card.idea.after && (
        <p className="mt-3 line-clamp-3 text-sm">
          <span className="font-medium">{t('hall.after')}: </span>
          {card.idea.after}
        </p>
      )}
      {card.gain && (
        <p className="mt-2 text-sm font-medium">
          {t('hall.gain', {
            value: new Intl.NumberFormat(undefined, {
              style: 'currency',
              currency: card.gain.currency,
              maximumFractionDigits: 0,
            }).format(card.gain.validatedAnnual),
          })}
        </p>
      )}
      <div className="mt-auto pt-4">
        <People card={card} />
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {dates.day(card.startsOn)} → {dates.day(card.endsOn)}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-flex items-center gap-1" title={t('hall.praiseCount', { count: card.praises })}>
              <MessageSquare aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{t('hall.praiseCount', { count: card.praises })}</span>
              <span aria-hidden="true">{card.praises}</span>
            </span>
            <LikeButton card={card} />
          </span>
        </div>
      </div>
    </article>
  );
}

// --- Página do Hall -----------------------------------------------------------------------------

export function HallPage() {
  const { t } = useTranslation();
  const { data: settings } = usePublicSettings();
  usePageTitle(t('hall.pageTitle'), settings?.organizationName);
  const hall = useQuery({ queryKey: keys.hall, queryFn: () => unwrap(api.GET('/api/hall')) });
  const [highlighting, setHighlighting] = useState<string | null>(null);
  const d = hall.data;
  return (
    <div className="mx-auto max-w-[72rem]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-start gap-1.5">
            <h1 className="text-[1.75rem] leading-tight font-bold">{t('hall.title')}</h1>
            <span className="pt-1">
              <HelpLink topic="hall" />
            </span>
          </div>
          <p className="mt-1 max-w-[70ch] text-muted-foreground">{t('hall.intro')}</p>
        </div>
        {d?.canCurate && <Button onClick={() => setHighlighting('')}>{t('hall.highlight')}</Button>}
      </div>
      <FormError message={hall.isError ? errorText(t, hall.error) : null} />
      {d?.mine.some((m) => m.status === 'pending') && <MyConsents mine={d.mine} />}
      {d?.canCurate && <Candidates onHighlight={setHighlighting} />}

      <section aria-labelledby="destaques" className="mt-8">
        <h2 id="destaques" className="font-semibold">
          {t('hall.current')}
        </h2>
        {d && d.current.length === 0 ? (
          <p className="mt-3 rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t('hall.empty')}</p>
        ) : (
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {d?.current.map((c) => (
              <li key={c.id}>
                <HallCardView card={c} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {d && d.fame.length > 0 && (
        <section aria-labelledby="hall-da-fama" className="mt-10">
          <h2 id="hall-da-fama" className="flex items-center gap-2 font-semibold">
            <Sparkles aria-hidden="true" className="size-4" />
            {t('hall.fame')}
          </h2>
          {d.fame.map((y) => (
            <div key={y.year} className="mt-4">
              <h3 className="text-sm font-semibold text-muted-foreground">{y.year}</h3>
              <ul className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {y.cards.map((c) => (
                  <li key={c.id}>
                    <HallCardView card={c} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {highlighting !== null && <HighlightDialog ideaRef={highlighting} onClose={() => setHighlighting(null)} />}
    </div>
  );
}

/** Consentimento (RN-74): quem foi destacado escolhe se aparece com o nome. */
function MyConsents({ mine }: { mine: components['schemas']['MyConsent'][] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const answer = useMutation({
    meta: { success: t('feedback.hall.consentAnswered') },
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      unwrap(api.POST('/api/hall/highlights/{id}/consent', { params: { path: { id } }, body: { accept } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.hall }),
  });
  return (
    <section aria-labelledby="meus-destaques" className="mt-6 rounded-lg border border-primary/50 bg-primary/5 p-5">
      <h2 id="meus-destaques" className="font-semibold">
        {t('hall.consentTitle')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('hall.consentIntro')}</p>
      <ul className="mt-3 space-y-2">
        {mine
          .filter((m) => m.status === 'pending')
          .map((m) => (
            <li key={m.highlightId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Link to="/hall/$id" params={{ id: m.highlightId }} className="font-medium underline underline-offset-4">
                {m.ideaTitle}
              </Link>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  disabled={answer.isPending}
                  onClick={() => answer.mutate({ id: m.highlightId, accept: true })}
                >
                  {t('hall.consentAccept')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={answer.isPending}
                  onClick={() => answer.mutate({ id: m.highlightId, accept: false })}
                >
                  {t('hall.consentDecline')}
                </Button>
              </span>
            </li>
          ))}
      </ul>
      <FormError message={answer.isError ? errorText(t, answer.error) : null} />
    </section>
  );
}

/** Sugestões automáticas (RN-72b): só para a curadoria; nada entra sem ação humana. */
function Candidates({ onHighlight }: { onHighlight: (code: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: keys.candidates, queryFn: () => unwrap(api.GET('/api/hall/candidates')) });
  const dismiss = useMutation({
    meta: { success: t('feedback.hall.dismissed') },
    mutationFn: (code: string) =>
      unwrap(api.POST('/api/hall/candidates/{ref}/dismiss', { params: { path: { ref: code } } })),
    onSuccess: (data) => qc.setQueryData(keys.candidates, data),
  });
  if (!list.data || list.data.length === 0) return null;
  return (
    <section aria-labelledby="candidatas" className="mt-6 rounded-lg border bg-card p-5">
      <h2 id="candidatas" className="font-semibold">
        {t('hall.candidates')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('hall.candidatesIntro')}</p>
      <ul className="mt-3 divide-y text-sm">
        {list.data.map((c) => (
          <li key={c.code} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <Link
                to="/ideias/$ref"
                params={{ ref: c.code }}
                className="font-medium underline-offset-4 hover:underline"
              >
                {c.title}
              </Link>
              <span className="block text-xs text-muted-foreground">
                {c.entity} · {c.reason === 'gain' ? t('hall.reasonGain') : t('hall.reasonLikes', { count: c.likes })}
              </span>
            </span>
            <span className="flex gap-2">
              <Button size="sm" onClick={() => onHighlight(c.code)}>
                {t('hall.highlight')}
              </Button>
              <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(c.code)}>
                {t('hall.dismiss')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Destacar (RN-72): justificativa e período obrigatórios; escopo conforme a permissão. */
export function HighlightDialog({ ideaRef, onClose }: { ideaRef: string; onClose: () => void }) {
  const { t } = useTranslation();
  const dates = useDates();
  const can = useCan();
  const qc = useQueryClient();
  const [ref, setRef] = useState(ideaRef);
  const [scope, setScope] = useState<'entity' | 'organization'>(
    can('hall.highlight_entity') ? 'entity' : 'organization',
  );
  const [justification, setJustification] = useState('');
  const [startsOn, setStartsOn] = useState(dates.dayFromToday(0));
  const [endsOn, setEndsOn] = useState(dates.dayFromToday(30));
  const save = useMutation({
    meta: { success: t('feedback.hall.highlighted') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/hall/highlights', { body: { ideaRef: ref.trim(), scope, justification, startsOn, endsOn } }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.hall });
      void qc.invalidateQueries({ queryKey: ['ideas'] });
      onClose();
    },
  });
  const server = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('hall.highlightTitle')}</DialogTitle>
          <DialogDescription>{t('hall.highlightIntro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('hall.ideaCode')} error={server.ideaRef}>
              <Input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="ITS-2026-0001"
                className="font-mono"
              />
            </Field>
            <Field label={t('hall.scope')}>
              <NativeSelect value={scope} onChange={(e) => setScope(e.target.value as 'entity' | 'organization')}>
                {can('hall.highlight_entity', 'hall.highlight_org') && (
                  <option value="entity">{t('hall.scopes.entity')}</option>
                )}
                {can('hall.highlight_org') && <option value="organization">{t('hall.scopes.organization')}</option>}
              </NativeSelect>
            </Field>
          </div>
          <Field label={t('hall.justification')} error={server.justification}>
            <Textarea
              rows={3}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              maxLength={2000}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('hall.startsOn')} error={server.startsOn}>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </Field>
            <Field label={t('hall.endsOn')} error={server.endsOn}>
              <Input type="date" min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </Field>
          </div>
          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || !ref.trim() || !justification.trim()}>
              {t('hall.highlight')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Detalhe do destaque ------------------------------------------------------------------------

export function HighlightPage() {
  const { id } = useParams({ from: '/instalacao/sessao/hall/$id' });
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  const detail = useQuery({
    queryKey: keys.detail(id),
    queryFn: () => unwrap(api.GET('/api/hall/highlights/{id}', { params: { path: { id } } })),
  });
  usePageTitle(detail.data?.card.idea.title ?? t('hall.pageTitle'), settings?.organizationName);
  const [praise, setPraise] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [hiding, setHiding] = useState<string | null>(null);
  const set = (data: components['schemas']['HighlightDetail']) => {
    qc.setQueryData(keys.detail(id), data);
    void qc.invalidateQueries({ queryKey: keys.hall });
  };
  const send = useMutation({
    meta: { success: t('feedback.hall.praised') },
    mutationFn: () =>
      unwrap(api.POST('/api/hall/highlights/{id}/praises', { params: { path: { id } }, body: { body: praise } })),
    onSuccess: (data) => {
      set(data);
      setPraise('');
    },
  });
  const consent = useMutation({
    meta: { success: t('feedback.hall.consentAnswered') },
    mutationFn: (accept: boolean) =>
      unwrap(api.POST('/api/hall/highlights/{id}/consent', { params: { path: { id } }, body: { accept } })),
    onSuccess: set,
  });
  const like = useMutation({
    meta: { silent: true },
    mutationFn: (on: boolean) =>
      on
        ? unwrap(api.PUT('/api/ideas/{ref}/like', { params: { path: { ref: detail.data?.card.idea.code ?? '' } } }))
        : unwrap(api.DELETE('/api/ideas/{ref}/like', { params: { path: { ref: detail.data?.card.idea.code ?? '' } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.detail(id) }),
  });
  if (detail.isError) return <FormError message={errorText(t, detail.error)} />;
  const d = detail.data;
  if (!d) return null;
  const c = d.card;
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/hall" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← {t('hall.back')}
      </Link>
      <article className="mt-3 rounded-lg border bg-card p-6">
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={c.scope === 'organization' ? 'default' : 'outline'}>
            {t(`hall.scopes.${c.scope}` as never)}
          </Badge>
          {c.state !== 'active' && <Badge variant="secondary">{t(`hall.states.${c.state}` as never)}</Badge>}
          {c.idea.category && <span>{c.idea.category.name}</span>}
          <span>{c.idea.entity}</span>
          <span>
            {dates.day(c.startsOn)} → {dates.day(c.endsOn)}
          </span>
        </p>
        <h1 className="mt-2 text-2xl font-bold">{c.idea.title}</h1>
        <p className="mt-1 text-muted-foreground">{c.justification}</p>
        {d.revokedReason && (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
            {t('hall.revokedReason', { reason: d.revokedReason })}
          </p>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold">{t('hall.before')}</h2>
            <p className="mt-1 text-sm whitespace-pre-wrap">{c.idea.before}</p>
          </div>
          <div>
            <h2 className="text-sm font-semibold">{t('hall.after')}</h2>
            <p className="mt-1 text-sm whitespace-pre-wrap">{c.idea.after ?? '—'}</p>
          </div>
        </div>
        {c.gain && (
          <p className="mt-4 text-sm font-medium">
            {t('hall.gain', {
              value: new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: c.gain.currency,
                maximumFractionDigits: 0,
              }).format(c.gain.validatedAnnual),
            })}
          </p>
        )}
        <div className="mt-4">
          <h2 className="text-sm font-semibold">{t('hall.people')}</h2>
          <People card={c} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {c.likes !== null && (
            <Button
              size="sm"
              variant={c.likedByMe ? 'secondary' : 'outline'}
              disabled={!c.canLike || like.isPending}
              aria-pressed={c.likedByMe}
              onClick={() => like.mutate(!c.likedByMe)}
            >
              <Heart aria-hidden="true" className={c.likedByMe ? 'fill-current' : ''} />
              {c.likedByMe ? t('hall.liked') : t('hall.likeShort')} · <span className="tabular-nums">{c.likes}</span>
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/hall/highlights/${c.id}/card`} download>
              <FileDown aria-hidden="true" />
              {t('hall.exportPdf')}
            </a>
          </Button>
          {c.canOpenIdea && (
            <Button size="sm" variant="ghost" asChild>
              <Link to="/ideias/$ref" params={{ ref: c.idea.code }}>
                {t('hall.openIdea')}
              </Link>
            </Button>
          )}
          {c.canManage && (
            <Button size="sm" variant="ghost" onClick={() => setRevoking(true)}>
              {t('hall.revoke')}
            </Button>
          )}
        </div>
        {d.myConsent === 'pending' && (
          <div className="mt-5 rounded-md border border-primary/50 bg-primary/5 p-4 text-sm">
            <p>{t('hall.consentQuestion')}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={consent.isPending} onClick={() => consent.mutate(true)}>
                {t('hall.consentAccept')}
              </Button>
              <Button size="sm" variant="outline" disabled={consent.isPending} onClick={() => consent.mutate(false)}>
                {t('hall.consentDecline')}
              </Button>
            </div>
          </div>
        )}
        {d.myConsent && d.myConsent !== 'pending' && (
          <p className="mt-4 text-xs text-muted-foreground">
            {d.myConsent === 'accepted' ? t('hall.consentAccepted') : t('hall.consentDeclined')}{' '}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => consent.mutate(d.myConsent !== 'accepted')}
            >
              {t('hall.consentChange')}
            </button>
          </p>
        )}
      </article>

      <section aria-labelledby="elogios" className="mt-6 rounded-lg border bg-card p-5">
        <h2 id="elogios" className="font-semibold">
          {t('hall.praises')}
        </h2>
        {d.praiseList.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('hall.noPraises')}</p>
        ) : (
          <ul className="mt-3 space-y-3 text-sm">
            {d.praiseList.map((p) => (
              <li key={p.id} className={`rounded-md border p-3 ${p.hidden ? 'border-dashed bg-muted/40' : ''}`}>
                <p className="whitespace-pre-wrap">{p.body}</p>
                <p className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {p.author ?? t('hall.anonymous')} · {dates.dateTime(p.createdAt)}
                    {p.hidden && ` · ${t('hall.hiddenBy', { reason: p.hiddenReason ?? '' })}`}
                  </span>
                  {d.canModerate && !p.hidden && (
                    <Button size="sm" variant="ghost" onClick={() => setHiding(p.id)}>
                      <EyeOff aria-hidden="true" />
                      {t('hall.hide')}
                    </Button>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        {c.state !== 'revoked' && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (praise.trim()) send.mutate();
            }}
            className="mt-4 space-y-2"
          >
            <Field label={t('hall.newPraise')}>
              <Textarea rows={2} value={praise} onChange={(e) => setPraise(e.target.value)} maxLength={1000} />
            </Field>
            <FormError message={send.isError ? errorText(t, send.error) : null} />
            <Button type="submit" size="sm" disabled={send.isPending || !praise.trim()}>
              {t('hall.sendPraise')}
            </Button>
          </form>
        )}
      </section>
      {revoking && (
        <ReasonDialog
          title={t('hall.revokeTitle')}
          label={t('hall.revoke')}
          success={t('feedback.hall.revoked')}
          onClose={() => setRevoking(false)}
          onSend={(reason) =>
            unwrap(api.POST('/api/hall/highlights/{id}/revoke', { params: { path: { id } }, body: { reason } })).then(
              set,
            )
          }
        />
      )}
      {hiding && (
        <ReasonDialog
          title={t('hall.hideTitle')}
          label={t('hall.hide')}
          success={t('feedback.hall.hidden')}
          onClose={() => setHiding(null)}
          onSend={(reason) =>
            unwrap(
              api.POST('/api/hall/praises/{id}/hide', { params: { path: { id: hiding } }, body: { reason } }),
            ).then(set)
          }
        />
      )}
    </div>
  );
}

function ReasonDialog({
  title,
  label,
  success,
  onClose,
  onSend,
}: {
  title: string;
  label: string;
  /** Texto do aviso na tela quando der certo (RN-174). */
  success: string;
  onClose: () => void;
  onSend: (reason: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const send = useMutation({ meta: { success }, mutationFn: () => onSend(reason), onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) send.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('hall.reason')}>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          </Field>
          <FormError message={send.isError ? errorText(t, send.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending || !reason.trim()}>
              {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
