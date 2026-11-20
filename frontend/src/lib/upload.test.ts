import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkAttachment } from './upload.ts';

const rules = { maxMb: 10, allowedExtensions: ['pdf', 'jpg', 'mp4'] };
const MB = 1024 * 1024;

describe('Anexos: conferência no navegador (RN-146)', () => {
  it('aceita extensão da lista dentro do limite, sem diferenciar maiúsculas', () => {
    assert.equal(checkAttachment({ name: 'foto.JPG', size: 2 * MB }, rules), null);
    assert.equal(checkAttachment({ name: 'video.mp4', size: 10 * MB }, rules), null);
  });
  it('recusa extensão fora da lista, sem extensão ou acima do limite', () => {
    assert.equal(checkAttachment({ name: 'script.exe', size: 10 }, rules), 'file_type_not_allowed');
    assert.equal(checkAttachment({ name: 'semextensao', size: 10 }, rules), 'file_type_not_allowed');
    assert.equal(checkAttachment({ name: '.pdf', size: 10 }, rules), 'file_type_not_allowed');
    assert.equal(checkAttachment({ name: 'grande.pdf', size: 10 * MB + 1 }, rules), 'file_too_large');
  });
});

describe('Prévia antes de enviar (RN-146)', () => {
  it('imagem e vídeo vão ao visualizador, PDF ao iframe; SVG e o resto não têm prévia', async () => {
    const { previewKind } = await import('./upload.ts');
    assert.equal(previewKind({ name: 'foto.JPG', type: 'image/jpeg' }), 'image');
    assert.equal(previewKind({ name: 'tela.png', type: '' }), 'image');
    assert.equal(previewKind({ name: 'video.mp4', type: 'video/mp4' }), 'video');
    assert.equal(previewKind({ name: 'video.webm', type: '' }), 'video');
    assert.equal(previewKind({ name: 'laudo.pdf', type: 'application/pdf' }), 'pdf');
    assert.equal(previewKind({ name: 'laudo.PDF', type: '' }), 'pdf');
    assert.equal(previewKind({ name: 'icone.svg', type: 'image/svg+xml' }), null);
    assert.equal(previewKind({ name: 'filme.mov', type: 'video/quicktime' }), null);
    assert.equal(previewKind({ name: 'planilha.xlsx', type: '' }), null);
  });
});
