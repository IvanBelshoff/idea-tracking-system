import { describe, expect, it } from 'vitest';
import { parseRange, sniffViewable } from '../../src/ideas/media-view.js';

const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc(32)]);

describe('Ver foto e vídeo na tela: regras (M20, RN-147, CA-T.23)', () => {
  it('reconhece PNG, JPEG, GIF, WebP, MP4 e WebM pelo conteúdo', () => {
    expect(sniffViewable(pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))).toBe('image/png');
    expect(sniffViewable(pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0])))).toBe('image/jpeg');
    expect(sniffViewable(pad(Buffer.from('GIF89a')))).toBe('image/gif');
    expect(sniffViewable(pad(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')))).toBe('image/webp');
    expect(sniffViewable(pad(Buffer.from('\x00\x00\x00\x20ftypisom', 'latin1')))).toBe('video/mp4');
    expect(sniffViewable(pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))).toBe('video/webm');
  });

  it('CA-RN-147.4 HTML, SVG, PDF, QuickTime e arquivo curto não são exibidos (negativo)', () => {
    for (const bad of [
      '<html><script>alert(1)</script></html>',
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
      '<svg onload="alert(1)"></svg>',
      '%PDF-1.7 xxxxxxxxxxxxx',
      '\x00\x00\x00\x14ftypqt  xxxxxxxx',
      '\x00\x00\x00\x18ftypheic xxxxxxx',
    ]) {
      expect(sniffViewable(pad(Buffer.from(bad, 'latin1'))), bad.slice(0, 20)).toBeNull();
    }
    expect(sniffViewable(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('CA-RN-147.3 faixa: uma só, dentro do arquivo; fora → inválida', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
    for (const bad of ['bytes=1000-', 'bytes=500-100', 'bytes=0-1,5-9', 'bytes=-', 'items=0-1', 'bytes=-0', 'lixo']) {
      expect(parseRange(bad, 1000), bad).toBe('invalid');
    }
  });
});
