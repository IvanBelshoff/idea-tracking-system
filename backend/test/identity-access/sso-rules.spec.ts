import 'reflect-metadata';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type Jwk, verifyIdToken } from '../../src/identity-access/sso/oidc.js';
import { presetOf } from '../../src/identity-access/sso/providers.js';
import { SsoError } from '../../src/identity-access/sso/sso-errors.js';
import {
  assertIdentityAllowed,
  canUsePassword,
  enableBlockers,
  isAdministrativeRole,
  isHttpsOrLocal,
  modeBlockers,
  provisionedName,
} from '../../src/identity-access/sso/sso-rules.js';
import { safeBackPath } from '../../src/identity-access/sso/sso-state.js';

const domains = ['empresa.com'];
const identity = (over: Partial<Parameters<typeof assertIdentityAllowed>[1]> = {}) => ({
  issuer: 'iss',
  subject: 'sub',
  email: 'ana@empresa.com',
  emailVerified: true,
  name: 'Ana',
  hostedDomain: null,
  ...over,
});
const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof SsoError ? e.code : 'outro';
  }
};

describe('Login corporativo: regras puras (M13)', () => {
  it('CA-RN-97.1 canUsePassword: só o modo "Só SSO" restringe, com emergência e e-mail de fora liberados', () => {
    const base = { email: 'ana@empresa.com', domains, isEmergency: false };
    expect(canUsePassword({ ...base, mode: 'password' })).toBe(true);
    expect(canUsePassword({ ...base, mode: 'password_sso' })).toBe(true);
    expect(canUsePassword({ ...base, mode: 'sso' })).toBe(false);
    expect(canUsePassword({ ...base, mode: 'sso', isEmergency: true })).toBe(true);
    expect(canUsePassword({ ...base, mode: 'sso', email: 'consultor@fora.io' })).toBe(true);
    expect(canUsePassword({ ...base, mode: 'sso', email: 'ANA@Empresa.COM' })).toBe(false);
  });

  it('CA-RN-96.6 e 96.7 assertIdentityAllowed: domínio, e-mail ausente, não verificado e Google sem hd', () => {
    expect(assertIdentityAllowed('microsoft', identity(), domains)).toBe('ana@empresa.com');
    expect(codeOf(() => assertIdentityAllowed('microsoft', identity(), []))).toBe('sso_domain_not_allowed');
    expect(codeOf(() => assertIdentityAllowed('microsoft', identity({ email: null }), domains))).toBe(
      'sso_email_missing',
    );
    expect(codeOf(() => assertIdentityAllowed('microsoft', identity({ emailVerified: false }), domains))).toBe(
      'sso_email_unverified',
    );
    expect(codeOf(() => assertIdentityAllowed('microsoft', identity({ email: 'x@fora.io' }), domains))).toBe(
      'sso_domain_not_allowed',
    );
    expect(codeOf(() => assertIdentityAllowed('google', identity(), domains))).toBe('sso_domain_not_allowed');
    expect(codeOf(() => assertIdentityAllowed('google', identity({ hostedDomain: 'outra.com' }), domains))).toBe(
      'sso_domain_not_allowed',
    );
    expect(assertIdentityAllowed('google', identity({ hostedDomain: 'empresa.com' }), domains)).toBe('ana@empresa.com');
  });

  it('CA-RN-96.4 Microsoft: o tid do token tem de ser o do tenant configurado', () => {
    const ms = presetOf('microsoft');
    const claims = { sub: 's', oid: 'o1', tid: 'TENANT-1', email: 'Ana@Empresa.com', name: 'Ana' };
    const ok = ms.identify(claims, 'iss', 'tenant-1');
    expect(ok.subject).toBe('tenant-1:o1');
    expect(ok.email).toBe('ana@empresa.com');
    expect(codeOf(() => ms.identify({ ...claims, tid: 'outro' }, 'iss', 'tenant-1'))).toBe('sso_tenant_mismatch');
    expect(codeOf(() => ms.identify({ ...claims, tid: undefined }, 'iss', 'tenant-1'))).toBe('sso_tenant_mismatch');
    // Sem o claim `email`, o nome de usuário (UPN) serve de e-mail.
    expect(
      ms.identify({ ...claims, email: undefined, preferred_username: 'ana@empresa.com' }, 'iss', 'tenant-1').email,
    ).toBe('ana@empresa.com');
  });

  it('CA-RN-97.6 enableBlockers lista o que falta, na ordem, e fica vazio quando tudo está pronto', () => {
    const ready = {
      provider: 'microsoft' as const,
      appUrl: 'https://its.empresa.com',
      secretKeyReady: true,
      clientId: 'c',
      tenantId: 't',
      hasSecret: true,
      lastTestOk: true,
      domains,
    };
    expect(enableBlockers(ready)).toEqual([]);
    expect(enableBlockers({ ...ready, appUrl: '' })).toEqual(['app_url_required']);
    expect(enableBlockers({ ...ready, appUrl: 'http://its.empresa.com' })).toEqual(['https_required']);
    expect(enableBlockers({ ...ready, appUrl: 'http://localhost:8080' })).toEqual([]);
    expect(enableBlockers({ ...ready, secretKeyReady: false })).toEqual(['secret_key_missing']);
    expect(enableBlockers({ ...ready, tenantId: null })).toEqual(['provider_incomplete']);
    expect(enableBlockers({ ...ready, provider: 'google', tenantId: null })).toEqual([]);
    expect(enableBlockers({ ...ready, hasSecret: false })).toEqual(['provider_incomplete']);
    expect(enableBlockers({ ...ready, domains: [] })).toEqual(['domains_required']);
    expect(enableBlockers({ ...ready, lastTestOk: null })).toEqual(['test_required']);
    expect(enableBlockers({ ...ready, lastTestOk: false })).toEqual(['test_required']);
    expect(isHttpsOrLocal('não é endereço')).toBe(false);
  });

  it('CA-RN-97.8 modeBlockers: só senha nunca bloqueia; "Só SSO" exige o administrador vinculado', () => {
    const base = { enabledProviders: 1, domains, actorLinked: true };
    expect(modeBlockers({ ...base, mode: 'password', enabledProviders: 0, domains: [], actorLinked: false })).toEqual(
      [],
    );
    expect(modeBlockers({ ...base, mode: 'password_sso' })).toEqual([]);
    expect(modeBlockers({ ...base, mode: 'password_sso', enabledProviders: 0 })).toEqual(['no_provider_enabled']);
    expect(modeBlockers({ ...base, mode: 'sso', actorLinked: false })).toEqual(['admin_not_linked']);
    expect(modeBlockers({ ...base, mode: 'sso', domains: [], enabledProviders: 0, actorLinked: false })).toEqual([
      'no_provider_enabled',
      'domains_required',
      'admin_not_linked',
    ]);
  });

  it('CA-RN-98.5 isAdministrativeRole: qualquer permissão administrativa, ou o perfil Administrador', () => {
    expect(isAdministrativeRole({ systemKey: 'collaborator', permissions: ['idea.submit', 'idea.comment'] })).toBe(
      false,
    );
    expect(isAdministrativeRole({ systemKey: null, permissions: ['idea.submit', 'audit.view'] })).toBe(true);
    expect(isAdministrativeRole({ systemKey: null, permissions: ['sso.manage'] })).toBe(true);
    expect(isAdministrativeRole({ systemKey: null, permissions: ['ops.view'] })).toBe(true);
    expect(isAdministrativeRole({ systemKey: 'admin', permissions: [] })).toBe(true);
    // Um analista (triagem) não é administrativo.
    expect(isAdministrativeRole({ systemKey: 'analyst', permissions: ['idea.triage', 'step.manage'] })).toBe(false);
  });

  it('CA-RN-98.8 provisionedName usa o nome do provedor, o e-mail como reserva, e limita a 200 caracteres', () => {
    expect(provisionedName('  Ana Souza ', 'ana@empresa.com')).toBe('Ana Souza');
    expect(provisionedName(null, 'ana@empresa.com')).toBe('ana');
    expect(provisionedName('   ', 'ana@empresa.com')).toBe('ana');
    expect(provisionedName('x'.repeat(500), 'a@b.com')).toHaveLength(200);
  });

  it('CA-RN-96.12 safeBackPath só aceita caminho interno', () => {
    expect(safeBackPath('/ideias/123')).toBe('/ideias/123');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'ideias', '', undefined, 42, null]) {
      expect(safeBackPath(bad)).toBe('/');
    }
    expect(safeBackPath(`/${'a'.repeat(900)}`)).toHaveLength(500);
  });
});

