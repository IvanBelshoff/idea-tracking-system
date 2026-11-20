import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Regras puras dos webhooks (M17, RN-118 a RN-122): limites, calendário de repetição, assinatura e o
 * receptor de referência (que a Ajuda de TI e os testes usam para conferir uma entrega).
 */
export const WEBHOOK_LIMITS = {
  maxSubscriptions: 5,
  maxActiveSecrets: 2,
  maxSecretDays: 365,
  defaultOverlapHours: 24,
  maxOverlapHours: 72,
  /** Aviso enviado e resposta lida (RN-118). */
  maxBodyBytes: 8 * 1024,
  maxResponseBytes: 64 * 1024,
  timeoutMs: 10_000,
  /** Falhas definitivas seguidas que suspendem a assinatura (RN-121). */
  maxConsecutiveFailures: 20,
  /** O que está pendente há mais que isto vira falha (RN-117). */
  expireAfterHours: 48,
  /** Pendência antiga que põe a saúde em atenção (RN-123). */
  staleMinutes: 15,
  /** Tolerância do carimbo para quem recebe (RN-120). */
  toleranceSeconds: 300,
} as const;

/**
 * Espera antes de cada repetição, em segundos: 30 s, 2 min, 10 min, 1 h, 3 h, 6 h, 12 h e 24 h. Há a
 * primeira tentativa e mais até 8 repetições (cerca de 46 horas); esgotadas, a entrega fica em falha.
 */
export const REPEAT_DELAYS_SECONDS = [30, 120, 600, 3600, 10_800, 21_600, 43_200, 86_400] as const;

/** Segundos até a próxima tentativa depois de `attemptsMade` tentativas; nulo se esgotou (RN-121). */
export function nextDelaySeconds(attemptsMade: number): number | null {
  return REPEAT_DELAYS_SECONDS[attemptsMade - 1] ?? null;
}

/** O resultado de HTTP é repetível? Rede, `5xx`, `408` e `429`; `3xx` e os demais `4xx` são definitivos. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export const SECRET_MARK = 'whsec_';
export const SECRET_PREFIX_LENGTH = 10;

export function newWebhookSecret(): { secret: string; prefix: string } {
  const secret = `${SECRET_MARK}${randomBytes(32).toString('base64url')}`;
  return { secret, prefix: secret.slice(0, SECRET_PREFIX_LENGTH) };
}

/** O HMAC-SHA256, em hexadecimal, de `<timestamp>.<corpo>` (RN-120). */
export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** O cabeçalho `X-ITS-Signature`: uma assinatura por segredo ativo (duas durante a janela de rotação). */
export function signatureHeader(secrets: readonly string[], timestamp: number, body: string): string {
  return secrets.map((s) => `v1=${signPayload(s, timestamp, body)}`).join(',');
}

/**
 * O receptor de referência (a Ajuda de TI mostra este mesmo passo): confere o carimbo, dentro de 5
 * minutos para os dois lados, e se alguma assinatura `v1` do cabeçalho bate com o segredo.
 */
export function verifySignature(input: {
  header: string | undefined;
  secret: string;
  timestamp: string | undefined;
  body: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: 'missing' | 'stale' | 'mismatch' } {
  const ts = Number(input.timestamp);
  if (!input.header || !input.timestamp || !Number.isFinite(ts)) return { ok: false, reason: 'missing' };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (input.toleranceSeconds ?? WEBHOOK_LIMITS.toleranceSeconds))
    return { ok: false, reason: 'stale' };
  const expected = Buffer.from(signPayload(input.secret, ts, input.body), 'hex');
  for (const part of input.header.split(',')) {
    const [version, value] = part.trim().split('=');
    if (version !== 'v1' || !value || !/^[0-9a-f]{64}$/.test(value)) continue;
    if (timingSafeEqual(Buffer.from(value, 'hex'), expected)) return { ok: true };
  }
  return { ok: false, reason: 'mismatch' };
}
