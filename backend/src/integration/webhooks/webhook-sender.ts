import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type { DataSource } from 'typeorm';
import { AuditService } from '../../audit/audit.service.js';
import { PtBrLogger } from '../../common/pt-br-logger.js';
import { open } from '../../communication/secret-box.js';
import { getSetting } from '../../organization/settings.service.js';
import { checkResolved, parseWebhookUrl } from './destination-rules.js';
import { WebhookDelivery, WebhookSecret, WebhookSubscription } from './entities.js';
import { buildBody, PING_EVENT, type WebhookData } from './events.js';
import { isRetryableStatus, nextDelaySeconds, signatureHeader, WEBHOOK_LIMITS } from './rules.js';
import { webhooksEnabled } from './webhook-emit.js';

const logger = new PtBrLogger('Webhooks');

/** O que o envio precisa do mundo de fora; os testes trocam por versões falsas (nunca a internet). */
export interface SenderDeps {
  resolve: (hostname: string) => Promise<string[]>;
  /** O loopback só vale nos testes (`NODE_ENV=test`), como os outros falsos do projeto. */
  allowLoopback: boolean;
  now: () => Date;
}

export const realDeps = (): SenderDeps => ({
  resolve: async (hostname) => (await lookup(hostname, { all: true })).map((a) => a.address),
  allowLoopback: process.env.NODE_ENV === 'test',
  now: () => new Date(),
});

export interface SendResult {
  kind: 'ok' | 'retry' | 'permanent';
  status: number | null;
  /** Código curto, nunca texto do destino. */
  error: string | null;
}

export interface SendInput {
  url: string;
  body: string;
  headers: Record<string, string>;
  destinations: readonly string[];
}

const DESTINATION_ERRORS: Record<string, string> = {
  invalid_url: 'invalid_url',
  credentials_not_allowed: 'invalid_url',
  destination_blocked: 'blocked_destination',
  destination_not_allowed: 'destination_not_allowed',
  https_required: 'https_required',
};

/**
 * Uma tentativa de envio (RN-118): resolve o nome, confere o endereço RESOLVIDO contra a lista e as
 * classes bloqueadas e conecta nesse endereço (resolver de novo não desvia a entrega). Não segue
 * redirecionamento, espera 10 s e lê no máximo 64 KB da resposta, que é descartada.
 */
export async function attemptSend(input: SendInput, deps: SenderDeps): Promise<SendResult> {
  const parsed = parseWebhookUrl(input.url);
  if (!parsed.ok) return { kind: 'permanent', status: null, error: DESTINATION_ERRORS[parsed.code] ?? 'invalid_url' };
  const { url, parts } = parsed;
  if (Buffer.byteLength(input.body) > WEBHOOK_LIMITS.maxBodyBytes) {
    return { kind: 'permanent', status: null, error: 'payload_too_large' };
  }

  let addresses: string[];
  try {
    addresses = isIP(parts.hostname) ? [parts.hostname] : await deps.resolve(parts.hostname);
  } catch {
    return { kind: 'retry', status: null, error: 'dns' };
  }
  const checked = checkResolved({
    scheme: parts.scheme,
    hostname: parts.hostname,
    addresses,
    entries: input.destinations,
    allowLoopback: deps.allowLoopback,
  });
  if (!checked.ok) {
    if (checked.code === 'unresolved') return { kind: 'retry', status: null, error: 'dns' };
    return { kind: 'permanent', status: null, error: DESTINATION_ERRORS[checked.code] ?? checked.code };
  }

  const client = parts.scheme === 'https' ? https : http;
  return new Promise<SendResult>((resolve) => {
    let settled = false;
    const done = (r: SendResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const req = client.request(
      {
        host: checked.address,
        port: url.port || (parts.scheme === 'https' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        // Agente próprio: o global do Node 24 obedece NODE_USE_ENV_PROXY/HTTPS_PROXY (usados pelo login
        // corporativo) e mandaria o aviso por um proxy, anulando a conexão ao endereço já checado.
        agent: parts.scheme === 'https' ? new https.Agent() : new http.Agent(),
        // O nome vai no Host e no SNI (a verificação do certificado), mas a conexão vai ao endereço já checado.
        servername: parts.literalIp ? undefined : parts.hostname,
        headers: {
          ...input.headers,
          Host: url.host,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(input.body)),
          'User-Agent': 'ITS-Webhooks/1',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let read = 0;
        res.on('data', (chunk: Buffer) => {
          read += chunk.length;
          if (read > WEBHOOK_LIMITS.maxResponseBytes) res.destroy();
        });
        res.on('error', () => undefined);
        res.on('close', () => undefined);
        // O corpo da resposta é descartado; só o código HTTP importa.
        res.resume();
        if (status >= 200 && status < 300) done({ kind: 'ok', status, error: null });
        else if (status >= 300 && status < 400) done({ kind: 'permanent', status, error: 'redirect' });
        else if (isRetryableStatus(status)) done({ kind: 'retry', status, error: `http_${status}` });
        else done({ kind: 'permanent', status, error: `http_${status}` });
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done({ kind: 'retry', status: null, error: 'timeout' });
    }, WEBHOOK_LIMITS.timeoutMs);
    req.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      done({
        kind: 'retry',
        status: null,
        error: error.code?.startsWith('ERR_TLS') || error.code?.includes('CERT') ? 'tls' : 'connection',
      });
    });
    req.on('close', () => clearTimeout(timer));
    req.end(input.body);
  });
}

