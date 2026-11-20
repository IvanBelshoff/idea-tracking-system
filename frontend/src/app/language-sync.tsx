import { useEffect } from 'react';
import { applyLanguage, hasSavedLanguage, isLanguage } from '@/i18n';
import { usePublicSettings } from './session';

/**
 * O idioma padrão da organização (`organization.default_locale`) vale para quem ainda não escolheu um
 * neste navegador: as telas sem login abrem nele. A escolha da pessoa (ou da conta dela, ao entrar)
 * sempre vence, e o padrão não fica gravado, para uma mudança nas configurações chegar a todos.
 */
export function LanguageSync() {
  const { data } = usePublicSettings();
  const defaultLocale = data?.defaultLocale;
  useEffect(() => {
    if (isLanguage(defaultLocale) && !hasSavedLanguage()) applyLanguage(defaultLocale, false);
  }, [defaultLocale]);
  return null;
}
