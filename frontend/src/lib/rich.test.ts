import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asRichDoc, docOf, isEmptyDoc, plainToDoc, richPayload, safeHref, toPlainText } from './rich.ts';

const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const doc = (...content: unknown[]) => asRichDoc({ type: 'doc', content });

describe('Texto formatado na tela (RN-136)', () => {
  it('safeHref só aceita http, https e mailto (CA-RN-136.2)', () => {
    assert.equal(safeHref('https://a.com/x'), 'https://a.com/x');
    assert.equal(safeHref('mailto:a@b.co'), 'mailto:a@b.co');
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:1',
      'data:text/html,x',
      'ftp://a.com',
      'a.com',
      '',
      42,
      null,
    ]) {
      assert.equal(safeHref(bad), null, String(bad));
    }
  });

  it('asRichDoc recusa o que não é documento', () => {
    for (const bad of [null, 'texto', 3, [], { type: 'paragraph' }, { type: 'doc' }]) {
      assert.equal(asRichDoc(bad), null);
    }
    assert.ok(asRichDoc({ type: 'doc', content: [] }));
  });

  it('texto puro antigo vira parágrafos e volta igual (CA-RN-136.4)', () => {
    const text = 'Linha 1\nLinha 2\n\nDepois de um branco';
    assert.equal(toPlainText(plainToDoc(text)), text);
    assert.equal(docOf(null, text)?.content.length, 4);
    assert.equal(docOf(null, null), null);
    assert.equal(docOf({ type: 'doc', content: [p(t('rico'))] }, 'puro')?.content.length, 1);
  });

  it('a cópia em texto puro tem listas com marcador e citação, como no servidor', () => {
    const d = doc(
      p(t('Com '), t('negrito', [{ type: 'bold' }])),
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [p(t('um'))] },
          { type: 'listItem', content: [p(t('dois'))] },
        ],
      },
      { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('a'))] }] },
      { type: 'blockquote', content: [p(t('citado'))] },
    );
    assert.equal(toPlainText(d), ['Com negrito', '- um', '- dois', '1. a', '> citado'].join('\n'));
  });

  it('documento só com parágrafos vazios é vazio e não vai para a API (obrigatório)', () => {
    const empty = doc({ type: 'paragraph' }, p());
    assert.equal(isEmptyDoc(empty), true);
    assert.equal(isEmptyDoc(null), true);
    assert.deepEqual(richPayload(empty), { text: '', rich: null });
    const full = doc(p(t('oi')));
    assert.equal(richPayload(full).text, 'oi');
    assert.equal(richPayload(full).rich, full);
  });
});
