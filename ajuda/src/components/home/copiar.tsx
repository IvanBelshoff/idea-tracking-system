'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Copia um comando. O estado "Copiado" é anunciado ao leitor de tela e volta depois de 2 s. */
export function Copiar({ text, label, copy, copied }: { text: string; label: string; copy: string; copied: string }) {
  const [done, setDone] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o comando continua visível para copiar à mão.
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-[oklch(0.85_0.01_270)] transition-colors hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {done ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
      <span aria-live="polite">{done ? copied : copy}</span>
    </button>
  );
}

/** Bloco escuro de comando, com o botão de copiar. */
export function Comando({
  text,
  copy,
  copied,
  copyLabel,
  regionLabel,
  quebrar = false,
}: {
  text: string;
  copy: string;
  copied: string;
  copyLabel: string;
  /** Nome do bloco, que rola na horizontal quando o comando é longo e por isso recebe o foco do teclado. */
  regionLabel: string;
  /** No celular, quebra as linhas longas em vez de rolar (a URL inteira fica à vista). */
  quebrar?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg bg-[oklch(0.2_0.012_270)] py-2 pr-2 pl-4 text-[oklch(0.94_0.005_270)] ring-1 ring-white/10 dark:bg-[oklch(0.11_0.008_270)] dark:ring-white/15">
      {/* Região rolável na ordem do teclado (setas rolam), como o Table do frontend: o axe exige. */}
      <div
        className="min-w-0 overflow-x-auto rounded-sm focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        {...{ role: 'region', 'aria-label': regionLabel, tabIndex: 0 }}
      >
        <pre
          className={`py-1.5 font-mono text-[0.8125rem] leading-relaxed ${quebrar ? 'break-all whitespace-pre-wrap sm:break-normal sm:whitespace-pre' : 'whitespace-pre'}`}
        >
          <code>{text}</code>
        </pre>
      </div>
      <Copiar text={text} label={copyLabel} copy={copy} copied={copied} />
    </div>
  );
}
