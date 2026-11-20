import { describe, expect, it } from 'vitest';
import {
  plainToDoc,
  type RichDoc,
  resolveRich,
  safeHref,
  sanitizeRichDoc,
  toPlainText,
} from '../../src/common/rich-text.js';

const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('Texto formatado (M19, RN-136)', () => {
  it('CA-RN-136.2 só a lista fixa fica: script, estilo, evento, imagem e protocolo perigoso saem (negativo)', () => {
    const hostile = doc(
      p(t('Olá '), t('negrito', [{ type: 'bold' }]), t(' e '), t('itálico', [{ type: 'italic' }])),
      { type: 'script', content: [t('alert(1)')] },
      { type: 'image', attrs: { src: 'x', onerror: 'alert(1)' } },
      p(
        t('link ruim', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
        t(' link bom', [
          { type: 'link', attrs: { href: 'https://exemplo.com/a?b=1', onclick: 'x()', target: '_blank' } },
        ]),
        t(' e-mail', [{ type: 'link', attrs: { href: 'mailto:a@b.co' } }]),
        t(' dados', [{ type: 'link', attrs: { href: 'data:text/html,<script>1</script>' } }]),
      ),
      { type: 'paragraph', attrs: { style: 'color:red' }, content: [{ type: 'iframe', src: 'x' }, t('só texto')] },
    );
    const out = JSON.stringify(sanitizeRichDoc(hostile));
    for (const bad of [
      'script',
      'alert',
      'image',
      'onerror',
      'onclick',
      'javascript',
      'data:',
      'iframe',
      'style',
      'target',
    ]) {
      expect(out, bad).not.toContain(bad);
    }
    for (const good of ['bold', 'italic', 'https://exemplo.com/a?b=1', 'mailto:a@b.co', 'só texto']) {
      expect(out, good).toContain(good);
    }
  });

  it('safeHref aceita http, https e mailto, e recusa o resto', () => {
    expect(safeHref('https://a.com/x')).toBe('https://a.com/x');
    expect(safeHref('http://a.com')).toBe('http://a.com/');
    expect(safeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:1',
      'data:text/html,x',
      'file:///etc/passwd',
      'ftp://a.com',
      '//a.com',
      'a.com',
      '',
      42,
      null,
    ]) {
      expect(safeHref(bad), String(bad)).toBeNull();
    }
  });

  it('o que não é um documento → 422; documento vazio vira um parágrafo vazio', () => {
    for (const bad of [null, 'texto', 3, [], { type: 'paragraph' }, { content: [] }]) {
      expect(() => sanitizeRichDoc(bad)).toThrow();
    }
    expect(sanitizeRichDoc({ type: 'doc', content: [] })).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('CA-RN-136.3 o texto puro derivado: parágrafos, quebra de linha, listas com marcador e citação', () => {
    const rich = sanitizeRichDoc(
      doc(
        p(t('Primeira linha'), { type: 'hardBreak' }, t('segunda linha')),
        p(t('Com '), t('negrito', [{ type: 'bold' }])),
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [p(t('um'))] },
            { type: 'listItem', content: [p(t('dois'))] },
          ],
        },
        {
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [p(t('a'))] },
            { type: 'listItem', content: [p(t('b'))] },
          ],
        },
        { type: 'blockquote', content: [p(t('citado'))] },
      ),
    );
    expect(toPlainText(rich)).toBe(
      ['Primeira linha', 'segunda linha', 'Com negrito', '- um', '- dois', '1. a', '2. b', '> citado'].join('\n'),
    );
  });

  it('CA-RN-136.4 texto puro antigo vira parágrafos e volta igual (sem perder quebra de linha)', () => {
    const text = 'Linha 1\nLinha 2\n\nDepois de um branco';
    const d = plainToDoc(text);
    expect(d.content).toHaveLength(4);
    expect(toPlainText(d)).toBe(text);
    expect(toPlainText(plainToDoc('um\r\ndois'))).toBe('um\ndois');
  });

  it('listas aninhadas e profundidade acima do limite não quebram', () => {
    let nested: unknown = p(t('fundo'));
    for (let i = 0; i < 20; i++) nested = { type: 'blockquote', content: [nested] };
    const out = sanitizeRichDoc(doc(nested));
    expect(JSON.stringify(out).length).toBeLessThan(2000);
    const lists = sanitizeRichDoc(
      doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [p(t('pai')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('filho'))] }] }],
          },
        ],
      }),
    );
    expect(toPlainText(lists)).toBe('- pai\n  - filho');
  });

  it('o orçamento de nós corta um documento gigante (sem travar)', () => {
    const many = doc(...Array.from({ length: 20_000 }, () => p(t('x'))));
    const out = sanitizeRichDoc(many) as RichDoc;
    expect(out.content.length).toBeLessThanOrEqual(5000);
  });

  it('CA-RN-136.5 resolveRich: o texto puro é derivado do documento e o limite vale sobre ele', () => {
    const rich = doc(p(t('Olá, '), t('mundo', [{ type: 'bold' }])));
    const out = resolveRich('IGNORADO', rich, 100, 'description');
    expect(out.text).toBe('Olá, mundo');
    expect(out.rich?.type).toBe('doc');
    expect(() => resolveRich(null, doc(p(t('x'.repeat(101)))), 100, 'description')).toThrow();
    expect(resolveRich(null, doc(p(t('x'.repeat(100)))), 100, 'description').text).toHaveLength(100);
    // Documento vazio: nada de texto nem de documento.
    expect(resolveRich('qualquer', doc(p()), 100, 'description')).toEqual({ text: null, rich: null });
  });

  it('resolveRich sem documento usa o texto puro e não deixa documento antigo (CA-RN-136.6)', () => {
    expect(resolveRich('Texto puro', undefined, 100, 'description')).toEqual({ text: 'Texto puro', rich: null });
    expect(resolveRich('Texto puro', null, 100, 'description')).toEqual({ text: 'Texto puro', rich: null });
    expect(resolveRich(null, undefined, 100, 'description')).toEqual({ text: null, rich: null });
  });
});
