'use client';

import { Check, Users } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Regra, Situacao } from '../components/doc-parts';
import { useLang } from '../components/use-lang';
import type { Lang } from '../i18n';
import { canSupport, type Status } from './regras';

const TEXT = {
  'pt-BR': {
    asked: (n: number) => (n === 1 ? '1 pessoa pediu isso' : `${n} pessoas pediram isso`),
    support: 'Apoiar',
    supported: 'Você apoia esta ideia',
    supportedNote: 'Agora você é co-autor: aparece entre quem pediu e recebe cada aviso de mudança.',
    closed: 'Encerrada: novos co-autores, só pela equipe.',
    label: (code: string) => `Apoiar a ideia ${code}`,
  },
  en: {
    asked: (n: number) => (n === 1 ? '1 person asked for this' : `${n} people asked for this`),
    support: 'Support',
    supported: 'You support this idea',
    supportedNote: 'You are now a co-author: you show up among those who asked and get every status notification.',
    closed: 'Closed: new co-authors only through the team.',
    label: (code: string) => `Support idea ${code}`,
  },
} satisfies Record<Lang, unknown>;

const IDEAS: { code: string; status: Status; asked: number; title: Record<Lang, string> }[] = [
  {
    code: 'ITS-2026-0021',
    status: 'submitted',
    asked: 2,
    title: { 'pt-BR': 'Rampa de acesso ao estoque do térreo', en: 'Access ramp to the ground-floor stockroom' },
  },
  {
    code: 'ITS-2026-0007',
    status: 'in_progress',
    asked: 1,
    title: { 'pt-BR': 'Gabarito de regulagem na prensa 3', en: 'Setup jig on press 3' },
  },
  {
    code: 'ITS-2026-0003',
    status: 'implemented',
    asked: 4,
    title: { 'pt-BR': 'Iluminação LED no galpão de cargas', en: 'LED lighting in the loading shed' },
  },
];

/** "Apoiar": entrar como co-autor de uma ideia que já existe, em vez de enviar outra igual. */
export function Apoiar() {
  const lang = useLang();
  const t = TEXT[lang];
  const [mine, setMine] = useState<Set<string>>(new Set());

  return (
    <ul className="divide-y border-y">
      {IDEAS.map((idea) => {
        const supported = mine.has(idea.code);
        const open = canSupport(idea.status);
        return (
          <li key={idea.code} className="p-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-xs text-muted-foreground">{idea.code}</span>
              <Situacao s={idea.status} />
            </div>
            <p className="mt-1 font-medium">{idea.title[lang]}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
                <Users aria-hidden="true" className="size-4" />
                {t.asked(idea.asked + (supported ? 1 : 0))}
              </span>
              {supported ? (
                <span className="flex items-center gap-1.5 text-sm font-medium text-(--st-done)">
                  <Check aria-hidden="true" className="size-4" />
                  {t.supported}
                </span>
              ) : open ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={t.label(idea.code)}
                  onClick={() => setMine((s) => new Set(s).add(idea.code))}
                >
                  {t.support}
                </Button>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {t.closed} <Regra id="RN-86" />
                </span>
              )}
            </div>
            {supported && <p className="mt-2 text-sm">{t.supportedNote}</p>}
          </li>
        );
      })}
    </ul>
  );
}
