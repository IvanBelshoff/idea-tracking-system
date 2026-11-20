import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * Google falso e local, só em 127.0.0.1 (como o Graph e o OIDC falsos): o pedido de token da conta de
 * serviço (JWT assinado, `jwt-bearer`) e o `messages.send` da Gmail API. Confere a assinatura do JWT com
 * a chave pública do par gerado aqui, os campos (`iss`, `sub`, `scope`, `aud`, `exp`), aceita só tokens
 * que ele mesmo emitiu e registra o que recebeu. Os campos de falha forçam cada erro que o ITS trata.
 * Nada aqui fala com o Google.
 */

export const SERVICE_ACCOUNT_EMAIL = 'its-mail@projeto-teste.iam.gserviceaccount.com';

/** Um par RSA novo e o conteúdo do arquivo JSON da conta de serviço, como o Google Cloud entrega. */
export function makeServiceAccount(email = SERVICE_ACCOUNT_EMAIL) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const json = JSON.stringify({
    type: 'service_account',
    project_id: 'projeto-teste',
    private_key_id: 'abc123',
    private_key: privatePem,
    client_email: email,
    client_id: '123456789012345678901',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
  return { json, privatePem, publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), email };
}

export interface SentGmail {
  mailbox: string;
  token: string;
  raw: string;
  /** Cabeçalhos e corpo da mensagem já decodificada. */
  mime: string;
}

export class FakeGoogle {
  private server: Server | null = null;
  private seq = 0;
  private readonly valid = new Set<string>();
  port = 0;

  readonly account = makeServiceAccount();
  /** Só estas caixas existem no domínio (`invalid_grant` para as outras); vazio = qualquer uma. */
  knownMailboxes: string[] = [];
  /** O pedido de token responde este erro do protocolo (ex.: `unauthorized_client`, `invalid_grant`). */
  tokenError: { status: number; code: string } | null = null;
  /** O `send` responde este status com o código e o motivo dados. */
  sendError: { status: number; code: string; reason?: string } | null = null;

  tokenRequests = 0;
  sendRequests = 0;
  readonly sent: SentGmail[] = [];
  /** Tudo o que o falso devolveu de sensível, para conferir que não vaza (CA-T.12). */
  readonly issuedTokens: string[] = [];
  lastClaims: Record<string, unknown> | null = null;
  lastAssertion = '';

  get base(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get tokenUrl(): string {
    return `${this.base}/token`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }

  reset(): void {
    this.valid.clear();
    this.knownMailboxes = [];
    this.tokenError = null;
    this.sendError = null;
    this.tokenRequests = 0;
    this.sendRequests = 0;
    this.sent.length = 0;
    this.issuedTokens.length = 0;
    this.lastClaims = null;
    this.lastAssertion = '';
  }

  /** Faz o Google recusar os tokens já emitidos (`401`), como um token revogado. */
  revokeAll(): void {
    this.valid.clear();
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }

  /** Confere a assinatura RS256 e devolve os campos; `null` se a assinatura não bate. */
  private verifyAssertion(assertion: string): Record<string, unknown> | null {
    const [head, claims, signature] = assertion.split('.');
    if (!head || !claims || !signature) return null;
    const verifier = createVerify('RSA-SHA256').update(`${head}.${claims}`);
    if (!verifier.verify(createPublicKey(this.account.publicPem), Buffer.from(signature, 'base64url'))) return null;
    return JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as Record<string, unknown>;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.base);

    if (req.method === 'POST' && url.pathname === '/token') {
      this.tokenRequests++;
      const form = new URLSearchParams(await this.readBody(req));
      this.lastAssertion = form.get('assertion') ?? '';
      if (this.tokenError) {
        return this.json(res, this.tokenError.status, {
          error: this.tokenError.code,
          error_description: 'descricao-com-dado-sensivel-do-google',
        });
      }
      if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
        return this.json(res, 400, { error: 'unsupported_grant_type' });
      }
      const claims = this.verifyAssertion(this.lastAssertion);
      this.lastClaims = claims;
      const nowSec = Math.floor(Date.now() / 1000);
      const ok =
        claims !== null &&
        claims.iss === this.account.email &&
        claims.scope === 'https://www.googleapis.com/auth/gmail.send' &&
        claims.aud === this.tokenUrl &&
        typeof claims.exp === 'number' &&
        claims.exp > nowSec &&
        typeof claims.iat === 'number' &&
        claims.exp - claims.iat <= 3600;
      if (!ok) return this.json(res, 400, { error: 'invalid_grant' });
      if (this.knownMailboxes.length > 0 && !this.knownMailboxes.includes(String(claims.sub))) {
        return this.json(res, 400, { error: 'invalid_grant' });
      }
      const token = `fake-google-token-${++this.seq}`;
      this.valid.add(token);
      this.issuedTokens.push(token);
      return this.json(res, 200, { token_type: 'Bearer', expires_in: 3599, access_token: token });
    }

    if (req.method === 'POST' && url.pathname === '/gmail/v1/users/me/messages/send') {
      this.sendRequests++;
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const raw = await this.readBody(req);
      if (!this.valid.has(token)) {
        return this.json(res, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
      }
      if (this.sendError) {
        const { status, code, reason } = this.sendError;
        return this.json(res, status, {
          error: {
            code: status,
            status: code,
            message: 'corpo-com-dado-sensivel-do-google',
            errors: reason ? [{ reason, message: 'detalhe-sensivel' }] : [],
          },
        });
      }
      const payload = JSON.parse(raw) as { raw: string };
      const mime = Buffer.from(payload.raw, 'base64url').toString('utf8');
      this.sent.push({ mailbox: String(this.lastClaims?.sub ?? ''), token, raw: payload.raw, mime });
      return this.json(res, 200, { id: 'msg-1', threadId: 'thr-1', labelIds: ['SENT'] });
    }

    res.writeHead(404);
    res.end();
  }
}
