import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Award, Gift, Lock, Medal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
import { PersonAvatar } from '@/components/person-avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { FormError } from '../auth/auth-layout';
import { HelpLink } from '../help';
import { PersonPicker } from '../ideas/person-picker';
import { usePageTitle } from '../page-title';
import { useCan, usePublicSettings } from '../session';
import { useDates } from '../use-dates';

/** Reconhecimento (RN-66 a RN-71): só existe com o módulo ligado (o menu some quando desligado). */
export function RecognitionPage() {
  const { t } = useTranslation();
  const can = useCan();
  const { data: settings } = usePublicSettings();
  usePageTitle(t('recognition.pageTitle'), settings?.organizationName);
  const enabled = settings?.recognition.enabled ?? false;
  const me = useQuery({
    queryKey: ['recognition', 'me'],
    queryFn: () => unwrap(api.GET('/api/recognition/me')),
    enabled,
  });
  if (settings && !enabled) {
    return (
      <div className="mx-auto max-w-[72rem]">
        <h1 className="text-[1.75rem] leading-tight font-bold">{t('recognition.title')}</h1>
        <p className="mt-1 max-w-[70ch] text-muted-foreground">{t('recognition.disabled')}</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[72rem]">
      <div className="flex items-start gap-1.5">
        <h1 className="text-[1.75rem] leading-tight font-bold">{t('recognition.title')}</h1>
        <span className="pt-1">
          <HelpLink topic="recognition" />
        </span>
      </div>
      <p className="mt-1 max-w-[70ch] text-muted-foreground">{t('recognition.intro')}</p>
      <FormError message={me.isError ? errorText(t, me.error) : null} />
      {me.data && <MyPoints data={me.data} />}
      <RankingSection individual={settings?.recognition.individualRanking ?? false} />
      {can('reward.register') && <RewardsSection />}
    </div>
  );
}

type MyData = components['schemas']['MyRecognition'];

function MyPoints({ data }: { data: MyData }) {
  const { t, i18n } = useTranslation();
  const dates = useDates();
  const n = (v: number) => new Intl.NumberFormat(i18n.language).format(v);
  const progress =
    data.nextLevel && data.level
      ? Math.round(
          ((data.totalPoints - data.level.minPoints) / (data.nextLevel.minPoints - data.level.minPoints)) * 100,
        )
      : 100;
  return (
    <>
      <section aria-labelledby="meus-pontos" className="mt-6 grid gap-3 sm:grid-cols-3">
        <h2 id="meus-pontos" className="sr-only">
          {t('recognition.myPoints')}
        </h2>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t('recognition.total')}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{n(data.totalPoints)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {data.season ? t('recognition.seasonPoints', { name: data.season.name }) : t('recognition.noSeason')}
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {data.seasonPoints === null ? '—' : n(data.seasonPoints)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t('recognition.level')}</p>
          <p className="mt-1 flex items-center gap-2 text-xl font-bold">
            <Medal aria-hidden="true" className="size-5 text-primary" />
            {data.level?.name ?? '—'}
          </p>
          {data.nextLevel && (
            <>
              <Progress
                value={progress}
                className="mt-2"
                aria-label={t('recognition.toNext', { name: data.nextLevel.name })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t('recognition.missing', {
                  points: n(data.nextLevel.minPoints - data.totalPoints),
                  name: data.nextLevel.name,
                })}
              </p>
            </>
          )}
        </div>
      </section>
      {!data.nameVisible && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t('recognition.hiddenName')}{' '}
          <Link to="/minha-conta" className="underline underline-offset-4">
            {t('recognition.changeInAccount')}
          </Link>
        </p>
      )}

      <section aria-labelledby="conquistas" className="mt-8">
        <h2 id="conquistas" className="flex items-center gap-2 font-semibold">
          <Award aria-hidden="true" className="size-4" />
          {t('recognition.achievements')}
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.achievements.map((a) => (
            <li
              key={a.code}
              className={`rounded-lg border p-4 ${a.grantedAt ? 'border-primary/50 bg-card' : 'bg-muted/30 text-muted-foreground'}`}
            >
              <p className="flex items-center gap-2 font-medium">
                {a.grantedAt ? (
                  <Award aria-hidden="true" className="size-4 text-primary" />
                ) : (
                  <Lock aria-hidden="true" className="size-4" />
                )}
                {a.name}
              </p>
              {a.description && <p className="mt-1 text-sm">{a.description}</p>}
              <p className="mt-2 text-xs">
                {a.grantedAt ? t('recognition.grantedOn', { date: dates.date(a.grantedAt) }) : t('recognition.locked')}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="lancamentos" className="rounded-lg border bg-card p-5">
          <h2 id="lancamentos" className="font-semibold">
            {t('recognition.recent')}
          </h2>
          {data.recent.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('recognition.noPoints')}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {data.recent.map((r) => (
                <li key={`${r.at}-${r.eventType}-${r.ideaCode}`} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    {t(`recognition.events.${r.eventType}` as never)}
                    {r.ideaCode && (
                      <>
                        {' · '}
                        <Link to="/ideias/$ref" params={{ ref: r.ideaCode }} className="underline underline-offset-4">
                          {r.ideaTitle ?? r.ideaCode}
                        </Link>
                      </>
                    )}
                    <span className="block text-xs text-muted-foreground">{dates.dateTime(r.at)}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">+{n(r.points)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="minhas-recompensas" className="rounded-lg border bg-card p-5">
          <h2 id="minhas-recompensas" className="flex items-center gap-2 font-semibold">
            <Gift aria-hidden="true" className="size-4" />
            {t('recognition.myRewards')}
          </h2>
          {data.rewards.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('recognition.noRewards')}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {data.rewards.map((r) => (
                <li key={r.id}>
                  {r.description}
                  <span className="block text-xs text-muted-foreground">
                    {dates.day(r.grantedOn)}
                    {r.ideaCode ? ` · ${r.ideaCode}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function RankingSection({ individual }: { individual: boolean }) {
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<'individual' | 'entity'>(individual ? 'individual' : 'entity');
  const [period, setPeriod] = useState<'season' | 'all'>('season');
  const effective = individual ? scope : 'entity';
  const ranking = useQuery({
    queryKey: ['recognition', 'ranking', effective, period],
    queryFn: () => unwrap(api.GET('/api/recognition/ranking', { params: { query: { scope: effective, period } } })),
  });
  const n = (v: number) => new Intl.NumberFormat(i18n.language).format(v);
  return (
    <section aria-labelledby="ranking" className="mt-8 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="ranking" className="font-semibold">
          {t('recognition.ranking')}
        </h2>
        <div className="flex flex-wrap gap-3">
          {individual && (
            <Field label={t('recognition.scope')}>
              <NativeSelect value={scope} onChange={(e) => setScope(e.target.value as 'individual' | 'entity')}>
                <option value="individual">{t('recognition.scopes.individual')}</option>
                <option value="entity">{t('recognition.scopes.entity')}</option>
              </NativeSelect>
            </Field>
          )}
          <Field label={t('recognition.period')}>
            <NativeSelect value={period} onChange={(e) => setPeriod(e.target.value as 'season' | 'all')}>
              <option value="season">{t('recognition.periods.season')}</option>
              <option value="all">{t('recognition.periods.all')}</option>
            </NativeSelect>
          </Field>
        </div>
      </div>
      {ranking.data && period === 'season' && ranking.data.period === 'all' && (
        <p className="mt-2 text-sm text-muted-foreground">{t('recognition.noSeasonRanking')}</p>
      )}
      {ranking.data && ranking.data.rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('recognition.emptyRanking')}</p>
      ) : (
        <ol className="mt-3 divide-y text-sm">
          {ranking.data?.rows.map((r) => (
            <li key={r.position} className={`flex items-center gap-3 py-2 ${r.isMe ? 'font-semibold' : ''}`}>
              <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{r.position}º</span>
              {ranking.data?.scope === 'individual' && (
                <PersonAvatar person={{ id: r.userId, name: r.name, photoVersion: r.photoVersion }} size="sm" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {r.isMe ? t('recognition.you') : (r.name ?? t('recognition.anonymous'))}
              </span>
              <span className="tabular-nums">{n(r.points)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Recompensas concedidas (RN-71): só registro informativo, sem valor nem pagamento. */
function RewardsSection() {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const rewards = useQuery({
    queryKey: ['recognition', 'rewards'],
    queryFn: () => unwrap(api.GET('/api/recognition/rewards')),
  });
  const [userId, setUserId] = useState('');
  const [ideaRef, setIdeaRef] = useState('');
  const [description, setDescription] = useState('');
  const [grantedOn, setGrantedOn] = useState(dates.dayFromToday(0));
  const save = useMutation({
    meta: { success: t('feedback.recognition.rewardSaved') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/recognition/rewards', {
          body: { userId, ideaRef: ideaRef.trim() || null, description, grantedOn },
        }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(['recognition', 'rewards'], data);
      setDescription('');
      setIdeaRef('');
    },
  });
  const server = fieldErrors(save.error);
  return (
    <section aria-labelledby="recompensas" className="mt-8 rounded-lg border bg-card p-5">
      <h2 id="recompensas" className="flex items-center gap-2 font-semibold">
        <Gift aria-hidden="true" className="size-4" />
        {t('recognition.rewards.title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('recognition.rewards.intro')}</p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (userId && description.trim()) save.mutate();
        }}
        className="mt-4 grid gap-4 md:grid-cols-2"
      >
        <PersonPicker
          label={t('recognition.rewards.person')}
          searchLabel={t('recognition.rewards.search')}
          value={userId}
          onChange={setUserId}
          error={server.userId}
        />
        <Field label={t('recognition.rewards.idea')} optionalLabel={t('common.optional')} error={server.ideaRef}>
          <Input
            value={ideaRef}
            onChange={(e) => setIdeaRef(e.target.value)}
            placeholder="ITS-2026-0001"
            className="font-mono"
          />
        </Field>
        <Field label={t('recognition.rewards.description')} error={server.description}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>
        <Field label={t('recognition.rewards.date')} error={server.grantedOn}>
          <Input type="date" value={grantedOn} onChange={(e) => setGrantedOn(e.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <Button type="submit" disabled={save.isPending || !userId || !description.trim()}>
            {t('recognition.rewards.register')}
          </Button>
        </div>
      </form>
      {rewards.data && rewards.data.length > 0 && (
        <ul className="mt-5 divide-y text-sm">
          {rewards.data.map((r) => (
            <li key={r.id} className="py-2">
              <span className="font-medium">{r.userName}</span> · {r.description}
              <span className="block text-xs text-muted-foreground">
                {dates.day(r.grantedOn)}
                {r.ideaCode ? ` · ${r.ideaCode}` : ''}
                {r.registeredBy ? ` · ${t('recognition.rewards.by', { name: r.registeredBy })}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
