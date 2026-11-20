'use client';

import { Info, RotateCcw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { type StatusMark, StatusPill } from '@/components/status-pill';
import { Button } from '@/components/ui/button';
import { useLang, useMessages } from './use-lang';

/**
 * Regra de negócio que leva à explicação na referência. Com texto dentro
 * (`<Regra id="RN-02">qualquer colaborador</Regra>`), vira um link comum nas palavras da frase,
 * que entram na busca; sem texto, é o selo ("RN-05"), fora do índice.
 */
export function Regra({ id, children }: { id: string; children?: ReactNode }) {
  const lang = useLang();
  const t = useMessages();
  const href = `/${lang}/referencia/regras/#${id.toLowerCase()}`;
  if (children) {
    return (
      <Link href={href} title={t.rule.title(id)}>
        {children}
      </Link>
    );
  }
  return (
    <Link
      data-pagefind-ignore
      href={href}
      title={t.rule.title(id)}
      className="inline-flex -translate-y-px items-center rounded-full border px-2 py-px align-middle font-mono text-[0.7rem] font-medium text-muted-foreground no-underline hover:border-primary hover:text-primary"
    >
      {id}
    </Link>
  );
}

/** Situação da ideia, com a mesma pílula do ITS (cor + ícone + texto). */
export function Situacao({ s, size }: { s: StatusMark; size?: 'md' | 'lg' }) {
  const t = useMessages();
  return <StatusPill status={s} label={t.status[s]} size={size} />;
}

function Callout({ kind, children }: { kind: 'tip' | 'warning'; children: ReactNode }) {
  const t = useMessages();
  const Icon = kind === 'tip' ? Info : TriangleAlert;
  const ink = kind === 'tip' ? 'var(--primary)' : 'var(--st-late)';
  return (
    <aside
      className="not-doc my-6 flex gap-3 rounded-lg border p-4 text-[0.95rem]"
      style={{ background: `color-mix(in oklch, ${ink} 6%, var(--card))` }}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-[1.1rem] shrink-0" style={{ color: ink }} />
      <div className="min-w-0 space-y-2 [&_p]:m-0">
        <p className="font-semibold">{kind === 'tip' ? t.callout.tip : t.callout.warning}</p>
        {children}
      </div>
    </aside>
  );
}

export const Dica = ({ children }: { children: ReactNode }) => <Callout kind="tip">{children}</Callout>;
export const Atencao = ({ children }: { children: ReactNode }) => <Callout kind="warning">{children}</Callout>;

/**
 * Moldura de "Pratique": um simulador com dados fictícios, que pode recomeçar do zero. O
 * conteúdo é remontado (key) ao recomeçar, para o estado voltar ao inicial.
 */
export function Simulador({ titulo, children }: { titulo: string; children: ReactNode }) {
  const t = useMessages();
  const [round, setRound] = useState(0);
  return (
    <section
      data-pagefind-ignore
      aria-label={`${t.sim.practice}: ${titulo}`}
      className="not-doc my-8 overflow-hidden rounded-xl border bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3 sm:px-5">
        <p className="min-w-0 font-heading font-semibold">
          <span className="text-primary">{t.sim.practice}:</span> {titulo}
        </p>
        <Button variant="outline" size="sm" onClick={() => setRound((n) => n + 1)}>
          <RotateCcw aria-hidden="true" />
          {t.sim.restart}
        </Button>
      </header>
      <div key={round} className="p-4 sm:p-5">
        {children}
      </div>
      <p className="border-t px-4 py-2 text-xs text-muted-foreground sm:px-5">{t.sim.note}</p>
    </section>
  );
}
