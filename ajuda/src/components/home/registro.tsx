import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { Lang } from '../../i18n';
import { Comando } from './copiar';
import { COMMANDS, HOME, type Situacao } from './texto';

/** Cor de cada situação: os mesmos tokens do ITS (frontend/src/tokens.css). */
export const INK: Record<Situacao, string> = {
  submitted: 'var(--st-submitted)',
  in_review: 'var(--st-review)',
  in_progress: 'var(--st-progress)',
  implemented: 'var(--st-done)',
};

/**
 * O histórico da ideia de exemplo, que se escreve evento a evento quando a página abre (CSS, sem
 * JavaScript; parado com menos movimento). A última entrada, "sua vez", é a instalação.
 */
export function Registro({ lang }: { lang: Lang }) {
  const t = HOME[lang];
  const install = t.install;
  return (
    <section aria-label={t.hero.logLabel} className="relative">
      <ol className="relative border-l-2 border-border pl-7 sm:pl-9">
        {t.hero.log.map((e, i) => (
          <li
            key={e.when}
            className="home-entry relative grid gap-1 border-b border-dashed py-4 sm:grid-cols-[9.5rem_1fr] sm:gap-5"
            style={{ '--i': i, '--ink': INK[e.status] } as CSSProperties}
          >
            <span
              aria-hidden="true"
              className={`absolute top-5.5 -left-[2.3rem] size-4 rounded-full border-3 border-background bg-(--ink) sm:-left-[2.8rem] ${e.live ? 'home-live' : ''}`}
            />
            <time className="font-num text-sm text-muted-foreground tabular-nums">{e.when}</time>
            <div>
              <p className="font-semibold text-pretty">{e.what}</p>
              <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{e.why}</p>
            </div>
          </li>
        ))}
        <li
          className="home-acao relative mt-4 rounded-xl border-2 border-primary bg-[color-mix(in_oklch,var(--brand)_7%,var(--background))] p-4 sm:grid sm:grid-cols-[9.5rem_1fr] sm:gap-5 sm:p-5"
          style={{ '--i': t.hero.log.length } as CSSProperties}
        >
          <span
            aria-hidden="true"
            className="absolute top-6 -left-[2.4rem] size-4 rounded-full border-3 border-background bg-primary sm:-left-[2.9rem]"
          />
          <span className="text-sm font-semibold text-primary">{t.hero.yourTurn}</span>
          <div className="mt-2 space-y-3 sm:mt-0">
            <Comando
              text={COMMANDS.start}
              copy={install.copy}
              copied={install.copied}
              copyLabel={install.copyLabel(COMMANDS.start)}
              regionLabel={`${install.command}: ${t.hero.yourTurn}`}
            />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <a
                href={`#${lang === 'en' ? 'install' : 'instalar'}`}
                className="inline-flex h-11 items-center rounded-lg bg-primary px-5 font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {t.hero.install}
              </a>
              <Link
                href={`/${lang}/`}
                className="font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {t.hero.docs} →
              </Link>
            </div>
          </div>
        </li>
      </ol>
    </section>
  );
}
