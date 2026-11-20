import type { Request, Response } from 'express';
import { open, seal } from '../../communication/secret-box.js';
import type { SsoProviderId } from '../entities/sso-provider.entity.js';

/**
 * Estado do fluxo entre o início e o retorno do provedor, num cookie curto e cifrado (sem tabela).
 * Leva `state`, `nonce` e o verificador PKCE; só vale para o provedor e o modo em que foi criado,
 * por 10 minutos, e só é enviado em `/api/auth/sso`.
 */
export const SSO_COOKIE = 'its_sso';
const MAX_AGE_MS = 10 * 60 * 1000;

export interface SsoFlowState {
  provider: SsoProviderId;
  state: string;
  nonce: string;
  verifier: string;
  /** Caminho interno para onde voltar depois de entrar. */
  back: string;
  /** Teste de conexão do administrador (não troca a sessão). */
  test: boolean;
  /** Quem iniciou o teste (o retorno só vale para a mesma pessoa). */
  actorId: string | null;
  /** Fim da validade, em ms. */
  until: number;
}

export function writeFlowCookie(req: Request, res: Response, flow: Omit<SsoFlowState, 'until'>): void {
  const value = seal(JSON.stringify({ ...flow, until: Date.now() + MAX_AGE_MS })).toString('base64url');
  res.cookie(SSO_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/api/auth/sso',
    maxAge: MAX_AGE_MS,
  });
}

export function clearFlowCookie(req: Request, res: Response): void {
  res.clearCookie(SSO_COOKIE, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/api/auth/sso' });
}

/** Lê e confere o cookie; nulo se faltar, estiver adulterado, vencido ou for de outro provedor. */
export function readFlowCookie(req: Request, provider: SsoProviderId): SsoFlowState | null {
  const raw = (req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SSO_COOKIE}=`))
    ?.slice(SSO_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const flow = JSON.parse(open(Buffer.from(raw, 'base64url'))) as SsoFlowState;
    if (flow.provider !== provider || typeof flow.until !== 'number' || flow.until < Date.now()) return null;
    return flow;
  } catch {
    return null;
  }
}

/** Só caminho interno (`/algo`), nunca `//host` nem URL completa: sem redirecionamento aberto. */
export function safeBackPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  return raw.slice(0, 500);
}
