import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * Provedor OpenID Connect falso e local, só em 127.0.0.1 (como o SMTP falso): descoberta, endereço
 * de autorização (302 de volta com `code` e `state`), troca do código (confere PKCE, cliente e
 * segredo) e chaves públicas. O id_token é assinado com uma RSA gerada no próprio teste. Nada aqui
 * fala com Microsoft ou Google. Os campos `tamper` forçam cada falha que o ITS precisa recusar.
 */

export interface FakeClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  tid?: string;
  oid?: string;
  preferred_username?: string;
  hd?: string;
  /** Google: endereço da foto (RN-144). */
  picture?: string;
}

export interface Tamper {
  aud?: string;
  iss?: string;
  nonce?: string;
  /** Segundos até expirar (negativo = já expirado). */
  expIn?: number;
  /** Assina com uma chave que não está no JWKS. */
  otherKey?: boolean;
  /** Usa outro algoritmo no cabeçalho. */
  alg?: string;
  omitNonce?: boolean;
}

interface CodeRecord {
  nonce: string;
  challenge: string;
  clientId: string;
  redirectUri: string;
  claims: FakeClaims;
  tamper: Tamper;
}

const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** Resposta falsa de uma foto (Graph ou endereço `picture` do Google). */
export interface FakePhoto {
  status: number;
  body: Buffer;
  type: string;
  /** Atraso antes de responder (para estourar o tempo limite). */
  delayMs?: number;
  /** Responde 302 para este endereço (o ITS não segue redirecionamento). */
  redirect?: string;
}

export class FakeOidc {
  private server: Server | null = null;
  private readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly codes = new Map<string, CodeRecord>();
  port = 0;

  /** Quem "entra" no próximo `authorize`. */
  user: FakeClaims = { sub: 'fake-user' };
  /** Cliente e segredo que o ITS deve apresentar na troca do código. */
  expectClient = { id: 'client-id', secret: 'client-secret' };
  tamper: Tamper = {};
  /** O provedor responde erro no `/token`. */
  tokenError: string | null = null;
  tokenRequests = 0;
  authorizeRequests = 0;
  discoveryRequests = 0;
  lastTokenBody: URLSearchParams | null = null;
  /** Tudo o que o provedor emitiu, para conferir que nada disso vaza (CA-T.12). */
  readonly idTokens: string[] = [];
  readonly codes_issued: string[] = [];
  /** Tokens de acesso emitidos (para conferir que não vazam, CA-T.22). */
  readonly accessTokens: string[] = [];
  /** Escopo pedido no último `authorize`. */
  lastScope: string | null = null;
  /** Pedidos ao Graph falso (`/v1.0/me/photo...`), com o cabeçalho de autorização. */
  readonly graphRequests: { path: string; authorized: boolean }[] = [];
  pictureRequests = 0;
  /** Foto do Graph; `sizedMissing` faz o tamanho pedido dar 404 (cai na foto original). */
  graphPhoto: FakePhoto & { sizedMissing?: boolean } = { status: 404, body: Buffer.alloc(0), type: 'text/plain' };
  /** Foto servida em `/picture/*` (o endereço `picture` do Google). */
  googlePhoto: FakePhoto = { status: 404, body: Buffer.alloc(0), type: 'text/plain' };

