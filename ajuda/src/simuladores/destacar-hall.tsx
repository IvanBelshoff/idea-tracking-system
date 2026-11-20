'use client';

import { Trophy } from 'lucide-react';
import { useId, useState } from 'react';
import { Field, NativeSelect } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Regra, Situacao } from '../components/doc-parts';
import { useLang } from '../components/use-lang';
import type { Lang } from '../i18n';
import { type Consent, hallEligibility, type Status, showsName } from './regras';

const TEXT = {
  'pt-BR': {
    allow: 'Permitir destacar ideias Em andamento (configuração da instalação)',
    pick: 'Escolha a ideia que você quer destacar',
    verdict: {
      ok: 'Pode ser destaque',
      not_ready: 'Ainda não: só depois de implementada',
      rejected: 'Nunca: ideia não autorizada',
    },
    scope: 'Onde aparece',
    scopeEntity: 'Hall da entidade (Unidade A)',
    scopeOrg: 'Hall da organização (exige outra permissão)',
    justification: 'Por que é destaque',
    required: 'Conte por que esta ideia é destaque.',
    period: 'Período: 10 de nov. a 10 de dez. de 2026',
    highlight: 'Destacar ideia',
    card: 'Como o cartão aparece no Hall',
    who: 'Quem fez',
    anonymous: 'Colaborador anônimo',
    consent: (name: string) => `Resposta de ${name}`,
    consents: { pending: 'Sem resposta', accepted: 'Aparecer com meu nome', declined: 'Não aparecer' },
    hide: (name: string) => `${name} marcou "Ocultar meu nome" em Minha conta`,
    notified: 'Autora e co-autor foram avisados e escolhem se aparecem com o nome.',
    author: 'autora',
    coauthor: 'co-autor',
  },
  en: {
    allow: 'Allow featuring In progress ideas (installation setting)',
    pick: 'Choose the idea you want to feature',
    verdict: {
      ok: 'Can be featured',
      not_ready: 'Not yet: only once implemented',
      rejected: 'Never: not approved idea',
    },
    scope: 'Where it shows',
    scopeEntity: 'Entity Hall (Site A)',
    scopeOrg: 'Organization Hall (needs another permission)',
    justification: 'Why it deserves the spotlight',
    required: 'Say why this idea deserves the spotlight.',
    period: 'Period: Nov 10 to Dec 10, 2026',
    highlight: 'Highlight idea',
    card: 'How the card shows in the Hall',
    who: 'Who did it',
    anonymous: 'Anonymous collaborator',
    consent: (name: string) => `${name}’s answer`,
    consents: { pending: 'No answer', accepted: 'Show my name', declined: 'Do not show' },
    hide: (name: string) => `${name} ticked "Hide my name" in My account`,
    notified: 'The author and co-author were notified and choose whether to show their names.',
    author: 'author',
    coauthor: 'co-author',
  },
} satisfies Record<Lang, unknown>;

const IDEAS: { code: string; status: Status; title: Record<Lang, string>; before: Record<Lang, string> }[] = [
  {
    code: 'ITS-2026-0007',
    status: 'implemented',
    title: { 'pt-BR': 'Gabarito de regulagem na prensa 3', en: 'Setup jig on press 3' },
    before: { 'pt-BR': 'Troca de ferramenta: de 40 para 12 minutos', en: 'Tool changeover: from 40 to 12 minutes' },
  },
  {
    code: 'ITS-2026-0034',
    status: 'in_progress',
    title: { 'pt-BR': 'Checklist digital na troca de turno', en: 'Digital checklist at shift change' },
    before: { 'pt-BR': 'Passagem de turno sem esquecimentos', en: 'Shift handover with nothing forgotten' },
  },
  {
    code: 'ITS-2026-0036',
    status: 'rejected',
    title: { 'pt-BR': 'Reaproveitar paletes danificados', en: 'Reuse damaged pallets' },
    before: { 'pt-BR': '', en: '' },
  },
];

