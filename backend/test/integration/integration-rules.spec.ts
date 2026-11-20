import { describe, expect, it } from 'vitest';
import { tokenHash } from '../../src/identity-access/password.js';
import { authorName } from '../../src/integration/api/author.js';
import { encodeCursor, pagePredicates, parsePage, SqlParams, sliceRows } from '../../src/integration/api/page.js';
import { filterContract } from '../../src/integration/contract-filter.js';
import { ipAllowed, normalizeIpList, parseIpEntry } from '../../src/integration/ip-rules.js';
import { enableBlockers, normalizeModules } from '../../src/integration/modules.js';
import { WindowCounter } from '../../src/integration/rate-window.js';
import {
  checkExpiry,
  countActiveTokens,
  healthExpiry,
  isTokenValid,
  newIntegrationToken,
  parseBearer,
  retireAtFor,
  tokenState,
} from '../../src/integration/token-rules.js';

const NOW = new Date('2026-11-11T12:00:00Z');
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);
const days = (n: number) => hours(n * 24);

describe('Token de integração (RN-104)', () => {
  it('CA-RN-104.1 o token é its_ mais 43 caracteres base64url e mil tokens não se repetem', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const { token, hash, prefix } = newIntegrationToken();
      expect(token).toMatch(/^its_[A-Za-z0-9_-]{43}$/);
      expect(hash).toBe(tokenHash(token));
      expect(prefix).toBe(token.slice(0, 8));
      seen.add(token);
    }
    expect(seen.size).toBe(1000);
  });

  it('CA-RN-104.9 o cabeçalho só vale como "Bearer <token no formato>"; o resto é "sem token"', () => {
    const { token } = newIntegrationToken();
    expect(parseBearer(`Bearer ${token}`)).toBe(token);
    expect(parseBearer(`bearer ${token}`)).toBe(token);
    expect(parseBearer(`Basic ${token}`)).toBeNull();
    expect(parseBearer(token)).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('Bearer its_curto')).toBeNull();
    expect(parseBearer(`Bearer ${token} extra`)).toBeNull();
  });

  it('CA-RN-104.3 a validade é no futuro e de no máximo 365 dias', () => {
    expect(checkExpiry(days(1), NOW)).toBe('ok');
    expect(checkExpiry(days(365), NOW)).toBe('ok');
    expect(checkExpiry(new Date(days(365).getTime() + 1), NOW)).toBe('too_far');
    expect(checkExpiry(NOW, NOW)).toBe('in_the_past');
    expect(checkExpiry(days(-1), NOW)).toBe('in_the_past');
  });

  it('CA-RN-104.4 e 104.5 estados do token: ativo, em aposentadoria, aposentado, vencido e revogado', () => {
    const base = { expiresAt: days(30), retireAt: null, revokedAt: null };
    expect(tokenState(base, NOW)).toBe('active');
    expect(tokenState({ ...base, retireAt: hours(24) }, NOW)).toBe('retiring');
    expect(tokenState({ ...base, retireAt: hours(-1) }, NOW)).toBe('retired');
    expect(tokenState({ ...base, expiresAt: NOW }, NOW)).toBe('expired');
    expect(tokenState({ ...base, revokedAt: hours(-1) }, NOW)).toBe('revoked');
    expect(isTokenValid({ ...base, retireAt: hours(24) }, NOW)).toBe(true);
    expect(isTokenValid({ ...base, retireAt: hours(-1) }, NOW)).toBe(false);
    expect(countActiveTokens([base, { ...base, retireAt: hours(1) }, { ...base, revokedAt: NOW }], NOW)).toBe(2);
  });

  it('CA-RN-104.5 a sobreposição vai até o fim da janela, nunca além da validade do token antigo', () => {
    expect(retireAtFor(days(30), NOW, 24).getTime()).toBe(hours(24).getTime());
    expect(retireAtFor(hours(5), NOW, 24).getTime()).toBe(hours(5).getTime());
    expect(retireAtFor(days(30), NOW, 0).getTime()).toBe(NOW.getTime());
  });

  it('CA-RN-113.3 para a saúde conta o token de maior validade que não foi revogado', () => {
    expect(healthExpiry([])).toBeNull();
    expect(
      healthExpiry([
        { expiresAt: days(2), revokedAt: null },
        { expiresAt: days(200), revokedAt: null },
      ])?.getTime(),
    ).toBe(days(200).getTime());
    expect(
      healthExpiry([
        { expiresAt: days(200), revokedAt: NOW },
        { expiresAt: days(2), revokedAt: null },
      ])?.getTime(),
    ).toBe(days(2).getTime());
    expect(healthExpiry([{ expiresAt: days(200), revokedAt: NOW }])).toBeNull();
  });
});

