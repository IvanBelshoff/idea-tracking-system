import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { DURATION_MS, MAX_VISIBLE, notify, toastStore } from './toast.ts';

const visible = () => toastStore.getItems().filter((item) => item.phase !== 'exiting');
const first = () => {
  const item = toastStore.getItems()[0];
  assert.ok(item);
  return item;
};

describe('Avisos na tela (CA-RN-175.1, CA-RN-175.2)', () => {
  beforeEach(() => toastStore.reset());

  it('CA-RN-175.1 ficam no máximo 3 à vista; o quarto tira o mais antigo', () => {
    assert.equal(MAX_VISIBLE, 3);
    const oldest = notify.success('Um');
    notify.success('Dois');
    notify.error('Três');
    assert.equal(visible().length, 3);
    notify.info('Quatro');
    assert.equal(visible().length, 3);
    assert.deepEqual(
      visible().map((item) => item.title),
      ['Dois', 'Três', 'Quatro'],
    );
    assert.equal(toastStore.getItems().find((item) => item.id === oldest)?.phase, 'exiting');
  });

  it('CA-RN-175.2 o tempo é de 4 s no sucesso, 6 s na atenção e na informação e 8 s no erro', () => {
    assert.deepEqual(DURATION_MS, { success: 4000, warning: 6000, info: 6000, error: 8000 });
    notify.success('a');
    notify.warning('b');
    notify.error('c');
    assert.deepEqual(
      toastStore.getItems().map((item) => item.durationMs),
      [4000, 6000, 8000],
    );
  });

  it('CA-RN-175.2 pausar para o tempo e retomar recomeça a contagem', () => {
    const id = notify.success('Salvo');
    const before = first().progressKey;
    toastStore.setPaused(id, true);
    assert.equal(first().paused, true);
    assert.equal(first().progressKey, before);
    // Pausar de novo (mouse e foco ao mesmo tempo) não muda nada.
    toastStore.setPaused(id, true);
    assert.equal(first().progressKey, before);
    toastStore.setPaused(id, false);
    assert.equal(first().paused, false);
    assert.equal(first().progressKey, before + 1);
  });

  it('fechar começa a saída e remover tira da lista; fechar duas vezes não quebra', () => {
    const id = notify.error('Falhou');
    toastStore.dismiss(id);
    toastStore.dismiss(id);
    assert.equal(first().phase, 'exiting');
    toastStore.remove(id);
    assert.equal(toastStore.getItems().length, 0);
  });

  it('quem assina é avisado de cada mudança e pode deixar de assinar', () => {
    let calls = 0;
    const stop = toastStore.subscribe(() => {
      calls += 1;
    });
    notify.info('Oi');
    assert.ok(calls >= 1);
    stop();
    const after = calls;
    notify.info('De novo');
    assert.equal(calls, after);
  });
});
