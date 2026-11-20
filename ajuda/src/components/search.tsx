'use client';

import { SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { type Lang, MESSAGES } from '../i18n';
import { asset } from '../site';

interface PagefindResult {
  url: string;
  excerpt: string;
  meta: { title?: string };
}
interface Pagefind {
  options: (o: { baseUrl: string }) => Promise<void>;
  debouncedSearch: (q: string) => Promise<{ results: { id: string; data: () => Promise<PagefindResult> }[] } | null>;
}

/** O índice é gerado no build (pagefind sobre out/), dentro da própria ajuda: nenhum serviço externo. */
const BASE = asset('/');
let loading: Promise<Pagefind | null> | null = null;
function loadPagefind(): Promise<Pagefind | null> {
  loading ??= (async () => {
    try {
      const url = `${BASE}_pagefind/pagefind.js`;
      const pf = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as Pagefind;
      await pf.options({ baseUrl: BASE });
      return pf;
    } catch {
      return null; // em `next dev` não há índice
    }
  })();
  return loading;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'done'; results: PagefindResult[] };

export function Search({ lang }: { lang: Lang }) {
  const t = MESSAGES[lang].search;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const input = useRef<HTMLInputElement>(null);

  // Ctrl+K / ⌘K abre a busca de qualquer página.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setState({ kind: 'idle' });
      return;
    }
    let alive = true;
    setState({ kind: 'loading' });
    void (async () => {
      const pf = await loadPagefind();
      if (!alive) return;
      if (!pf) return setState({ kind: 'unavailable' });
      const search = await pf.debouncedSearch(q);
      if (!alive || !search) return;
      const results = await Promise.all(search.results.slice(0, 8).map((r) => r.data()));
      if (alive) setState({ kind: 'done', results });
    })();
    return () => {
      alive = false;
    };
  }, [query, open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-md border bg-card px-2.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-52"
      >
        <SearchIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="sr-only sm:not-sr-only">{t.open}</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[0.7rem] sm:inline">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          closeLabel={t.close}
          className="top-[12svh] max-w-xl translate-y-0 gap-3"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            input.current?.focus();
          }}
        >
          <DialogTitle>{t.label}</DialogTitle>
          <DialogDescription className="sr-only">{t.shortcut}</DialogDescription>
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.placeholder}
            aria-label={t.label}
            className="h-11 w-full rounded-md border bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <div aria-live="polite" className="min-h-6 text-sm">
            {state.kind === 'loading' && <p className="text-muted-foreground">{t.loading}</p>}
            {state.kind === 'unavailable' && <p className="text-muted-foreground">{t.unavailable}</p>}
            {state.kind === 'done' && state.results.length === 0 && <p className="text-muted-foreground">{t.empty}</p>}
            {state.kind === 'done' && state.results.length > 0 && (
              <ul className="-mx-2 space-y-1">
                {state.results.map((r) => (
                  <li key={r.url}>
                    <a
                      href={r.url}
                      onClick={() => setOpen(false)}
                      className="block rounded-md px-2 py-2 hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <span className="block font-medium">{r.meta.title}</span>
                      <span
                        className="mt-0.5 block text-muted-foreground [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-foreground"
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: trecho do índice gerado no build a partir do nosso conteúdo
                        dangerouslySetInnerHTML={{ __html: r.excerpt }}
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
