import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Megaphone, Plus, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
import { RichTextEditor } from '@/components/form/rich-text-editor';
import { RichText } from '@/components/rich-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { docOf, type RichDoc, richPayload } from '@/lib/rich';
import { useEntities } from '../admin/queries';
import { entityOptionLabel, orderTree } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { HelpLink } from '../help';
import { useActiveCategories } from '../ideas/queries';
import { usePageTitle } from '../page-title';
import { useCan, usePublicSettings } from '../session';
import { useDates } from '../use-dates';

type Campaign = components['schemas']['CampaignView'];
type Dashboard = components['schemas']['CampaignDashboard'];

const keys = {
  all: ['campaigns'] as const,
  list: ['campaigns', 'list'] as const,
  detail: (id: string) => ['campaigns', 'detail', id] as const,
  available: (entityId?: string, categoryId?: string) => ['campaigns', 'available', entityId, categoryId] as const,
};

export function useAvailableCampaigns(entityId?: string, categoryId?: string, enabled = true) {
  return useQuery({
    queryKey: keys.available(entityId, categoryId),
    queryFn: () =>
      unwrap(
        api.GET('/api/campaigns/available', {
          params: { query: { entityId: entityId || undefined, categoryId: categoryId || undefined } },
        }),
      ),
    enabled,
  });
}

function StatusBadge({ status }: { status: Campaign['status'] }) {
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'active' ? 'default' : status === 'draft' ? 'outline' : 'secondary'}>
      {t(`campaigns.status.${status}` as never)}
    </Badge>
  );
}

function useGoalText() {
  const { t, i18n } = useTranslation();
  const { data: settings } = usePublicSettings();
  return (c: Campaign) => {
    if (c.goalType === 'qualitative' || c.goalValue === null) return c.goalText ?? '';
    const value =
      c.goalType === 'gain'
        ? new Intl.NumberFormat(i18n.language, {
            style: 'currency',
            currency: settings?.currency ?? 'BRL',
            maximumFractionDigits: 0,
          }).format(c.goalValue)
        : new Intl.NumberFormat(i18n.language).format(c.goalValue);
    const base = t(`campaigns.goal.${c.goalType}` as never, { value }) as string;
    return c.goalText ? `${base} · ${c.goalText}` : base;
  };
}

// --- Envio e início (RN-51) -------------------------------------------------------------------

/**
 * Campanha no envio (RN-51): só as ativas que servem para a entidade e a categoria escolhidas.
 * Enviar sem campanha continua sempre possível (fluxo contínuo).
 */
export function CampaignField({
  entityId,
  categoryId,
  value,
  onChange,
}: {
  entityId: string;
  categoryId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const available = useAvailableCampaigns(entityId, categoryId, !!entityId);
  const list = available.data ?? [];
  useEffect(() => {
    if (value && available.isSuccess && !list.some((c) => c.id === value)) onChange('');
  }, [value, available.isSuccess, list, onChange]);
  if (!entityId || list.length === 0) return null;
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
      <Field label={t('campaigns.field')} optionalLabel={t('common.optional')} hint={t('campaigns.fieldHint')}>
        <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('campaigns.none')}</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({t('campaigns.until', { date: dates.day(c.endsOn) })})
            </option>
          ))}
        </NativeSelect>
      </Field>
    </div>
  );
}

