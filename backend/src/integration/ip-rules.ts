import { BlockList, isIP } from 'node:net';
import { INTEGRATION_LIMITS } from './modules.js';

/**
 * Lista de IPs da integração (RN-103): endereços ou faixas CIDR, IPv4 ou IPv6; vazia = qualquer origem.
 * Regras puras. O IP que se confere é o real, repassado pelo nginx (`trust proxy`).
 */

/** `::ffff:10.0.0.1` (IPv4 dentro de IPv6, comum atrás de proxy) vira `10.0.0.1`. */
export function plainIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped?.[1] ?? ip;
}

/** Uma entrada da lista, normalizada (`10.0.0.0/8`, `203.0.113.7`); nulo se inválida. */
export function parseIpEntry(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const slash = text.indexOf('/');
  if (slash === -1) {
    const ip = plainIp(text);
    return isIP(ip) ? ip.toLowerCase() : null;
  }
  const address = plainIp(text.slice(0, slash));
  const prefixText = text.slice(slash + 1);
  const family = isIP(address);
  if (!family || !/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix < 0 || prefix > (family === 4 ? 32 : 128)) return null;
  return `${address.toLowerCase()}/${prefix}`;
}

/**
 * Valida a lista inteira: normaliza, tira repetidos e confere o limite de 20 entradas. Nulo se
 * alguma entrada for inválida ou passar do limite.
 */
export function normalizeIpList(list: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const raw of list) {
    const entry = parseIpEntry(raw);
    if (!entry) return null;
    if (!out.includes(entry)) out.push(entry);
  }
  return out.length > INTEGRATION_LIMITS.maxIpEntries ? null : out;
}

/** O IP de origem está na lista? Lista vazia aceita qualquer origem; IP desconhecido com lista, não. */
export function ipAllowed(ip: string | null | undefined, list: readonly string[]): boolean {
  if (list.length === 0) return true;
  if (!ip) return false;
  const address = plainIp(ip);
  const family = isIP(address);
  if (!family) return false;
  const block = new BlockList();
  for (const entry of list) {
    const slash = entry.indexOf('/');
    const base = slash === -1 ? entry : entry.slice(0, slash);
    const baseFamily = isIP(base);
    if (!baseFamily) continue;
    const type = baseFamily === 4 ? 'ipv4' : 'ipv6';
    if (slash === -1) block.addAddress(base, type);
    else block.addSubnet(base, Number(entry.slice(slash + 1)), type);
  }
  return block.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
