import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * Microsoft Graph falso e local, só em 127.0.0.1 (como o SMTP e o OIDC falsos): o pedido de token do
 * aplicativo (`client_credentials`) e o `sendMail`. Confere cliente e segredo, aceita só tokens que
 * ele mesmo emitiu e registra o que recebeu. Os campos de falha forçam cada erro que o ITS trata.
 * Nada aqui fala com a Microsoft.
 */

export interface SentMail {
  mailbox: string;
  token: string;
  message: {
    subject: string;
    body: { contentType: string; content: string };
    toRecipients: { emailAddress: { address: string } }[];
    replyTo?: { emailAddress: { address: string } }[];
  };
  saveToSentItems: boolean;
}

export class FakeGraph {
  private server: Server | null = null;
  private seq = 0;
  private readonly valid = new Set<string>();
  port = 0;

  /** Cliente e segredo que o aplicativo deve apresentar. */
  expectClient = { id: 'mail-client-id', secret: 'mail-client-secret' };
  /** Só estas caixas podem enviar (simula o RBAC do Exchange); vazio = qualquer uma. */
  allowedMailboxes: string[] = [];
  /** O pedido de token responde este erro do protocolo (ex.: `invalid_client`). */
  tokenError: string | null = null;
  /** O `sendMail` responde este status (ex.: 403, 404, 429, 503) com o código dado. */
  sendError: { status: number; code: string } | null = null;

  tokenRequests = 0;
  sendRequests = 0;
  readonly sent: SentMail[] = [];
  /** Tudo o que o falso devolveu de sensível, para conferir que não vaza (CA-T.12). */
  readonly issuedTokens: string[] = [];
  lastTokenBody: URLSearchParams | null = null;
  lastTokenPath = '';

  get base(): string {
    return `http://127.0.0.1:${this.port}`;
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
    this.allowedMailboxes = [];
    this.tokenError = null;
    this.sendError = null;
    this.tokenRequests = 0;
    this.sendRequests = 0;
    this.sent.length = 0;
    this.issuedTokens.length = 0;
    this.lastTokenBody = null;
  }

  /** Faz o Graph recusar os tokens já emitidos (`401`), como um token revogado. */
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

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.base);

    if (req.method === 'POST' && /\/oauth2\/v2\.0\/token$/.test(url.pathname)) {
      this.tokenRequests++;
      this.lastTokenPath = url.pathname;
      const form = new URLSearchParams(await this.readBody(req));
      this.lastTokenBody = form;
      if (this.tokenError) {
        return this.json(res, 401, { error: this.tokenError, error_description: 'descricao-com-segredo-secreto' });
      }
      const ok =
        form.get('grant_type') === 'client_credentials' &&
        form.get('client_id') === this.expectClient.id &&
        form.get('client_secret') === this.expectClient.secret &&
        form.get('scope') === 'https://graph.microsoft.com/.default';
      if (!ok) return this.json(res, 401, { error: 'invalid_client' });
      const token = `fake-graph-token-${++this.seq}`;
      this.valid.add(token);
      this.issuedTokens.push(token);
      return this.json(res, 200, { token_type: 'Bearer', expires_in: 3600, access_token: token });
    }

    const send = /^\/v1\.0\/users\/([^/]+)\/sendMail$/.exec(url.pathname);
    if (req.method === 'POST' && send) {
      this.sendRequests++;
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const mailbox = decodeURIComponent(send[1] as string);
      const raw = await this.readBody(req);
      if (!this.valid.has(token)) return this.json(res, 401, { error: { code: 'InvalidAuthenticationToken' } });
      if (this.sendError) {
        return this.json(res, this.sendError.status, {
          error: { code: this.sendError.code, message: 'corpo-com-dado-sensivel-do-graph' },
        });
      }
      if (this.allowedMailboxes.length > 0 && !this.allowedMailboxes.includes(mailbox)) {
        return this.json(res, 403, { error: { code: 'ErrorAccessDenied', message: 'sem permissão na caixa' } });
      }
      const payload = JSON.parse(raw) as Omit<SentMail, 'mailbox' | 'token'>;
      this.sent.push({ mailbox, token, ...payload });
      res.writeHead(202);
      return void res.end();
    }

    res.writeHead(404);
    res.end();
  }
}