/** Os segredos de uma assinatura que assinam agora: não revogados, dentro da validade e fora da aposentadoria. */
export async function activeSecrets(ds: DataSource, subscriptionId: string, now: Date): Promise<string[]> {
  const rows = await ds.getRepository(WebhookSecret).find({ where: { subscriptionId }, order: { createdAt: 'DESC' } });
  return rows
    .filter(
      (s) =>
        !s.revokedAt && s.expiresAt.getTime() > now.getTime() && (!s.retireAt || s.retireAt.getTime() > now.getTime()),
    )
    .map((s) => open(s.secretEncrypted));
}

/** Os cabeçalhos de uma entrega (RN-120). */
export function deliveryHeaders(
  type: string,
  eventId: string,
  secrets: readonly string[],
  body: string,
  now: Date,
): Record<string, string> {
  const timestamp = Math.floor(now.getTime() / 1000);
  return {
    'X-ITS-Event': type,
    'X-ITS-Event-Id': eventId,
    'X-ITS-Timestamp': String(timestamp),
    'X-ITS-Signature': signatureHeader(secrets, timestamp, body),
  };
}

/** O evento de teste (`webhook.ping`, RN-122): passa pela checagem do destino e pela assinatura, sem ideia nem escopo. */
export async function sendPing(
  ds: DataSource,
  subscription: Pick<WebhookSubscription, 'id' | 'url'>,
  deps: SenderDeps = realDeps(),
): Promise<SendResult> {
  const now = deps.now();
  const secrets = await activeSecrets(ds, subscription.id, now);
  if (secrets.length === 0) return { kind: 'permanent', status: null, error: 'secret_expired' };
  const id = randomUUID();
  const body = buildBody({ id, type: PING_EVENT, createdAt: now, data: {} as WebhookData });
  const destinations = await getSetting(ds.manager, 'integration.webhook_destinations');
  return attemptSend(
    { url: subscription.url, body, headers: deliveryHeaders(PING_EVENT, id, secrets, body, now), destinations },
    deps,
  );
}

/**
 * Resolve o resultado de uma entrega (RN-121): entregue, nova tentativa no calendário, ou falha. A falha
 * definitiva (inclusive a de quem esgotou as repetições) conta para a suspensão automática da assinatura.
 */
export function nextState(
  attemptsAfter: number,
  result: SendResult,
  now: Date,
): { state: 'delivered' | 'pending' | 'failed'; nextAttemptAt: Date | null; definitive: boolean } {
  if (result.kind === 'ok') return { state: 'delivered', nextAttemptAt: null, definitive: false };
  if (result.kind === 'retry') {
    const delay = nextDelaySeconds(attemptsAfter);
    if (delay !== null)
      return { state: 'pending', nextAttemptAt: new Date(now.getTime() + delay * 1000), definitive: false };
  }
  return { state: 'failed', nextAttemptAt: null, definitive: true };
}

/** Soma da espera de quem foi pego de surpresa: a entrega "emprestada" ao worker (não é enviada duas vezes ao mesmo tempo). */
const LEASE_SECONDS = 120;

/**
 * A rodada do worker (RN-121): pega as entregas devidas de forma atômica (uma só por vez, mesmo com
 * dois processos) e envia. Nunca lança. Devolve quantas foram tentadas.
 */
