/**
 * Tela de login (M23, RN-176 a RN-179): funções puras, sem React, para os testes do Node. Quem desenha é
 * app/auth/access-layout.tsx.
 */
export type LoginLayout = 'card' | 'split' | 'full' | 'panel' | 'band' | 'minimal';
export type LoginBackgroundType = 'none' | 'color' | 'gradient' | 'image' | 'video';

export type LoginBackground = {
  type: LoginBackgroundType;
  color1: string;
  color2: string;
  focusX: number;
  focusY: number;
  overlayColor: 'black' | 'white' | 'brand';
  overlayOpacity: number;
  blur: number;
  imageVersion: string | null;
  posterVersion: string | null;
  videoVersion: string | null;
};

/** O texto no idioma da tela; sem a versão em inglês, vale a em português (RN-179). */
export function pickText(pair: { ptBR: string; en: string } | undefined, language: string): string {
  if (!pair) return '';
  return language.toLowerCase().startsWith('en') && pair.en.trim() ? pair.en : pair.ptBR;
}

/**
 * O vídeo só toca quando nada pede o contrário (RN-178): quem pede menos movimento, quem pede economia
 * de dados e a tela estreita veem a capa, e o vídeo nem é baixado.
 */
export function videoAllowed(env: { reducedMotion: boolean; saveData: boolean; narrow: boolean }): boolean {
  return !env.reducedMotion && !env.saveData && !env.narrow;
}

/** Os layouts que mostram o fundo: o cartão central (o de hoje) e o minimalista ficam na superfície. */
export function showsBackground(layout: LoginLayout): boolean {
  return layout !== 'card' && layout !== 'minimal';
}

export const mediaUrl = (kind: 'image' | 'poster' | 'video', version: string | null) =>
  version ? `/api/branding/login/media/${kind}?v=${encodeURIComponent(version)}` : null;

/** A cor de fundo da cor sólida ou do gradiente (o resto é imagem ou vídeo). */
export function fillStyle(bg: LoginBackground): string | null {
  if (bg.type === 'color') return bg.color1;
  if (bg.type === 'gradient') return `linear-gradient(135deg, ${bg.color1}, ${bg.color2})`;
  return null;
}

/** A camada sobre a imagem ou o vídeo: cor e opacidade (RN-177). */
export function overlayStyle(bg: LoginBackground, brand: string): { background: string; opacity: number } | null {
  if (bg.type !== 'image' && bg.type !== 'video') return null;
  if (bg.overlayOpacity <= 0) return null;
  const color = bg.overlayColor === 'black' ? '#000000' : bg.overlayColor === 'white' ? '#ffffff' : brand;
  return { background: color, opacity: bg.overlayOpacity / 100 };
}

/** O ponto de foco da imagem, para o recorte nunca tirar o que importa (RN-177). */
export const focusPosition = (bg: LoginBackground) => `${bg.focusX}% ${bg.focusY}%`;

type Pair = { ptBR: string; en: string };

/** Textos prontos (RN-179), já traduzidos: escolher um preenche os campos, que continuam editáveis. */
export const LOGIN_TEXT_PRESETS: readonly { title: Pair; subtitle: Pair }[] = [
  {
    title: { ptBR: 'Melhoria contínua começa com uma ideia', en: 'Continuous improvement starts with an idea' },
    subtitle: {
      ptBR: 'Envie, acompanhe e veja suas ideias acontecerem.',
      en: 'Submit, follow and watch your ideas come to life.',
    },
  },
  {
    title: { ptBR: 'Sua ideia faz a diferença', en: 'Your idea makes a difference' },
    subtitle: {
      ptBR: 'Cada melhoria começa com alguém que viu um jeito melhor.',
      en: 'Every improvement starts with someone who saw a better way.',
    },
  },
  {
    title: { ptBR: 'Pequenas melhorias, grandes resultados', en: 'Small improvements, big results' },
    subtitle: { ptBR: 'Juntos, melhoramos um pouco todos os dias.', en: 'Together, we get a little better every day.' },
  },
  {
    title: { ptBR: 'Bem-vindo de volta', en: 'Welcome back' },
    subtitle: { ptBR: 'Entre para acompanhar as ideias da sua equipe.', en: "Sign in to follow your team's ideas." },
  },
  {
    title: { ptBR: 'Quem faz, melhora', en: 'Those who do, improve' },
    subtitle: {
      ptBR: 'Ninguém conhece o trabalho melhor do que quem o faz.',
      en: 'Nobody knows the work better than the people who do it.',
    },
  },
  {
    title: { ptBR: 'Ideias que viram resultado', en: 'Ideas that become results' },
    subtitle: {
      ptBR: 'Da sugestão à implementação, tudo num só lugar.',
      en: 'From suggestion to implementation, all in one place.',
    },
  },
];

/** O tradutor que vem no navegador (Chrome e Edge recentes), se houver: a tradução roda no aparelho. */
type BrowserTranslator = {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<{ translate(text: string): Promise<string> }>;
};

export function browserTranslator(scope: unknown = globalThis): BrowserTranslator | null {
  const candidate = (scope as { Translator?: unknown }).Translator as BrowserTranslator | undefined;
  return candidate && typeof candidate.create === 'function' && typeof candidate.availability === 'function'
    ? candidate
    : null;
}

/** "Sugerir tradução" só aparece quando o navegador traduz de português para inglês (RN-179). */
export async function canSuggestTranslation(scope: unknown = globalThis): Promise<boolean> {
  const api = browserTranslator(scope);
  if (!api) return false;
  try {
    return (await api.availability({ sourceLanguage: 'pt', targetLanguage: 'en' })) !== 'unavailable';
  } catch {
    return false;
  }
}

export async function suggestTranslation(text: string, scope: unknown = globalThis): Promise<string> {
  const api = browserTranslator(scope);
  if (!api || !text.trim()) return '';
  const translator = await api.create({ sourceLanguage: 'pt', targetLanguage: 'en' });
  return translator.translate(text);
}
