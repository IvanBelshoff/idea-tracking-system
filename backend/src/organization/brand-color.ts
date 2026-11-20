/**
 * Cor da marca da organização (identidade visual): o administrador escolhe UMA cor; daqui saem as
 * variantes do tema claro e do escuro, sempre com contraste legível (WCAG). Regras puras.
 *
 * Os fundos abaixo espelham `frontend/src/tokens.css` (manter em sincronia): se o fundo ou o cartão
 * mudarem lá, mudam aqui, e os testes de contraste mostram o efeito.
 */

export interface Oklch {
  L: number;
  C: number;
  H: number;
}

export interface BrandPair {
  /** Cor da marca (botões, links, foco, item ativo do menu), em `oklch(...)`. */
  brand: string;
  /** Texto sobre a cor da marca (botão primário). */
  brandFg: string;
  /** Fundo do item ativo do menu: neutro com um toque do matiz da marca. */
  shellActive: string;
  /** Texto do item ativo do menu. */
  shellActiveFg: string;
}

export interface DerivedBrand {
  light: BrandPair;
  dark: BrandPair;
  /** Hex da variante clara (PDF, `theme-color`). */
  lightHex: string;
  /** O tom foi corrigido para manter a leitura (a tela avisa). */
  adjusted: { light: boolean; dark: boolean };
}

/** Índigo do ITS (tokens.css): o padrão quando a organização não escolheu cor. */
export const ITS_BRAND: DerivedBrand = {
  light: {
    brand: 'oklch(0.52 0.17 277)',
    brandFg: 'oklch(0.99 0 0)',
    shellActive: 'oklch(0.925 0.012 277)',
    shellActiveFg: 'oklch(0.2 0.03 277)',
  },
  dark: {
    brand: 'oklch(0.74 0.13 277)',
    brandFg: 'oklch(0.18 0.03 277)',
    shellActive: 'oklch(0.26 0.03 277)',
    shellActiveFg: 'oklch(0.97 0.01 277)',
  },
  lightHex: '#5458c8',
  adjusted: { light: false, dark: false },
};

const LIGHT = { background: { L: 0.99, C: 0.002, H: 270 }, card: { L: 1, C: 0, H: 0 }, fg: { L: 0.99, C: 0, H: 0 } };
const DARK = { background: { L: 0.165, C: 0.008, H: 270 }, card: { L: 0.2, C: 0.01, H: 270 } };

/** Mínimos (os mesmos do `check-contrast`): texto 4,5:1; foco e ícones sobre o fundo 3:1. */
const TEXT = 4.5;
const UI = 3;

// --- conversões -----------------------------------------------------------------------------------

const dec = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

/** `#RRGGBB` → OKLCH. */
export function hexToOklch(hex: string): Oklch {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => dec(x / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { L, C, H };
}

/** OKLCH → sRGB linear (sem cortar: fora de [0, 1] quer dizer fora da gama). */
function toLinear({ L, C, H }: Oklch): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (c: Oklch) => toLinear(c).every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** Reduz o croma até a cor existir no sRGB (mantém claridade e matiz). */
export function toGamut(c: Oklch): Oklch {
  if (inGamut(c)) return c;
  let lo = 0;
  let hi = c.C;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (inGamut({ ...c, C: mid })) lo = mid;
    else hi = mid;
  }
  return { ...c, C: lo };
}

export function oklchToHex(c: Oklch): string {
  return `#${toLinear(toGamut(c))
    .map((v) => Math.round(enc(Math.min(1, Math.max(0, v))) * 255))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function css(c: Oklch): string {
  const r = (v: number, d: number) => Number(v.toFixed(d));
  return `oklch(${r(c.L, 3)} ${r(c.C, 3)} ${r(c.H, 1)})`;
}

const luminance = (c: Oklch) => {
  const [r, g, b] = toLinear(toGamut(c)).map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Razão de contraste WCAG entre duas cores. */
export function contrast(a: Oklch, b: Oklch): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

// --- derivação ------------------------------------------------------------------------------------

/** Tema claro: texto branco no botão, link legível no cartão, foco visível no fundo. */
export function lightOk(c: Oklch): boolean {
  return contrast(LIGHT.fg, c) >= TEXT && contrast(c, LIGHT.card) >= TEXT && contrast(c, LIGHT.background) >= UI;
}

const darkFg = (c: Oklch): Oklch => ({ L: 0.18, C: Math.min(0.03, c.C), H: c.H });

/** Tema escuro: link legível no cartão escuro, foco visível, texto escuro no botão. */
export function darkOk(c: Oklch): boolean {
  return contrast(c, DARK.card) >= TEXT && contrast(c, DARK.background) >= UI && contrast(darkFg(c), c) >= TEXT;
}

/** Escurece (claro) ou clareia (escuro) só o necessário, mantendo o matiz. */
function search(start: Oklch, ok: (c: Oklch) => boolean, direction: -1 | 1): Oklch {
  let c = toGamut(start);
  const limit = direction < 0 ? 0 : 0.97;
  for (let i = 0; i < 300 && !ok(c); i += 1) {
    const L = Math.min(0.97, Math.max(0, c.L + direction * 0.005));
    c = toGamut({ ...start, L });
    // Para só no limite da direção da busca (ex.: escurecer o branco começa em L = 1 e desce).
    if (L === limit) break;
  }
  return c;
}

const moved = (a: Oklch, b: Oklch) => Math.abs(a.L - b.L) > 0.01 || Math.abs(a.C - b.C) > 0.01;

/**
 * Deriva as duas variantes a partir de uma cor (e, opcional, do tom escolhido para o escuro).
 * Sem cor, devolve o índigo do ITS. Cor ou ajuste que não passem no contraste são corrigidos e
 * marcados em `adjusted`.
 */
export function deriveBrand(hex: string | null, darkHex: string | null = null): DerivedBrand {
  if (!hex) return ITS_BRAND;
  const base = hexToOklch(hex);
  const light = search(base, lightOk, -1);
  // Escuro: do ajuste escolhido, ou do mesmo matiz com croma um pouco menor e claridade de partida
  // parecida com a do índigo do ITS no escuro.
  const darkStart = darkHex ? hexToOklch(darkHex) : { L: Math.max(base.L, 0.7), C: base.C * 0.8, H: base.H };
  const dark = search(darkStart, darkOk, 1);
  // Item ativo do menu: as mesmas claridades e cromas do tokens.css, no matiz da marca. Marca sem
  // matiz (preto, cinza) deixa esse fundo neutro.
  const tint = (L: number, C: number) => css({ L, C: base.C < 0.02 ? 0 : C, H: base.C < 0.02 ? 0 : base.H });
  return {
    light: {
      brand: css(light),
      brandFg: css(LIGHT.fg),
      shellActive: tint(0.925, 0.012),
      shellActiveFg: tint(0.2, 0.03),
    },
    dark: {
      brand: css(dark),
      brandFg: css(darkFg(dark)),
      shellActive: tint(0.26, 0.03),
      shellActiveFg: tint(0.97, 0.01),
    },
    lightHex: oklchToHex(light),
    adjusted: { light: moved(base, light), dark: darkHex !== null && moved(hexToOklch(darkHex), dark) },
  };
}
