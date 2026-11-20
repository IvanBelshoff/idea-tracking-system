/**
 * Limite de chamadas por integração (RN-105): contagem em janela fixa de 1 minuto, na memória da
 * instância da API. O limite varia por integração, então vem a cada chamada (o `RateLimiter` comum
 * tem um limite só). Com mais de uma instância da API o limite vale por instância.
 */
export interface WindowDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Segundos até a janela virar (para `Retry-After`). */
  retryAfter: number;
}

const WINDOW_MS = 60_000;

export class WindowCounter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  take(key: string, limit: number, now = Date.now()): WindowDecision {
    this.sweep(now);
    let entry = this.windows.get(key);
    if (!entry || now - entry.start >= WINDOW_MS) {
      entry = { start: now, count: 0 };
      this.windows.set(key, entry);
    }
    const retryAfter = Math.max(1, Math.ceil((entry.start + WINDOW_MS - now) / 1000));
    if (entry.count >= limit) return { allowed: false, limit, remaining: 0, retryAfter };
    entry.count += 1;
    return { allowed: true, limit, remaining: limit - entry.count, retryAfter };
  }

  private sweep(now: number): void {
    if (this.windows.size < 1000) return;
    for (const [key, entry] of this.windows) if (now - entry.start >= WINDOW_MS) this.windows.delete(key);
  }
}
