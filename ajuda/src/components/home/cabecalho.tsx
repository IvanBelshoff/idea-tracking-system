'use client';

import { ExternalLink, Languages } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ItsSymbol } from '@/components/brand/its-symbol';
import type { Lang } from '../../i18n';
import { REPO_URL } from '../../site';
import { ThemeMenu } from '../theme-menu';
import { LANG_KEY } from './idioma';
import { ANCHORS, HOME } from './texto';

function readLang(): Lang {
  return document.documentElement.dataset.lang === 'en' ? 'en' : 'pt-BR';
}

/**
 * Cabeçalho da página inicial: uma vez só, com os rótulos dos dois idiomas (o CSS mostra o escolhido).
 * O botão de idioma troca na hora e guarda a escolha, que vale também na documentação e no ITS.
 */
export function Cabecalho() {
  const [lang, setLang] = useState<Lang>('pt-BR');
  useEffect(() => setLang(readLang()), []);

  const toggle = () => {
    const next: Lang = lang === 'en' ? 'pt-BR' : 'en';
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // Sem armazenamento (navegação privada): vale só nesta visita.
    }
    document.documentElement.dataset.lang = next;
    document.documentElement.lang = next;
    document.title = HOME[next].meta.title;
    setLang(next);
  };

  const link =
    'rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none';

  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
      {(['pt-BR', 'en'] as const).map((l) => (
        <a
          key={l}
          data-l={l}
          href={`#${ANCHORS[l].main}`}
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
        >
          {HOME[l].skip}
        </a>
      ))}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-8">
        <Link
          href="/"
          className="mr-auto flex items-center gap-2.5 rounded-md font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span aria-hidden="true" className="text-primary">
            <ItsSymbol size={28} free />
          </span>
          <span className="text-lg">ITS</span>
        </Link>
        {(['pt-BR', 'en'] as const).map((l) => (
          <nav key={l} data-l={l} aria-label={HOME[l].nav.label} className="hidden items-center gap-0.5 md:flex">
            <a href={`#${ANCHORS[l].how}`} className={link}>
              {HOME[l].nav.how}
            </a>
            <a href={`#${ANCHORS[l].features}`} className={link}>
              {HOME[l].nav.features}
            </a>
            <Link href={`/${l}/`} className={link}>
              {HOME[l].nav.docs}
            </Link>
            <a href={REPO_URL} className={`${link} inline-flex items-center gap-1`}>
              {HOME[l].nav.github}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </nav>
        ))}
        {/* No celular, a navegação some; a documentação continua a um toque. */}
        {(['pt-BR', 'en'] as const).map((l) => (
          <Link key={l} data-l={l} href={`/${l}/`} className={`${link} md:hidden`}>
            {HOME[l].nav.docs}
          </Link>
        ))}
        <button
          type="button"
          onClick={toggle}
          title={HOME[lang].nav.otherLanguage}
          className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Languages aria-hidden="true" className="size-[1.15rem]" />
          {(['pt-BR', 'en'] as const).map((l) => (
            <span key={l} data-l={l}>
              <span className="text-xs font-semibold tracking-wide">{HOME[l].nav.language}</span>
              <span className="sr-only" lang={l === 'en' ? 'pt-BR' : 'en'}>
                , {HOME[l].nav.otherLanguage}
              </span>
            </span>
          ))}
        </button>
        <ThemeMenu lang={lang} />
      </div>
    </header>
  );
}
