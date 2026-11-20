'use client';

import { useEffect } from 'react';

/**
 * Fonte da organização (escolhida no ITS): o script inline já marcou `html[data-font]`; aqui só se
 * baixa o CSS da família, sob demanda, como o ITS faz (frontend/src/app/fonts.ts). A Geist já vem.
 */
const loaders: Record<string, () => Promise<unknown>> = {
  inter: () => import('@fontsource-variable/inter/index.css'),
  atkinson: () => import('@fontsource-variable/atkinson-hyperlegible-next/index.css'),
  plex: () => import('@fontsource-variable/ibm-plex-sans/index.css'),
};

export function FontSync() {
  useEffect(() => {
    const font = document.documentElement.dataset.font;
    if (font && loaders[font]) void loaders[font]().catch(() => undefined);
  }, []);
  return null;
}
