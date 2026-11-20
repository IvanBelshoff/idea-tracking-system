import { z } from 'zod';

/**
 * Tela de login (M23, RN-176 a RN-179): regras puras. A configuração é um objeto só, guardado na chave
 * `branding.login`, fora das configurações editáveis em bloco: só a API da tela de login grava, porque
 * confere os arquivos do fundo e audita os campos que mudaram.
 */
export const LOGIN_LAYOUTS = ['card', 'split', 'full', 'panel', 'band', 'minimal'] as const;
export const LOGIN_SIDES = ['left', 'right'] as const;
export const LOGIN_BACKGROUNDS = ['none', 'color', 'gradient', 'image', 'video'] as const;
export const LOGIN_OVERLAYS = ['black', 'white', 'brand'] as const;
export const LOGIN_MEDIA = ['image', 'poster', 'video'] as const;
/** Cor do título e do subtítulo sobre o fundo: automática ou escolhida (RN-177). */
export const LOGIN_TEXT_TONES = ['auto', 'light', 'dark'] as const;

export type LoginLayout = (typeof LOGIN_LAYOUTS)[number];
export type LoginSide = (typeof LOGIN_SIDES)[number];
export type LoginBackgroundType = (typeof LOGIN_BACKGROUNDS)[number];
export type LoginOverlay = (typeof LOGIN_OVERLAYS)[number];
export type LoginMediaKind = (typeof LOGIN_MEDIA)[number];
export type LoginTextTone = (typeof LOGIN_TEXT_TONES)[number];

/** Limites (RN-177 a RN-179). */
export const TITLE_MAX = 80;
export const SUBTITLE_MAX = 200;
export const OVERLAY_MAX = 90;
export const BLUR_MAX = 20;
/** Contraste mínimo do texto (WCAG AA, texto normal). */
export const TEXT_CONTRAST_MIN = 4.5;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
/** Largura máxima da imagem gravada (telas largas e de alta densidade). */
export const IMAGE_MAX_WIDTH = 2560;

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((v) => v.toLowerCase());
const pair = (max: number) =>
  z.object({
    ptBR: z.string().trim().max(max),
    en: z.string().trim().max(max),
  });
const percent = z.number().int().min(0).max(100);

export const LoginScreenSchema = z.object({
  layout: z.enum(LOGIN_LAYOUTS),
  side: z.enum(LOGIN_SIDES),
  background: z.object({
    type: z.enum(LOGIN_BACKGROUNDS),
    /** Nulo = a cor da marca (a primeira) ou a variante escura dela (a segunda, só no gradiente). */
    color1: hex.nullable(),
    color2: hex.nullable(),
    /** Ponto de foco da imagem, em % da largura e da altura: o que nunca é cortado. */
    focusX: percent,
    focusY: percent,
    overlayColor: z.enum(LOGIN_OVERLAYS),
    overlayOpacity: z.number().int().min(0).max(OVERLAY_MAX),
    blur: z.number().int().min(0).max(BLUR_MAX),
  }),
  title: pair(TITLE_MAX),
  subtitle: pair(SUBTITLE_MAX),
  textTone: z.enum(LOGIN_TEXT_TONES),
});

export type LoginScreenConfig = z.infer<typeof LoginScreenSchema>;

/** De fábrica: o cartão central de hoje, sem fundo nem textos (RN-176). */
export const LOGIN_DEFAULT: LoginScreenConfig = {
  layout: 'card',
  side: 'right',
  background: {
    type: 'none',
    color1: null,
    color2: null,
    focusX: 50,
    focusY: 50,
    overlayColor: 'black',
    overlayOpacity: 40,
    blur: 0,
  },
  title: { ptBR: '', en: '' },
  subtitle: { ptBR: '', en: '' },
  textTone: 'auto',
};

/** O que foi gravado, completado com o padrão (uma versão futura pode acrescentar campos). */
export function normalizeLogin(value: unknown): LoginScreenConfig {
  const v = (value ?? {}) as Partial<LoginScreenConfig>;
  const merged = {
    ...LOGIN_DEFAULT,
    ...v,
    background: { ...LOGIN_DEFAULT.background, ...(v.background ?? {}) },
    title: { ...LOGIN_DEFAULT.title, ...(v.title ?? {}) },
    subtitle: { ...LOGIN_DEFAULT.subtitle, ...(v.subtitle ?? {}) },
  };
  const parsed = LoginScreenSchema.safeParse(merged);
  return parsed.success ? parsed.data : LOGIN_DEFAULT;
}

