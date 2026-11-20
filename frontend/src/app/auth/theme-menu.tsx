import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type ThemeMode, useThemeMode } from '../theme';

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
/** Ordem: Claro, Escuro, Automático. */
const ORDER: ThemeMode[] = ['light', 'dark', 'system'];

/**
 * Tema nas telas de acesso (M23, RN-181): o ícone mostra a escolha e abre as três
 * opções. Vale na hora; ao entrar, a conta adota a escolha (app/theme.tsx).
 */
export function ThemeMenu({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const { mode, setModeBeforeLogin } = useThemeMode();
  const Icon = ICONS[mode];
  const label = t('login.screen.theme', { mode: t(`login.screen.themes.${mode}`) });
  return (
    // Não modal: o resto da tela continua acessível; Esc ou clicar fora fecha.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={label}
        title={label}
        className={`grid size-10 place-items-center rounded-full border bg-background/90 text-foreground shadow-sm backdrop-blur hover:bg-muted ${className}`}
      >
        <Icon className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t('login.screen.themeMenu')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setModeBeforeLogin(v as ThemeMode)}>
          {ORDER.map((option) => {
            const OptionIcon = ICONS[option];
            return (
              <DropdownMenuRadioItem key={option} value={option} className="gap-2">
                <OptionIcon className="size-4" aria-hidden="true" />
                {t(`login.screen.themes.${option}`)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
