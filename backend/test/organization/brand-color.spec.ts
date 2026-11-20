import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  contrast,
  darkOk,
  deriveBrand,
  hexToOklch,
  ITS_BRAND,
  isHexColor,
  lightOk,
  oklchToHex,
} from '../../src/organization/brand-color.js';

const parse = (s: string) => {
  const [L, C, H] = (s.match(/oklch\(([^)]*)\)/)?.[1] ?? '').split(/\s+/).map(Number) as [number, number, number];
  return { L, C, H };
};

describe('Cor da marca: derivação com contraste garantido (identidade visual)', () => {
  it('conversões: hex → OKLCH → hex volta ao mesmo valor', () => {
    for (const hex of ['#5458c8', '#0b6e4f', '#ffd400', '#000000', '#ffffff', '#ff0000', '#dddddd']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
    expect(isHexColor('#0B6E4F')).toBe(true);
    expect(isHexColor('0B6E4F')).toBe(false);
    expect(isHexColor('#0B6E4')).toBe(false);
    expect(isHexColor('red')).toBe(false);
  });

  it('sem cor escolhida, vale o índigo do ITS (tokens.css), sem ajuste', () => {
    expect(deriveBrand(null)).toEqual(ITS_BRAND);
  });

  it('cores difíceis sempre saem legíveis nos dois temas (texto 4,5:1; foco 3:1)', () => {
    for (const hex of ['#ffd400', '#dddddd', '#000000', '#ff0000', '#5458c8', '#0b6e4f', '#00a3e0', '#ffffff']) {
      const d = deriveBrand(hex);
      expect(lightOk(parse(d.light.brand)), `${hex} claro ${d.light.brand}`).toBe(true);
      expect(darkOk(parse(d.dark.brand)), `${hex} escuro ${d.dark.brand}`).toBe(true);
      expect(contrast(parse(d.light.brandFg), parse(d.light.brand))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parse(d.dark.brandFg), parse(d.dark.brand))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('cor já legível fica como está; cor clara demais (amarelo) é escurecida e avisa', () => {
    const green = deriveBrand('#0b6e4f');
    expect(green.adjusted.light).toBe(false);
    expect(green.lightHex).toBe('#0b6e4f');
    const yellow = deriveBrand('#ffd400');
    expect(yellow.adjusted.light).toBe(true);
    expect(parse(yellow.light.brand).L).toBeLessThan(hexToOklch('#ffd400').L);
    // O matiz é preservado (continua sendo "o amarelo da empresa", mais escuro).
    expect(Math.abs(parse(yellow.light.brand).H - hexToOklch('#ffd400').H)).toBeLessThan(2);
  });

  it('o tom do escuro é derivado; um ajuste manual ilegível é corrigido e avisa', () => {
    expect(deriveBrand('#0b6e4f').adjusted.dark).toBe(false); // derivado não "ajusta" nada escolhido
    const bad = deriveBrand('#0b6e4f', '#0b3020'); // escuro demais sobre o fundo escuro
    expect(bad.adjusted.dark).toBe(true);
    expect(darkOk(parse(bad.dark.brand))).toBe(true);
    const good = deriveBrand('#0b6e4f', '#5fd3a3');
    expect(good.adjusted.dark).toBe(false);
  });

  it('as amostras do check-contrast do frontend estão em dia com esta regra', () => {
    const file = new URL('../../../frontend/scripts/brand-samples.json', import.meta.url);
    const { samples } = JSON.parse(readFileSync(file, 'utf8')) as {
      samples: { hex: string; light: unknown; dark: unknown }[];
    };
    expect(samples.length).toBeGreaterThanOrEqual(3);
    for (const s of samples) {
      const d = deriveBrand(s.hex);
      // Se falhar: a regra mudou; gere de novo frontend/scripts/brand-samples.json (ver o comentário nele).
      expect({ light: s.light, dark: s.dark }, s.hex).toEqual({ light: d.light, dark: d.dark });
    }
  });
});
