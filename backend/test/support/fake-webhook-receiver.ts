import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * Receptor de webhook falso e local, só em 127.0.0.1 (como o SMTP, o Graph e o OIDC falsos). Registra
 * cada pedido (cabeçalhos e corpo) e cada conexão aberta; responde o que o teste mandar. Nada aqui
 * fala com a internet, e o ITS só alcança o loopback com `NODE_ENV=test`.
 */
export interface ReceivedHook {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export class FakeWebhookReceiver {
  private server: Server | null = null;
  port = 0;

  /** A resposta de cada pedido: um status fixo ou uma função do pedido (ex.: falhar as duas primeiras vezes). */
  respond: number | ((n: number, hook: ReceivedHook) => number) = 200;
  /** Espera antes de responder, em ms (para o teste do tempo limite). */
  delayMs = 0;
  /** Cabeçalho `Location` das respostas 3xx. */
  location: string | null = null;
  /** Corpo devolvido (para o teste de resposta grande). */
  responseBody = 'ok';

  readonly received: ReceivedHook[] = [];
  /** Conexões abertas, mesmo que o pedido nunca chegue: prova que um destino bloqueado não foi alcançado. */
  connections = 0;

  get base(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.server.on('connection', () => {
      this.connections++;
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  reset(): void {
    this.received.length = 0;
    this.connections = 0;
    this.respond = 200;
    this.delayMs = 0;
    this.location = null;
    this.responseBody = 'ok';
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const hook: ReceivedHook = {
      path: req.url ?? '',
      headers: req.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    };
    this.received.push(hook);
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    const status = typeof this.respond === 'function' ? this.respond(this.received.length, hook) : this.respond;
    const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
    if (this.location) headers.Location = this.location;
    res.writeHead(status, headers);
    res.end(this.responseBody);
  }
}
