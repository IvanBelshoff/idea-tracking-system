import { describe, expect, it } from 'vitest';
import {
  checkResolved,
  hostMatches,
  isBlockedAddress,
  isInternalAddress,
  normalizeDestinations,
  parseWebhookUrl,
} from '../../src/integration/webhooks/destination-rules.js';
import { buildBody, eventModule, mapIdeaEvent, WEBHOOK_EVENT_TYPES } from '../../src/integration/webhooks/events.js';
import {
  isRetryableStatus,
  newWebhookSecret,
  nextDelaySeconds,
  REPEAT_DELAYS_SECONDS,
  signatureHeader,
  signPayload,
  verifySignature,
  WEBHOOK_LIMITS,
} from '../../src/integration/webhooks/rules.js';
import { nextState } from '../../src/integration/webhooks/webhook-sender.js';

const NOW = new Date('2026-11-12T12:00:00Z');

describe('Destinos dos webhooks (M17, RN-117 e RN-118)', () => {
  it('CA-RN-117.3 a lista aceita nome, curinga, IP e faixa; normaliza e tira repetidos', () => {
    expect(
      normalizeDestinations([' ERP.Empresa.Local ', '*.empresa.com.br', '10.20.0.0/16', '10.20.0.0/16', '192.0.2.7']),
    ).toEqual(['erp.empresa.local', '*.empresa.com.br', '10.20.0.0/16', '192.0.2.7']);
    expect(normalizeDestinations([])).toEqual([]);
  });

  it('CA-RN-117.3 entrada inválida ou mais de 50 devolve nulo', () => {
    for (const bad of ['', 'exemplo com espaço', '*.com', '*', 'http://x.com', '10.0.0.0/99', 'a_b.com']) {
      expect(normalizeDestinations([bad]), bad).toBeNull();
    }
    const many = Array.from({ length: 51 }, (_, i) => `h${i}.empresa.com`);
    expect(normalizeDestinations(many)).toBeNull();
    expect(normalizeDestinations(many.slice(0, 50))).toHaveLength(50);
  });

  it('CA-RN-117.3 o curinga casa os subdomínios, não o domínio puro', () => {
    const list = ['*.empresa.com.br'];
    expect(hostMatches('erp.empresa.com.br', list)).toBe(true);
    expect(hostMatches('a.b.empresa.com.br', list)).toBe(true);
    expect(hostMatches('empresa.com.br', list)).toBe(false);
    expect(hostMatches('outra.com.br', list)).toBe(false);
    expect(hostMatches('xempresa.com.br', list)).toBe(false);
  });

  it('CA-RN-118.1 classes sempre bloqueadas, inclusive os metadados de nuvem e os equivalentes em IPv6', () => {
    for (const ip of [
      '127.0.0.1',
      '127.9.9.9',
      '::1',
      '169.254.169.254',
      '169.254.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      'fe80::1',
      'ff02::1',
      '::',
      'fd00:ec2::254',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ['10.1.2.3', '192.168.0.9', '203.0.113.7', '2001:db8::1']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
    // O loopback só vale nos testes.
    expect(isBlockedAddress('127.0.0.1', true)).toBe(false);
    expect(isBlockedAddress('169.254.169.254', true)).toBe(true);
  });

  it('CA-RN-118.1 estar na lista não libera uma classe bloqueada', () => {
    const entries = ['169.254.169.254', '127.0.0.1', 'metadata.empresa.local', '0.0.0.0'];
    expect(
      checkResolved({ scheme: 'https', hostname: '169.254.169.254', addresses: ['169.254.169.254'], entries }),
    ).toEqual({ ok: false, code: 'destination_blocked' });
    expect(checkResolved({ scheme: 'https', hostname: '127.0.0.1', addresses: ['127.0.0.1'], entries })).toEqual({
      ok: false,
      code: 'destination_blocked',
    });
    // O nome está na lista, mas resolve para os metadados.
    expect(
      checkResolved({
        scheme: 'https',
        hostname: 'metadata.empresa.local',
        addresses: ['169.254.169.254'],
        entries,
      }),
    ).toEqual({ ok: false, code: 'destination_blocked' });
  });

  it('CA-RN-118.2 vale se o nome casa ou se TODOS os IPs resolvidos estão na lista', () => {
    const byName = checkResolved({
      scheme: 'https',
      hostname: 'erp.empresa.com.br',
      addresses: ['203.0.113.7'],
      entries: ['*.empresa.com.br'],
    });
    expect(byName).toEqual({ ok: true, address: '203.0.113.7' });
    const byIp = checkResolved({
      scheme: 'https',
      hostname: 'qualquer.exemplo.org',
      addresses: ['203.0.113.7'],
      entries: ['203.0.113.0/24'],
    });
    expect(byIp.ok).toBe(true);
    // Um dos IPs resolvidos está fora da lista e o nome não casa: recusa.
    expect(
      checkResolved({
        scheme: 'https',
        hostname: 'qualquer.exemplo.org',
        addresses: ['203.0.113.7', '198.51.100.9'],
        entries: ['203.0.113.0/24'],
      }),
    ).toEqual({ ok: false, code: 'destination_not_allowed' });
    expect(
      checkResolved({ scheme: 'https', hostname: 'fora.exemplo.org', addresses: ['203.0.113.7'], entries: [] }),
    ).toEqual({ ok: false, code: 'destination_not_allowed' });
    expect(
      checkResolved({ scheme: 'https', hostname: 'x.exemplo.org', addresses: [], entries: ['x.exemplo.org'] }),
    ).toEqual({ ok: false, code: 'unresolved' });
  });

  it('CA-RN-118.2 uma rede interna sem estar na lista também é recusada', () => {
    expect(
      checkResolved({ scheme: 'https', hostname: '10.0.0.5', addresses: ['10.0.0.5'], entries: ['erp.empresa.local'] }),
    ).toEqual({ ok: false, code: 'destination_not_allowed' });
  });

  it('CA-RN-118.3 http só vale para rede interna da lista', () => {
    const entries = ['10.20.0.0/16', 'publico.exemplo.org'];
    expect(checkResolved({ scheme: 'http', hostname: '10.20.1.1', addresses: ['10.20.1.1'], entries }).ok).toBe(true);
    expect(
      checkResolved({ scheme: 'http', hostname: 'publico.exemplo.org', addresses: ['203.0.113.7'], entries }),
    ).toEqual({ ok: false, code: 'https_required' });
    expect(
      checkResolved({ scheme: 'https', hostname: 'publico.exemplo.org', addresses: ['203.0.113.7'], entries }).ok,
    ).toBe(true);
    expect(isInternalAddress('100.64.0.1')).toBe(true);
    expect(isInternalAddress('fd12:3456::1')).toBe(true);
    expect(isInternalAddress('203.0.113.7')).toBe(false);
  });

  it('CA-RN-118.3 a URL recusa usuário e senha, esquema que não é http(s) e texto que não é URL', () => {
    expect(parseWebhookUrl('https://user:pass@erp.empresa.local/x')).toEqual({
      ok: false,
      code: 'credentials_not_allowed',
    });
    expect(parseWebhookUrl('https://user@erp.empresa.local/x')).toEqual({ ok: false, code: 'credentials_not_allowed' });
    for (const bad of [
      'ftp://erp.empresa.local/x',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'erp.empresa.local',
      '',
    ]) {
      expect(parseWebhookUrl(bad), bad).toEqual({ ok: false, code: 'invalid_url' });
    }
    const ok = parseWebhookUrl('https://ERP.Empresa.Local:8443/its/hook?k=1');
    expect(ok.ok && ok.parts).toEqual({ scheme: 'https', hostname: 'erp.empresa.local', literalIp: false });
    const ipv6 = parseWebhookUrl('http://[fd00::1]:8080/x');
    expect(ipv6.ok && ipv6.parts).toEqual({ scheme: 'http', hostname: 'fd00::1', literalIp: true });
  });
});

describe('Assinatura e entrega (M17, RN-120 e RN-121)', () => {
  const secret = 'whsec_exemplo-de-teste';
  const body = JSON.stringify({ id: 'e1', type: 'idea.submitted', created_at: NOW.toISOString(), data: {} });
  const ts = Math.floor(NOW.getTime() / 1000);
  const now = ts;

  it('CA-RN-120.1 o HMAC-SHA256 de <carimbo>.<corpo> em hexadecimal; mudar um byte invalida', () => {
    const sig = signPayload(secret, ts, body);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    const header = `v1=${sig}`;
    const check = (over: Partial<Parameters<typeof verifySignature>[0]> = {}) =>
      verifySignature({ header, secret, timestamp: String(ts), body, nowSeconds: now, ...over });
    expect(check()).toEqual({ ok: true });
    expect(check({ body: `${body} ` })).toEqual({ ok: false, reason: 'mismatch' });
    expect(check({ body: body.replace('e1', 'e2') })).toEqual({ ok: false, reason: 'mismatch' });
    expect(check({ timestamp: String(ts + 1) })).toEqual({ ok: false, reason: 'mismatch' });
    expect(check({ secret: 'whsec_outro' })).toEqual({ ok: false, reason: 'mismatch' });
    expect(check({ header: undefined })).toEqual({ ok: false, reason: 'missing' });
    expect(check({ header: 'v2=abc' })).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('CA-RN-120.5 durante a rotação o cabeçalho leva duas assinaturas e as duas conferem', () => {
    const old = 'whsec_antigo';
    const header = signatureHeader([secret, old], ts, body);
    expect(header.split(',')).toHaveLength(2);
    for (const s of [secret, old]) {
      expect(verifySignature({ header, secret: s, timestamp: String(ts), body, nowSeconds: now })).toEqual({
        ok: true,
      });
    }
    expect(verifySignature({ header, secret: 'whsec_x', timestamp: String(ts), body, nowSeconds: now }).ok).toBe(false);
  });

  it('CA-RN-120.6 o receptor recusa carimbo com mais de 5 minutos e do futuro além da tolerância', () => {
    const header = signatureHeader([secret], ts, body);
    const at = (nowSeconds: number) => verifySignature({ header, secret, timestamp: String(ts), body, nowSeconds }).ok;
    expect(at(ts + 300)).toBe(true);
    expect(at(ts + 301)).toBe(false);
    expect(at(ts - 300)).toBe(true);
    expect(at(ts - 301)).toBe(false);
  });

  it('CA-RN-120.3 o segredo é whsec_ mais 43 caracteres e o prefixo mostra só o começo', () => {
    const a = newWebhookSecret();
    const b = newWebhookSecret();
    expect(a.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(a.secret).not.toBe(b.secret);
    expect(a.prefix).toBe(a.secret.slice(0, 10));
    expect(a.prefix.length).toBeLessThan(a.secret.length);
  });

  it('CA-RN-121.2 o calendário de repetição é 30 s, 2 min, 10 min, 1 h, 3 h, 6 h, 12 h e 24 h', () => {
    expect([...REPEAT_DELAYS_SECONDS]).toEqual([30, 120, 600, 3600, 10_800, 21_600, 43_200, 86_400]);
    expect(nextDelaySeconds(1)).toBe(30);
    expect(nextDelaySeconds(8)).toBe(86_400);
    expect(nextDelaySeconds(9)).toBeNull();
    // A soma do calendário cabe nas 48 horas em que um aviso pendente vale.
    const total = REPEAT_DELAYS_SECONDS.reduce((a, b) => a + b, 0);
    expect(total / 3600).toBeLessThan(WEBHOOK_LIMITS.expireAfterHours);
  });

  it('CA-RN-121.3 rede, 5xx, 408 e 429 repetem; 3xx e os demais 4xx não', () => {
    for (const s of [500, 502, 503, 504, 408, 429]) expect(isRetryableStatus(s), String(s)).toBe(true);
    for (const s of [301, 302, 307, 400, 401, 403, 404, 410, 422]) expect(isRetryableStatus(s), String(s)).toBe(false);
  });

  it('CA-RN-121.1 e .3 o próximo estado de uma entrega', () => {
    expect(nextState(1, { kind: 'ok', status: 200, error: null }, NOW)).toEqual({
      state: 'delivered',
      nextAttemptAt: null,
      definitive: false,
    });
    const retry = nextState(1, { kind: 'retry', status: 503, error: 'http_503' }, NOW);
    expect(retry.state).toBe('pending');
    expect(retry.nextAttemptAt?.getTime()).toBe(NOW.getTime() + 30_000);
    expect(retry.definitive).toBe(false);
    expect(nextState(4, { kind: 'retry', status: null, error: 'timeout' }, NOW).nextAttemptAt?.getTime()).toBe(
      NOW.getTime() + 3600_000,
    );
    // Esgotadas as repetições, vira falha definitiva.
    expect(nextState(9, { kind: 'retry', status: 503, error: 'http_503' }, NOW)).toMatchObject({
      state: 'failed',
      definitive: true,
    });
    expect(nextState(1, { kind: 'permanent', status: 404, error: 'http_404' }, NOW)).toMatchObject({
      state: 'failed',
      definitive: true,
    });
  });
});

describe('Eventos dos webhooks (M17, RN-119)', () => {
  const idea = { code: 'IDE-2026-0001', entityId: '11111111-1111-4111-8111-111111111111' };

  it('o catálogo tem os dezesseis eventos (mural no M21; loja no M22; aprovação no M24, RN-191), cada um ligado a um módulo', () => {
    expect([...WEBHOOK_EVENT_TYPES].sort()).toEqual([
      'approval.decided',
      'approval.requested',
      'campaign.status_changed',
      'gain.validated',
      'highlight.created',
      'highlight.revoked',
      'idea.archived',
      'idea.converged',
      'idea.deleted',
      'idea.status_changed',
      'idea.submitted',
      'mural.published',
      'mural.withdrawn',
      'store.bonus_paid',
      'store.order_approved',
      'store.order_delivered',
    ]);
    expect(eventModule('mural.withdrawn')).toBe('ideas');
    expect(eventModule('idea.submitted')).toBe('ideas');
    expect(eventModule('gain.validated')).toBe('indicators');
    expect(eventModule('highlight.created')).toBe('hall');
    expect(eventModule('campaign.status_changed')).toBe('campaigns');
  });

  it('CA-RN-119.3 a transição leva o código e os estados de origem e destino', () => {
    expect(mapIdeaEvent('status_changed', { from: 'submitted', to: 'in_triage' }, idea)).toEqual({
      type: 'idea.status_changed',
      data: { idea_code: idea.code, entity_id: idea.entityId, from: 'submitted', to: 'in_triage' },
    });
    expect(mapIdeaEvent('created', {}, idea)?.type).toBe('idea.submitted');
    expect(mapIdeaEvent('archived', {}, idea)?.type).toBe('idea.archived');
    expect(mapIdeaEvent('converged', { into: 'IDE-2026-0002' }, idea)?.data.converged_into).toBe('IDE-2026-0002');
  });

  it('CA-RN-119.3 reabrir também avisa a mudança de situação, com origem e destino', () => {
    expect(mapIdeaEvent('reopened', { from: 'implemented', to: 'in_progress' }, idea)).toEqual({
      type: 'idea.status_changed',
      data: { idea_code: idea.code, entity_id: idea.entityId, from: 'implemented', to: 'in_progress' },
    });
    expect(mapIdeaEvent('reopened', { from: 'rejected', to: 'in_review' }, idea)?.data).toMatchObject({
      from: 'rejected',
      to: 'in_review',
    });
  });

  it('um evento do histórico que não é da lista não vira webhook', () => {
    for (const type of ['comment_added', 'assigned', 'edited', 'liked', 'inventado']) {
      expect(mapIdeaEvent(type, {}, idea), type).toBeNull();
    }
  });

  it('CA-RN-119.1 o aviso é { id, type, created_at, data } e não carrega texto livre (negativo)', () => {
    const body = JSON.parse(
      buildBody({
        id: 'e1',
        type: 'idea.status_changed',
        createdAt: NOW,
        data:
          mapIdeaEvent('status_changed', { from: 'a', to: 'b', title: 'Segredo', email: 'x@y.z' }, idea)?.data ?? {},
      }),
    );
    expect(Object.keys(body)).toEqual(['id', 'type', 'created_at', 'data']);
    expect(body.created_at).toBe(NOW.toISOString());
    const flat = JSON.stringify(body);
    expect(flat).not.toContain('Segredo');
    expect(flat).not.toContain('x@y.z');
    expect(Object.keys(body.data).sort()).toEqual(['entity_id', 'from', 'idea_code', 'to']);
  });
});
