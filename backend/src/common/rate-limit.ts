import { apiError } from './api-error.js';

/**
 * Limite de requisições por chave (ex.: IP) em janela fixa, na memória do processo. Serve para
 * barrar varredura de códigos da consulta pública (RN-36). Com mais de uma instância da API o
 * limite vale por instância; para o porte do projeto (uma instância) basta.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Registra uma tentativa; lança 429 (com `retryAfter` em segundos) se passou do limite. */
  hit(key: string, now = Date.now()): void {
    this.sweep(now);
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: now, count: 1 });
      return;
    }
    entry.count += 1;
    if (entry.count > this.limit) this.refuse(entry.windowStart, now);
  }

  /**
   * Confere sem registrar: lança 429 se a chave já está no limite da janela. Com `record`, serve
   * para contar só as tentativas que falham (token de integração inválido por IP, RN-105).
   */
  check(key: string, now = Date.now()): void {
    const entry = this.hits.get(key);
    if (entry && now - entry.windowStart < this.windowMs && entry.count >= this.limit) {
      this.refuse(entry.windowStart, now);
    }
  }

  /** Registra uma tentativa sem lançar. */
  record(key: string, now = Date.now()): void {
    this.sweep(now);
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) this.hits.set(key, { windowStart: now, count: 1 });
    else entry.count += 1;
  }

  /** Esquece todas as janelas (para os testes não somarem tentativas entre casos). */
  clear(): void {
    this.hits.clear();
  }

  private refuse(windowStart: number, now: number): never {
    const retryAfter = Math.max(1, Math.ceil((windowStart + this.windowMs - now) / 1000));
    const error = apiError(429, 'too_many_requests', 'Muitas tentativas. Tente de novo em instantes.', { retryAfter });
    throw Object.assign(error, { retryAfter });
  }

  /** Descarta janelas vencidas (evita crescer sem fim). */
  private sweep(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [key, entry] of this.hits) if (now - entry.windowStart >= this.windowMs) this.hits.delete(key);
  }
}
