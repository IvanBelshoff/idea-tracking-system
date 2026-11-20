'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type Lang, MESSAGES } from '../i18n';

type Mode = 'system' | 'light' | 'dark';
/** A mesma preferência do ITS (mesmo endereço): trocar aqui vale lá, e vice-versa. */
const KEY = 'its-theme-mode';

function readMode(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function ThemeMenu({ lang }: { lang: Lang }) {
  const t = MESSAGES[lang].theme;
  const [mode, setMode] = useState<Mode>('system');

  useEffect(() => setMode(readMode()), []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      document.documentElement.classList.toggle('dark', mode === 'dark' || (mode === 'system' && media.matches));
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode]);

  const choose = (next: Mode) => {
    setMode(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // armazenamento bloqueado: vale só nesta página
    }
  };

  const Icon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${t.label}: ${t[mode]}`}
        className="grid size-10 place-items-center rounded-md hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Icon aria-hidden="true" className="size-[1.15rem]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t.label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => choose(v as Mode)}>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden="true" />
            {t.system}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden="true" />
            {t.light}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden="true" />
            {t.dark}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
