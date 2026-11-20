import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../../src/app.factory.js';
import { createMigratedTestDatabase, type TestDatabase } from './test-db.js';

/** API real, numa porta aleatória local, sobre um banco temporário já migrado. */
export interface TestApp {
  app: INestApplication;
  db: TestDatabase;
  baseUrl: string;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const db = await createMigratedTestDatabase();
  const app = await createApp({ databaseUrl: db.url, logger: process.env.TEST_LOGS ? undefined : false });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  return {
    app,
    db,
    baseUrl,
    async close() {
      await app.close();
      await db.drop();
    },
  };
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  setCookie: string | null;
}

/** Cliente HTTP com "pote" de cookie, como um navegador: guarda a sessão entre as chamadas. */
export class Client {
  cookie: string | null = null;

  constructor(private readonly baseUrl: string) {}

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0] ?? '';
      // Cookie apagado (logout) chega vazio.
      this.cookie = pair.endsWith('=') ? null : pair;
    }
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, setCookie };
  }

  /** Envio de arquivo (multipart, campo "file"). */
  async upload<T = unknown>(
    path: string,
    fileName: string,
    content: Buffer,
    type = 'application/octet-stream',
    method = 'POST',
  ): Promise<ApiResponse<T>> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(content)], { type }), fileName);
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers: this.cookie ? { cookie: this.cookie } : {},
      body: form,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, setCookie: null };
  }

  /** Resposta bruta (cabeçalhos e bytes), para downloads. */
  raw(path: string): Promise<Response> {
    return fetch(`${this.baseUrl}/api${path}`, { headers: this.cookie ? { cookie: this.cookie } : {} });
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body ?? {});
  }

  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body ?? {});
  }

  delete<T = unknown>(path: string) {
    return this.request<T>('DELETE', path);
  }
}

/** Senha que atende à política padrão (10+ caracteres, 3 classes). Fictícia, só para testes. */
export const STRONG_PASSWORD = 'Ideia-Boa-2026';

export const INSTALL_INPUT = {
  organizationName: 'Org',
  timezone: 'America/Sao_Paulo',
  locale: 'pt-BR',
  adminName: 'Admin Teste',
  adminEmail: 'admin@example.test',
  password: STRONG_PASSWORD,
} as const;
