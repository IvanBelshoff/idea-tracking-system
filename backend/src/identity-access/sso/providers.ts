import type { SsoProviderId } from '../entities/sso-provider.entity.js';
import type { IdTokenClaims } from './oidc.js';
import { SsoError } from './sso-errors.js';

/** O que o ITS extrai do id_token de um provedor, já conferido. */
export interface ProviderIdentity {
  issuer: string;
  /** Identificador estável da conta no provedor (Microsoft: `tid:oid`; Google: `sub`). */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  /** Domínio do Google Workspace (`hd`); nulo nas demais contas. */
  hostedDomain: string | null;
}

interface Preset {
  scope: string;
  /** Emissor do provedor para esta configuração (para a descoberta e para conferir o `iss`). */
  issuer(tenantId: string | null): string;
  /** Lê os claims; recusa com `SsoError` o que não vale (outro tenant, sem e-mail…). */
  identify(claims: IdTokenClaims, issuer: string, tenantId: string | null): ProviderIdentity;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const emailOf = (v: unknown): string | null => {
  const s = text(v)?.toLowerCase() ?? null;
  return s?.includes('@') ? s : null;
};

const microsoft: Preset = {
  scope: 'openid profile email',
  issuer: (tenantId) => `https://login.microsoftonline.com/${tenantId ?? ''}/v2.0`,
  identify(claims, issuer, tenantId) {
    // App de um tenant só: o `tid` do token tem de ser o da empresa (CA-RN-96.4).
    const tid = text(claims.tid)?.toLowerCase();
    if (!tid || !tenantId || tid !== tenantId.toLowerCase()) {
      throw new SsoError('sso_tenant_mismatch', 'A conta não pertence ao tenant da organização.');
    }
    const oid = text(claims.oid) ?? text(claims.sub);
    return {
      issuer,
      subject: `${tid}:${oid}`,
      // Como o tenant é da empresa, o e-mail (ou o nome de usuário) vem de quem o TI controla.
      email: emailOf(claims.email) ?? emailOf(claims.preferred_username),
      emailVerified: true,
      name: text(claims.name),
      hostedDomain: null,
    };
  },
};

const google: Preset = {
  scope: 'openid profile email',
  issuer: () => 'https://accounts.google.com',
  identify(claims, issuer) {
    return {
      issuer,
      subject: String(claims.sub),
      email: emailOf(claims.email),
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      name: text(claims.name),
      hostedDomain: text(claims.hd)?.toLowerCase() ?? null,
    };
  },
};

const PRESETS: Record<SsoProviderId, Preset> = { microsoft, google };

export const presetOf = (id: SsoProviderId): Preset => PRESETS[id];

/**
 * Emissor efetivo. Nos testes (`NODE_ENV=test`) pode ser trocado por um provedor falso local pela
 * variável `SSO_ISSUER_OVERRIDE_<PROVEDOR>`; em produção a variável é ignorada.
 */
export function issuerFor(id: SsoProviderId, tenantId: string | null): string {
  const override = process.env.NODE_ENV === 'test' ? process.env[`SSO_ISSUER_OVERRIDE_${id.toUpperCase()}`] : undefined;
  return override || PRESETS[id].issuer(tenantId);
}
