import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eventKey, hostOf, statusKey } from './helpers.ts';

describe('Webhooks: ajudas da tela (M17)', () => {
  it('CA-RN-124.2 a lista mostra só o servidor: o caminho e a consulta (que podem trazer segredo) ficam de fora', () => {
    assert.equal(hostOf('https://erp.empresa.local:8443/its/hook?chave=segredo'), 'erp.empresa.local:8443');
    assert.equal(hostOf('http://10.20.0.5/x'), '10.20.0.5');
    assert.equal(hostOf('não é uma url'), '');
    assert.equal(hostOf(''), '');
  });

  it('a chave do texto de cada evento não usa ponto (o ponto separa níveis no i18n)', () => {
    assert.equal(eventKey('idea.submitted'), 'idea_submitted');
    assert.equal(eventKey('campaign.status_changed'), 'campaign_status_changed');
  });

  it('o estado distingue a suspensão pelo administrador da suspensão por falhas', () => {
    assert.equal(statusKey({ status: 'active', suspendedReason: null }), 'active');
    assert.equal(statusKey({ status: 'suspended', suspendedReason: 'admin' }), 'admin');
    assert.equal(statusKey({ status: 'suspended', suspendedReason: 'failures' }), 'failures');
    assert.equal(statusKey({ status: 'suspended', suspendedReason: null }), 'admin');
  });
});
