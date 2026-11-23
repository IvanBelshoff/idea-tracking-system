'use client';

import { useRef } from 'react';
import type { Lang } from '../../i18n';
import { rastrear } from '../../rastrear';
import { asset } from '../../site';

/** O vídeo do caminho de uma ideia. Conta no site público a primeira vez que alguém dá o play. */
export function VideoCiclo({ lang, label }: { lang: Lang; label: string }) {
  const contado = useRef(false);
  const onPlay = () => {
    if (contado.current) return;
    contado.current = true;
    rastrear(`video/${lang}`);
  };
  return (
    <video
      className="aspect-video w-full rounded-xl border bg-muted shadow-sm"
      controls
      muted
      playsInline
      preload="none"
      poster={asset(`/video/ciclo-${lang}.webp`)}
      aria-label={label}
      onPlay={onPlay}
    >
      <source src={asset(`/video/ciclo-${lang}.webm`)} type="video/webm" />
    </video>
  );
}
