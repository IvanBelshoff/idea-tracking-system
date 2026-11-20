import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { ptBR } from './pt-BR';

export const LANGUAGES = ['pt-BR', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = 'its-lang';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Último idioma usado neste navegador; senão o idioma do navegador; senão pt-BR. */
function savedLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isLanguage(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Este navegador já tem um idioma escolhido (pela pessoa ou pela conta dela). */
export const hasSavedLanguage = (): boolean => savedLanguage() !== null;

/**
 * O idioma de quem abre o ITS: o escolhido neste navegador; sem ele, o padrão da organização, que chega
 * com as configurações públicas (LanguageSync). Até lá, português, o padrão da instalação.
 */
function initialLanguage(): Language {
  return savedLanguage() ?? 'pt-BR';
}

void i18n.use(initReactI18next).init({
  resources: { 'pt-BR': { translation: ptBR }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: 'pt-BR',
  // React já escapa o texto; o i18next não deve escapar de novo (evita "&amp;" na tela).
  interpolation: { escapeValue: false },
  returnNull: false,
});
document.documentElement.lang = i18n.language;

/**
 * Troca o idioma da interface e guarda neste navegador (vale antes do login).
 * Com sessão, quem guarda de verdade é a conta (useUpdatePreferences).
 */
/** Troca o idioma da tela. Com `remember` (padrão), a escolha fica neste navegador. */
export function applyLanguage(lng: Language, remember = true): void {
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, lng);
    } catch {
      // Sem armazenamento (navegação privada): vale só nesta visita.
    }
  }
  if (i18n.language !== lng) void i18n.changeLanguage(lng);
  document.documentElement.lang = lng;
}

export { i18n };
