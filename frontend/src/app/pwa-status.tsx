import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** Procura versão nova de hora em hora enquanto o app fica aberto (o instalado fica aberto o dia todo). */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/**
 * App instalável (RN-83). O service worker guarda só a casca do app (HTML, JS, CSS, fontes,
 * ícones); a API nunca vai para o cache. Versão nova não recarrega sozinha (poderia perder um
 * formulário pela metade): a pessoa escolhe "Atualizar". Sem conexão, avisa que nada é salvo.
 */
export function PwaStatus() {
  const { t } = useTranslation();
  const online = useOnline();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update(), UPDATE_CHECK_MS);
    },
  });
  if (online && !needRefresh) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {!online && (
        <div
          role="status"
          className="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
        >
          <WifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{t('pwa.offline')}</span>
        </div>
      )}
      {needRefresh && (
        <div
          role="status"
          className="pointer-events-auto flex max-w-md flex-wrap items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
        >
          <RefreshCw aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{t('pwa.update')}</span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
              {t('pwa.later')}
            </Button>
            <Button size="sm" onClick={() => void updateServiceWorker(true)}>
              {t('pwa.reload')}
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
