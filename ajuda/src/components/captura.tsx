'use client';

import { Expand } from 'lucide-react';
import dynamic from 'next/dynamic';
import { type MouseEvent, useState } from 'react';
import { type Lang, MESSAGES } from '../i18n';
import { asset } from '../site';
import type { CapturaAberta } from './captura-visor';
import { useLang } from './use-lang';

/** O visualizador só é baixado quando alguém abre uma captura. */
const CapturaVisor = dynamic(() => import('./captura-visor'), { ssr: false });

/**
 * Captura de tela do ITS, gerada por scripts/capturas.mjs (dados fictícios de demonstração), no
 * idioma da página e nos dois temas: o CSS mostra a do tema atual. Largura e altura fixas evitam
 * que o texto pule quando a imagem carrega.
 *
 * Clicar amplia a captura em tela cheia, na própria página (zoom e pinça para ler os detalhes). Sem
 * JavaScript, ou com Ctrl, ⌘, Shift ou o botão do meio, o link abre o arquivo, como qualquer link.
 */
export function Captura({
  nome,
  alt,
  legenda,
  lang: forced,
  recorte = false,
}: {
  nome: string;
  alt: string;
  legenda?: string;
  /** Fora das páginas da documentação (a página inicial, sem idioma no endereço). */
  lang?: Lang;
  /** Mostra a captura numa proporção fixa, a partir do topo (a ampliada continua inteira). */
  recorte?: boolean;
}) {
  const pathLang = useLang();
  const lang = forced ?? pathLang;
  const t = MESSAGES[lang].capture;
  const [aberta, setAberta] = useState<CapturaAberta | null>(null);
  const src = (tema: 'claro' | 'escuro') => asset(`/capturas/${lang}/${tema}/${nome}.webp`);

  const abrir = (evento: MouseEvent<HTMLAnchorElement>) => {
    if (evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey || evento.button !== 0) return;
    evento.preventDefault();
    const escuro = document.documentElement.classList.contains('dark');
    // O tamanho real vem da imagem que está na tela (as capturas têm alturas diferentes).
    const img = evento.currentTarget.querySelector<HTMLImageElement>(
      escuro ? 'img[data-tema="escuro"]' : 'img[data-tema="claro"]',
    );
    setAberta({
      src: src(escuro ? 'escuro' : 'claro'),
      alt,
      width: img?.naturalWidth || 1280,
      height: img?.naturalHeight || 800,
      legenda,
    });
  };

  return (
    <figure className="not-doc my-6">
      <a
        href={src('claro')}
        onClick={abrir}
        aria-label={t.expand(alt)}
        className={`group relative block cursor-zoom-in overflow-clip rounded-lg border bg-muted shadow-sm outline-none transition-colors hover:border-ring focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${recorte ? 'aspect-[16/10]' : ''}`}
      >
        {/* biome-ignore lint/performance/noImgElement: exportação estática sem otimizador (images.unoptimized); next/image não acrescentaria nada */}
        <img
          src={src('claro')}
          alt={alt}
          width={1280}
          height={800}
          loading="lazy"
          data-tema="claro"
          className={`block w-full dark:hidden ${recorte ? 'h-full object-cover object-top' : 'h-auto'}`}
        />
        {/* biome-ignore lint/performance/noImgElement: exportação estática sem otimizador (images.unoptimized); next/image não acrescentaria nada */}
        <img
          src={src('escuro')}
          alt={alt}
          width={1280}
          height={800}
          loading="lazy"
          data-tema="escuro"
          className={`hidden w-full dark:block ${recorte ? 'h-full object-cover object-top' : 'h-auto'}`}
        />
        {/*
          Sinal de que a captura amplia, visível também no celular (onde não há "passar o mouse"). Fica
          sobre o canto de baixo da imagem (-mt-9 + h-7 + mb-2 = 0, sem mudar a altura do link) e, nas
          capturas mais altas que a tela, gruda no rodapé enquanto a captura está à vista (sticky; por
          isso o link usa overflow-clip, que não quebra o sticky como o overflow-hidden).
        */}
        <span
          aria-hidden="true"
          className={`pointer-events-none z-10 flex h-7 w-fit items-center gap-1.5 rounded-md border bg-background/90 px-2 text-xs font-medium text-foreground shadow-sm transition-colors group-hover:border-ring group-focus-visible:border-ring ${recorte ? 'absolute right-2 bottom-2' : 'sticky bottom-2 mr-2 mb-2 -mt-9 ml-auto'}`}
        >
          <Expand className="size-3.5" />
          {t.hint}
        </span>
      </a>
      {legenda && <figcaption className="mt-2 text-sm text-muted-foreground">{legenda}</figcaption>}
      {aberta && <CapturaVisor captura={aberta} lang={lang} fechar={() => setAberta(null)} />}
    </figure>
  );
}
