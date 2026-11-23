import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { StatusPill } from '@/components/status-pill';
import type { Lang } from '../../i18n';
import { REPO_URL } from '../../site';
import { Captura } from '../captura';
import { Cabecalho } from './cabecalho';
import { Comando } from './copiar';
import { Registro } from './registro';
import { ANCHORS, COMMANDS, HOME } from './texto';
import { VideoCiclo } from './video';

const RELEASES = `${REPO_URL}/releases`;
const DOCKER_HUB = 'https://hub.docker.com/r/ivanbelshoff/its-api';
const AUTHOR = 'https://github.com/IvanBelshoff';

/**
 * Seção abaixo da dobra: o trilho do histórico continua pela página (a borda à esquerda do contêiner,
 * no computador) e cada seção é uma parada, com o marcador na cor de uma situação ao lado do título.
 */
function Secao({ id, title, ink, children }: { id: string; title: string; ink: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="relative scroll-mt-20 py-16 sm:py-24 lg:pl-14">
      <span
        aria-hidden="true"
        className="absolute top-[4.625rem] -left-[7px] hidden size-4 rounded-full border-3 border-background lg:block sm:top-[6.75rem]"
        style={{ background: ink }}
      />
      <h2 id={`${id}-titulo`} className="max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      <div className="mt-10 sm:mt-12">{children}</div>
    </section>
  );
}

