'use client';

import { usePathname } from 'next/navigation';
import { isLang, type Lang, MESSAGES, type Messages } from '../i18n';

/** Idioma da página atual (primeiro trecho do caminho), para componentes usados dentro do MDX. */
export function useLang(): Lang {
  const first = (usePathname() ?? '/').split('/')[1];
  return isLang(first) ? first : 'pt-BR';
}

export function useMessages(): Messages {
  return MESSAGES[useLang()];
}
