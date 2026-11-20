/**
 * Ver foto e vídeo na tela (RN-147), regras puras. O tipo vem do CONTEÚDO (os primeiros bytes), nunca do
 * nome nem do tipo gravado: um HTML ou SVG com nome de `.png` não é exibido (CA-T.23).
 */
export type ViewableMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'video/mp4' | 'video/webm';

/** Os tipos que a tela abre (pelo tipo gravado, que vem da extensão): só uma dica para a lista. */
export const VIEWABLE_MIMES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
];

const starts = (b: Buffer, bytes: number[], at = 0) => bytes.every((v, i) => b[at + i] === v);
const ascii = (b: Buffer, text: string, at: number) => b.subarray(at, at + text.length).toString('latin1') === text;

/** O tipo real pelo conteúdo, se for um dos que a tela abre; senão nulo (só baixar). */
export function sniffViewable(head: Buffer): ViewableMime | null {
  if (head.length < 12) return null;
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(head, 'GIF87a', 0) || ascii(head, 'GIF89a', 0)) return 'image/gif';
  if (ascii(head, 'RIFF', 0) && ascii(head, 'WEBP', 8)) return 'image/webp';
  if (starts(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  // MP4/ISO-BMFF: "ftyp" no byte 4, com uma marca de vídeo conhecida (não QuickTime nem HEIC).
  if (ascii(head, 'ftyp', 4)) {
    const brand = head.subarray(8, 12).toString('latin1');
    if (['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V '].includes(brand)) {
      return 'video/mp4';
    }
  }
  return null;
}

export type ByteRange = { start: number; end: number } | 'invalid' | null;

/**
 * Lê um cabeçalho `Range` de uma faixa só (`bytes=0-`, `bytes=100-199`, `bytes=-500`). Sem cabeçalho → nulo
 * (arquivo inteiro); fora do arquivo, várias faixas ou formato estranho → `invalid` (416).
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '') || size === 0) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return 'invalid';
  return { start, end };
}
