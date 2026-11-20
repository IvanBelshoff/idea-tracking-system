import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { type ThemePreference, useMe, useUpdatePreferences } from './session';

/**
 * Tema claro/escuro. Com sessão, vem da conta (vale em qualquer navegador); sem sessão (login,
 * assistente), usa o último escolhido neste navegador. Padrão: igual ao sistema.
 *
 * Tema escolhido na tela de acesso (M23, RN-181): vale na hora, fica marcado nesta aba
 * e, ao entrar, a conta ADOTA a escolha. Sem mexer no botão, vale o tema que a conta já tinha.
 */
export type ThemeMode = ThemePreference;

const STORAGE_KEY = 'its-theme-mode';
const BEFORE_LOGIN_KEY = 'its-theme-before-login';
const ThemeContext = createContext<{
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  setModeBeforeLogin: (m: ThemeMode) => void;
} | null>(null);

const isMode = (v: unknown): v is ThemeMode => v === 'light' || v === 'dark' || v === 'system';

function stored(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** A escolha feita na tela de acesso nesta aba (sobrevive à ida e volta do login corporativo). */
function beforeLogin(): ThemeMode | null {
  try {
    const saved = sessionStorage.getItem(BEFORE_LOGIN_KEY);
    return isMode(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const updatePreferences = useUpdatePreferences();
  const [local, setLocal] = useState<ThemeMode>(() => beforeLogin() ?? stored());
  const [pending, setPending] = useState<ThemeMode | null>(beforeLogin);
  // Enquanto a conta não devolve a escolha do login, o tema antigo da conta não manda na tela (não pisca).
  const mode = me ? (pending ?? me.theme) : local;
  const save = useRef(updatePreferences);
  save.current = updatePreferences;
  const tried = useRef(false);

  // Acabou de entrar com uma escolha feita na tela de acesso: a conta adota (uma vez só).
  useEffect(() => {
    if (!me || !pending) return;
    if (me.theme === pending) {
      setPending(null);
      tried.current = false;
      try {
        sessionStorage.removeItem(BEFORE_LOGIN_KEY);
      } catch {
        // Sem armazenamento da aba, nada a limpar.
      }
      return;
    }
    if (tried.current) return;
    tried.current = true;
    save.current({ theme: pending });
  }, [me, pending]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = mode === 'dark' || (mode === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.dataset.brand = 'its';
    };
    apply();
    // Guarda também neste navegador, para a tela de login abrir com o mesmo tema.
    try {
      if (mode === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Sem armazenamento, o tema vale até fechar a aba.
    }
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode]);

  const setMode = (m: ThemeMode) => {
    setLocal(m);
    updatePreferences({ theme: m });
  };
  const setModeBeforeLogin = (m: ThemeMode) => {
    setLocal(m);
    setPending(m);
    tried.current = false;
    try {
      sessionStorage.setItem(BEFORE_LOGIN_KEY, m);
    } catch {
      // Sem armazenamento da aba, vale até entrar; a conta mantém o tema dela.
    }
  };
  return <ThemeContext.Provider value={{ mode, setMode, setModeBeforeLogin }}>{children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode fora do ThemeProvider');
  return ctx;
}
