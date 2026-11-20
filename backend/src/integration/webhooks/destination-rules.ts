import { BlockList, isIP } from 'node:net';
import { parseIpEntry, plainIp } from '../ip-rules.js';

/**
 * Destinos dos webhooks (M17, RN-117 e RN-118): regras puras, sem rede e sem banco. O ITS só chama o
 * que o administrador permitiu (nome, domínio com curinga, IP ou faixa), e NUNCA chama o que cai numa
 * classe sempre bloqueada (loopback, link local, metadados de nuvem, não especificado, multicast),
 * mesmo que alguém a cadastre. A checagem vale ao salvar e a cada entrega, com o endereço RESOLVIDO.
 */
export const MAX_DESTINATIONS = 50;

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const WILDCARD = /^\*\.[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Uma entrada da lista, normalizada (minúsculas; IP e faixa como na RN-103); nulo se inválida. */
export function parseDestination(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (!text || text.length > 253) return null;
  if (text.includes('/') || isIP(plainIp(text))) return parseIpEntry(text);
  if (WILDCARD.test(text) || HOST.test(text)) return text;
  return null;
}

/** A lista inteira: normaliza, tira repetidos e confere o limite de 50. Nulo se alguma for inválida. */
export function normalizeDestinations(list: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const raw of list) {
    const entry = parseDestination(raw);
    if (!entry) return null;
    if (!out.includes(entry)) out.push(entry);
  }
  return out.length > MAX_DESTINATIONS ? null : out;
}

const isIpEntry = (entry: string) => entry.includes('/') || isIP(entry) !== 0;

/** O nome casa com um nome da lista ou com um domínio com curinga (`*.x` cobre os subdomínios, não o domínio puro)? */
export function hostMatches(hostname: string, entries: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return entries.some((entry) => {
    if (isIpEntry(entry)) return false;
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);
      return host.length > suffix.length && host.endsWith(suffix);
    }
    return host === entry;
  });
}

function blockListOf(
  ranges: readonly [string, number, 'ipv4' | 'ipv6'][],
  singles: readonly [string, 'ipv4' | 'ipv6'][] = [],
) {
  const list = new BlockList();
  for (const [address, prefix, type] of ranges) list.addSubnet(address, prefix, type);
  for (const [address, type] of singles) list.addAddress(address, type);
  return list;
}

const ALWAYS_BLOCKED = blockListOf(
  [
    ['0.0.0.0', 8, 'ipv4'],
    ['169.254.0.0', 16, 'ipv4'],
    ['224.0.0.0', 4, 'ipv4'],
    ['240.0.0.0', 4, 'ipv4'],
    ['fe80::', 10, 'ipv6'],
    ['ff00::', 8, 'ipv6'],
  ],
  [
    ['::', 'ipv6'],
    ['fd00:ec2::254', 'ipv6'],
  ],
);
const LOOPBACK = blockListOf([['127.0.0.0', 8, 'ipv4']], [['::1', 'ipv6']]);
const PRIVATE = blockListOf([
  ['10.0.0.0', 8, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['fc00::', 7, 'ipv6'],
]);

const familyName = (ip: string) => (isIP(ip) === 4 ? 'ipv4' : 'ipv6');

/**
 * Classe sempre bloqueada: não especificado, link local (inclui os metadados de nuvem `169.254.169.254`),
 * multicast, reservado e o equivalente em IPv6. O loopback também, salvo `allowLoopback` (só nos testes).
 */
export function isBlockedAddress(ip: string, allowLoopback = false): boolean {
  const address = plainIp(ip);
  if (!isIP(address)) return true;
  if (ALWAYS_BLOCKED.check(address, familyName(address))) return true;
  return !allowLoopback && LOOPBACK.check(address, familyName(address));
}

/** Rede interna (privada)? O loopback conta só com `allowLoopback` (testes). Só ela aceita `http://`. */
export function isInternalAddress(ip: string, allowLoopback = false): boolean {
  const address = plainIp(ip);
  if (!isIP(address)) return false;
  if (PRIVATE.check(address, familyName(address))) return true;
  return allowLoopback && LOOPBACK.check(address, familyName(address));
}

function ipEntriesMatch(ip: string, entries: readonly string[]): boolean {
  const ipEntries = entries.filter(isIpEntry);
  if (ipEntries.length === 0) return false;
  const list = new BlockList();
  for (const entry of ipEntries) {
    const slash = entry.indexOf('/');
    const base = slash === -1 ? entry : entry.slice(0, slash);
    const type = familyName(base);
    if (slash === -1) list.addAddress(base, type);
    else list.addSubnet(base, Number(entry.slice(slash + 1)), type);
  }
  const address = plainIp(ip);
  return isIP(address) !== 0 && list.check(address, familyName(address));
}

export type DestinationError =
  | 'invalid_url'
  | 'credentials_not_allowed'
  | 'destination_blocked'
  | 'destination_not_allowed'
  | 'https_required'
  | 'unresolved';

export interface UrlParts {
  scheme: 'http' | 'https';
  hostname: string;
  literalIp: boolean;
}

/** A parte da URL que decide o destino; erro de forma (esquema, credencial) já aqui. */
export function parseWebhookUrl(
  raw: string,
): { ok: true; parts: UrlParts; url: URL } | { ok: false; code: DestinationError } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: 'invalid_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, code: 'invalid_url' };
  if (url.username || url.password) return { ok: false, code: 'credentials_not_allowed' };
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) return { ok: false, code: 'invalid_url' };
  return {
    ok: true,
    url,
    parts: { scheme: url.protocol === 'https:' ? 'https' : 'http', hostname, literalIp: isIP(hostname) !== 0 },
  };
}

export interface ResolvedCheck {
  scheme: 'http' | 'https';
  hostname: string;
  /** Os endereços que o nome resolveu agora (um IP literal resolve para ele mesmo). */
  addresses: readonly string[];
  entries: readonly string[];
  allowLoopback?: boolean;
}

/**
 * A checagem do envio (e do salvar, depois de resolver): nenhum endereço pode ser de classe bloqueada;
 * o destino precisa estar na lista (pelo nome ou por TODOS os IPs resolvidos); `http` só para rede
 * interna. Devolve o endereço a que se conecta (já checado: resolver de novo não desvia a entrega).
 */
export function checkResolved(c: ResolvedCheck): { ok: true; address: string } | { ok: false; code: DestinationError } {
  if (c.addresses.length === 0) return { ok: false, code: 'unresolved' };
  if (c.addresses.some((a) => isBlockedAddress(a, c.allowLoopback))) return { ok: false, code: 'destination_blocked' };
  const literal = isIP(c.hostname) !== 0;
  const byName = !literal && hostMatches(c.hostname, c.entries);
  const byIp = c.addresses.every((a) => ipEntriesMatch(a, c.entries));
  if (!byName && !byIp) return { ok: false, code: 'destination_not_allowed' };
  if (c.scheme === 'http' && !c.addresses.every((a) => isInternalAddress(a, c.allowLoopback))) {
    return { ok: false, code: 'https_required' };
  }
  return { ok: true, address: plainIp(c.addresses[0] as string) };
}
