/**
 * "Navegador" mínimo para testar fluxos com redirecionamento: guarda vários cookies, não segue
 * redirecionamentos sozinho (cada salto é visível) e devolve os cabeçalhos `Set-Cookie` crus.
 */
export interface Hop {
  status: number;
  location: string | null;
  setCookies: string[];
  body: string;
}

export class Browser {
  private readonly jar = new Map<string, string>();

  constructor(private readonly origin: string) {}

  cookie(name: string): string | undefined {
    return this.jar.get(name);
  }

  setCookie(name: string, value: string): void {
    this.jar.set(name, value);
  }

  private store(setCookies: string[]): void {
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const eq = (pair ?? '').indexOf('=');
      if (eq < 0) continue;
      const name = (pair as string).slice(0, eq).trim();
      const value = (pair as string).slice(eq + 1);
      // Cookie apagado chega vazio ou já vencido.
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async hop(url: string, init: RequestInit = {}): Promise<Hop> {
    const full = url.startsWith('http') ? url : `${this.origin}${url}`;
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(full, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
    });
    const setCookies = res.headers.getSetCookie();
    this.store(setCookies);
    return { status: res.status, location: res.headers.get('location'), setCookies, body: await res.text() };
  }

  /** Segue os redirecionamentos até uma resposta que não seja 3xx (limite de 10 saltos). */
  async follow(url: string): Promise<Hop & { path: string }> {
    let current = url;
    for (let i = 0; i < 10; i++) {
      const hop = await this.hop(current);
      if (hop.status < 300 || hop.status >= 400 || !hop.location) return { ...hop, path: current };
      current = new URL(hop.location, current.startsWith('http') ? current : this.origin).toString();
    }
    throw new Error('Redirecionamentos demais');
  }
}
