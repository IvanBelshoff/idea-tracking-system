import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
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
import { FormError } from '../auth/auth-layout';
import { HelpLink } from '../help';
import { usePageTitle } from '../page-title';
import { usePublicSettings } from '../session';
import { useDates } from '../use-dates';

type AchievementView = components['schemas']['AchievementView'];
const KEY = ['admin', 'recognition'] as const;

/**
 * Configuração do reconhecimento (RN-66 a RN-68): níveis, conquistas e temporadas. Pode ser
 * preparada com o módulo desligado; ligar e os pesos ficam em Configurações.
 */
export function RecognitionAdminPage() {
  const { t } = useTranslation();
  const { data: settings } = usePublicSettings();
  usePageTitle(t('admin.recognition.pageTitle'), settings?.organizationName);
  return (
    <div className="mx-auto max-w-[72rem]">
      <div className="flex items-start gap-1.5">
        <h1 className="text-[1.75rem] leading-tight font-bold">{t('admin.recognition.title')}</h1>
        <span className="pt-1">
          <HelpLink topic="adminRecognition" />
        </span>
      </div>
      <p className="mt-1 max-w-[70ch] text-muted-foreground">
        {settings?.recognition.enabled ? t('admin.recognition.introOn') : t('admin.recognition.introOff')}
      </p>
      <LevelsCard />
      <AchievementsCard />
      <SeasonsCard />
    </div>
  );
}

function LevelsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const levels = useQuery({ queryKey: [...KEY, 'levels'], queryFn: () => unwrap(api.GET('/api/recognition/levels')) });
  const [rows, setRows] = useState<{ name: string; minPoints: string }[]>([]);
  useEffect(() => {
    if (levels.data) setRows(levels.data.map((l) => ({ name: l.name, minPoints: String(l.minPoints) })));
  }, [levels.data]);
  const save = useMutation({
    meta: { success: t('feedback.recognition.levelsSaved') },
    mutationFn: () =>
      unwrap(
        api.PUT('/api/recognition/levels', {
          body: { levels: rows.map((r) => ({ name: r.name.trim(), minPoints: Number(r.minPoints) })) },
        }),
      ),
    onSuccess: (data) => qc.setQueryData([...KEY, 'levels'], data),
  });
  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <section aria-labelledby="niveis" className="mt-6 rounded-lg border bg-card p-5">
      <h2 id="niveis" className="font-semibold">
        {t('admin.recognition.levels')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('admin.recognition.levelsHint')}</p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="mt-4 space-y-2"
      >
        {rows.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: linhas editáveis sem id estável até salvar
          <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
            <Field label={t('admin.recognition.levelName', { n: i + 1 })}>
              <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={80} />
            </Field>
            <Field label={t('admin.recognition.minPoints')}>
              <Input
                inputMode="numeric"
                value={r.minPoints}
                onChange={(e) => set(i, { minPoints: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('admin.recognition.removeLevel', { name: r.name || i + 1 })}
              disabled={rows.length === 1}
              onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        <FormError message={save.isError ? errorText(t, save.error) : null} />
        {save.isSuccess && !save.isPending && (
          <p className="text-sm text-muted-foreground">{t('admin.recognition.saved')}</p>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setRows((list) => [...list, { name: '', minPoints: '' }])}
          >
            <Plus aria-hidden="true" />
            {t('admin.recognition.addLevel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('admin.recognition.saveLevels')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function AchievementsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: [...KEY, 'achievements'],
    queryFn: () => unwrap(api.GET('/api/recognition/achievements')),
  });
  const [editing, setEditing] = useState<AchievementView | 'new' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const grant = useMutation({
    meta: {
      success: (d: { granted: number; a: { name: string } }) =>
        t('admin.recognition.grantResult', { count: d.granted, name: d.a.name }),
    },
    mutationFn: (a: AchievementView) =>
      unwrap(api.POST('/api/recognition/achievements/{id}/grant', { params: { path: { id: a.id } } })).then((r) => ({
        ...r,
        a,
      })),
    onSuccess: ({ granted, a }) => {
      setResult(t('admin.recognition.grantResult', { count: granted, name: a.name }));
      void qc.invalidateQueries({ queryKey: [...KEY, 'achievements'] });
    },
  });
  return (
    <section aria-labelledby="conquistas-admin" className="mt-6 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="conquistas-admin" className="font-semibold">
          {t('admin.recognition.achievements')}
        </h2>
        <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" />
          {t('admin.recognition.newAchievement')}
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('admin.recognition.achievementsHint')}</p>
      {result && (
        <p role="status" className="mt-2 text-sm">
          {result}
        </p>
      )}
      <FormError message={grant.isError ? errorText(t, grant.error) : null} />
      <ul className="mt-3 divide-y text-sm">
        {list.data?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="font-medium">{a.name}</span>{' '}
              {!a.active && <Badge variant="outline">{t('admin.recognition.inactive')}</Badge>}
              <span className="block text-xs text-muted-foreground">
                {t(`admin.recognition.rules.${a.ruleType}` as never, { n: a.threshold })} ·{' '}
                {t('admin.recognition.holders', { count: a.holders })}
              </span>
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                {t('admin.common.edit')}
              </Button>
              {a.active && (
                <Button size="sm" variant="outline" disabled={grant.isPending} onClick={() => grant.mutate(a)}>
                  {t('admin.recognition.grantNow')}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {editing && (
        <AchievementDialog achievement={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

function AchievementDialog({ achievement, onClose }: { achievement: AchievementView | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [code, setCode] = useState(achievement?.code ?? '');
  const [name, setName] = useState(achievement?.name ?? '');
  const [description, setDescription] = useState(achievement?.description ?? '');
  const [ruleType, setRuleType] = useState<string>(achievement?.ruleType ?? 'ideas_submitted');
  const [threshold, setThreshold] = useState(String(achievement?.threshold ?? 1));
  const [active, setActive] = useState(achievement?.active ?? true);
  const save = useMutation({
    meta: {
      success: achievement
        ? t('feedback.recognition.achievementUpdated')
        : t('feedback.recognition.achievementCreated'),
    },
    mutationFn: () => {
      const body = {
        code,
        name,
        description: description.trim() || null,
        ruleType: ruleType as 'ideas_submitted' | 'ideas_implemented' | 'points',
        threshold: Number(threshold),
        active,
      };
      return achievement
        ? unwrap(api.PUT('/api/recognition/achievements/{id}', { params: { path: { id: achievement.id } }, body }))
        : unwrap(api.POST('/api/recognition/achievements', { body }));
    },
    onSuccess: (data) => {
      qc.setQueryData([...KEY, 'achievements'], data);
      onClose();
    },
  });
  const remove = useMutation({
    meta: { success: t('feedback.recognition.achievementRemoved') },
    mutationFn: () =>
      unwrap(api.DELETE('/api/recognition/achievements/{id}', { params: { path: { id: achievement?.id ?? '' } } })),
    onSuccess: (data) => {
      qc.setQueryData([...KEY, 'achievements'], data);
      onClose();
    },
  });
  const server = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>
            {achievement ? t('admin.recognition.editAchievement') : t('admin.recognition.newAchievement')}
          </DialogTitle>
          <DialogDescription>{t('admin.recognition.achievementIntro')}</DialogDescription>
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
            <Field label={t('admin.recognition.name')} error={server.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
            <Field label={t('admin.recognition.code')} hint={t('admin.recognition.codeHint')} error={server.code}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={60} className="font-mono" />
            </Field>
          </div>
          <Field label={t('admin.recognition.description')} optionalLabel={t('common.optional')}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field label={t('admin.recognition.rule')}>
              <NativeSelect value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
                <option value="ideas_submitted">{t('admin.recognition.ruleTypes.ideas_submitted')}</option>
                <option value="ideas_implemented">{t('admin.recognition.ruleTypes.ideas_implemented')}</option>
                <option value="points">{t('admin.recognition.ruleTypes.points')}</option>
              </NativeSelect>
            </Field>
            <Field label={t('admin.recognition.threshold')} error={server.threshold}>
              <Input
                inputMode="numeric"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="conquista-ativa" checked={active} onCheckedChange={(v) => setActive(v === true)} />
            <label htmlFor="conquista-ativa">{t('admin.recognition.active')}</label>
          </div>
          <FormError
            message={save.isError ? errorText(t, save.error) : remove.isError ? errorText(t, remove.error) : null}
          />
          <DialogFooter className="sm:justify-between">
            {achievement ? (
              <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {t('admin.recognition.deleteAchievement')}
              </Button>
            ) : (
              <span />
            )}
            <span className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {t('common.save')}
              </Button>
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SeasonsCard() {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const seasons = useQuery({
    queryKey: [...KEY, 'seasons'],
    queryFn: () => unwrap(api.GET('/api/recognition/seasons')),
  });
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(dates.dayFromToday(0));
  const [endsOn, setEndsOn] = useState(dates.dayFromToday(90));
  const create = useMutation({
    meta: { success: t('feedback.recognition.seasonCreated') },
    mutationFn: () => unwrap(api.POST('/api/recognition/seasons', { body: { name, startsOn, endsOn } })),
    onSuccess: (data) => {
      qc.setQueryData([...KEY, 'seasons'], data);
      setName('');
    },
  });
  const remove = useMutation({
    meta: { success: t('feedback.recognition.seasonRemoved') },
    mutationFn: (id: string) => unwrap(api.DELETE('/api/recognition/seasons/{id}', { params: { path: { id } } })),
    onSuccess: (data) => qc.setQueryData([...KEY, 'seasons'], data),
  });
  const server = fieldErrors(create.error);
  return (
    <section aria-labelledby="temporadas" className="mt-6 rounded-lg border bg-card p-5">
      <h2 id="temporadas" className="font-semibold">
        {t('admin.recognition.seasons')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('admin.recognition.seasonsHint')}</p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
        className="mt-4 grid items-end gap-3 sm:grid-cols-[1fr_10rem_10rem_auto]"
      >
        <Field label={t('admin.recognition.seasonName')} error={server.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t('admin.recognition.startsOn')}>
          <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label={t('admin.recognition.endsOn')} error={server.endsOn}>
          <Input type="date" min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {t('admin.recognition.addSeason')}
        </Button>
      </form>
      <FormError
        message={create.isError ? errorText(t, create.error) : remove.isError ? errorText(t, remove.error) : null}
      />
      <ul className="mt-4 divide-y text-sm">
        {seasons.data?.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">{s.name}</span>{' '}
              {s.current && <Badge>{t('admin.recognition.current')}</Badge>}
              <span className="block text-xs text-muted-foreground">
                {dates.day(s.startsOn)} → {dates.day(s.endsOn)}
              </span>
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('admin.recognition.removeSeason', { name: s.name })}
              disabled={remove.isPending}
              onClick={() => remove.mutate(s.id)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
