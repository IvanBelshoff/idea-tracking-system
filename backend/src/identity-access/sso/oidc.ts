import { createHash, createPublicKey, verify as cryptoVerify, randomBytes, type webcrypto } from 'node:crypto';
import { SsoError } from './sso-errors.js';

/**
 * Cliente OpenID Connect enxuto (RN-96): fluxo de código com PKCE, no servidor, sobre `fetch` e
 * `node:crypto`, sem dependência nova. Confere assinatura RS256, emissor, público, validade e
 * `nonce` do id_token. Nada aqui lê o banco: quem chama passa a configuração.
 */

export interface OidcEndpoints {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface Jwk {
  kty?: string;
  kid?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface IdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  sub?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  nonce?: unknown;
  [claim: string]: unknown;
}

const TIMEOUT_MS = 10_000;
const MAX_BODY = 512 * 1024;
const CACHE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 60;
const MIN_RSA_BYTES = 256; // 2048 bits

const cache = new Map<string, { at: number; value: unknown }>();

/** Só `https`; `http` apenas para 127.0.0.1/localhost e só quando `NODE_ENV=test` (provedor falso). */
export function assertSecureUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsoError('sso_provider_error', 'Endereço do provedor inválido.');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && loopback && process.env.NODE_ENV === 'test') return url;
  throw new SsoError('sso_provider_error', 'O provedor precisa usar HTTPS.');
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (text.length > MAX_BODY) throw new SsoError('sso_provider_error', 'Resposta grande demais do provedor.');
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // cai no erro abaixo
  }
  throw new SsoError('sso_provider_error', 'Resposta inesperada do provedor.');
}

async function request(url: URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new SsoError('sso_network', 'Não foi possível falar com o provedor.');
  }
}

async function cachedJson(url: string, fresh: boolean): Promise<Record<string, unknown>> {
  const hit = cache.get(url);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value as Record<string, unknown>;
  const res = await request(assertSecureUrl(url));
  if (!res.ok) throw new SsoError('sso_provider_error', `O provedor respondeu ${res.status}.`);
  const value = await readJson(res);
  cache.set(url, { at: Date.now(), value });
  return value;
}

/** Esquece o que foi guardado do provedor (teste de conexão e testes automáticos). */
export function clearOidcCache(): void {
  cache.clear();
}

/** Descoberta (`/.well-known/openid-configuration`); o emissor devolvido tem de ser o esperado. */
export async function discover(issuer: string, fresh = false): Promise<OidcEndpoints> {
  const base = issuer.replace(/\/+$/, '');
  const doc = await cachedJson(`${base}/.well-known/openid-configuration`, fresh);
  if (doc.issuer !== issuer) throw new SsoError('sso_provider_error', 'O emissor do provedor não confere.');
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    const value = doc[key];
    if (typeof value !== 'string') throw new SsoError('sso_provider_error', 'Descoberta incompleta no provedor.');
    assertSecureUrl(value);
  }
  return doc as unknown as OidcEndpoints;
}

export async function fetchJwks(jwksUri: string, fresh = false): Promise<Jwk[]> {
  const doc = await cachedJson(jwksUri, fresh);
  return Array.isArray(doc.keys) ? (doc.keys as Jwk[]) : [];
}

export const newToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

export function authorizationUrl(
  endpoints: OidcEndpoints,
  p: { clientId: string; redirectUri: string; scope: string; state: string; nonce: string; challenge: string },
): string {
  const url = assertSecureUrl(endpoints.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('scope', p.scope);
  url.searchParams.set('state', p.state);
  url.searchParams.set('nonce', p.nonce);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/**
 * Troca o código pelo id_token (cliente confidencial, `client_secret_post`). O token de acesso só serve
 * para buscar a foto no Graph (RN-144), na hora, e nunca é guardado nem registrado.
 */
export async function exchangeCode(
  endpoints: OidcEndpoints,
  p: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string },
): Promise<{ idToken: string; accessToken: string | null }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    code_verifier: p.verifier,
  });
  const res = await request(assertSecureUrl(endpoints.token_endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const json = await readJson(res);
  if (!res.ok) {
    // Só o código do erro do protocolo (ex.: invalid_client); nunca a descrição, que pode ecoar dados.
    const code = typeof json.error === 'string' ? json.error.slice(0, 40) : String(res.status);
    throw new SsoError('sso_provider_error', `O provedor recusou a troca do código (${code}).`);
  }
  if (typeof json.id_token !== 'string' || json.id_token === '') {
    throw new SsoError('sso_token_invalid', 'O provedor não devolveu o id_token.');
  }
  const accessToken = typeof json.access_token === 'string' && json.access_token !== '' ? json.access_token : null;
  return { idToken: json.id_token, accessToken };
}

const invalid = (why: string) => new SsoError('sso_token_invalid', `id_token recusado: ${why}.`);

function decodePart(part: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // cai no erro abaixo
  }
  throw invalid('formato');
}

/** Cabeçalho do id_token, para saber o `kid` antes de buscar as chaves. */
export function tokenKid(idToken: string): string | undefined {
  const [h] = idToken.split('.');
  const kid = h ? decodePart(h).kid : undefined;
  return typeof kid === 'string' ? kid : undefined;
}

/**
 * Confere o id_token: assinatura RS256 com a chave do provedor (`kid`), emissor, público, validade
 * (com 60 s de tolerância de relógio) e `nonce`. Devolve os claims; recusa com `sso_token_invalid`.
 */
export function verifyIdToken(
  idToken: string,
  jwks: readonly Jwk[],
  expect: { issuer: string; audience: string; nonce: string; now?: number },
): IdTokenClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw invalid('formato');
  const [h, p, s] = parts as [string, string, string];
  const header = decodePart(h);
  if (header.alg !== 'RS256') throw invalid('algoritmo');
  if (typeof header.kid !== 'string') throw invalid('sem chave');

  const jwk = jwks.find((k) => k.kty === 'RSA' && k.kid === header.kid && (!k.use || k.use === 'sig'));
  if (!jwk || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') throw invalid('chave desconhecida');
  if (Buffer.from(jwk.n, 'base64url').length < MIN_RSA_BYTES) throw invalid('chave fraca');
  let valid = false;
  try {
    const key = createPublicKey({ key: jwk as webcrypto.JsonWebKey, format: 'jwk' });
    valid = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  } catch {
    valid = false;
  }
  if (!valid) throw invalid('assinatura');

  const claims = decodePart(p) as IdTokenClaims;
  const now = expect.now ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== expect.issuer) throw invalid('emissor');
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(expect.audience) : aud === expect.audience;
  if (!audOk) throw invalid('público');
  if (Array.isArray(aud) && aud.length > 1 && claims.azp !== expect.audience) throw invalid('parte autorizada');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw invalid('expirado');
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > now) throw invalid('ainda não vale');
  if (typeof claims.sub !== 'string' || claims.sub === '') throw invalid('sem identificador');
  if (claims.nonce !== expect.nonce) throw invalid('nonce');
  return claims;
}

/** Busca as chaves e confere o id_token; se a chave (`kid`) não está no cache, busca de novo uma vez. */
export async function verifyWithProviderKeys(
  idToken: string,
  endpoints: OidcEndpoints,
  expect: { issuer: string; audience: string; nonce: string },
): Promise<IdTokenClaims> {
  const kid = tokenKid(idToken);
  let keys = await fetchJwks(endpoints.jwks_uri);
  if (kid && !keys.some((k) => k.kid === kid)) keys = await fetchJwks(endpoints.jwks_uri, true);
  return verifyIdToken(idToken, keys, expect);
}
