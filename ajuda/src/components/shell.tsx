'use client';

import { ArrowLeft, ExternalLink, Languages, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { ItsSymbol } from '@/components/brand/its-symbol';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { pageHref, SECTIONS } from '../../content/nav';
import { type Lang, MESSAGES, otherLang } from '../i18n';
import { PUBLICA, REPO_URL } from '../site';
import { Search } from './search';
import { ThemeMenu } from './theme-menu';

/** Caminho atual sem o idioma: "referencia/situacoes" (o mesmo nos dois idiomas). */
export function useSlug(): string {
  const path = usePathname() ?? '/';
  return path.replace(/^\/(pt-BR|en)\/?/, '').replace(/\/$/, '');
}

function SideNav({ lang, onNavigate }: { lang: Lang; onNavigate?: () => void }) {
  const slug = useSlug();
  const t = MESSAGES[lang];
  return (
    <nav aria-label={t.nav.label} className="space-y-6">
      {SECTIONS.map((section) => (
        <div key={section.id}>
          <p className="px-3 text-[0.7rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {section.title[lang]}
          </p>
          <ul className="mt-2 space-y-0.5">
            {section.pages.map((page) => {
              const active = page.slug === slug;
              return (
                <li key={page.slug}>
                  <Link
                    href={pageHref(lang, page.slug)}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-shell-active font-medium text-shell-active-foreground'
                        : 'text-foreground/85 hover:bg-foreground/5 hover:text-foreground'
                    }`}
                  >
                    {page.title[lang]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Moldura da ajuda: cabeçalho fixo, trilho de navegação no computador e gaveta no celular. */
export function Shell({ lang, children }: { lang: Lang; children: ReactNode }) {
  const t = MESSAGES[lang];
  const slug = useSlug();
  const [open, setOpen] = useState(false);
  const other = otherLang(lang);

  // A escolha de idioma vale também para o ITS (mesmo endereço, mesma preferência guardada).
  useEffect(() => {
    try {
      localStorage.setItem('its-lang', lang);
    } catch {
      // armazenamento bloqueado: só não lembra o idioma
    }
  }, [lang]);

  return (
    <div className="min-h-svh">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t.skip}
      </a>
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex h-14 max-w-[90rem] items-center gap-2 px-3 sm:px-5">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t.header.menu}
            aria-expanded={open}
            aria-controls="menu-ajuda"
            className="grid size-10 shrink-0 place-items-center rounded-md hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:hidden"
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
          <Link href={pageHref(lang, '')} className="flex shrink-0 items-center gap-2.5 rounded-md">
            <span aria-hidden="true" className="text-primary">
              <ItsSymbol size={28} free />
            </span>
            <span className="font-heading text-[1.05rem] font-bold">{t.site.title}</span>
          </Link>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Search lang={lang} />
            <Link
              href={pageHref(other, slug)}
              hrefLang={other}
              title={t.header.otherLanguageHint}
              className="inline-flex h-10 shrink-0 items-center gap-1 rounded-md px-2 hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {/*
               * Como o tema: mostra o estado atual (o idioma da página); a dica diz para onde o clique leva.
               * O nome acessível começa pela sigla visível ("PT, Read this page in English"), para comando de voz.
               */}
              <Languages aria-hidden="true" className="size-[1.15rem]" />
              <span className="text-xs font-semibold tracking-wide">{t.header.languageCode}</span>
              <span className="sr-only" lang={other}>
                , {t.header.otherLanguageHint}
              </span>
            </Link>
            <ThemeMenu lang={lang} />
            {/*
              Na instalação, o ITS mora na raiz do mesmo endereço: link comum, fora do basePath da ajuda.
              Na ajuda pública não há ITS por trás: o link leva ao código, onde está a instalação.
            */}
            <a
              href={PUBLICA ? REPO_URL : '/'}
              className="hidden items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:inline-flex"
            >
              {PUBLICA ? (
                <ExternalLink aria-hidden="true" className="size-4" />
              ) : (
                <ArrowLeft aria-hidden="true" className="size-4" />
              )}
              {PUBLICA ? t.header.repo : t.header.backToIts}
            </a>
          </div>
        </div>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent id="menu-ajuda" closeLabel={t.header.closeMenu} className="overflow-y-auto">
          <SheetTitle className="sr-only">{t.nav.label}</SheetTitle>
          <div className="space-y-6 px-3 pt-16 pb-8">
            <SideNav lang={lang} onNavigate={() => setOpen(false)} />
            <div className="space-y-1 border-t pt-4">
              <Link
                href={pageHref(other, slug)}
                hrefLang={other}
                lang={other}
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-1.5 text-sm hover:bg-foreground/5"
              >
                {t.header.otherLanguage}
              </Link>
              <a href={PUBLICA ? REPO_URL : '/'} className="block rounded-md px-3 py-1.5 text-sm hover:bg-foreground/5">
                {PUBLICA ? t.header.repo : t.header.backToIts}
              </a>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <div className="mx-auto flex max-w-[90rem] gap-8 px-4 sm:px-5">
        <aside className="rail-scroll sticky top-14 hidden h-[calc(100svh-3.5rem)] w-60 shrink-0 overflow-y-auto py-8 lg:block">
          <SideNav lang={lang} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
