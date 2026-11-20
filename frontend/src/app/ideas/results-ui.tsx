import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { BadgeCheck, Copy, Pencil, Target } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
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
import { Textarea } from '@/components/ui/textarea';
import { docOf, type RichDoc, richPayload } from '@/lib/rich';
import { useEntities } from '../admin/queries';
import { entityOptionLabel, orderTree } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { usePublicSettings } from '../session';
import { useDates } from '../use-dates';
import { type IdeaDetail, ideaKeys } from './queries';

type Gain = NonNullable<IdeaDetail['gain']>;

/** Texto de número digitado → número (vazio = nulo). Aceita vírgula decimal. */
const parseNumber = (v: string): number | null => {
  const s = v.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
};
const toInput = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

function useFormat() {
  const { i18n } = useTranslation();
  const lng = i18n.language;
  return {
    number: (v: number) => new Intl.NumberFormat(lng, { maximumFractionDigits: 4 }).format(v),
    percent: (v: number) => new Intl.NumberFormat(lng, { style: 'percent', maximumFractionDigits: 0 }).format(v),
    money: (v: number, currency: string) =>
      new Intl.NumberFormat(lng, { style: 'currency', currency, maximumFractionDigits: 2 }).format(v),
    times: (v: number) => new Intl.NumberFormat(lng, { maximumFractionDigits: 1 }).format(v),
  };
}

function useSetDetail(code: string) {
  const qc = useQueryClient();
  return (data: IdeaDetail) => {
    qc.setQueryData(ideaKeys.detail(code), data);
    void qc.invalidateQueries({ queryKey: ideaKeys.timeline(code) });
  };
}

/** Linha "rótulo: valor" dos blocos do resultado. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Resultado (RN-61 a RN-64): medição com atingimento, ganho financeiro (declarado ou validado, com
 * ROI), lição aprendida e réplica. Aparece quando há algo registrado ou quando quem vê pode registrar.
 */
