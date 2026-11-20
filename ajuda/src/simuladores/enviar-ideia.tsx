'use client';

import { CheckCircle2, Users } from 'lucide-react';
import { useState } from 'react';
import { Field, NativeSelect } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Regra, Situacao } from '../components/doc-parts';
import { useLang } from '../components/use-lang';
import type { Lang } from '../i18n';
import { formatDay, SLA_DAYS, type Status, triageDueDate } from './regras';

/** "Hoje" fixo do simulador, para a previsão de retorno ser sempre a mesma. */
const TODAY = '2026-11-09';

const TEXT = {
  'pt-BR': {
    title: 'Título',
    titleHint: 'Uma frase que resuma a ideia.',
    description: 'Situação atual',
    descriptionHint: 'Qual é o problema ou a oportunidade? Onde acontece?',
    entity: 'Entidade',
    category: 'Categoria',
    pick: 'Escolha…',
    entities: ['Unidade A · Expedição', 'Unidade A · Produção', 'Unidade B · Câmaras frias'],
    categories: ['Segurança', 'Qualidade', 'Entrega', 'Custo', 'Meio ambiente', 'Pessoas'],
    required: 'Campo obrigatório.',
    send: 'Enviar ideia',
    tryHint: 'Dica: escreva algo com "etiqueta" ou "prensa" no título para ver a sugestão de ideias parecidas.',
    similarTitle: 'Ideias parecidas que já estão abertas',
    similarIntro:
      'Se uma delas é o mesmo pedido, apoie-a: você entra como co-autor e acompanha tudo, sem duplicar o trabalho da equipe.',
    support: 'Apoiar esta ideia',
    sendAnyway: 'Nenhuma é igual à sua? Continue o preenchimento e envie normalmente.',
    sentTitle: 'Ideia enviada',
    sentText: (code: string) => `Sua ideia ${code} chegou à equipe de melhoria.`,
    returnBy: 'Previsão de retorno',
    next: 'O que acontece agora',
    nextItems: [
      'Um analista assume a análise; você é avisado quando isso acontecer.',
      'Você acompanha tudo em Minhas ideias: situação, linha do tempo e comentários.',
      'Se a equipe não autorizar, você recebe a justificativa.',
    ],
    supportedTitle: 'Apoio registrado',
    supportedText: (code: string) => `Você agora é co-autor da ideia ${code} e vai receber os avisos sobre ela.`,
  },
  en: {
    title: 'Title',
    titleHint: 'One sentence that sums up the idea.',
    description: 'Current situation',
    descriptionHint: 'What is the problem or opportunity? Where does it happen?',
    entity: 'Entity',
    category: 'Category',
    pick: 'Choose…',
    entities: ['Site A · Shipping', 'Site A · Production', 'Site B · Cold rooms'],
    categories: ['Safety', 'Quality', 'Delivery', 'Cost', 'Environment', 'People'],
    required: 'Required field.',
    send: 'Submit idea',
    tryHint: 'Tip: write something with "label" or "press" in the title to see similar-idea suggestions.',
    similarTitle: 'Similar ideas that are already open',
    similarIntro:
      "If one of them is the same request, support it: you join as a co-author and follow everything, without duplicating the team's work.",
    support: 'Support this idea',
    sendAnyway: 'None of them matches yours? Keep filling in the form and submit as usual.',
    sentTitle: 'Idea submitted',
    sentText: (code: string) => `Your idea ${code} has reached the improvement team.`,
    returnBy: 'Expected response by',
    next: 'What happens now',
    nextItems: [
      'An analyst takes the review; you are notified when that happens.',
      'You follow everything in My ideas: status, timeline and comments.',
      'If the team does not approve it, you get the justification.',
    ],
    supportedTitle: 'Support recorded',
    supportedText: (code: string) => `You are now a co-author of idea ${code} and will be notified about it.`,
  },
} satisfies Record<Lang, unknown>;

/** Ideias abertas fictícias, e as palavras que as fazem aparecer como "parecidas". */
const OPEN: { code: string; status: Status; title: Record<Lang, string>; words: string[] }[] = [
  {
    code: 'ITS-2026-0012',
    status: 'in_review',
    title: {
      'pt-BR': 'Etiquetas resistentes à umidade nas câmaras frias',
      en: 'Moisture-proof labels in the cold rooms',
    },
    words: ['etiqueta', 'umidade', 'label', 'moisture'],
  },
  {
    code: 'ITS-2026-0007',
    status: 'in_progress',
    title: { 'pt-BR': 'Gabarito de regulagem na prensa 3', en: 'Setup jig on press 3' },
    words: ['prensa', 'gabarito', 'press', 'jig'],
  },
];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Done = { kind: 'sent' } | { kind: 'supported'; code: string };

export function EnviarIdeia() {
  const lang = useLang();
  const t = TEXT[lang];
  const [form, setForm] = useState({ title: '', description: '', entity: '', category: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, boolean>>>({});
  const [done, setDone] = useState<Done | null>(null);
  const set = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: false }));
  };
  const text = norm(`${form.title} ${form.description}`);
  const similar = OPEN.filter((o) => o.words.some((w) => text.includes(w)));

  if (done) {
    const due = triageDueDate(TODAY, SLA_DAYS, false);
    return (
      <div role="status" className="space-y-4">
        <p className="flex items-center gap-2 font-heading text-lg font-semibold">
          <CheckCircle2 aria-hidden="true" className="size-5 text-(--st-done)" />
          {done.kind === 'sent' ? t.sentTitle : t.supportedTitle}
        </p>
        {done.kind === 'sent' ? (
          <>
            <p className="flex flex-wrap items-center gap-2">
              {t.sentText('ITS-2026-0043')} <Situacao s="submitted" />
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">{t.returnBy}:</span>{' '}
              <span className="font-medium">{formatDay(due, lang)}</span> <Regra id="RN-54" />
            </p>
            <div>
              <p className="text-sm font-medium">{t.next}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {t.nextItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p>
            {t.supportedText(done.code)} <Regra id="RN-86" />
          </p>
        )}
      </div>
    );
  }

  const submit = () => {
    const missing = {
      title: !form.title.trim(),
      description: !form.description.trim(),
      entity: !form.entity,
      category: !form.category,
    };
    setErrors(missing);
    if (!Object.values(missing).some(Boolean)) setDone({ kind: 'sent' });
  };

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label={t.title} hint={t.titleHint} error={errors.title ? t.required : undefined}>
        <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={200} />
      </Field>
      {similar.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-4" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Users aria-hidden="true" className="size-4" />
            {t.similarTitle} <Regra id="RN-57" />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t.similarIntro}</p>
          <ul className="mt-3 divide-y border-y">
            {similar.map((o) => (
              <li key={o.code} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="min-w-0 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{o.code}</span>{' '}
                  <span className="font-medium">{o.title[lang]}</span> <Situacao s={o.status} />
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDone({ kind: 'supported', code: o.code })}
                >
                  {t.support}
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{t.sendAnyway}</p>
        </div>
      )}
      <Field label={t.description} hint={t.descriptionHint} error={errors.description ? t.required : undefined}>
        <Textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.entity} error={errors.entity ? t.required : undefined}>
          <NativeSelect value={form.entity} onChange={(e) => set('entity', e.target.value)}>
            <option value="">{t.pick}</option>
            {t.entities.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t.category} error={errors.category ? t.required : undefined}>
          <NativeSelect value={form.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">{t.pick}</option>
            {t.categories.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{t.send}</Button>
        <span className="text-xs text-muted-foreground">{t.tryHint}</span>
      </div>
    </form>
  );
}
