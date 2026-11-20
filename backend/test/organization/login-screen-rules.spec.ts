import { describe, expect, it } from 'vitest';
import {
  changedFields,
  contrastRatio,
  hexToRgb,
  LOGIN_DEFAULT,
  type LoginScreenConfig,
  LoginScreenSchema,
  normalizeLogin,
  requiredMedia,
  textPlacement,
} from '../../src/organization/login-screen-rules.js';

const with_ = (bg: Partial<LoginScreenConfig['background']>): LoginScreenConfig => ({
  ...LOGIN_DEFAULT,
  background: { ...LOGIN_DEFAULT.background, ...bg },
});
const colors = { color1: '#5458c8', color2: '#2a2c6b', brand: '#5458c8' };

describe('Tela de login: regras (M23)', () => {
  it('CA-RN-176.1 o padrão de fábrica é o cartão central sem fundo nem textos', () => {
    expect(LOGIN_DEFAULT.layout).toBe('card');
    expect(LOGIN_DEFAULT.background.type).toBe('none');
    expect(LOGIN_DEFAULT.title).toEqual({ ptBR: '', en: '' });
    expect(normalizeLogin(undefined)).toEqual(LOGIN_DEFAULT);
    expect(normalizeLogin({ layout: 'inventado' })).toEqual(LOGIN_DEFAULT);
  });

  it('CA-RN-176.2 CA-RN-177.2 CA-RN-179.1 só os valores e limites da regra passam', () => {
    const ok = LoginScreenSchema.safeParse(LOGIN_DEFAULT);
    expect(ok.success).toBe(true);
    const bad = [
      { ...LOGIN_DEFAULT, layout: 'carousel' },
      { ...LOGIN_DEFAULT, side: 'top' },
      with_({ overlayOpacity: 91 }),
      with_({ blur: 21 }),
      with_({ focusX: 101 }),
      with_({ color1: 'red' }),
      { ...LOGIN_DEFAULT, title: { ptBR: 'x'.repeat(81), en: '' } },
      { ...LOGIN_DEFAULT, subtitle: { ptBR: '', en: 'y'.repeat(201) } },
    ];
    for (const value of bad) expect(LoginScreenSchema.safeParse(value).success).toBe(false);
  });

  it('a cor em hex é guardada em minúsculas e os textos sem espaço nas pontas', () => {
    const parsed = LoginScreenSchema.parse({
      ...with_({ type: 'color', color1: '#0B6E4F' }),
      title: { ptBR: '  Olá  ', en: '' },
    });
    expect(parsed.background.color1).toBe('#0b6e4f');
    expect(parsed.title.ptBR).toBe('Olá');
  });

  it('os campos que mudaram saem em notação de ponto, sem os valores', () => {
    const after = { ...with_({ type: 'gradient', blur: 4 }), title: { ptBR: 'Oi', en: '' } };
    expect(changedFields(LOGIN_DEFAULT, after)).toEqual(['background.type', 'background.blur', 'title.ptBR']);
    expect(changedFields(LOGIN_DEFAULT, LOGIN_DEFAULT)).toEqual([]);
  });

  it('CA-RN-178.1 o fundo de imagem exige a imagem; o de vídeo, o vídeo e a capa', () => {
    expect(requiredMedia(with_({ type: 'image' }))).toEqual(['image']);
    expect(requiredMedia(with_({ type: 'video' }))).toEqual(['video', 'poster']);
    expect(requiredMedia(with_({ type: 'gradient' }))).toEqual([]);
  });

  const blend = (o: [number, number, number], a: number, u: [number, number, number]) =>
    o.map((c, i) => Math.round(c * a + (u[i] ?? 0) * (1 - a))) as [number, number, number];
  const WHITE: [number, number, number] = [255, 255, 255];
  const BLACK: [number, number, number] = [0, 0, 0];
  const INK: [number, number, number] = [23, 23, 28];

  it('CA-RN-177.3 sem fundo, o texto fica na superfície, sem placa', () => {
    expect(textPlacement(LOGIN_DEFAULT, colors)).toEqual({ onBackground: false, tone: 'dark', plate: null });
  });

  it('CA-RN-177.3 cor automática: o texto que passa de 4,5:1 nas duas pontas do gradiente, sem placa', () => {
    expect(textPlacement(with_({ type: 'gradient' }), colors)).toEqual({
      onBackground: true,
      tone: 'light',
      plate: null,
    });
    for (const c of [colors.color1, colors.color2]) {
      expect(contrastRatio(WHITE, hexToRgb(c))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('CA-RN-177.3 gradiente azul → amarelo: nenhum texto passa sozinho, então ganha a placa que garante 4,5:1', () => {
    const blueYellow = { ...colors, color1: '#0b4f8a', color2: '#ffbb00' };
    const placed = textPlacement(with_({ type: 'gradient' }), blueYellow);
    expect(placed.onBackground).toBe(true);
    expect(placed.plate).not.toBeNull();
    const plate = placed.tone === 'light' ? BLACK : WHITE;
    const ink = placed.tone === 'light' ? WHITE : INK;
    for (const c of [blueYellow.color1, blueYellow.color2]) {
      expect(contrastRatio(ink, blend(plate, placed.plate ?? 0, hexToRgb(c)))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('CA-RN-177.3 cor escolhida: vale ela mesma; sem contraste, ganha a placa', () => {
    const light = textPlacement(
      { ...with_({ type: 'color', color1: '#ffffff' }), textTone: 'light' },
      { ...colors, color1: '#ffffff' },
    );
    expect(light.tone).toBe('light');
    expect(light.plate).not.toBeNull();
    expect(contrastRatio(WHITE, blend(BLACK, light.plate ?? 0, WHITE))).toBeGreaterThanOrEqual(4.5);
    const dark = textPlacement(
      { ...with_({ type: 'color', color1: '#ffffff' }), textTone: 'dark' },
      { ...colors, color1: '#ffffff' },
    );
    expect(dark).toEqual({ onBackground: true, tone: 'dark', plate: null });
  });

  it('CA-RN-177.3 foto: a camada preta de 50% dá só 3,95:1 no pior caso, então o texto claro ganha a placa; 55% passa sozinho', () => {
    const half = textPlacement(with_({ type: 'image', overlayOpacity: 50 }), colors);
    expect(half.tone).toBe('light');
    expect(half.plate).not.toBeNull();
    expect(textPlacement(with_({ type: 'image', overlayOpacity: 55 }), colors)).toEqual({
      onBackground: true,
      tone: 'light',
      plate: null,
    });
  });

  it('CA-RN-177.3 foto sem camada: a placa garante o texto até sobre uma foto toda branca e toda preta', () => {
    const placed = textPlacement(with_({ type: 'video', overlayOpacity: 0 }), colors);
    expect(placed.plate).not.toBeNull();
    const plate = placed.tone === 'light' ? BLACK : WHITE;
    const ink = placed.tone === 'light' ? WHITE : INK;
    for (const under of [WHITE, BLACK]) {
      expect(contrastRatio(ink, blend(plate, placed.plate ?? 0, under))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
