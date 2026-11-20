import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mailErrorText, splitCoded, type Translate, validationText, webhookErrorText } from './server-text.ts';

/** Um `t` mínimo: dicionário com `{{x}}` e plural `_one`/`_other`, como o i18next; sem chave, devolve a chave. */
function fakeT(dict: Record<string, string>): Translate {
  return (key, options = {}) => {
    const count = options.count;
    const plural = typeof count === 'number' ? `${key}_${count === 1 ? 'one' : 'other'}` : null;
    const text = (plural && dict[plural]) ?? dict[key];
    if (text === undefined) return key;
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ''));
  };
}

const t = fakeT({
  'errors.mail.mail_disabled': 'Email sending is off.',
  'errors.mail.graph_send_failed': 'Sending through Microsoft Graph failed ({{detail}}).',
  'errors.mail.transport': 'Sending failed: {{detail}}',
  'errors.webhook.http': 'The destination answered HTTP {{status}}.',
  'errors.webhook.dns': 'Could not resolve the destination name.',
  'errors.validation.invalid': 'Invalid value.',
  'errors.validation.invalid_format': 'Invalid format.',
  'errors.validation.too_small.string_one': 'Use at least {{count}} character.',
  'errors.validation.too_small.string_other': 'Use at least {{count}} characters.',
  'errors.validation.too_big.number_other': 'Use a value of at most {{count}}.',
  'errors.validation.too_small.array_one': 'Choose at least {{count}}.',
});

describe('Textos do servidor no idioma de quem lê (M28)', () => {
  it('separa código e detalhe; texto livre não é código', () => {
    assert.deepEqual(splitCoded('graph_send_failed: HTTP 403: ErrorAccessDenied'), {
      code: 'graph_send_failed',
      detail: 'HTTP 403: ErrorAccessDenied',
    });
    assert.deepEqual(splitCoded('mail_disabled'), { code: 'mail_disabled', detail: null });
    assert.equal(splitCoded('O envio de e-mail está desligado.'), null);
  });

  it('falha de e-mail: traduz o código e mantém o detalhe técnico', () => {
    assert.equal(mailErrorText(t, 'mail_disabled'), 'Email sending is off.');
    assert.equal(
      mailErrorText(t, 'graph_send_failed: HTTP 403: ErrorAccessDenied'),
      'Sending through Microsoft Graph failed (HTTP 403: ErrorAccessDenied).',
    );
    assert.equal(mailErrorText(t, 'transport: 535 Authentication failed'), 'Sending failed: 535 Authentication failed');
  });

  it('falha de e-mail antiga (frase gravada antes dos códigos) ou código desconhecido aparece como chegou', () => {
    assert.equal(mailErrorText(t, 'O envio de e-mail está desligado.'), 'O envio de e-mail está desligado.');
    assert.equal(mailErrorText(t, 'connect: ECONNREFUSED'), 'connect: ECONNREFUSED');
    assert.equal(mailErrorText(t, null), '');
  });

  it('falha de webhook: HTTP com o código e os motivos conhecidos', () => {
    assert.equal(webhookErrorText(t, 'http_503'), 'The destination answered HTTP 503.');
    assert.equal(webhookErrorText(t, 'dns'), 'Could not resolve the destination name.');
    assert.equal(webhookErrorText(t, 'algo_novo'), 'algo_novo');
    assert.equal(webhookErrorText(t, null), '');
  });

  it('validação: em pt-BR vale o texto do servidor; nos outros idiomas, o tipo e o limite', () => {
    const short = { path: 'name', code: 'too_small', origin: 'string', minimum: 3, message: 'Pequeno demais' };
    assert.equal(validationText(t, 'pt-BR', short), 'Pequeno demais');
    assert.equal(validationText(t, 'en', short), 'Use at least 3 characters.');
    assert.equal(validationText(t, 'en', { ...short, minimum: 1 }), 'Use at least 1 character.');
    assert.equal(
      validationText(t, 'en', { code: 'too_big', origin: 'number', maximum: 5, message: 'Grande demais' }),
      'Use a value of at most 5.',
    );
    assert.equal(validationText(t, 'en', { code: 'too_small', origin: 'array', minimum: 1 }), 'Choose at least 1.');
    assert.equal(validationText(t, 'en', { code: 'invalid_format', message: 'Servidor inválido' }), 'Invalid format.');
    // Regra própria do backend (refine) ou detalhe sem código: mensagem genérica.
    assert.equal(validationText(t, 'en', { code: 'custom', message: 'Fuso horário inválido' }), 'Invalid value.');
    assert.equal(validationText(t, 'en', { key: 'x', message: 'Valor fora da regra' }), 'Invalid value.');
  });
});
