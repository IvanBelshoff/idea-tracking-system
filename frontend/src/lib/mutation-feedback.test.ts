import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { errorFeedback, isSessionExpired, successFeedback } from './mutation-feedback.ts';

const apiError = (status: number, code: string) => Object.assign(new Error(code), { status, code });
const text = (error: unknown) => `texto de ${(error as { code?: string }).code ?? 'desconhecido'}`;

describe('Aviso das ações (CA-RN-174.1, CA-RN-174.2, CA-RN-174.4)', () => {
  it('CA-RN-174.1 toda ação que falha mostra o erro com o texto da tela, sem nada declarado na ação', () => {
    assert.deepEqual(errorFeedback(apiError(422, 'category_name_taken'), undefined, text), {
      tone: 'error',
      title: 'texto de category_name_taken',
    });
    assert.deepEqual(errorFeedback(new Error('rede'), {}, text), { tone: 'error', title: 'texto de desconhecido' });
  });

  it('CA-RN-174.1 o erro aparece mesmo quando a ação não mostra sucesso (silent)', () => {
    assert.equal(errorFeedback(apiError(409, 'conflict'), { silent: true }, text)?.tone, 'error');
  });

  it('CA-RN-174.2 com o texto declarado, mostra o sucesso; sem ele, não mostra', () => {
    assert.deepEqual(successFeedback({}, { success: 'Item salvo' }), { tone: 'success', title: 'Item salvo' });
    assert.equal(successFeedback({}, undefined), null);
    assert.equal(successFeedback({}, {}), null);
    assert.equal(successFeedback({}, { silent: true }), null);
  });

  it('CA-RN-174.2 o texto de sucesso pode depender da resposta', () => {
    const meta = { success: (data: unknown) => `Pedido ${(data as { code: string }).code} feito` };
    assert.deepEqual(successFeedback({ code: 'P-1' }, meta), { tone: 'success', title: 'Pedido P-1 feito' });
  });

  it('CA-RN-174.2 o texto pode depender do que foi pedido (ligar ou desligar), e o vazio não mostra nada', () => {
    const meta = { success: (_data: unknown, on: unknown) => (on ? 'Ligado' : '') };
    assert.deepEqual(successFeedback({}, meta, true), { tone: 'success', title: 'Ligado' });
    assert.equal(successFeedback({}, meta, false), null);
  });

  it('CA-RN-174.4 a sessão expirada não gera aviso; a senha errada do login (outro 401) gera', () => {
    assert.equal(isSessionExpired(apiError(401, 'unauthenticated')), true);
    assert.equal(errorFeedback(apiError(401, 'unauthenticated'), undefined, text), null);
    assert.equal(isSessionExpired(apiError(401, 'invalid_credentials')), false);
    assert.equal(errorFeedback(apiError(401, 'invalid_credentials'), undefined, text)?.tone, 'error');
  });

  it('silentError cala só o erro daquela ação', () => {
    assert.equal(errorFeedback(apiError(404, 'not_found'), { silentError: true }, text), null);
  });
});
