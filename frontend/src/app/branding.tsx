import { useQuery } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { useEffect, useSyncExternalStore } from 'react';
import type { components } from '@/api/schema';
import { ITS_FAVICON_HEX, itsFaviconUrl } from '@/components/brand/its-favicon';
import { meQuery, usePublicSettings } from './session';

export type Branding = components['schemas']['BrandingView'];
type Me = components['schemas']['MeResponse'];

/** Chave do último tema de marca, lida pelo script do index.html antes do React (sem piscar). */
export const BRANDING_KEY = 'its-branding';
/** Favicon na cor da organização (URL `data:`), também reaplicado pelo script do index.html. */
export const FAVICON_KEY = 'its-favicon';

/** Só aceita o formato que o backend gera; nada além disso vai para dentro de uma folha de estilo. */
const SAFE = /^oklch\([0-9. ]+\)$/;
const safe = (b: Branding) =>
  [b.light, b.dark].every((p) => [p.brand, p.brandFg, p.shellActive, p.shellActiveFg].every((v) => SAFE.test(v)));

/**
 * CSS da cor da marca nos dois temas. `html:root` vence o `:root`/`.dark` do tokens.css sem
 * depender da ordem em que as folhas de estilo entram no documento.
 */
const vars = (p: Branding['light']) =>
  `--brand:${p.brand};--brand-fg:${p.brandFg};--shell-active:${p.shellActive};--shell-active-foreground:${p.shellActiveFg}`;

export function brandingCss(b: Branding): string {
  return `html:root{${vars(b.light)}}` + `html:root.dark{${vars(b.dark)}}`;
}

export function applyBranding(b: Branding): void {
  if (!safe(b)) return;
  let el = document.getElementById('org-brand');
  if (!el) {
    el = document.createElement('style');
    el.id = 'org-brand';
    document.head.appendChild(el);
  }
  el.textContent = brandingCss(b);
  if (!/^#[0-9a-f]{6}$/i.test(b.lightHex)) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = b.lightHex;
  // O favicon segue a cor da marca (o símbolo é sempre o do ITS); no padrão, o arquivo estático.
  const custom = b.lightHex.toLowerCase() !== ITS_FAVICON_HEX;
  const href = custom ? itsFaviconUrl(b.lightHex) : '/favicon.svg';
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon && icon.getAttribute('href') !== href) icon.setAttribute('href', href);
  try {
    if (custom) localStorage.setItem(FAVICON_KEY, href);
    else localStorage.removeItem(FAVICON_KEY);
  } catch {
    // navegação privada ou armazenamento bloqueado: o favicon só demora um instante a mudar
  }
}

/** Telas públicas (entrada, consulta, nova senha): sempre com a identidade da organização (RN-145). */
const PUBLIC_PATHS = /^\/(entrar|definir-senha|consulta|esqueci-senha|instalar)(\/|$)/;

function usePathname(router: AnyRouter): string {
  return useSyncExternalStore(
    (notify) => router.subscribe('onResolved', notify),
    () => router.state.location.pathname,
  );
}

/**
 * A cor e a fonte escolhidas pela pessoa (RN-145), quando a organização libera; nulo nas telas públicas
 * e para quem não escolheu.
 */
export function useOwnAppearance(router: AnyRouter): Me['appearance'] | null {
  const pathname = usePathname(router);
  const { data: me } = useQuery(meQuery);
  if (PUBLIC_PATHS.test(pathname) || !me?.appearance.allowed) return null;
  return me.appearance;
}

/**
 * Aplica a cor da marca (a da pessoa, se ela escolheu e a organização libera; senão a da organização) e
 * guarda para a próxima abertura: o script do index.html reaplica antes do React, para não piscar.
 */
export function BrandingSync({ router }: { router: AnyRouter }) {
  const { data } = usePublicSettings();
  const own = useOwnAppearance(router);
  const branding = own?.branding ?? data?.branding;
  useEffect(() => {
    if (!branding) return;
    applyBranding(branding);
    try {
      localStorage.setItem(BRANDING_KEY, JSON.stringify(branding));
    } catch {
      // navegação privada ou armazenamento bloqueado: só perde o "não piscar"
    }
  }, [branding]);
  return null;
}
