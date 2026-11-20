import { apiError } from './api-error.js';

/**
 * Texto formatado (M19, RN-136). O conteúdo é o JSON do editor (TipTap/ProseMirror) e a coluna de texto
 * que já existia vira a CÓPIA EM TEXTO PURO, gerada aqui no servidor: busca, ideias semelhantes, PDF,
 * exportação e a API de integração seguem lendo a coluna de sempre.
 *
 * "Sanitizar" é validar contra uma lista fixa de nós e marcas, sem interpretar HTML: parágrafo, quebra de
 * linha, listas, citação, negrito, itálico e link (`http`, `https` e `mailto`). O resto é descartado,
 * então nada do que alguém escreve vira código na tela (CA-RN-136.2).
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
export interface RichDoc {
  type: 'doc';
  content: RichBlock[];
}

const MAX_DEPTH = 6;
const MAX_NODES = 5000;
const MAX_TEXT_NODE = 20_000;
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** O endereço de um link só vale com protocolo da lista; qualquer outro (`javascript:`, `data:`) é recusado. */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try {
    const url = new URL(raw.trim());
    return SAFE_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

class Budget {
  nodes = 0;
  take(): boolean {
    this.nodes += 1;
    return this.nodes <= MAX_NODES;
  }
}

function cleanMarks(raw: unknown): RichMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const marks: RichMark[] = [];
  for (const m of raw) {
    if (!isObject(m)) continue;
    if (m.type === 'bold' && !marks.some((x) => x.type === 'bold')) marks.push({ type: 'bold' });
    else if (m.type === 'italic' && !marks.some((x) => x.type === 'italic')) marks.push({ type: 'italic' });
    else if (m.type === 'link' && isObject(m.attrs)) {
      const href = safeHref(m.attrs.href);
      if (href && !marks.some((x) => x.type === 'link')) marks.push({ type: 'link', attrs: { href } });
    }
  }
  return marks.length > 0 ? marks : undefined;
}

function cleanInline(node: unknown, budget: Budget): RichInline | null {
  if (!isObject(node) || !budget.take()) return null;
  if (node.type === 'hardBreak') return { type: 'hardBreak' };
  if (node.type === 'text' && typeof node.text === 'string' && node.text !== '') {
    const marks = cleanMarks(node.marks);
    return { type: 'text', text: node.text.slice(0, MAX_TEXT_NODE), ...(marks ? { marks } : {}) };
  }
  return null;
}

function cleanBlocks(raw: unknown, depth: number, budget: Budget): RichBlock[] {
  if (!Array.isArray(raw) || depth > MAX_DEPTH) return [];
  const out: RichBlock[] = [];
  for (const node of raw) {
    const block = cleanBlock(node, depth, budget);
    if (block) out.push(block);
  }
  return out;
}

function cleanBlock(node: unknown, depth: number, budget: Budget): RichBlock | null {
  if (!isObject(node) || !budget.take()) return null;
  switch (node.type) {
    case 'paragraph': {
      const content = (Array.isArray(node.content) ? node.content : [])
        .map((n) => cleanInline(n, budget))
        .filter((n): n is RichInline => n !== null);
      return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
    }
    case 'blockquote': {
      const content = cleanBlocks(node.content, depth + 1, budget);
      return content.length > 0 ? { type: 'blockquote', content } : null;
    }
    case 'bulletList':
    case 'orderedList': {
      const items: RichListItem[] = [];
      for (const raw of Array.isArray(node.content) ? node.content : []) {
        if (!isObject(raw) || raw.type !== 'listItem' || !budget.take()) continue;
        const content = cleanBlocks(raw.content, depth + 1, budget);
        if (content.length > 0) items.push({ type: 'listItem', content });
      }
      return items.length > 0 ? { type: node.type, content: items } : null;
    }
    default:
      return null;
  }
}

/** Limpa o documento: só a lista fixa fica. Algo que nem é um documento → 422. */
export function sanitizeRichDoc(input: unknown): RichDoc {
  if (!isObject(input) || input.type !== 'doc') {
    throw apiError(422, 'validation_failed', 'O texto formatado não é válido.', [
      { path: 'rich', code: 'invalid', message: 'Envie um documento do editor (type "doc").' },
    ]);
  }
  const content = cleanBlocks(input.content, 0, new Budget());
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
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

/** A cópia em texto puro: um parágrafo por linha, listas com marcador e citação com `>` (CA-RN-136.3). */
export function toPlainText(doc: RichDoc): string {
  return doc.content
    .flatMap((b) => blockLines(b, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Texto puro antigo (ou vindo da API de integração) como documento: cada linha vira um parágrafo (CA-RN-136.4). */
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

export interface RichValue {
  /** A cópia em texto puro (a coluna de sempre), ou nula se ficou vazio. */
  text: string | null;
  /** O documento, ou nulo quando o texto veio puro (API de integração, dados antigos). */
  rich: RichDoc | null;
}

/**
 * Resolve um campo que aceita texto puro OU documento (RN-136). Com o documento, ele é limpo e o texto
 * puro é DERIVADO dele (o texto que vier junto é ignorado); sem ele, vale o texto puro e não sobra
 * documento antigo. O limite de tamanho vale sobre o texto puro (CA-RN-136.5).
 */
export function resolveRich(plain: string | null | undefined, rich: unknown, max: number, path: string): RichValue {
  if (rich === undefined || rich === null) return { text: plain ? plain : null, rich: null };
  const doc = sanitizeRichDoc(rich);
  const text = toPlainText(doc);
  if (text.length > max) {
    throw apiError(422, 'validation_failed', 'Dados inválidos.', [
      { path, code: 'too_big', message: `O texto passa de ${max} caracteres.` },
    ]);
  }
  return text === '' ? { text: null, rich: null } : { text, rich: doc };
}

/**
 * Prepara o corpo de uma chamada da tela para o `zod` (RN-136): para cada campo `campo` que veio com
 * `campoRich` (o documento do editor), limpa o documento e DERIVA o texto puro em `campo` (o que vier em
 * `campo` é ignorado); o documento limpo fica em `campoRich`. Quem não manda `campoRich` segue só com o texto
 * puro. Documento que não é um documento → 422. Os limites de tamanho e a obrigatoriedade continuam nos
 * esquemas, que agora olham o texto puro derivado.
 */
export function normalizeRich(body: unknown, fields: readonly string[]): unknown {
  if (!isObject(body)) return body;
  const out: Record<string, unknown> = { ...body };
  for (const field of fields) {
    const key = `${field}Rich`;
    const raw = body[key];
    if (raw === undefined || raw === null) {
      delete out[key];
      continue;
    }
    const doc = sanitizeRichDoc(raw);
    const text = toPlainText(doc);
    out[field] = text;
    out[key] = text === '' ? null : doc;
  }
  return out;
}

/** O que se grava na coluna do documento quando o texto puro muda: o documento novo, ou nulo (texto puro). */
export const richOrNull = (doc: RichDoc | null | undefined): RichDoc | null => doc ?? null;
