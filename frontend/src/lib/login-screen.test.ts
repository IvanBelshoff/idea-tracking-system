import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canSuggestTranslation,
  fillStyle,
  focusPosition,
  LOGIN_TEXT_PRESETS,
  type LoginBackground,
  mediaUrl,
  overlayStyle,
  pickText,
  showsBackground,
  suggestTranslation,
  videoAllowed,
} from './login-screen.ts';

const bg = (change: Partial<LoginBackground>): LoginBackground => ({
  type: 'none',
  color1: '#5458c8',
  color2: '#2a2c6b',
  focusX: 50,
  focusY: 50,
  overlayColor: 'black',
  overlayOpacity: 40,
  blur: 0,
  imageVersion: null,
  posterVersion: null,
  videoVersion: null,
  ...change,
});

describe('Tela de login (CA-RN-176, CA-RN-177, CA-RN-178, CA-RN-179)', () => {
  it('CA-RN-179.3 sem o texto em inglês, a tela em inglês mostra o português', () => {
    const pair = { ptBR: 'Sua ideia faz a diferença', en: '' };
    assert.equal(pickText(pair, 'en'), 'Sua ideia faz a diferença');
    assert.equal(pickText({ ...pair, en: 'Your idea matters' }, 'en'), 'Your idea matters');
    assert.equal(pickText({ ...pair, en: 'Your idea matters' }, 'pt-BR'), 'Sua ideia faz a diferença');
    assert.equal(pickText({ ptBR: 'x', en: '   ' }, 'en'), 'x');
    assert.equal(pickText(undefined, 'en'), '');
  });

  it('CA-RN-178.4 menos movimento, economia de dados ou tela estreita: só a capa', () => {
    assert.equal(videoAllowed({ reducedMotion: false, saveData: false, narrow: false }), true);
    assert.equal(videoAllowed({ reducedMotion: true, saveData: false, narrow: false }), false);
    assert.equal(videoAllowed({ reducedMotion: false, saveData: true, narrow: false }), false);
    assert.equal(videoAllowed({ reducedMotion: false, saveData: false, narrow: true }), false);
  });

  it('o cartão central e o minimalista não mostram o fundo; os outros quatro mostram', () => {
    assert.deepEqual((['card', 'split', 'full', 'panel', 'band', 'minimal'] as const).filter(showsBackground), [
      'split',
      'full',
      'panel',
      'band',
    ]);
  });

  it('cor, gradiente, camada e foco viram os estilos certos', () => {
    assert.equal(fillStyle(bg({ type: 'color' })), '#5458c8');
    assert.equal(fillStyle(bg({ type: 'gradient' })), 'linear-gradient(135deg, #5458c8, #2a2c6b)');
    assert.equal(fillStyle(bg({ type: 'image' })), null);
    assert.deepEqual(overlayStyle(bg({ type: 'image', overlayOpacity: 60 }), '#123456'), {
      background: '#000000',
      opacity: 0.6,
    });
    assert.deepEqual(overlayStyle(bg({ type: 'video', overlayColor: 'brand' }), '#123456'), {
      background: '#123456',
      opacity: 0.4,
    });
    assert.equal(overlayStyle(bg({ type: 'image', overlayOpacity: 0 }), '#123456'), null);
    assert.equal(overlayStyle(bg({ type: 'gradient' }), '#123456'), null);
    assert.equal(focusPosition(bg({ focusX: 20, focusY: 75 })), '20% 75%');
  });

  it('CA-T.27 os arquivos vêm da própria instalação, com a versão na URL', () => {
    assert.equal(mediaUrl('video', '123'), '/api/branding/login/media/video?v=123');
    assert.equal(mediaUrl('image', null), null);
  });
});

describe('Textos prontos e tradução no navegador (CA-RN-179.4, CA-RN-179.5)', () => {
  it('CA-RN-179.5 há pelo menos 6 pares prontos, nas duas línguas e dentro dos limites', () => {
    assert.ok(LOGIN_TEXT_PRESETS.length >= 6);
    for (const p of LOGIN_TEXT_PRESETS) {
      for (const text of [p.title.ptBR, p.title.en]) assert.ok(text.length > 0 && text.length <= 80);
      for (const text of [p.subtitle.ptBR, p.subtitle.en]) assert.ok(text.length > 0 && text.length <= 200);
    }
  });

  it('CA-RN-179.4 sem o tradutor do navegador, o botão não aparece', async () => {
    assert.equal(await canSuggestTranslation({}), false);
    assert.equal(
      await canSuggestTranslation({
        Translator: { availability: async () => 'unavailable', create: async () => ({}) },
      }),
      false,
    );
    assert.equal(await suggestTranslation('Olá', {}), '');
  });

  it('CA-RN-179.4 com o tradutor, sugere a tradução de português para inglês', async () => {
    const calls: unknown[] = [];
    const Translator = {
      availability: async () => 'downloadable',
      create: async (o: unknown) => {
        calls.push(o);
        return { translate: async (text: string) => `EN(${text})` };
      },
    };
    assert.equal(await canSuggestTranslation({ Translator }), true);
    assert.equal(await suggestTranslation('Sua ideia', { Translator }), 'EN(Sua ideia)');
    assert.deepEqual(calls, [{ sourceLanguage: 'pt', targetLanguage: 'en' }]);
  });
});