/** Simulador da curadoria do Hall: elegibilidade, escopo, justificativa e consentimento de cada pessoa. */
export function DestacarHall() {
  const lang = useLang();
  const t = TEXT[lang];
  const [allow, setAllow] = useState(false);
  const [picked, setPicked] = useState(IDEAS[0]?.code ?? '');
  const [why, setWhy] = useState('');
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const [consent, setConsent] = useState<Record<string, Consent>>({ Carla: 'pending', Davi: 'pending' });
  const [hidden, setHidden] = useState<Record<string, boolean>>({ Carla: false, Davi: false });
  const ids = useId();
  const idea = IDEAS.find((i) => i.code === picked) ?? IDEAS[0];
  if (!idea) return null;
  const eligible = hallEligibility(idea.status, allow);

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium">
          {t.card} <Regra id="RN-75" />
        </p>
        <article className="rounded-xl border bg-background p-5">
          <h3 className="font-heading text-lg font-bold">{idea.title[lang]}</h3>
          <p className="mt-1 text-sm">{idea.before[lang]}</p>
          <p className="mt-3 text-sm">
            <span className="text-muted-foreground">{t.who}:</span>{' '}
            <span className="font-medium" aria-live="polite">
              {(['Carla', 'Davi'] as const)
                .map((n) => (showsName(consent[n] ?? 'pending', hidden[n] ?? false) ? n : t.anonymous))
                .join(', ')}
            </span>
          </p>
          <p className="mt-3 flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
            <Trophy aria-hidden="true" className="size-3.5 text-primary" />
            {t.scopeEntity} · {t.period.replace(/^[^:]+: /, '')}
          </p>
        </article>
        <p className="text-sm text-muted-foreground">
          {t.notified} <Regra id="RN-80" />
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['Carla', 'Davi'] as const).map((n) => (
            <div key={n} className="space-y-2 rounded-lg bg-muted/50 p-3">
              <Field label={`${t.consent(n)} (${n === 'Carla' ? t.author : t.coauthor})`}>
                <NativeSelect
                  value={consent[n]}
                  onChange={(e) => setConsent((c) => ({ ...c, [n]: e.target.value as Consent }))}
                >
                  <option value="pending">{t.consents.pending}</option>
                  <option value="accepted">{t.consents.accepted}</option>
                  <option value="declined">{t.consents.declined}</option>
                </NativeSelect>
              </Field>
              <div className="flex items-start gap-2 text-xs">
                <Checkbox
                  id={`${ids}-oculta-${n}`}
                  checked={hidden[n]}
                  onCheckedChange={(v) => setHidden((h) => ({ ...h, [n]: v === true }))}
                  className="mt-0.5"
                />
                <label htmlFor={`${ids}-oculta-${n}`}>{t.hide(n)}</label>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          <Regra id="RN-74" /> <Regra id="RN-70" />
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 text-sm">
        <Checkbox
          id={`${ids}-permitir`}
          checked={allow}
          onCheckedChange={(v) => setAllow(v === true)}
          className="mt-0.5"
        />
        <label htmlFor={`${ids}-permitir`}>{t.allow}</label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">{t.pick}</legend>
        <div className="mt-2 space-y-2">
          {IDEAS.map((i) => {
            const v = hallEligibility(i.status, allow);
            return (
              <label
                key={i.code}
                className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 has-checked:border-primary"
              >
                <input
                  type="radio"
                  name={`${ids}-ideia`}
                  checked={picked === i.code}
                  onChange={() => {
                    setPicked(i.code);
                    setError(false);
                  }}
                  className="mt-1 size-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{i.code}</span>
                    <Situacao s={i.status} />
                  </span>
                  <span className="mt-0.5 block font-medium">{i.title[lang]}</span>
                  <span className={`block text-xs ${v === 'ok' ? 'text-(--st-done)' : 'text-muted-foreground'}`}>
                    {t.verdict[v]}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          <Regra id="RN-73" />
        </p>
      </fieldset>

      {eligible === 'ok' && (
        <form
          noValidate
          className="space-y-3 rounded-lg bg-muted/50 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!why.trim()) {
              setError(true);
              return;
            }
            setDone(true);
          }}
        >
          <fieldset>
            <legend className="text-sm font-medium">
              {t.scope} <Regra id="RN-79" />
            </legend>
            <div className="mt-2 space-y-1.5 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name={`${ids}-escopo`} defaultChecked className="size-4 accent-primary" />
                {t.scopeEntity}
              </label>
              <label className="flex items-center gap-2 text-muted-foreground">
                <input type="radio" name={`${ids}-escopo`} disabled className="size-4" />
                {t.scopeOrg}
              </label>
            </div>
          </fieldset>
          <Field label={t.justification} error={error ? t.required : undefined}>
            <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
          </Field>
          <p className="text-sm text-muted-foreground">
            {t.period} <Regra id="RN-78" />
          </p>
          <Button type="submit" size="sm">
            {t.highlight}
          </Button>
        </form>
      )}
    </div>
  );
}