export async function deliverDue(ds: DataSource, deps: SenderDeps = realDeps(), limit = 20): Promise<number> {
  // O TypeORM devolve `[linhas, contagem]` nos UPDATE ... RETURNING do PostgreSQL.
  const [claimed] = (await ds.query(
    `UPDATE webhook_delivery SET next_attempt_at = now() + make_interval(secs => $2)
      WHERE id IN (SELECT id FROM webhook_delivery WHERE state = 'pending' AND next_attempt_at <= now()
                    ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING id`,
    [limit, LEASE_SECONDS],
  )) as [{ id: string }[], number];
  const ids = claimed.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(
      ids.slice(i, i + 5).map((id) =>
        deliverOne(ds, id, deps).catch((error) => {
          logger.warn(`Falha ao entregar um webhook: ${error instanceof Error ? error.message : error}`);
        }),
      ),
    );
  }
  return ids.length;
}

async function deliverOne(ds: DataSource, id: string, deps: SenderDeps): Promise<void> {
  const repo = ds.getRepository(WebhookDelivery);
  const delivery = await repo.findOne({
    where: { id },
    relations: { event: true, subscription: { integration: true } },
  });
  if (delivery?.state !== 'pending') return;
  const now = deps.now();
  const sub = delivery.subscription;
  // A idade conta da entrega (criada junto com o evento); o reenvio a reinicia.
  const ageHours = (now.getTime() - delivery.createdAt.getTime()) / 3_600_000;

  // O que passou de 48 horas vira falha (RN-117); fora isso, chave desligada ou assinatura parada só espera.
  if (ageHours > WEBHOOK_LIMITS.expireAfterHours) {
    await repo.update({ id }, { state: 'failed', lastError: 'expired', nextAttemptAt: now });
    return;
  }
  if (!(await webhooksEnabled(ds.manager)) || sub.status !== 'active' || sub.integration.status !== 'active') {
    await repo.update({ id }, { nextAttemptAt: new Date(now.getTime() + 60_000) });
    return;
  }

  const secrets = await activeSecrets(ds, sub.id, now);
  let result: SendResult;
  if (secrets.length === 0) {
    result = { kind: 'permanent', status: null, error: 'secret_expired' };
  } else {
    const body = buildBody(delivery.event);
    const destinations = await getSetting(ds.manager, 'integration.webhook_destinations');
    result = await attemptSend(
      {
        url: sub.url,
        body,
        headers: deliveryHeaders(delivery.event.type, delivery.event.id, secrets, body, now),
        destinations,
      },
      deps,
    );
  }

  const attempts = delivery.attempts + 1;
  const next = nextState(attempts, result, now);
  await repo.update(
    { id },
    {
      state: next.state,
      attempts,
      nextAttemptAt: next.nextAttemptAt ?? now,
      lastStatus: result.status,
      lastError: result.error,
      deliveredAt: next.state === 'delivered' ? now : null,
    },
  );
  await trackSubscription(ds, sub, next.state, next.definitive);
}

/** Zera a contagem num sucesso; 20 falhas definitivas seguidas suspendem a assinatura e vão à auditoria (RN-121, RN-124). */
async function trackSubscription(
  ds: DataSource,
  sub: WebhookSubscription,
  state: string,
  definitive: boolean,
): Promise<void> {
  const repo = ds.getRepository(WebhookSubscription);
  if (state === 'delivered') {
    if (sub.consecutiveFailures > 0) await repo.update({ id: sub.id }, { consecutiveFailures: 0 });
    return;
  }
  if (!definitive) return;
  const [rows] = (await ds.query(
    'UPDATE webhook_subscription SET consecutive_failures = consecutive_failures + 1 WHERE id = $1 RETURNING consecutive_failures',
    [sub.id],
  )) as [{ consecutive_failures: number }[], number];
  const failures = rows[0]?.consecutive_failures ?? 0;
  if (failures >= WEBHOOK_LIMITS.maxConsecutiveFailures && sub.status === 'active') {
    await repo.update({ id: sub.id }, { status: 'suspended', suspendedReason: 'failures' });
    await new AuditService(ds).record({
      action: 'integration.webhook_suspended_failures',
      actorId: null,
      targetType: 'webhook_subscription',
      targetId: sub.id,
      data: { integrationId: sub.integrationId, subscription: sub.name, failures },
    });
    logger.warn(`Assinatura de webhook suspensa por falhas seguidas: ${sub.name}`);
  }
}
