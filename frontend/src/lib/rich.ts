/**
 * Texto formatado (RN-136), lado da tela. O documento é o JSON do editor; o servidor é quem limpa e
 * deriva o texto puro, mas a tela também só desenha o que está na lista fixa (nós e marcas) e só abre
 * link com protocolo seguro. Espelho enxuto de `backend/src/common/rich-text.ts`.
 */
export type RichMark = { type: 'bold' } | { type: 'italic' } | { type: 'link'; attrs: { href: string } };
export type RichInline = { type: 'text'; text: string; marks?: RichMark[] } | { type: 'hardBreak' };
export interface RichParagraph {
  type: 'paragraph';
  content?: RichInline[];
}
export interface RichListItem {
  type: 'listItem';
  content: RichBlock[];
}
export type RichBlock =
  | RichParagraph
  | { type: 'bulletList' | 'orderedList'; content: RichListItem[] }
  | { type: 'blockquote'; content: RichBlock[] };
/** `type` (e não `interface`) para caber nos campos `object` da API gerada. */
export type RichDoc = {
  type: 'doc';
  content: RichBlock[];
};

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Só `http`, `https` e `mailto` viram link; qualquer outra coisa (`javascript:`, `data:`) é recusada. */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try {
    const url = new URL(raw.trim());
    return SAFE_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** O que a API devolve é `object`; aqui vira o tipo do documento, ou nulo se não for um. */
export function asRichDoc(value: unknown): RichDoc | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { type?: unknown; content?: unknown };
  return v.type === 'doc' && Array.isArray(v.content) ? (value as RichDoc) : null;
}

/** Texto puro antigo como documento: cada linha vira um parágrafo (igual ao servidor, CA-RN-136.4). */
export function plainToDoc(text: string): RichDoc {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return {
    type: 'doc',
    content: lines.map(
      (l): RichParagraph =>
        l === '' ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text: l }] },
    ),
  };
}

/** O documento a mostrar/editar: o formatado, se houver; senão o texto puro vira parágrafos. */
export function docOf(rich: unknown, plain: string | null | undefined): RichDoc | null {
  return asRichDoc(rich) ?? (plain ? plainToDoc(plain) : null);
}

function inlineText(nodes: readonly RichInline[] | undefined): string {
  return (nodes ?? []).map((n) => (n.type === 'hardBreak' ? '\n' : n.text)).join('');
}

function blockLines(block: RichBlock, indent: string): string[] {
  switch (block.type) {
    case 'paragraph':
      return inlineText(block.content)
        .split('\n')
        .map((l) => `${indent}${l}`);
    case 'blockquote':
      return block.content
        .flatMap((b) => blockLines(b, indent))
        .map((l) => (l.trim() ? `${indent}> ${l.slice(indent.length)}` : l));
    case 'bulletList':
    case 'orderedList':
      return block.content.flatMap((item, i) => {
        const marker = block.type === 'bulletList' ? '- ' : `${i + 1}. `;
        const lines = item.content.flatMap((b) => blockLines(b, `${indent}  `));
        return lines.map((l, k) => (k === 0 ? `${indent}${marker}${l.trimStart()}` : l));
      });
  }
}

/** A cópia em texto puro, igual à que o servidor grava (parágrafos, listas com marcador, citação com `>`). */
export function toPlainText(doc: RichDoc | null | undefined): string {
  if (!doc) return '';
  return doc.content
    .flatMap((b) => blockLines(b, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Sem texto nenhum (só parágrafos vazios): conta como vazio, para validar "obrigatório". */
export function isEmptyDoc(doc: RichDoc | null | undefined): boolean {
  return toPlainText(doc) === '';
}

/** O corpo que vai para a API: o documento e a sua cópia em texto puro (o servidor deriva de novo). */
export function richPayload(doc: RichDoc | null | undefined): { text: string; rich: RichDoc | null } {
  const text = toPlainText(doc);
  return { text, rich: text === '' ? null : (doc ?? null) };
}
