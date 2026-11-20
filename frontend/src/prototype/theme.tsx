import { Moon, Palette, Sun, X } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

// Tema (claro/escuro) e marca da organização. O seletor flutuante existe só nos protótipos;
// na versão real o tema segue a preferência do usuário e a marca vem da configuração da instalação.

export type Mode = 'light' | 'dark';
export type Brand = 'its' | 'org';

export const BRANDS: Record<Brand, { name: string; org: string; initials: string }> = {
  its: { name: 'ITS', org: 'Identidade padrão', initials: 'S' },
  org: { name: 'Ideias Vale Verde', org: 'Organização exemplo (fictícia)', initials: 'VV' },
};

interface ThemeState {
  mode: Mode;
  brand: Brand;
  set: (patch: Partial<Pick<ThemeState, 'mode' | 'brand'>>) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);
const STORAGE_KEY = 'its-theme';

function readInitial(): Omit<ThemeState, 'set'> {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const fallback = { mode: (prefersDark ? 'dark' : 'light') as Mode, brand: 'its' as Brand };
  try {
    const params = new URLSearchParams(window.location.search);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      mode: (params.get('tema') as Mode) ?? stored.mode ?? fallback.mode,
      brand: (params.get('marca') as Brand) ?? stored.brand ?? fallback.brand,
    };
  } catch {
    return fallback;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readInitial);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.brand = state.brand;
    root.classList.toggle('dark', state.mode === 'dark');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  return (
    <ThemeContext.Provider value={{ ...state, set: (patch) => setState((s) => ({ ...s, ...patch })) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme fora do ThemeProvider');
  return ctx;
}

/** Painel flutuante do protótipo: claro/escuro e marca de outra organização. */
export function PrototypeSwitcher() {
  const { mode, brand, set } = useTheme();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-3 bottom-3 z-50 flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-lg shadow-black/10 hover:bg-muted"
      >
        <Palette aria-hidden="true" className="size-4" />
        Tema e marca
      </button>
    );
  }

  return (
    <section
      aria-label="Tema e marca do protótipo"
      className="fixed inset-x-2 bottom-2 z-50 rounded-lg border bg-card p-3 text-card-foreground shadow-xl shadow-black/15 sm:inset-x-auto sm:right-3 sm:bottom-3 sm:w-72"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Protótipo · dados fictícios</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Recolher painel"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <fieldset className="grid grid-cols-2 gap-1">
          <legend className="sr-only">Tema</legend>
          <ToggleButton pressed={mode === 'light'} onClick={() => set({ mode: 'light' })}>
            <Sun aria-hidden="true" className="size-3.5" /> Claro
          </ToggleButton>
          <ToggleButton pressed={mode === 'dark'} onClick={() => set({ mode: 'dark' })}>
            <Moon aria-hidden="true" className="size-3.5" /> Escuro
          </ToggleButton>
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-1">
          <legend className="sr-only">Marca</legend>
          <ToggleButton pressed={brand === 'its'} onClick={() => set({ brand: 'its' })}>
            ITS
          </ToggleButton>
          <ToggleButton pressed={brand === 'org'} onClick={() => set({ brand: 'org' })}>
            Outra org.
          </ToggleButton>
        </fieldset>
      </div>
    </section>
  );
}

function ToggleButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="flex items-center justify-center gap-1 rounded-md border px-1 py-1.5 text-xs font-medium hover:bg-muted aria-pressed:bg-foreground aria-pressed:text-background"
    >
      {children}
    </button>
  );
}