export function ResultsCard({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  const dates = useDates();
  const f = useFormat();
  const setDetail = useSetDetail(idea.code);
  const [dialog, setDialog] = useState<'measurement' | 'gain' | 'standard' | 'replicate' | 'sustainment' | null>(null);
  const validate = useMutation({
    meta: { success: t('feedback.results.gainValidated') },
    mutationFn: () => unwrap(api.POST('/api/ideas/{ref}/gain/validate', { params: { path: { ref: idea.code } } })),
    onSuccess: setDetail,
  });
  const implemented = idea.status === 'implemented';
  const m = idea.measurement;
  const g = idea.gain;
  const sus = idea.sustainment;
  const hasSomething =
    m || g || sus || idea.standardAdopted || idea.isReplicable || idea.origin || idea.replicas.length > 0;
  if (!hasSomething && !idea.can.editResults && !idea.can.validateGain) return null;

  return (
    <section aria-labelledby="resultado" className="rounded-lg border bg-card p-5">
      <h2 id="resultado" className="flex items-center gap-2 font-semibold">
        <Target aria-hidden="true" className="size-4" />
        {t('ideas.results.title')}
      </h2>
      {idea.origin && (
        <p className="mt-2 text-sm">
          {t('ideas.results.replicaOf')}{' '}
          <Link to="/ideias/$ref" params={{ ref: idea.origin.code }} className="font-mono underline underline-offset-4">
            {idea.origin.code}
          </Link>{' '}
          · {idea.origin.title}
        </p>
      )}

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        {/* Medição */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('ideas.results.measurement')}</h3>
            {idea.can.editResults && (
              <Button size="sm" variant="ghost" onClick={() => setDialog('measurement')}>
                <Pencil aria-hidden="true" />
                {m ? t('ideas.results.edit') : t('ideas.results.addMeasurement')}
              </Button>
            )}
          </div>
          {m ? (
            <>
              <p className="mt-1 text-sm">
                {m.indicator} <span className="text-muted-foreground">({m.unit})</span>
              </p>
              <dl className="mt-1">
                <Row label={t('ideas.results.baseline')}>{f.number(m.baseline)}</Row>
                <Row label={t('ideas.results.target')}>{m.target === null ? '—' : f.number(m.target)}</Row>
                <Row label={t('ideas.results.achieved')}>{m.achieved === null ? '—' : f.number(m.achieved)}</Row>
                {m.variation !== null && (
                  <Row label={t('ideas.results.variation')}>
                    {m.variation > 0 ? '+' : ''}
                    {f.number(m.variation)}
                    {m.variationPercent !== null &&
                      ` (${m.variationPercent > 0 ? '+' : ''}${f.percent(m.variationPercent)})`}
                  </Row>
                )}
              </dl>
              {m.attainment !== null && (
                <div className="mt-2">
                  <p className="flex justify-between text-sm">
                    <span>{t('ideas.results.attainment')}</span>
                    <span className="font-semibold tabular-nums">{f.percent(m.attainment)}</span>
                  </p>
                  <Progress
                    value={Math.round(m.attainment * 100)}
                    className="mt-1"
                    aria-label={t('ideas.results.attainment')}
                  />
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{t('ideas.results.noMeasurement')}</p>
          )}
        </div>

        {/* Ganho */}
        {(g || idea.can.editResults) && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t('ideas.results.gain')}</h3>
              {idea.can.editResults && (
                <Button size="sm" variant="ghost" onClick={() => setDialog('gain')}>
                  <Pencil aria-hidden="true" />
                  {g ? t('ideas.results.edit') : t('ideas.results.addGain')}
                </Button>
              )}
            </div>
            {g ? (
              <>
                <p className="mt-1">
                  {g.status === 'validated' ? (
                    <Badge variant="secondary" className="gap-1">
                      <BadgeCheck aria-hidden="true" className="size-3.5" />
                      {t('ideas.results.validated')}
                    </Badge>
                  ) : (
                    <Badge variant="outline">{t('ideas.results.declared')}</Badge>
                  )}
                </p>
                <dl className="mt-1">
                  <Row label={t('ideas.results.estimated')}>
                    {g.estimated === null ? '—' : f.money(g.estimated, g.currency)}
                  </Row>
                  <Row label={t('ideas.results.realized')}>
                    {g.realized === null ? '—' : f.money(g.realized, g.currency)}{' '}
                    <span className="font-normal text-muted-foreground">
                      {t(`ideas.results.periodicity.${g.periodicity}` as never)}
                    </span>
                  </Row>
                  {g.annualizedRealized !== null && g.periodicity === 'monthly' && (
                    <Row label={t('ideas.results.annualized')}>{f.money(g.annualizedRealized, g.currency)}</Row>
                  )}
                  <Row label={t('ideas.results.cost')}>
                    {g.implementationCost === null ? '—' : f.money(g.implementationCost, g.currency)}
                  </Row>
                  <Row label={t('ideas.results.roi')}>
                    {g.roi === null ? (
                      <span className="font-normal text-muted-foreground">{t('ideas.results.roiNone')}</span>
                    ) : (
                      t('ideas.results.roiValue', { value: f.times(g.roi) })
                    )}
                  </Row>
                </dl>
                {g.status === 'validated' && g.validatedBy && g.validatedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('ideas.results.validatedBy', { name: g.validatedBy.name, date: dates.date(g.validatedAt) })}
                  </p>
                )}
                {idea.can.validateGain && (
                  <Button size="sm" className="mt-3" disabled={validate.isPending} onClick={() => validate.mutate()}>
                    <BadgeCheck aria-hidden="true" />
                    {t('ideas.results.validate')}
                  </Button>
                )}
                <FormError message={validate.isError ? errorText(t, validate.error) : null} />
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t('ideas.results.noGain')}</p>
            )}
          </div>
        )}
      </div>

      {/* Lição aprendida e réplica */}
      {(implemented || idea.replicas.length > 0) && (
        <div className="mt-6 border-t pt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('ideas.results.standard')}</h3>
            <div className="flex gap-1">
              {idea.can.editResults && implemented && (
                <Button size="sm" variant="ghost" onClick={() => setDialog('standard')}>
                  <Pencil aria-hidden="true" />
                  {t('ideas.results.edit')}
                </Button>
              )}
              {idea.can.replicate && (
                <Button size="sm" variant="outline" onClick={() => setDialog('replicate')}>
                  <Copy aria-hidden="true" />
                  {t('ideas.results.replicate')}
                </Button>
              )}
            </div>
          </div>
          {idea.standardAdopted ? (
            <RichText rich={idea.standardAdoptedRich} plain={idea.standardAdopted} className="mt-1 text-sm" />
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{t('ideas.results.noStandard')}</p>
          )}
          {idea.isReplicable && (
            <Badge variant="secondary" className="mt-2">
              {t('ideas.results.replicable')}
            </Badge>
          )}
          {idea.replicas.length > 0 && (
            <div className="mt-3 text-sm">
              <p className="text-muted-foreground">{t('ideas.results.replicas', { count: idea.replicas.length })}</p>
              <ul className="mt-1 space-y-1">
                {idea.replicas.map((r) => (
                  <li key={r.code}>
                    <Link to="/ideias/$ref" params={{ ref: r.code }} className="font-mono underline underline-offset-4">
                      {r.code}
                    </Link>{' '}
                    · {r.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {sus && (
        <div className="mt-6 border-t pt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('ideas.results.sustainment')}</h3>
            {idea.can.reviewSustainment && (
              <Button size="sm" onClick={() => setDialog('sustainment')}>
                {t('ideas.results.reviewSustainment')}
              </Button>
            )}
          </div>
          {sus.status === 'pending' ? (
            <p className="mt-1 text-sm">
              {sus.due
                ? t('ideas.results.sustainmentDue', { date: dates.day(sus.dueOn) })
                : t('ideas.results.sustainmentPlanned', { date: dates.day(sus.dueOn) })}
            </p>
          ) : (
            <div className="mt-1 text-sm">
              <Badge variant={sus.status === 'confirmed' ? 'secondary' : 'outline'}>
                {t(`ideas.results.sustainmentStatus.${sus.status}` as never)}
              </Badge>
              {sus.reviewedBy && sus.reviewedAt && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {t('ideas.results.reviewedBy', { name: sus.reviewedBy.name, date: dates.date(sus.reviewedAt) })}
                </span>
              )}
              {sus.note && <p className="mt-1 whitespace-pre-wrap">{sus.note}</p>}
            </div>
          )}
        </div>
      )}

      {dialog === 'sustainment' && <SustainmentDialog idea={idea} onClose={() => setDialog(null)} />}
      {dialog === 'measurement' && <MeasurementDialog idea={idea} onClose={() => setDialog(null)} />}
      {dialog === 'gain' && <GainDialog idea={idea} gain={g} onClose={() => setDialog(null)} />}
      {dialog === 'standard' && <StandardDialog idea={idea} onClose={() => setDialog(null)} />}
      {dialog === 'replicate' && <ReplicateDialog idea={idea} onClose={() => setDialog(null)} />}
    </section>
  );
}

function DialogShell({
  title,
  intro,
  children,
  onClose,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {intro && <DialogDescription>{intro}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function Footer({ pending, label, onClose }: { pending: boolean; label: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" disabled={pending}>
        {label}
      </Button>
    </DialogFooter>
  );
}

function MeasurementDialog({ idea, onClose }: { idea: IdeaDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const setDetail = useSetDetail(idea.code);
  const m = idea.measurement;
  const [indicator, setIndicator] = useState(m?.indicator ?? '');
  const [unit, setUnit] = useState(m?.unit ?? '');
  const [direction, setDirection] = useState<'increase' | 'decrease'>(m?.direction ?? 'decrease');
  const [baseline, setBaseline] = useState(toInput(m?.baseline));
  const [target, setTarget] = useState(toInput(m?.target));
  const [achieved, setAchieved] = useState(toInput(m?.achieved));
  const [touched, setTouched] = useState(false);
  const nums = { baseline: parseNumber(baseline), target: parseNumber(target), achieved: parseNumber(achieved) };
  const bad = (v: number | null) => v !== null && Number.isNaN(v);
  const save = useMutation({
    meta: { success: t('feedback.results.measurementSaved') },
    mutationFn: () =>
      unwrap(
        api.PUT('/api/ideas/{ref}/measurement', {
          params: { path: { ref: idea.code } },
          body: {
            indicator,
            unit,
            direction,
            baseline: nums.baseline ?? 0,
            target: nums.target,
            achieved: nums.achieved,
          },
        }),
      ),
    onSuccess: (d) => {
      setDetail(d);
      onClose();
    },
  });
  const remove = useMutation({
    meta: { success: t('feedback.results.measurementRemoved') },
    mutationFn: () => unwrap(api.DELETE('/api/ideas/{ref}/measurement', { params: { path: { ref: idea.code } } })),
    onSuccess: (d) => {
      setDetail(d);
      onClose();
    },
  });
  const server = fieldErrors(save.error);
  const req = (v: string) => (touched && !v.trim() ? t('validation.required') : undefined);
  const numErr = (v: number | null) => (touched && bad(v) ? t('ideas.results.invalidNumber') : undefined);
  return (
    <DialogShell
      title={t('ideas.results.measurementTitle')}
      intro={t('ideas.results.measurementIntro')}
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (indicator.trim() && unit.trim() && baseline.trim() && !Object.values(nums).some(bad)) save.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label={t('ideas.results.indicator')} error={req(indicator) ?? server.indicator}>
            <Input value={indicator} onChange={(e) => setIndicator(e.target.value)} maxLength={200} />
          </Field>
          <Field label={t('ideas.results.unit')} error={req(unit) ?? server.unit}>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={40} />
          </Field>
        </div>
        <Field label={t('ideas.results.direction')}>
          <NativeSelect value={direction} onChange={(e) => setDirection(e.target.value as 'increase' | 'decrease')}>
            <option value="decrease">{t('ideas.results.decrease')}</option>
            <option value="increase">{t('ideas.results.increase')}</option>
          </NativeSelect>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('ideas.results.baseline')} error={req(baseline) ?? numErr(nums.baseline)}>
            <Input inputMode="decimal" value={baseline} onChange={(e) => setBaseline(e.target.value)} />
          </Field>
          <Field label={t('ideas.results.target')} optionalLabel={t('common.optional')} error={numErr(nums.target)}>
            <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field label={t('ideas.results.achieved')} optionalLabel={t('common.optional')} error={numErr(nums.achieved)}>
            <Input inputMode="decimal" value={achieved} onChange={(e) => setAchieved(e.target.value)} />
          </Field>
        </div>
        <FormError
          message={save.isError ? errorText(t, save.error) : remove.isError ? errorText(t, remove.error) : null}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {m ? (
            <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t('ideas.results.removeMeasurement')}
            </Button>
          ) : (
            <span />
          )}
          <Footer pending={save.isPending} label={t('common.save')} onClose={onClose} />
        </div>
      </form>
    </DialogShell>
  );
}

function GainDialog({ idea, gain, onClose }: { idea: IdeaDetail; gain: Gain | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: settings } = usePublicSettings();
  const setDetail = useSetDetail(idea.code);
  const triaging = idea.status === 'submitted' || idea.status === 'in_review';
  const implemented = idea.status === 'implemented';
  const [currency, setCurrency] = useState(gain?.currency ?? settings?.currency ?? 'BRL');
  const [periodicity, setPeriodicity] = useState<'once' | 'monthly' | 'yearly'>(gain?.periodicity ?? 'monthly');
  const [estimated, setEstimated] = useState(toInput(gain?.estimated));
  const [realized, setRealized] = useState(toInput(gain?.realized));
  const [cost, setCost] = useState(toInput(gain?.implementationCost));
  const [touched, setTouched] = useState(false);
  const nums = { estimated: parseNumber(estimated), realized: parseNumber(realized), cost: parseNumber(cost) };
  const bad = (v: number | null) => v !== null && (Number.isNaN(v) || v < 0);
  const save = useMutation({
    meta: { success: t('feedback.results.gainSaved') },
    mutationFn: () =>
      unwrap(
        api.PUT('/api/ideas/{ref}/gain', {
          params: { path: { ref: idea.code } },
          body: {
            currency,
            periodicity,
            // Cada valor só vai quando a fase permite (CA-RN-62.1); o servidor confere de novo.
            ...(triaging ? { estimated: nums.estimated } : {}),
            ...(implemented ? { realized: nums.realized } : {}),
            implementationCost: nums.cost,
          },
        }),
      ),
    onSuccess: (d) => {
      setDetail(d);
      onClose();
    },
  });
  const numErr = (v: number | null) => (touched && bad(v) ? t('ideas.results.invalidAmount') : undefined);
  return (
    <DialogShell title={t('ideas.results.gainTitle')} intro={t('ideas.results.gainIntro')} onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!Object.values(nums).some(bad) && /^[A-Za-z]{3}$/.test(currency.trim())) save.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
          <Field label={t('ideas.results.periodicityLabel')}>
            <NativeSelect value={periodicity} onChange={(e) => setPeriodicity(e.target.value as typeof periodicity)}>
              <option value="once">{t('ideas.results.periodicity.once')}</option>
              <option value="monthly">{t('ideas.results.periodicity.monthly')}</option>
              <option value="yearly">{t('ideas.results.periodicity.yearly')}</option>
            </NativeSelect>
          </Field>
          <Field label={t('ideas.results.currency')}>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
          </Field>
        </div>
        <Field
          label={t('ideas.results.estimated')}
          hint={triaging ? undefined : t('ideas.results.estimatedLocked')}
          error={numErr(nums.estimated)}
        >
          <Input
            inputMode="decimal"
            value={estimated}
            disabled={!triaging}
            onChange={(e) => setEstimated(e.target.value)}
          />
        </Field>
        <Field
          label={t('ideas.results.realized')}
          hint={
            implemented
              ? gain?.status === 'validated'
                ? t('ideas.results.realizedRevalidate')
                : undefined
              : t('ideas.results.realizedLocked')
          }
          error={numErr(nums.realized)}
        >
          <Input
            inputMode="decimal"
            value={realized}
            disabled={!implemented}
            onChange={(e) => setRealized(e.target.value)}
          />
        </Field>
        <Field label={t('ideas.results.cost')} optionalLabel={t('common.optional')} error={numErr(nums.cost)}>
          <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <FormError message={save.isError ? errorText(t, save.error) : null} />
        <Footer pending={save.isPending} label={t('common.save')} onClose={onClose} />
      </form>
    </DialogShell>
  );
}

function StandardDialog({ idea, onClose }: { idea: IdeaDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const setDetail = useSetDetail(idea.code);
  const [standard, setStandard] = useState<RichDoc | null>(docOf(idea.standardAdoptedRich, idea.standardAdopted));
  const [replicable, setReplicable] = useState(idea.isReplicable);
  const save = useMutation({
    meta: { success: t('feedback.results.standardSaved') },
    mutationFn: () =>
      unwrap(
        api.PUT('/api/ideas/{ref}/standard', {
          params: { path: { ref: idea.code } },
          body: {
            standardAdopted: richPayload(standard).text || null,
            standardAdoptedRich: richPayload(standard).rich,
            isReplicable: replicable,
          },
        }),
      ),
    onSuccess: (d) => {
      setDetail(d);
      onClose();
    },
  });
  return (
    <DialogShell title={t('ideas.results.standardTitle')} onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-4"
      >
        <StandardFields
          standard={standard}
          setStandard={setStandard}
          replicable={replicable}
          setReplicable={setReplicable}
        />
        <FormError message={save.isError ? errorText(t, save.error) : null} />
        <Footer pending={save.isPending} label={t('common.save')} onClose={onClose} />
      </form>
    </DialogShell>
  );
}

/** Campos da lição aprendida (RN-64), usados também no diálogo de implementar. */
export function StandardFields({
  standard,
  setStandard,
  replicable,
  setReplicable,
}: {
  standard: RichDoc | null;
  setStandard: (v: RichDoc | null) => void;
  replicable: boolean;
  setReplicable: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Field
        label={t('ideas.results.standard')}
        optionalLabel={t('common.optional')}
        hint={t('ideas.results.standardHint')}
      >
        <RichTextEditor rows={3} max={10_000} value={standard} onChange={setStandard} />
      </Field>
      <div className="flex items-center gap-2 text-sm">
        <Checkbox id="replicavel" checked={replicable} onCheckedChange={(v) => setReplicable(v === true)} />
        <label htmlFor="replicavel">{t('ideas.results.replicableLabel')}</label>
      </div>
    </>
  );
}

function ReplicateDialog({ idea, onClose }: { idea: IdeaDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const entities = useEntities();
  const options = orderTree(entities.data ?? []).filter((e) => e.canSubmit && e.id !== idea.entity.id);
  const [entityId, setEntityId] = useState('');
  const [touched, setTouched] = useState(false);
  const send = useMutation({
    meta: { success: t('feedback.results.replicated') },
    mutationFn: () =>
      unwrap(api.POST('/api/ideas/{ref}/replicate', { params: { path: { ref: idea.code } }, body: { entityId } })),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ideaKeys.all });
      void navigate({ to: '/ideias/$ref', params: { ref: created.code } });
    },
  });
  return (
    <DialogShell title={t('ideas.results.replicateTitle')} intro={t('ideas.results.replicateIntro')} onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (entityId) send.mutate();
        }}
        className="space-y-4"
      >
        <Field
          label={t('ideas.results.targetEntity')}
          error={touched && !entityId ? t('validation.required') : fieldErrors(send.error).entityId}
        >
          <NativeSelect value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">—</option>
            {options.map((e) => (
              <option key={e.id} value={e.id}>
                {entityOptionLabel(e)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <FormError message={send.isError ? errorText(t, send.error) : null} />
        <Footer pending={send.isPending} label={t('ideas.results.replicate')} onClose={onClose} />
      </form>
    </DialogShell>
  );
}

/** Revisão de sustentação (RN-65): o ganho se mantém? Contestar pede o que mudou e não reabre. */
function SustainmentDialog({ idea, onClose }: { idea: IdeaDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const setDetail = useSetDetail(idea.code);
  const [decision, setDecision] = useState<'confirmed' | 'contested'>('confirmed');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const send = useMutation({
    meta: { success: t('feedback.results.sustainmentSaved') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/{ref}/sustainment', {
          params: { path: { ref: idea.code } },
          body: { decision, note: note.trim() || null },
        }),
      ),
    onSuccess: (d) => {
      setDetail(d);
      onClose();
    },
  });
  const noteMissing = decision === 'contested' && !note.trim();
  return (
    <DialogShell
      title={t('ideas.results.sustainmentTitle')}
      intro={t('ideas.results.sustainmentIntro')}
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!noteMissing) send.mutate();
        }}
        className="space-y-4"
      >
        <Field label={t('ideas.results.sustainmentDecision')}>
          <NativeSelect value={decision} onChange={(e) => setDecision(e.target.value as 'confirmed' | 'contested')}>
            <option value="confirmed">{t('ideas.results.sustainmentConfirm')}</option>
            <option value="contested">{t('ideas.results.sustainmentContest')}</option>
          </NativeSelect>
        </Field>
        <Field
          label={t('ideas.results.sustainmentNote')}
          optionalLabel={decision === 'confirmed' ? t('common.optional') : undefined}
          error={touched && noteMissing ? t('validation.required') : undefined}
        >
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
        </Field>
        <FormError message={send.isError ? errorText(t, send.error) : null} />
        <Footer pending={send.isPending} label={t('common.save')} onClose={onClose} />
      </form>
    </DialogShell>
  );
}