  get base(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** O emissor é o próprio endereço do servidor falso. */
  get issuer(): string {
    return this.base;
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
    this.codes.clear();
    this.user = { sub: 'fake-user' };
    this.tamper = {};
    this.tokenError = null;
    this.tokenRequests = 0;
    this.authorizeRequests = 0;
    this.discoveryRequests = 0;
    this.lastTokenBody = null;
    this.idTokens.length = 0;
    this.codes_issued.length = 0;
    this.accessTokens.length = 0;
    this.lastScope = null;
    this.graphRequests.length = 0;
    this.pictureRequests = 0;
    this.graphPhoto = { status: 404, body: Buffer.alloc(0), type: 'text/plain' };
    this.googlePhoto = { status: 404, body: Buffer.alloc(0), type: 'text/plain' };
  }

  private async photo(res: ServerResponse, photo: FakePhoto, status = photo.status): Promise<void> {
    if (photo.delayMs) await new Promise((r) => setTimeout(r, photo.delayMs));
    if (photo.redirect) {
      res.writeHead(302, { location: photo.redirect });
      return void res.end();
    }
    res.writeHead(status, { 'content-type': photo.type });
    res.end(photo.body);
  }

  private jwk(pub = this.keys.publicKey) {
    return { ...pub.export({ format: 'jwk' }), kid: 'test-key-1', use: 'sig', alg: 'RS256' };
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private async body(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.base);
    if (url.pathname === '/.well-known/openid-configuration') {
      this.discoveryRequests++;
      return this.json(res, 200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.base}/authorize`,
        token_endpoint: `${this.base}/token`,
        jwks_uri: `${this.base}/jwks`,
      });
    }
    if (url.pathname === '/jwks') return this.json(res, 200, { keys: [this.jwk()] });

    if (url.pathname.startsWith('/v1.0/me/photo')) {
      const auth = req.headers.authorization ?? '';
      const authorized = this.accessTokens.some((tk) => auth === `Bearer ${tk}`);
      this.graphRequests.push({ path: url.pathname, authorized });
      if (!authorized) return this.json(res, 401, { error: 'InvalidAuthenticationToken' });
      const sized = url.pathname.startsWith('/v1.0/me/photos/');
      if (sized && this.graphPhoto.sizedMissing) return this.json(res, 404, { error: 'ImageNotFound' });
      return this.photo(res, this.graphPhoto);
    }
    if (url.pathname.startsWith('/picture/')) {
      this.pictureRequests++;
      return this.photo(res, this.googlePhoto);
    }

    if (url.pathname === '/authorize') {
      this.authorizeRequests++;
      const q = url.searchParams;
      this.lastScope = q.get('scope');
      const code = randomBytes(16).toString('hex');
      this.codes_issued.push(code);
      this.codes.set(code, {
        nonce: q.get('nonce') ?? '',
        challenge: q.get('code_challenge') ?? '',
        clientId: q.get('client_id') ?? '',
        redirectUri: q.get('redirect_uri') ?? '',
        claims: { ...this.user },
        tamper: { ...this.tamper },
      });
      const back = new URL(q.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state') ?? '');
      res.writeHead(302, { location: back.toString() });
      return void res.end();
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      this.tokenRequests++;
      const form = new URLSearchParams(await this.body(req));
      this.lastTokenBody = form;
      if (this.tokenError) return this.json(res, 400, { error: this.tokenError, error_description: 'segredo-secreto' });
      const rec = this.codes.get(form.get('code') ?? '');
      this.codes.delete(form.get('code') ?? ''); // uso único
      const challenge = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url');
      const ok =
        rec &&
        form.get('grant_type') === 'authorization_code' &&
        form.get('client_id') === this.expectClient.id &&
        form.get('client_secret') === this.expectClient.secret &&
        form.get('redirect_uri') === rec.redirectUri &&
        challenge === rec.challenge;
      if (!ok || !rec) return this.json(res, 400, { error: 'invalid_grant' });
      const idToken = this.idToken(rec);
      this.idTokens.push(idToken);
      const accessToken = `fake-access-${randomBytes(12).toString('hex')}`;
      this.accessTokens.push(accessToken);
      return this.json(res, 200, { token_type: 'Bearer', id_token: idToken, access_token: accessToken });
    }
    res.writeHead(404);
    res.end();
  }

  private idToken(rec: CodeRecord): string {
    const t = rec.tamper;
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: t.iss ?? this.issuer,
      aud: t.aud ?? rec.clientId,
      iat: now,
      exp: now + (t.expIn ?? 3600),
      ...(t.omitNonce ? {} : { nonce: t.nonce ?? rec.nonce }),
      ...rec.claims,
    };
    const header = b64(JSON.stringify({ alg: t.alg ?? 'RS256', typ: 'JWT', kid: 'test-key-1' }));
    const payload = b64(JSON.stringify(claims));
    const key = createPrivateKey(
      (t.otherKey ? this.otherKeys.privateKey : this.keys.privateKey).export({ type: 'pkcs8', format: 'pem' }),
    );
    const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key);
    return `${header}.${payload}.${b64(signature)}`;
  }
}
