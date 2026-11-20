'use client';

import { useEffect } from 'react';

/**
 * Favicon da organização (guardado pelo ITS em `its-favicon`). O script inline já o aplica antes
 * da primeira pintura, mas o Next recria o `<link rel="icon">` da página ao hidratar e ao navegar,
 * voltando ao ícone padrão. Aqui o ícone da organização é reaplicado sempre que isso acontecer.
 * Mesma regra de validação do script: só entra um SVG em URL `data:`.
 */
function storedFavicon(): string | null {
  try {
    const fav = localStorage.getItem('its-favicon');
    return fav?.startsWith('data:image/svg+xml,') ? fav : null;
  } catch {
    return null;
  }
}

function apply(fav: string): void {
  for (const icon of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')) {
    if (icon.getAttribute('href') !== fav) icon.setAttribute('href', fav);
  }
}

export function FaviconSync() {
  useEffect(() => {
    const fav = storedFavicon();
    if (!fav) return;
    apply(fav);
    const observer = new MutationObserver(() => apply(fav));
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    return () => observer.disconnect();
  }, []);
  return null;
}
