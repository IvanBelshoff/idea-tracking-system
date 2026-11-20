import { createServer, type Server, type Socket } from 'node:net';

/**
 * Servidor SMTP falso, só em 127.0.0.1 e só para os testes: aceita (ou recusa, quando pedido) e
 * guarda as mensagens na memória. Nada sai da máquina. Conta conexões para provar que, com o
 * envio desligado, nenhuma tentativa acontece (CA-RN-30.2).
 */
export interface ReceivedMail {
  from: string;
  to: string[];
  raw: string;
  subject: string;
  text: string;
}

export interface FakeSmtpOptions {
  user?: string;
  pass?: string;
}

export class FakeSmtp {
  connections = 0;
  messages: ReceivedMail[] = [];
  /** Quando definido, o servidor recusa o remetente com esta resposta (ex.: "451 ..."). */
  failWith: string | null = null;
  port = 0;
  private server: Server | null = null;
  private sockets = new Set<Socket>();

  private readonly options: FakeSmtpOptions;

  // Sem 'parameter properties': o arquivo também roda direto no Node (scripts de teste no navegador).
  constructor(options: FakeSmtpOptions = {}) {
    this.options = options;
  }

  async start(port = 0): Promise<void> {
    this.server = createServer((socket) => this.handle(socket));
    await new Promise<void>((resolve) => this.server?.listen(port, '127.0.0.1', resolve));
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  reset(): void {
    this.connections = 0;
    this.messages = [];
    this.failWith = null;
  }

  private handle(socket: Socket): void {
    this.connections += 1;
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => undefined);
    const send = (line: string) => socket.write(`${line}\r\n`);
    let buffer = '';
    let mode: 'command' | 'data' | 'auth-plain' | 'auth-user' | 'auth-pass' = 'command';
    let authUser = '';
    let from = '';
    let to: string[] = [];
    let data: string[] = [];

    const checkAuth = (user: string, pass: string) => {
      const ok = (this.options.user ?? user) === user && (this.options.pass ?? pass) === pass;
      send(ok ? '235 2.7.0 Autenticado' : '535 5.7.8 Authentication credentials invalid');
    };

    send('220 fake-smtp ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\r\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf('\r\n');

        if (mode === 'data') {
          if (line === '.') {
            const raw = data.join('\r\n');
            this.messages.push({ from, to, raw, ...decode(raw) });
            data = [];
            mode = 'command';
            send('250 2.0.0 OK');
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }
        if (mode === 'auth-plain') {
          const [, user = '', pass = ''] = Buffer.from(line, 'base64').toString('utf8').split('\0');
          mode = 'command';
          checkAuth(user, pass);
          continue;
        }
        if (mode === 'auth-user') {
          authUser = Buffer.from(line, 'base64').toString('utf8');
          mode = 'auth-pass';
          send('334 UGFzc3dvcmQ6');
          continue;
        }
        if (mode === 'auth-pass') {
          mode = 'command';
          checkAuth(authUser, Buffer.from(line, 'base64').toString('utf8'));
          continue;
        }

        const [verb = '', ...rest] = line.split(' ');
        switch (verb.toUpperCase()) {
          case 'EHLO':
            send('250-fake-smtp');
            send('250-AUTH PLAIN LOGIN');
            send('250 8BITMIME');
            break;
          case 'HELO':
            send('250 fake-smtp');
            break;
          case 'AUTH': {
            const method = (rest[0] ?? '').toUpperCase();
            if (method === 'PLAIN' && rest[1]) {
              const [, user = '', pass = ''] = Buffer.from(rest[1], 'base64').toString('utf8').split('\0');
              checkAuth(user, pass);
            } else if (method === 'PLAIN') {
              mode = 'auth-plain';
              send('334 ');
            } else if (method === 'LOGIN' && rest[1]) {
              authUser = Buffer.from(rest[1], 'base64').toString('utf8');
              mode = 'auth-pass';
              send('334 UGFzc3dvcmQ6');
            } else {
              mode = 'auth-user';
              send('334 VXNlcm5hbWU6');
            }
            break;
          }
          case 'MAIL':
            if (this.failWith) {
              send(this.failWith);
            } else {
              from =
                line
                  .replace(/^MAIL FROM:\s*/i, '')
                  .replace(/[<>]/g, '')
                  .split(' ')[0] ?? '';
              to = [];
              send('250 2.1.0 OK');
            }
            break;
          case 'RCPT':
            to.push(
              line
                .replace(/^RCPT TO:\s*/i, '')
                .replace(/[<>]/g, '')
                .split(' ')[0] ?? '',
            );
            send('250 2.1.5 OK');
            break;
          case 'DATA':
            mode = 'data';
            send('354 Termine com <CRLF>.<CRLF>');
            break;
          case 'RSET':
          case 'NOOP':
            send('250 OK');
            break;
          case 'QUIT':
            send('221 Até logo');
            socket.end();
            break;
          default:
            send('502 Comando não implementado');
        }
      }
    });
  }
}

/** Assunto e corpo legíveis (decodifica quoted-printable e palavras MIME do assunto). */
function decode(raw: string): { subject: string; text: string } {
  const split = raw.indexOf('\r\n\r\n');
  const headerText = raw.slice(0, split).replace(/\r\n[ \t]+/g, ' ');
  const bodyRaw = raw.slice(split + 4);
  const headers = new Map<string, string>();
  for (const line of headerText.split('\r\n')) {
    const at = line.indexOf(':');
    if (at > 0) headers.set(line.slice(0, at).toLowerCase(), line.slice(at + 1).trim());
  }
  const subject = (headers.get('subject') ?? '').replace(
    /=\?utf-8\?([QB])\?([^?]*)\?=\s*/gi,
    (_m, enc: string, text: string) =>
      enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64').toString('utf8') : qp(text.replace(/_/g, ' ')),
  );
  const encoding = (headers.get('content-transfer-encoding') ?? '').toLowerCase();
  const text =
    encoding === 'quoted-printable'
      ? qp(bodyRaw)
      : encoding === 'base64'
        ? Buffer.from(bodyRaw.replace(/\s+/g, ''), 'base64').toString('utf8')
        : bodyRaw;
  return { subject: subject.trim(), text: text.replace(/\r\n/g, '\n') };
}

function qp(text: string): string {
  const joined = text.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=' && /^[0-9A-F]{2}$/i.test(joined.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(joined[i] ?? '', 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
