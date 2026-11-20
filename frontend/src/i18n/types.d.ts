import 'i18next';
import type { ptBR } from './pt-BR';

// Chaves de tradução tipadas: t('install.title') é conferido pelo compilador.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof ptBR };
  }
}
