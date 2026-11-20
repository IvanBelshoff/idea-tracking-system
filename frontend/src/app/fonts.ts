import type { AnyRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { components } from '@/api/schema';
import { useOwnAppearance } from './branding';
import { usePublicSettings } from './session';

export type BrandFont = components['schemas']['PublicSettingsView']['font'];

/** Chave da última fonte, lida pelo script do index.html antes do React (o `data-font` já vem certo). */
export const FONT_KEY = 'its-font';
export const BRAND_FONTS: readonly BrandFont[] = ['geist', 'inter', 'atkinson', 'plex'];

/** Família de cada fonte, como o CSS do @fontsource a declara (para as amostras da tela de identidade). */
export const FONT_FAMILY: Record<BrandFont, string> = {
  geist: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  inter: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  atkinson: '"Atkinson Hyperlegible Next Variable", ui-sans-serif, system-ui, sans-serif',
  plex: '"IBM Plex Sans Variable", ui-sans-serif, system-ui, sans-serif',
};

/**
 * A Geist vem no pacote principal; as outras só são baixadas quando escolhidas (import dinâmico do
 * CSS), para o carregamento inicial não crescer em quem usa o padrão.
 */
const loaders: Record<Exclude<BrandFont, 'geist'>, () => Promise<unknown>> = {
  inter: () => import('@fontsource-variable/inter/index.css'),
  atkinson: () => import('@fontsource-variable/atkinson-hyperlegible-next/index.css'),
  plex: () => import('@fontsource-variable/ibm-plex-sans/index.css'),
};

export const isBrandFont = (v: unknown): v is BrandFont => BRAND_FONTS.includes(v as BrandFont);

export function loadFont(font: BrandFont): Promise<unknown> {
  return font === 'geist' ? Promise.resolve() : loaders[font]().catch(() => undefined);
}

/** Aplica a fonte na interface inteira (`html[data-font]` troca os tokens; códigos seguem em Geist Mono). */
export function applyFont(font: BrandFont): void {
  void loadFont(font);
  const root = document.documentElement;
  if (font === 'geist') delete root.dataset.font;
  else root.dataset.font = font;
}

/** Começa a baixar a fonte que o script do index.html já marcou, antes de o React montar. */
export function bootFont(): void {
  const font = document.documentElement.dataset.font;
  if (isBrandFont(font)) void loadFont(font);
}

/** Aplica a fonte (a da pessoa, se a organização libera e ela escolheu; senão a da organização) e guarda. */
export function FontSync({ router }: { router: AnyRouter }) {
  const { data } = usePublicSettings();
  const own = useOwnAppearance(router);
  const font = own?.font ?? data?.font;
  useEffect(() => {
    if (!font || !isBrandFont(font)) return;
    applyFont(font);
    try {
      localStorage.setItem(FONT_KEY, font);
    } catch {
      // navegação privada ou armazenamento bloqueado: só perde o "não piscar"
    }
  }, [font]);
  return null;
}