/** Destaque das campanhas ativas na página inicial (RN-51). */
export function ActiveCampaigns() {
  const { t } = useTranslation();
  const dates = useDates();
  const goal = useGoalText();
  const can = useCan();
  const available = useAvailableCampaigns(undefined, undefined, can('idea.submit'));
  const list = available.data ?? [];
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="campanhas-ativas" className="mt-8">
      <h2 id="campanhas-ativas" className="flex items-center gap-2 font-semibold">
        <Megaphone aria-hidden="true" className="size-4" />
        {t('campaigns.activeTitle')}
      </h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {list.map((c) => (
          <li key={c.id} className="rounded-lg border border-primary/40 bg-card p-4">
            <p className="font-semibold">{c.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{c.objective}</p>
            <p className="mt-2 text-sm">{goal(c)}</p>
            {c.rewardNote && <p className="mt-1 text-sm">{t('campaigns.reward', { reward: c.rewardNote })}</p>}
            <p className="mt-2 text-xs text-muted-foreground">{t('campaigns.until', { date: dates.day(c.endsOn) })}</p>
            <Link to="/ideias/nova" className="mt-3 inline-block text-sm font-medium underline underline-offset-4">
              {t('campaigns.sendIdea')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Lista e cadastro (RN-50) -----------------------------------------------------------------

export function CampaignsPage() {
  const { t } = useTranslation();
  const dates = useDates();
  const goal = useGoalText();
  const can = useCan();
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  usePageTitle(t('campaigns.pageTitle'), settings?.organizationName);
  const list = useQuery({ queryKey: keys.list, queryFn: () => unwrap(api.GET('/api/campaigns')) });
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const act = useMutation({
    meta: {
      success: (_d, v: { action: 'activate' | 'delete' }) =>
        v.action === 'delete' ? t('feedback.campaigns.removed') : t('feedback.campaigns.activated'),
    },
    mutationFn: async ({ id, action }: { id: string; action: 'activate' | 'delete' }) => {
      if (action === 'delete') {
        await unwrap(api.DELETE('/api/campaigns/{id}', { params: { path: { id } } }));
        return;
      }
      await unwrap(api.POST('/api/campaigns/{id}/activate', { params: { path: { id } } }));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.all }),
  });
  return (
    <div className="mx-auto max-w-[72rem]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-start gap-1.5">
            <h1 className="text-[1.75rem] leading-tight font-bold">{t('campaigns.title')}</h1>
            <span className="pt-1">
              <HelpLink topic="campaigns" />
            </span>
          </div>
          <p className="mt-1 max-w-[70ch] text-muted-foreground">{t('campaigns.intro')}</p>
        </div>
        {can('campaign.manage') && (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('campaigns.new')}
          </Button>
        )}
      </div>
      <FormError message={act.isError ? errorText(t, act.error) : list.isError ? errorText(t, list.error) : null} />
      {list.data && list.data.length === 0 && (
        <p className="mt-6 rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t('campaigns.empty')}</p>
      )}
      <ul className="mt-6 grid gap-3">
        {list.data?.map((c) => (
          <li key={c.id} className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/campanhas/$id"
                    params={{ id: c.id }}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {c.name}
                  </Link>
                  <StatusBadge status={c.status} />
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {dates.day(c.startsOn)} → {dates.day(c.endsOn)} · {goal(c)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.entities.length ? c.entities.map((e) => e.name).join(', ') : t('campaigns.allEntities')}
                  {' · '}
                  {c.categories.length ? c.categories.map((x) => x.name).join(', ') : t('campaigns.allCategories')}
                </p>
              </div>
              {c.canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                    {t('campaigns.edit')}
                  </Button>
                  {c.status === 'draft' && (
                    <>
                      <Button
                        size="sm"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: c.id, action: 'activate' })}
                      >
                        {t('campaigns.activate')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: c.id, action: 'delete' })}
                      >
                        {t('campaigns.delete')}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editing && <CampaignDialog campaign={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CampaignDialog({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const entities = useEntities();
  const categories = useActiveCategories();
  const [name, setName] = useState(campaign?.name ?? '');
  const [objective, setObjective] = useState<RichDoc | null>(docOf(campaign?.objectiveRich, campaign?.objective));
  const [startsOn, setStartsOn] = useState(campaign?.startsOn ?? dates.dayFromToday(0));
  const [endsOn, setEndsOn] = useState(campaign?.endsOn ?? dates.dayFromToday(30));
  const [goalType, setGoalType] = useState<Campaign['goalType']>(campaign?.goalType ?? 'ideas');
  const [goalValue, setGoalValue] = useState(campaign?.goalValue == null ? '' : String(campaign.goalValue));
  const [goalText, setGoalText] = useState(campaign?.goalText ?? '');
  const [rewardNote, setRewardNote] = useState(campaign?.rewardNote ?? '');
  const [entityIds, setEntityIds] = useState<string[]>(campaign?.entities.map((e) => e.id) ?? []);
  const [categoryIds, setCategoryIds] = useState<string[]>(campaign?.categories.map((c) => c.id) ?? []);
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));
  const save = useMutation({
    meta: { success: campaign ? t('feedback.campaigns.updated') : t('feedback.campaigns.created') },
    mutationFn: () => {
      const body = {
        name,
        objective: richPayload(objective).text,
        objectiveRich: richPayload(objective).rich,
        startsOn,
        endsOn,
        goalType,
        goalValue: goalType === 'qualitative' || goalValue.trim() === '' ? null : Number(goalValue.replace(',', '.')),
        goalText: goalText.trim() || null,
        rewardNote: rewardNote.trim() || null,
        entityIds,
        categoryIds,
      };
      return campaign
        ? unwrap(api.PUT('/api/campaigns/{id}', { params: { path: { id: campaign.id } }, body }))
        : unwrap(api.POST('/api/campaigns', { body }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.all });
      onClose();
    },
  });
  const server = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign ? t('campaigns.editTitle') : t('campaigns.newTitle')}</DialogTitle>
          <DialogDescription>{t('campaigns.formIntro')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('campaigns.name')} error={server.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </Field>
          <Field label={t('campaigns.objective')} error={server.objective}>
            <RichTextEditor rows={2} max={5000} value={objective} onChange={setObjective} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('campaigns.startsOn')} error={server.startsOn}>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </Field>
            <Field label={t('campaigns.endsOn')} error={server.endsOn}>
              <Input type="date" min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('campaigns.goalType')}>
              <NativeSelect value={goalType} onChange={(e) => setGoalType(e.target.value as Campaign['goalType'])}>
                <option value="ideas">{t('campaigns.goalTypes.ideas')}</option>
                <option value="gain">{t('campaigns.goalTypes.gain')}</option>
                <option value="qualitative">{t('campaigns.goalTypes.qualitative')}</option>
              </NativeSelect>
            </Field>
            {goalType !== 'qualitative' && (
              <Field label={t('campaigns.goalValue')} error={server.goalValue}>
                <Input inputMode="decimal" value={goalValue} onChange={(e) => setGoalValue(e.target.value)} />
              </Field>
            )}
          </div>
          <Field
            label={t('campaigns.goalText')}
            optionalLabel={goalType === 'qualitative' ? undefined : t('common.optional')}
            hint={t('campaigns.goalTextHint')}
            error={server.goalText}
          >
            <Input value={goalText} onChange={(e) => setGoalText(e.target.value)} maxLength={500} />
          </Field>
          <Field label={t('campaigns.reward')} optionalLabel={t('common.optional')} hint={t('campaigns.rewardHint')}>
            <Input value={rewardNote} onChange={(e) => setRewardNote(e.target.value)} maxLength={2000} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="text-sm font-medium">{t('campaigns.entities')}</legend>
              <p className="text-xs text-muted-foreground">{t('campaigns.entitiesHint')}</p>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {orderTree(entities.data ?? []).map((e) => (
                  <div key={e.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`ce-${e.id}`}
                      checked={entityIds.includes(e.id)}
                      onCheckedChange={(v) => setEntityIds((l) => toggle(l, e.id, v === true))}
                    />
                    <label htmlFor={`ce-${e.id}`}>{entityOptionLabel(e)}</label>
                  </div>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium">{t('campaigns.categories')}</legend>
              <p className="text-xs text-muted-foreground">{t('campaigns.categoriesHint')}</p>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {categories.data?.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`cc-${c.id}`}
                      checked={categoryIds.includes(c.id)}
                      onCheckedChange={(v) => setCategoryIds((l) => toggle(l, c.id, v === true))}
                    />
                    <label htmlFor={`cc-${c.id}`}>{c.name}</label>
                  </div>
                ))}
              </div>
            </fieldset>
          </div>
          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Painel (RN-52) e encerramento (RN-53) ----------------------------------------------------

export function CampaignPage() {
  const { id } = useParams({ from: '/instalacao/sessao/campanhas/$id' });
  const { t, i18n } = useTranslation();
  const dates = useDates();
  const goal = useGoalText();
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  const dashboard = useQuery({
    queryKey: keys.detail(id),
    queryFn: () => unwrap(api.GET('/api/campaigns/{id}', { params: { path: { id } } })),
  });
  usePageTitle(dashboard.data?.campaign.name ?? t('campaigns.pageTitle'), settings?.organizationName);
  const [confirm, setConfirm] = useState(false);
  const close = useMutation({
    meta: { success: t('feedback.campaigns.closed') },
    mutationFn: () => unwrap(api.POST('/api/campaigns/{id}/close', { params: { path: { id } } })),
    onSuccess: (d: Dashboard) => {
      qc.setQueryData(keys.detail(id), d);
      void qc.invalidateQueries({ queryKey: keys.list });
      setConfirm(false);
    },
  });
  const d = dashboard.data;
  const money = (v: number, currency: string) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  const percent = (v: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(v);
  if (dashboard.isError) return <FormError message={errorText(t, dashboard.error)} />;
  if (!d) return null;
  const c = d.campaign;
  const metrics: [string, number][] = [
    [t('campaigns.dashboard.received'), d.received],
    [t('campaigns.dashboard.approved'), d.approved],
    [t('campaigns.dashboard.implemented'), d.implemented],
    [t('campaigns.dashboard.participants'), d.participants],
  ];
  return (
    <div className="mx-auto max-w-[72rem]">
      <Link to="/campanhas" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← {t('campaigns.back')}
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-[1.75rem] leading-tight font-bold">
            {c.name} <StatusBadge status={c.status} />
          </h1>
          <RichText rich={c.objectiveRich} plain={c.objective} className="mt-1 max-w-[70ch] text-muted-foreground" />
          <p className="mt-1 text-sm">
            {dates.day(c.startsOn)} → {dates.day(c.endsOn)} · {goal(c)}
          </p>
        </div>
        {c.canManage && c.status === 'active' && (
          <Button variant="outline" onClick={() => setConfirm(true)}>
            {t('campaigns.close')}
          </Button>
        )}
      </div>

      <ul className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map(([label, value]) => (
          <li key={label} className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
          </li>
        ))}
      </ul>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="meta" className="rounded-lg border bg-card p-5">
          <h2 id="meta" className="font-semibold">
            {t('campaigns.dashboard.goal')}
          </h2>
          {d.goalProgress === null ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('campaigns.dashboard.qualitative')}</p>
          ) : (
            <>
              <p className="mt-2 flex justify-between text-sm">
                <span>{goal(c)}</span>
                <span className="font-semibold tabular-nums">{percent(d.goalProgress)}</span>
              </p>
              <Progress
                value={Math.min(100, Math.round(d.goalProgress * 100))}
                className="mt-2"
                aria-label={t('campaigns.dashboard.goal')}
              />
            </>
          )}
          <p className="mt-4 text-sm text-muted-foreground">{t('campaigns.dashboard.gain')}</p>
          {d.gains.length === 0 ? (
            <p className="text-sm">{t('campaigns.dashboard.noGain')}</p>
          ) : (
            d.gains.map((g) => (
              <p key={g.currency} className="text-lg font-semibold tabular-nums">
                {money(g.validatedAnnual, g.currency)}{' '}
                <span className="text-sm font-normal">{t('campaigns.dashboard.perYear')}</span>
              </p>
            ))
          )}
        </section>
        <section aria-labelledby="hall" className="rounded-lg border bg-card p-5">
          <h2 id="hall" className="flex items-center gap-2 font-semibold">
            <Trophy aria-hidden="true" className="size-4" />
            {t('campaigns.dashboard.hallTitle')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('campaigns.dashboard.hallIntro')}</p>
          {d.hallCandidates.length === 0 ? (
            <p className="mt-3 text-sm">{t('campaigns.dashboard.noCandidates')}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {d.hallCandidates.map((h) => (
                <li key={h.code} className="flex flex-wrap justify-between gap-2">
                  <span>
                    <Link
                      to="/ideias/$ref"
                      params={{ ref: h.code }}
                      className="font-medium underline underline-offset-4"
                    >
                      {h.title}
                    </Link>
                    {h.author && <span className="text-muted-foreground"> · {h.author}</span>}
                  </span>
                  {h.validatedAnnual !== null && h.currency && (
                    <span className="tabular-nums">{money(h.validatedAnnual, h.currency)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {c.status === 'closed' && d.summary && (
        <p className="mt-6 rounded-lg border bg-muted/40 p-4 text-sm">
          {t('campaigns.dashboard.summary', {
            date: c.closedAt ? dates.date(c.closedAt) : '',
            received: String(d.summary.received ?? 0),
            implemented: String(d.summary.implemented ?? 0),
          })}
        </p>
      )}

      {confirm && (
        <Dialog open onOpenChange={(o) => !o && setConfirm(false)}>
          <DialogContent closeLabel={t('admin.common.close')}>
            <DialogHeader>
              <DialogTitle>{t('campaigns.closeTitle')}</DialogTitle>
              <DialogDescription>{t('campaigns.closeIntro')}</DialogDescription>
            </DialogHeader>
            <FormError message={close.isError ? errorText(t, close.error) : null} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </Button>
              <Button disabled={close.isPending} onClick={() => close.mutate()}>
                {t('campaigns.close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