describe('Lista de IPs (RN-103)', () => {
  it('CA-RN-103.8 aceita IP e faixa, IPv4 e IPv6; recusa o que não é endereço', () => {
    expect(parseIpEntry('203.0.113.7')).toBe('203.0.113.7');
    expect(parseIpEntry('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseIpEntry('2001:db8::/32')).toBe('2001:db8::/32');
    expect(parseIpEntry('::ffff:10.0.0.1')).toBe('10.0.0.1');
    for (const bad of ['', 'abc', '10.0.0.0/33', '10.0.0.256', '2001:db8::/129', '10.0.0.0/x']) {
      expect(parseIpEntry(bad), bad).toBeNull();
    }
  });

  it('CA-RN-103.8 no máximo 20 entradas, sem repetição, e nulo se alguma for inválida', () => {
    expect(normalizeIpList(['10.0.0.1', '10.0.0.1'])).toEqual(['10.0.0.1']);
    expect(normalizeIpList(Array.from({ length: 20 }, (_, i) => `10.0.0.${i + 1}`))).toHaveLength(20);
    expect(normalizeIpList(Array.from({ length: 21 }, (_, i) => `10.0.0.${i + 1}`))).toBeNull();
    expect(normalizeIpList(['10.0.0.1', 'lixo'])).toBeNull();
    expect(normalizeIpList([])).toEqual([]);
  });

  it('CA-RN-103.8 dentro da faixa passa, fora não; lista vazia aceita qualquer origem; IPv4 dentro de IPv6 conta', () => {
    const list = ['203.0.113.0/24', '198.51.100.77', '2001:db8::/32'];
    expect(ipAllowed('203.0.113.9', list)).toBe(true);
    expect(ipAllowed('198.51.100.77', list)).toBe(true);
    expect(ipAllowed('198.51.100.78', list)).toBe(false);
    expect(ipAllowed('2001:db8:1::5', list)).toBe(true);
    expect(ipAllowed('2001:db9::1', list)).toBe(false);
    expect(ipAllowed('::ffff:203.0.113.9', list)).toBe(true);
    expect(ipAllowed(undefined, list)).toBe(false);
    expect(ipAllowed('lixo', list)).toBe(false);
    expect(ipAllowed(undefined, [])).toBe(true);
    expect(ipAllowed('1.2.3.4', [])).toBe(true);
  });
});

describe('Limite por integração (RN-105)', () => {
  it('CA-RN-105.1 a janela de 1 minuto: passou do limite, bloqueia; na janela seguinte volta', () => {
    const counter = new WindowCounter();
    const t0 = 1_000_000;
    expect(counter.take('a', 2, t0)).toMatchObject({ allowed: true, remaining: 1, limit: 2 });
    expect(counter.take('a', 2, t0 + 1000)).toMatchObject({ allowed: true, remaining: 0 });
    const blocked = counter.take('a', 2, t0 + 2000);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0 });
    expect(blocked.retryAfter).toBe(58);
    expect(counter.take('a', 2, t0 + 60_000)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('CA-RN-105.3 cada chave tem a sua contagem e o limite vem a cada chamada', () => {
    const counter = new WindowCounter();
    expect(counter.take('a', 1, 0).allowed).toBe(true);
    expect(counter.take('a', 1, 1).allowed).toBe(false);
    expect(counter.take('b', 1, 1).allowed).toBe(true);
    expect(counter.take('a', 5, 2).allowed).toBe(true);
  });
});

describe('Módulos e pré-condições (RN-102)', () => {
  it('CA-RN-102.7 só os seis códigos, sem repetição e na ordem do contrato', () => {
    expect(normalizeModules(['users', 'ideas', 'ideas'])).toEqual(['ideas', 'users']);
    expect(normalizeModules([])).toEqual([]);
    expect(normalizeModules(['ideas', 'inventado'])).toBeNull();
  });

  it('CA-RN-102.2 ligar exige o endereço do sistema em HTTPS (ou localhost)', () => {
    expect(enableBlockers('')).toEqual(['app_url_required']);
    expect(enableBlockers('   ')).toEqual(['app_url_required']);
    expect(enableBlockers('http://its.empresa.com.br')).toEqual(['https_required']);
    expect(enableBlockers('https://its.empresa.com.br')).toEqual([]);
    expect(enableBlockers('http://localhost:8080')).toEqual([]);
    expect(enableBlockers('isso nao e url')).toEqual(['https_required']);
  });
});

describe('Convenções de lista (RN-106)', () => {
  const at = '2026-11-11T12:00:00.123456Z';
  const id = '019a2c10-0000-7000-8000-000000000001';

  it('CA-RN-106.2 limite padrão 50, de 1 a 200; fora disso e cursor inválido dão 422', () => {
    expect(parsePage({}).limit).toBe(50);
    expect(parsePage({ limit: '200' }).limit).toBe(200);
    for (const bad of [
      { limit: '0' },
      { limit: '201' },
      { limit: 'x' },
      { cursor: 'lixo' },
      { updated_since: 'ontem' },
    ]) {
      expect(() => parsePage(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('CA-RN-106.2 o cursor guarda a hora com microssegundos e o identificador da última linha', () => {
    const page = parsePage({ cursor: encodeCursor(at, id), limit: '10' });
    expect(page.cursor).toEqual({ at, id });
    const p = new SqlParams();
    const where = pagePredicates('x', p, page);
    expect(where).toEqual(['(x.sync_at, x.id) > ($1::timestamptz, $2::uuid)']);
    expect(p.values).toEqual([at, id]);
  });

  it('CA-RN-106.3 updated_since é inclusivo', () => {
    const p = new SqlParams();
    const where = pagePredicates('x', p, parsePage({ updated_since: '2026-11-11T00:00:00Z' }));
    expect(where[0]).toContain('>=');
  });

  it('CA-RN-106.2 corta a linha extra e monta o próximo cursor só quando há mais', () => {
    const rows = [1, 2, 3].map((n) => ({ id: `${id.slice(0, -1)}${n}`, cur_at: at }));
    expect(sliceRows(rows, 5)).toEqual({ rows, next: null });
    const sliced = sliceRows(rows, 2);
    expect(sliced.rows).toHaveLength(2);
    expect(sliced.next).toBe(encodeCursor(at, rows[1]?.id as string));
  });
});

describe('Autor para quem consome a API (RN-107)', () => {
  it('CA-RN-107.6 nome na ideia comum; nulo com opt-out ou sem autor; "Ex-colaborador" se anonimizado', () => {
    expect(authorName({ name: 'Maria', hideName: false, status: 'active' })).toBe('Maria');
    expect(authorName({ name: 'Maria', hideName: false, status: 'disabled' })).toBe('Maria');
    expect(authorName({ name: 'Maria', hideName: true, status: 'active' })).toBeNull();
    expect(authorName({ name: 'Anon', hideName: false, status: 'anonymized' })).toBe('Ex-colaborador');
    expect(authorName({ name: 'Anon', hideName: true, status: 'anonymized' })).toBe('Ex-colaborador');
    expect(authorName(null)).toBeNull();
    expect(authorName(undefined)).toBeNull();
  });
});

describe('Filtro do contrato por módulo (RN-106, RN-115)', () => {
  const doc = {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    tags: [{ name: 'ideas' }, { name: 'users' }, { name: 'contract' }],
    paths: {
      '/integration/v1/ideas': {
        get: {
          tags: ['ideas'],
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/IdeaPage' } } } },
          },
        },
      },
      '/integration/v1/users': {
        get: {
          tags: ['users'],
          responses: {
            200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/UserPage' } } } },
          },
        },
      },
      '/integration/v1/openapi.json': { get: { tags: ['contract'], responses: { 200: { description: 'ok' } } } },
    },
    components: {
      schemas: {
        IdeaPage: {
          type: 'object',
          properties: { data: { type: 'array', items: { $ref: '#/components/schemas/IdeaItem' } } },
        },
        IdeaItem: { type: 'object', properties: { code: { type: 'string' } } },
        UserPage: {
          type: 'object',
          properties: { data: { type: 'array', items: { $ref: '#/components/schemas/UserItem' } } },
        },
        UserItem: { type: 'object', properties: { email: { type: 'string' } } },
      },
    },
  } as never;

  it('CA-RN-102.5 só ficam as rotas dos módulos pedidos e as do próprio contrato', () => {
    const out = filterContract(doc, ['ideas']) as unknown as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
      tags: { name: string }[];
    };
    expect(Object.keys(out.paths).sort()).toEqual(['/integration/v1/ideas', '/integration/v1/openapi.json']);
    expect(Object.keys(out.components.schemas).sort()).toEqual(['IdeaItem', 'IdeaPage']);
    expect(out.tags.map((t) => t.name).sort()).toEqual(['contract', 'ideas']);
  });

  it('CA-RN-115.8 módulo desligado não aparece, nem seus esquemas; o documento original não muda', () => {
    const out = filterContract(doc, []) as unknown as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(out.paths)).toEqual(['/integration/v1/openapi.json']);
    expect(out.components.schemas).toEqual({});
    expect(Object.keys((doc as unknown as { paths: Record<string, unknown> }).paths)).toHaveLength(3);
  });
});