/** Um idioma da página. Os dois vão no HTML; o CSS (globals.css, data-l) mostra o escolhido. */
function Corpo({ lang }: { lang: Lang }) {
  const t = HOME[lang];
  const a = ANCHORS[lang];
  const install = lang === 'en' ? 'install' : 'instalar';
  const linkClass =
    'font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none';

  return (
    <div data-l={lang} lang={lang}>
      <main id={a.main}>
        {/* Primeira tela: o título e a ideia de exemplo à esquerda; o histórico dela à direita. */}
        <div className="mx-auto grid max-w-7xl gap-12 px-4 pt-12 pb-16 sm:px-8 sm:pt-16 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] lg:gap-16 lg:pb-24">
          <div>
            <h1 className="text-[2.75rem] leading-[0.98] font-extrabold tracking-[-0.03em] sm:text-6xl xl:text-[4.25rem]">
              <span className="block sm:whitespace-nowrap">{t.hero.title[0]}</span>
              <span className="block text-primary sm:whitespace-nowrap">{t.hero.title[1]}</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-pretty text-muted-foreground">{t.hero.lede}</p>
            <div className="mt-8 border-t pt-5">
              <p className="font-mono text-sm text-muted-foreground">{t.hero.ideaCode}</p>
              <p className="mt-1 text-xl font-semibold text-balance">{t.hero.ideaTitle}</p>
              <p className="mt-2 text-xs text-muted-foreground">{t.hero.note}</p>
            </div>
          </div>
          <Registro lang={lang} />
        </div>

        {/* O trilho: a borda esquerda deste contêiner, no computador. */}
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="border-border lg:border-l-2">
            <Secao id={a.how} title={t.how.title} ink="var(--st-submitted)">
              <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
                {t.how.steps.map((s, i) => (
                  <li key={s.name} className="relative lg:pt-8">
                    {/* No computador, os quatro passos ficam num trilho, como as paradas de uma ideia. */}
                    <span
                      aria-hidden="true"
                      className="absolute top-3 right-0 left-0 hidden h-0.5 bg-border lg:block"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 left-0 hidden size-3.5 rounded-full border-3 border-background lg:block"
                      style={{ background: `var(--st-${['submitted', 'review', 'progress', 'done'][i]})` }}
                    />
                    <StatusPill status={s.status} label={t.status[s.status]} size="lg" />
                    <h3 className="mt-4 text-xl font-semibold">{s.name}</h3>
                    <p className="mt-2 leading-relaxed text-pretty text-muted-foreground">{s.text}</p>
                  </li>
                ))}
              </ol>
            </Secao>

            <Secao id={a.features} title={t.features.title} ink="var(--st-review)">
              <ul className="grid gap-x-8 gap-y-12 md:grid-cols-2">
                {t.features.items.map((f) => (
                  <li key={f.title}>
                    <h3 className="text-xl font-semibold">{f.title}</h3>
                    <p className="mt-2 max-w-xl leading-relaxed text-pretty text-muted-foreground">{f.text}</p>
                    {f.shot && f.alt && <Captura nome={f.shot} alt={f.alt} lang={lang} recorte />}
                  </li>
                ))}
              </ul>
            </Secao>

            <Secao id={lang === 'en' ? 'demo' : 'demonstracao'} title={t.video.title} ink="var(--st-progress)">
              <figure className="not-doc">
                <VideoCiclo lang={lang} label={t.video.label} />
                <figcaption className="mt-3 text-sm text-muted-foreground">{t.video.caption}</figcaption>
              </figure>
            </Secao>

            <Secao id={install} title={t.install.title} ink="var(--brand)">
              <p className="-mt-6 mb-10 max-w-2xl text-lg text-pretty text-muted-foreground">{t.install.lede}</p>
              <ol className="grid gap-x-8 gap-y-10 lg:grid-cols-2">
                {t.install.steps.map((s, i) => (
                  <li key={s.title} className={`flex min-w-0 flex-col gap-3 ${i === 0 ? 'lg:col-span-2' : ''}`}>
                    <p className="font-num text-sm font-semibold text-primary">0{i + 1}</p>
                    <h3 className="text-xl font-semibold">{s.title}</h3>
                    {i === 0 && (
                      <Comando
                        quebrar
                        text={COMMANDS.download}
                        copy={t.install.copy}
                        copied={t.install.copied}
                        copyLabel={t.install.copyLabel(s.title)}
                        regionLabel={`${t.install.command}: ${s.title}`}
                        evento="copiar-comando/baixar/instalar"
                      />
                    )}
                    {s.text && <p className="leading-relaxed text-pretty text-muted-foreground">{s.text}</p>}
                    {i === 2 && (
                      <Comando
                        text={COMMANDS.start}
                        copy={t.install.copy}
                        copied={t.install.copied}
                        copyLabel={t.install.copyLabel(COMMANDS.start)}
                        regionLabel={`${t.install.command}: ${s.title}`}
                        evento="copiar-comando/subir/instalar"
                      />
                    )}
                  </li>
                ))}
              </ol>
              <p className="mt-10">
                <Link href={`/${lang}/ti/instalacao/`} className={linkClass} data-goatcounter-click="guia-instalacao">
                  {t.install.guide} →
                </Link>
              </p>
            </Secao>

            <Secao id={lang === 'en' ? 'open' : 'aberto'} title={t.open.title} ink="var(--st-done)">
              <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
                {t.open.items.map((o) => (
                  <li key={o.title} className="border-t-2 border-primary pt-4">
                    <h3 className="font-semibold">{o.title}</h3>
                    <p className="mt-1.5 leading-relaxed text-pretty text-muted-foreground">{o.text}</p>
                  </li>
                ))}
              </ul>
            </Secao>
          </div>
        </div>
      </main>

      <footer className="border-t bg-shell py-10 text-sm text-shell-muted">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>
            <span className="font-semibold text-shell-foreground">{t.footer.name}</span>
            {' · '}
            {t.footer.by}{' '}
            <a href={AUTHOR} className={linkClass} data-goatcounter-click="saida/autor/rodape">
              Ivan Belshoff
            </a>
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            <li>
              <Link href={`/${lang}/`} className={linkClass} data-goatcounter-click="documentacao/rodape">
                {t.footer.links.docs}
              </Link>
            </li>
            {(
              [
                [REPO_URL, t.footer.links.github, 'github'],
                [RELEASES, t.footer.links.releases, 'releases'],
                [DOCKER_HUB, t.footer.links.dockerHub, 'docker-hub'],
                [`${REPO_URL}/blob/main/LICENSE`, t.footer.links.license, 'licenca'],
              ] as const
            ).map(([href, label, destino]) => (
              <li key={href}>
                <a
                  href={href}
                  className={`${linkClass} inline-flex items-center gap-1`}
                  data-goatcounter-click={`saida/${destino}/rodape`}
                >
                  {label}
                  <ExternalLink aria-hidden="true" className="size-3" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}

/** A página inicial do site público: cabeçalho único e o corpo nos dois idiomas. */
export function Inicio() {
  return (
    <>
      <Cabecalho />
      <Corpo lang="pt-BR" />
      <Corpo lang="en" />
    </>
  );
}
