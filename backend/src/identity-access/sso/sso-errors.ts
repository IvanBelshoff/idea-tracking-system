/**
 * Códigos de erro do login corporativo. Voltam à tela de entrada como `?sso_erro=<código>` e são
 * traduzidos pelo frontend; nunca levam token, e-mail de terceiros ou detalhe técnico (CA-T.12).
 */
export const SSO_ERROR_CODES = [
  'sso_not_configured',
  'sso_state_invalid',
  'sso_provider_error',
  'sso_token_invalid',
  'sso_tenant_mismatch',
  'sso_email_missing',
  'sso_email_unverified',
  'sso_domain_not_allowed',
  'sso_user_not_found',
  'sso_user_disabled',
  'sso_identity_conflict',
  'sso_provisioning_unavailable',
  'sso_network',
  'sso_session_required',
] as const;

export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];

/** Falha do fluxo. A mensagem é para o log/auditoria em português; a tela usa só o código. */
export class SsoError extends Error {
  constructor(
    readonly code: SsoErrorCode,
    message: string,
  ) {
    super(message);
  }
}