describe('Login corporativo: validação do id_token (M13)', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk: Jwk = { ...(keys.publicKey.export({ format: 'jwk' }) as Jwk), kid: 'k1', use: 'sig' };
  const expect_ = { issuer: 'https://idp.test', audience: 'cliente', nonce: 'n-1', now: 1_000_000 };
  const claims = { iss: 'https://idp.test', aud: 'cliente', sub: 'u1', exp: 1_000_300, nonce: 'n-1' };

  const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
  function token(over: Record<string, unknown> = {}, opts: { kid?: string; alg?: string; key?: typeof keys } = {}) {
    const h = b64({ alg: opts.alg ?? 'RS256', typ: 'JWT', kid: opts.kid ?? 'k1' });
    const p = b64({ ...claims, ...over });
    const sig = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), (opts.key ?? keys).privateKey);
    return `${h}.${p}.${sig.toString('base64url')}`;
  }
  const check = (t: string) => codeOf(() => verifyIdToken(t, [jwk], expect_));

  it('aceita um token válido e devolve os claims', () => {
    expect(verifyIdToken(token(), [jwk], expect_).sub).toBe('u1');
  });

  it('CA-RN-96.4 recusa emissor, público, nonce, validade e partes autorizadas errados', () => {
    expect(check(token({ iss: 'https://outro' }))).toBe('sso_token_invalid');
    expect(check(token({ aud: 'outro' }))).toBe('sso_token_invalid');
    expect(check(token({ aud: ['cliente', 'outro'] }))).toBe('sso_token_invalid');
    expect(check(token({ aud: ['cliente', 'outro'], azp: 'cliente' }))).toBeNull();
    expect(check(token({ nonce: 'x' }))).toBe('sso_token_invalid');
    expect(check(token({ nonce: undefined }))).toBe('sso_token_invalid');
    expect(check(token({ exp: 1_000_000 - 120 }))).toBe('sso_token_invalid');
    expect(check(token({ exp: 1_000_000 - 30 }))).toBeNull(); // dentro da tolerância de relógio
    expect(check(token({ nbf: 1_000_000 + 600 }))).toBe('sso_token_invalid');
    expect(check(token({ sub: '' }))).toBe('sso_token_invalid');
  });

  it('CA-RN-96.4 recusa assinatura de outra chave, algoritmo diferente de RS256 e `kid` desconhecido', () => {
    expect(check(token({}, { key: other }))).toBe('sso_token_invalid');
    expect(check(token({}, { alg: 'HS256' }))).toBe('sso_token_invalid');
    expect(check(token({}, { alg: 'none' }))).toBe('sso_token_invalid');
    expect(check(token({}, { kid: 'desconhecida' }))).toBe('sso_token_invalid');
    expect(check('só.duas')).toBe('sso_token_invalid');
    expect(check('a.b.c')).toBe('sso_token_invalid');
    const tampered = token().split('.');
    tampered[1] = b64({ ...claims, sub: 'invasor' });
    expect(check(tampered.join('.'))).toBe('sso_token_invalid');
  });

  it('recusa chave RSA fraca (menos de 2048 bits)', () => {
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const weakJwk: Jwk = { ...(weak.publicKey.export({ format: 'jwk' }) as Jwk), kid: 'k1', use: 'sig' };
    const h = b64({ alg: 'RS256', kid: 'k1' });
    const p = b64(claims);
    const sig = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), weak.privateKey).toString('base64url');
    expect(codeOf(() => verifyIdToken(`${h}.${p}.${sig}`, [weakJwk], expect_))).toBe('sso_token_invalid');
  });
});
