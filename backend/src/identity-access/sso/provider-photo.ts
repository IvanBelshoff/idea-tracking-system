import type { SsoProviderId } from '../entities/sso-provider.entity.js';

/**
 * Foto do perfil vinda do provedor do login corporativo (RN-144). A busca é feita pelo SERVIDOR e só vai
 * a endereços fixos do provedor, sempre `https`, sem seguir redirecionamento, com tempo e tamanho
 * limitados (CA-T.22). Qualquer outro endereço é ignorado sem conexão nenhuma.
 *
 * Em teste (`NODE_ENV=test`), o Graph falso entra por `SSO_GRAPH_BASE_OVERRIDE` e o servidor de fotos
 * falso do Google por `SSO_PHOTO_TEST_HOST` (`127.0.0.1:porta` exato); fora de teste, as duas são ignoradas.
 */
export const PHOTO_TIMEOUT_MS = 5_000;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const GRAPH = 'https://graph.microsoft.com';
/** Tamanho pedido ao Graph; sem esse tamanho (foto menor), cai na foto original. */
const GRAPH_SIZE = '504x504';

const testOnly = (name: string): string | undefined =>
  process.env.NODE_ENV === 'test' ? process.env[name] || undefined : undefined;

function graphBase(): string {
  return (testOnly('SSO_GRAPH_BASE_OVERRIDE') ?? GRAPH).replace(/\/+$/, '');
}

/** O endereço pode ser buscado? Só os hosts fixos de cada provedor (ou o host falso exato, em teste). */
export function isAllowedPhotoUrl(provider: SsoProviderId, raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const testHost = testOnly('SSO_PHOTO_TEST_HOST');
  if (testHost && url.protocol === 'http:' && url.host === testHost) return true;
  if (provider === 'microsoft') {
    const base = new URL(graphBase());
    return url.protocol === base.protocol && url.host === base.host;
  }
  if (url.protocol !== 'https:' || url.port !== '') return false;
  const host = url.hostname.toLowerCase();
  return host.endsWith('.googleusercontent.com');
}

export interface PhotoRequest {
  urls: string[];
  bearer: string | null;
}

/**
 * O que buscar para cada provedor: Microsoft, a foto da pessoa no Graph com o token de acesso (precisa de
 * `User.Read`); Google, o endereço `picture` do id_token, pedindo 512 px. Sem dado suficiente, nada.
 */
export function photoRequestFor(
  provider: SsoProviderId,
  claims: Record<string, unknown>,
  accessToken: string | null,
): PhotoRequest | null {
  if (provider === 'microsoft') {
    if (!accessToken) return null;
    const base = graphBase();
    return {
      urls: [`${base}/v1.0/me/photos/${GRAPH_SIZE}/$value`, `${base}/v1.0/me/photo/$value`],
      bearer: accessToken,
    };
  }
  const picture = typeof claims.picture === 'string' ? claims.picture.trim() : '';
  if (!picture || picture.length > 2000) return null;
  // As fotos do Google aceitam o tamanho no fim (=s96-c); pede 512 px quadrados.
  const sized = /=s\d+(-c)?$/.test(picture) ? picture.replace(/=s\d+(-c)?$/, '=s512-c') : picture;
  return { urls: [sized], bearer: null };
}

async function readCapped(res: Response): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > PHOTO_MAX_BYTES) return null;
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PHOTO_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Busca a foto. Devolve os bytes ou null (endereço não permitido, 404, tempo esgotado, grande demais,
 * redirecionamento). Nunca lança: o login não pode falhar por causa da foto. O token não sai daqui.
 */
export async function fetchProviderPhoto(provider: SsoProviderId, request: PhotoRequest): Promise<Buffer | null> {
  for (const url of request.urls) {
    if (!isAllowedPhotoUrl(provider, url)) return null;
    try {
      const res = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
        headers: { accept: 'image/*', ...(request.bearer ? { authorization: `Bearer ${request.bearer}` } : {}) },
      });
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      return await readCapped(res);
    } catch {
      return null;
    }
  }
  return null;
}
