import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { EXIT_MS, type ToastItem, type ToastTone, toastStore } from '@/lib/toast';

/**
 * Avisos na tela (M23, RN-175): canto inferior direito, ícone por tipo, círculo de progresso,
 * pausa e Fechar. O tipo é dito em texto ao leitor de tela, a pausa vale também para o foco do teclado, o erro é anunciado na
 * hora (`role="alert"`), sem animação para quem pede menos movimento, cores dos tokens do ITS.
 */
export function ToastHost() {
  const { t } = useTranslation();
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getItems, toastStore.getItems);

  return createPortal(
    // A região existe sempre (mesmo vazia), para o leitor de tela anunciar o que entra nela.
    <section
      aria-label={t('common.toast.region')}
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-100 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-88"
    >
      {items.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </section>,
    document.body,
  );
}

const TONE_COLOR: Record<ToastTone, string> = {
  success: 'text-(--st-done)',
  error: 'text-destructive',
  warning: 'text-(--st-review)',
  info: 'text-(--st-progress)',
};

const TONE_ICON = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info } as const;

function Toast({ item }: { item: ToastItem }) {
  const { t } = useTranslation();
  const exiting = item.phase === 'exiting';
  const Icon = TONE_ICON[item.tone];

  const expire = useCallback(() => {
    if (!item.paused) toastStore.dismiss(item.id);
  }, [item.id, item.paused]);

  useEffect(() => {
    if (!exiting) return;
    const timeout = window.setTimeout(() => toastStore.remove(item.id), EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [exiting, item.id]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mouse e foco só pausam o tempo do aviso (RN-175); a ação é o botão Fechar.
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={`toast pointer-events-auto flex items-center gap-3 rounded-lg border bg-popover px-3 py-3 text-popover-foreground shadow-lg ${
        exiting ? 'toast-exit' : 'toast-enter'
      }`}
      onMouseEnter={() => toastStore.setPaused(item.id, true)}
      onMouseLeave={() => toastStore.setPaused(item.id, false)}
      onFocus={() => toastStore.setPaused(item.id, true)}
      onBlur={(event) => {
        // Só retoma quando o foco sai do aviso inteiro (não ao passar para o botão Fechar).
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) toastStore.setPaused(item.id, false);
      }}
    >
      <span className={`relative flex size-9 shrink-0 items-center justify-center ${TONE_COLOR[item.tone]}`}>
        {/* A chave muda a cada retomada: o círculo recomeça e o tempo volta a contar inteiro. */}
        <CircularProgress
          key={item.progressKey}
          durationMs={item.durationMs}
          paused={item.paused}
          onComplete={expire}
        />
        <Icon className="absolute size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-5">
          <span className="sr-only">{t(`common.toast.tones.${item.tone}`)}: </span>
          {item.title}
        </p>
        {item.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>}
      </div>
      <button
        type="button"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={t('common.toast.close')}
        onClick={() => toastStore.dismiss(item.id)}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

const SIZE = 36;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** O tempo que falta (decorativo: o aviso some sozinho, e o leitor de tela não precisa dele). */
function CircularProgress({
  durationMs,
  paused,
  onComplete,
}: {
  durationMs: number;
  paused: boolean;
  onComplete: () => void;
}) {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    // Pausado: o círculo volta a cheio e espera; ao retomar, o componente é recriado (nova chave).
    if (paused) {
      setOffset(0);
      return;
    }
    const frame = window.requestAnimationFrame(() => setOffset(CIRCUMFERENCE));
    const timeout = window.setTimeout(onComplete, durationMs);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [durationMs, paused, onComplete]);

  return (
    <svg width={SIZE} height={SIZE} className="-rotate-90" aria-hidden="true">
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={STROKE}
      />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        style={{ transition: paused || offset === 0 ? 'none' : `stroke-dashoffset ${durationMs}ms linear` }}
      />
    </svg>
  );
}
