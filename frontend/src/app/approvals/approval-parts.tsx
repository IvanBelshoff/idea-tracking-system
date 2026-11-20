import { CircleCheck, CircleX, Clock, Download, Hourglass, type LucideIcon, Paperclip, Stamp } from 'lucide-react';
import { type CSSProperties, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { COMMENT_MAX, decisionReady, NAME_MAX } from '@/lib/approvals';
import { FormError } from '../auth/auth-layout';
import { IdCode } from '../ideas/ui';
import { useDates } from '../use-dates';
import type { ApprovalGain, ApprovalSnapshot } from './queries';

export type PillTone = 'pending' | 'approved' | 'rejected' | 'muted';

const TONES: Record<PillTone, { ink: string; Icon: LucideIcon }> = {
  pending: { ink: 'var(--st-late)', Icon: Hourglass },
  approved: { ink: 'var(--st-done)', Icon: CircleCheck },
  rejected: { ink: 'var(--st-rejected)', Icon: CircleX },
  muted: { ink: 'var(--muted-foreground)', Icon: Clock },
};

/** Situação com cor, ícone e texto (nunca só cor), no mesmo desenho da pílula de status da ideia. */
export function ApprovalPill({ tone, label, size = 'md' }: { tone: PillTone; label: string; size?: 'md' | 'lg' }) {
  const { ink, Icon } = TONES[tone];
  const lg = size === 'lg';
  return (
    <span
      style={{ '--ink': ink } as CSSProperties}
      className={`inline-flex max-w-full items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--ink)_12%,transparent)] font-medium text-(--ink) ${lg ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs'}`}
    >
      <Icon aria-hidden="true" className={`shrink-0 ${lg ? 'size-4' : 'size-3.5'}`} />
      <span className="truncate">{label}</span>
    </span>
  );
}

export const requestTone = (status: string): PillTone =>
  status === 'pending' ? 'pending' : status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'muted';

export const decisionTone = (decision: string): PillTone =>
  decision === 'pending'
    ? 'pending'
    : decision === 'approved'
      ? 'approved'
      : decision === 'rejected'
        ? 'rejected'
        : 'muted';

/** Ganho estimado no idioma da tela: "R$ 12.000,00 por mês". */
export function useGainText() {
  const { t, i18n } = useTranslation();
  return (gain: ApprovalGain) => {
    const value = Number(gain.estimated);
    let money = gain.estimated;
    try {
      money = new Intl.NumberFormat(i18n.language, {
        style: 'currency',
        currency: gain.currency,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      // Moeda desconhecida pelo navegador: mostra o número e o código.
      money = `${gain.currency} ${gain.estimated}`;
    }
    const period = t(`approvals.snapshot.periodicity.${gain.periodicity}` as never) as string;
    return period.startsWith('approvals.') ? money : `${money} ${period}`;
  };
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

/**
 * O que o pedido congelou para o aprovador (RN-184): código, título, resumo, área, quem pediu, prazo
 * e, se marcados, o ganho e os anexos. Nada além disso.
 */
export function SnapshotView({
  snapshot,
  onDownload,
}: {
  snapshot: ApprovalSnapshot;
  onDownload: (file: { id: string; originalName: string }) => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const gainText = useGainText();
  return (
    <dl className="grid gap-3">
      <Item label={t('approvals.snapshot.idea')}>
        <span className="flex flex-wrap items-center gap-2">
          <IdCode code={snapshot.ideaCode} />
          <span className="font-medium">{snapshot.ideaTitle}</span>
        </span>
      </Item>
      <Item label={t('approvals.snapshot.summary')}>
        <p className="whitespace-pre-wrap">{snapshot.summary}</p>
      </Item>
      {snapshot.area && <Item label={t('approvals.snapshot.area')}>{snapshot.area}</Item>}
      <Item label={t('approvals.snapshot.requestedBy')}>{snapshot.requestedBy}</Item>
      <Item label={t('approvals.snapshot.due')}>{dates.day(snapshot.dueOn)}</Item>
      {snapshot.gain && <Item label={t('approvals.snapshot.gain')}>{gainText(snapshot.gain)}</Item>}
      {snapshot.attachments.length > 0 && (
        <Item label={t('approvals.snapshot.attachments')}>
          <ul className="grid gap-1">
            {snapshot.attachments.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onDownload(f)}
                  aria-label={t('approvals.snapshot.download', { name: f.originalName })}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-left text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <Paperclip aria-hidden="true" className="size-4 shrink-0" />
                  <span className="truncate">{f.originalName}</span>
                  <Download aria-hidden="true" className="size-3.5 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </Item>
      )}
    </dl>
  );
}

export interface DecisionValues {
  decision: 'approved' | 'rejected';
  comment: string;
  name: string;
  code: string;
}

/**
 * O formulário de decidir (RN-184, RN-186): aprovar ou não, o motivo (obrigatório para não aprovar)
 * e, pelo link, o nome confirmado e, se a organização usa, o código de confirmação (RN-185).
 */
export function DecisionForm({
  askName,
  defaultName = '',
  code,
  pending,
  error,
  onSubmit,
}: {
  askName?: boolean;
  defaultName?: string;
  code?: { onSend: () => void; sending: boolean; sent: boolean };
  pending: boolean;
  error: string | null;
  onSubmit: (values: DecisionValues) => void;
}) {
  const { t } = useTranslation();
  const group = useId();
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  const [comment, setComment] = useState('');
  const [name, setName] = useState(defaultName);
  const [codeValue, setCodeValue] = useState('');
  const nameOk = !askName || (name.trim().length > 0 && name.trim().length <= NAME_MAX);
  const codeOk = !code || /^\d{6}$/.test(codeValue);
  const ready = decisionReady(decision, comment) && nameOk && codeOk;
  const options = [
    { value: 'approved' as const, label: t('approvals.decide.approve'), Icon: CircleCheck },
    { value: 'rejected' as const, label: t('approvals.decide.reject'), Icon: CircleX },
  ];

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && decision) onSubmit({ decision, comment: comment.trim(), name: name.trim(), code: codeValue });
      }}
      className="grid gap-4"
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t('approvals.decide.legend')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map(({ value, label, Icon }) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50 ${decision === value ? 'border-primary bg-primary/5' : ''}`}
            >
              <input
                type="radio"
                name={group}
                value={value}
                checked={decision === value}
                onChange={() => setDecision(value)}
                className="size-4 accent-primary"
              />
              <Icon
                aria-hidden="true"
                className={`size-4 ${value === 'approved' ? 'text-(--st-done)' : 'text-(--st-rejected)'}`}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        label={decision === 'rejected' ? t('approvals.decide.commentRequired') : t('approvals.decide.comment')}
        hint={t('richText.counter', { count: comment.length, max: COMMENT_MAX })}
      >
        <Textarea rows={3} maxLength={COMMENT_MAX} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      {askName && (
        <Field label={t('approvals.decide.name')} hint={t('approvals.decide.nameHint')} className="max-w-sm">
          <Input value={name} maxLength={NAME_MAX} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      {code && (
        <div className="grid gap-2 rounded-md border p-3">
          <p className="flex items-start gap-2 text-sm">
            <Stamp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {code.sent ? t('approvals.decide.codeHint') : t('approvals.decide.codeAsk')}
          </p>
          {code.sent && (
            <Field label={t('approvals.decide.code')} className="max-w-[12rem]">
              <Input
                value={codeValue}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                onChange={(e) => setCodeValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="font-mono tracking-widest"
              />
            </Field>
          )}
          <div>
            <Button type="button" variant="outline" size="sm" disabled={code.sending} onClick={code.onSend}>
              {code.sent ? t('approvals.decide.resendCode') : t('approvals.decide.sendCode')}
            </Button>
          </div>
        </div>
      )}
      <FormError message={error} />
      <div>
        <Button type="submit" disabled={pending || !ready}>
          {pending ? t('approvals.decide.sending') : t('approvals.decide.submit')}
        </Button>
      </div>
    </form>
  );
}
