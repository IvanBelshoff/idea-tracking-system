/**
 * Avisos na tela (M23, RN-174 e RN-175): a fila, sem React, para rodar nos testes do Node: no
 * máximo 3 visíveis, tempo por tipo e pausa que vale para o mouse e para o foco do teclado.
 *
 * Não confundir com as notificações do sino (app/notifications), que ficam guardadas no servidor.
 */
export type ToastTone = 'success' | 'error' | 'warning' | 'info';
export type ToastPhase = 'entering' | 'visible' | 'exiting';

export type ToastItem = {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs: number;
  phase: ToastPhase;
  paused: boolean;
  /** Muda a cada retomada: o círculo de progresso recomeça a contar. */
  progressKey: number;
};

export type ShowToastInput = {
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs?: number;
};

/** Quantos avisos ficam à vista ao mesmo tempo; o próximo tira o mais antigo (RN-175). */
export const MAX_VISIBLE = 3;

/** Quanto tempo cada tipo fica na tela: o erro, mais tempo, para dar tempo de ler (RN-175). */
export const DURATION_MS: Record<ToastTone, number> = { success: 4000, warning: 6000, info: 6000, error: 8000 };

/** Tempo da animação de saída antes de tirar o aviso da lista. */
export const EXIT_MS = 200;

type Listener = () => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let counter = 0;

function publish() {
  for (const listener of listeners) listener();
}

function update(id: string, change: (item: ToastItem) => ToastItem) {
  items = items.map((item) => (item.id === id ? change(item) : item));
  publish();
}

export const toastStore = {
  getItems: (): ToastItem[] => items,

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  add(input: ShowToastInput): string {
    counter += 1;
    const id = `toast-${counter}`;
    // O mais antigo que ainda está à vista sai para caber o novo.
    const visible = items.filter((item) => item.phase !== 'exiting');
    for (const old of visible.slice(0, Math.max(0, visible.length - MAX_VISIBLE + 1))) {
      toastStore.dismiss(old.id);
    }
    items = [
      ...items,
      {
        id,
        tone: input.tone,
        title: input.title,
        description: input.description,
        durationMs: input.durationMs ?? DURATION_MS[input.tone],
        phase: 'entering',
        paused: false,
        progressKey: 0,
      },
    ];
    publish();
    globalThis.setTimeout(() => {
      if (items.some((item) => item.id === id && item.phase === 'entering'))
        update(id, (i) => ({ ...i, phase: 'visible' }));
    }, 20);
    return id;
  },

  /** Pausa (mouse em cima ou foco dentro) e retoma; ao retomar, o tempo recomeça inteiro. */
  setPaused(id: string, paused: boolean) {
    update(id, (item) =>
      item.paused === paused
        ? item
        : { ...item, paused, progressKey: paused ? item.progressKey : item.progressKey + 1 },
    );
  },

  /** Começa a saída; o aviso é tirado da lista depois da animação (`remove`). */
  dismiss(id: string) {
    const item = items.find((entry) => entry.id === id);
    if (!item || item.phase === 'exiting') return;
    update(id, (i) => ({ ...i, phase: 'exiting' }));
  },

  remove(id: string) {
    items = items.filter((item) => item.id !== id);
    publish();
  },

  /** Só para os testes. */
  reset() {
    items = [];
    counter = 0;
    publish();
  },
};

/** Mostrar um aviso na tela. As ações do ITS quase nunca chamam isto direto: ver app/mutation-feedback.ts. */
export const notify = {
  success: (title: string, description?: string) => toastStore.add({ tone: 'success', title, description }),
  error: (title: string, description?: string) => toastStore.add({ tone: 'error', title, description }),
  warning: (title: string, description?: string) => toastStore.add({ tone: 'warning', title, description }),
  info: (title: string, description?: string) => toastStore.add({ tone: 'info', title, description }),
};