/** Os campos que mudaram, em notação de ponto (vão para a auditoria, sem os valores; RN-180). */
export function changedFields(before: LoginScreenConfig, after: LoginScreenConfig): string[] {
  const out: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
      for (const key of Object.keys(b))
        walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
      return;
    }
    if (a !== b) out.push(path);
  };
  walk(before, after, '');
  return out;
}

/** Os arquivos que o fundo escolhido exige (RN-177 e RN-178): sem eles, salvar é recusado. */
export function requiredMedia(config: LoginScreenConfig): LoginMediaKind[] {
  if (config.background.type === 'image') return ['image'];
  if (config.background.type === 'video') return ['video', 'poster'];
  return [];
}

// --- Contraste (WCAG 2.x, sRGB) -------------------------------------------------------------

type Rgb = [number, number, number];

export function hexToRgb(value: string): Rgb {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A camada por cima de uma cor de fundo, misturada como o navegador faz (no espaço sRGB). */
function blend(overlay: Rgb, alpha: number, under: Rgb): Rgb {
  return overlay.map((o, i) => Math.round(o * alpha + (under[i] ?? 0) * (1 - alpha))) as Rgb;
}

const WHITE: Rgb = [255, 255, 255];
/** O texto escuro dos tokens do ITS (perto do --foreground claro). */
const INK: Rgb = [23, 23, 28];

/**
 * Onde o título fica, com que cor e se precisa de placa (RN-177). `plate` é a opacidade (0 a 1) de uma
 * placa atrás do texto (preta para o texto claro, branca para o escuro); nulo = sem placa.
 */
export type TextPlacement = { onBackground: boolean; tone: 'light' | 'dark'; plate: number | null };

/** Opacidade mínima da placa (abaixo disso ela some no visual, mesmo quando o contraste já passaria). */
export const PLATE_MIN = 0.35;

const BLACK: Rgb = [0, 0, 0];
const INKS = { light: WHITE, dark: INK } as const;
const PLATES = { light: BLACK, dark: WHITE } as const;

/** O pior contraste do texto contra todos os fundos possíveis. */
const worst = (ink: Rgb, backs: Rgb[]) => Math.min(...backs.map((b) => contrastRatio(ink, b)));

/** A menor placa que garante 4,5:1 contra todos os fundos (em passos de 5%). */
function plateFor(tone: 'light' | 'dark', backs: Rgb[]): number {
  for (let alpha = PLATE_MIN; alpha < 1; alpha = Math.round((alpha + 0.05) * 100) / 100) {
    if (
      worst(
        INKS[tone],
        backs.map((b) => blend(PLATES[tone], alpha, b)),
      ) >= TEXT_CONTRAST_MIN
    )
      return alpha;
  }
  return 0.95;
}

/**
 * Onde o título e o subtítulo ficam e com que cor (RN-177). Os fundos possíveis são as cores da cor ou do
 * gradiente; na foto e no vídeo, o PIOR caso: a camada sobre uma foto toda branca e toda preta.
 *
 * - Cor automática: o texto claro ou o escuro, o que der 4,5:1 sem placa; se nenhum der, o de melhor
 *   contraste, com a placa.
 * - Cor escolhida (clara ou escura): ela mesma, com a placa quando não der 4,5:1 sozinha.
 * - Sem fundo: o texto fica na superfície (como sempre).
 */
export function textPlacement(
  config: LoginScreenConfig,
  colors: { color1: string; color2: string; brand: string },
): TextPlacement {
  const { type, overlayOpacity, overlayColor } = config.background;
  if (type === 'none') return { onBackground: false, tone: 'dark', plate: null };
  let backs: Rgb[];
  if (type === 'color') backs = [hexToRgb(colors.color1)];
  else if (type === 'gradient') backs = [hexToRgb(colors.color1), hexToRgb(colors.color2)];
  else {
    const overlay = overlayColor === 'black' ? BLACK : overlayColor === 'white' ? WHITE : hexToRgb(colors.brand);
    const alpha = overlayOpacity / 100;
    backs = [blend(overlay, alpha, WHITE), blend(overlay, alpha, BLACK)];
  }
  const passes = (tone: 'light' | 'dark') => worst(INKS[tone], backs) >= TEXT_CONTRAST_MIN;
  const choice = config.textTone;
  if (choice !== 'auto') {
    return { onBackground: true, tone: choice, plate: passes(choice) ? null : plateFor(choice, backs) };
  }
  for (const tone of ['light', 'dark'] as const) {
    if (passes(tone)) return { onBackground: true, tone, plate: null };
  }
  const tone = worst(WHITE, backs) >= worst(INK, backs) ? 'light' : 'dark';
  return { onBackground: true, tone, plate: plateFor(tone, backs) };
}
