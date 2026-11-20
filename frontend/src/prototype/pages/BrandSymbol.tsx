import { Play, Repeat } from 'lucide-react';
import { useState } from 'react';
import { ItsSymbol, type ItsSymbolProps } from '@/components/brand/its-symbol';
import { Button } from '@/components/ui/button';

// Apresentação do símbolo do ITS (escolhido no M0V). Use o botão "Tema e marca" para ver no escuro.

const SIZES = [16, 24, 32, 48, 64];

const MEANING = [
  {
    title: 'Ideia → ação → resultado',
    text: 'Cada pá é uma etapa do caminho de uma melhoria: alguém tem a ideia, a equipe a coloca em ação e ela gera um resultado reconhecido.',
  },
  {
    title: 'Uma etapa encaixa na outra',
    text: 'O nariz de cada pá entra na cauda da seguinte: uma etapa começa onde a anterior termina, e nenhuma existe sozinha.',
  },
  {
    title: 'A volta não fecha',
    text: 'O resultado não é o fim: ele vira a próxima ideia. É a melhoria que não termina.',
  },
  {
    title: 'Ganha corpo',
    text: 'As três intensidades da mesma cor mostram a ideia nascendo clara e ganhando corpo até virar resultado.',
  },
  {
    title: 'Da borda para o centro',
    text: 'As pás vêm do aro para dentro: as melhorias saem do dia a dia das pessoas e convergem para o propósito da organização.',
  },
];

export function BrandSymbol() {
  const [motion, setMotion] = useState<ItsSymbolProps['motion']>('loop');
  const [replay, setReplay] = useState(0);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  return (
    <div className="mx-auto max-w-[64rem]">
      <h1 className="text-[1.75rem] leading-tight font-bold">Símbolo do ITS</h1>
      <p className="mt-1 max-w-[70ch] text-muted-foreground">
        Três pás em ciclo, reinterpretadas do símbolo antigo. Uma cor só, a da marca, que cada organização pode trocar
        junto com o nome e o logo.
      </p>

      <section
        aria-labelledby="sym-preview"
        className="mt-6 grid gap-6 rounded-lg border bg-card p-5 sm:p-6 md:grid-cols-2"
      >
        <div>
          <h2 id="sym-preview" className="sr-only">
            Prévia e movimento
          </h2>
          <div className="grid place-items-center rounded-md bg-muted/50 py-10 text-primary">
            <ItsSymbol key={replay} size={168} motion={motion} forceMotion title="Símbolo do ITS" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={motion === 'loop' ? 'default' : 'outline'}
              onClick={() => setMotion('loop')}
              aria-pressed={motion === 'loop'}
            >
              <Repeat aria-hidden="true" />
              Carregando
            </Button>
            <Button
              size="sm"
              variant={motion === 'once' ? 'default' : 'outline'}
              onClick={() => {
                setMotion('once');
                setReplay((r) => r + 1);
              }}
              aria-pressed={motion === 'once'}
            >
              <Play aria-hidden="true" />
              Entrada
            </Button>
            <Button
              size="sm"
              variant={motion === 'idle' ? 'default' : 'outline'}
              onClick={() => setMotion('idle')}
              aria-pressed={motion === 'idle'}
            >
              Parado
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Carregando:</span> avança um terço de volta por vez, cada
            etapa passando a vez à seguinte. <span className="font-medium text-foreground">Entrada:</span> as pás chegam
            girando, para momentos como "ideia enviada".
          </p>
          {reduced && (
            <p className="mt-3 rounded-md bg-muted px-4 py-3 text-sm">
              Seu sistema pede movimento reduzido. No sistema real o símbolo fica parado nesse caso; aqui ele anima para
              você poder ver.
            </p>
          )}
        </div>

        <div>
          <h2 className="text-lg font-bold">O que significa</h2>
          <dl className="mt-3 space-y-3">
            {MEANING.map((m) => (
              <div key={m.title}>
                <dt className="font-semibold">{m.title}</dt>
                <dd className="text-sm text-muted-foreground">{m.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="sym-uses" className="mt-6 rounded-lg border bg-card p-5 sm:p-6">
        <h2 id="sym-uses" className="text-lg font-bold">
          Onde aparece
        </h2>
        <p className="mt-4 text-xs font-medium text-muted-foreground">Tamanhos reais</p>
        <div className="mt-2 flex items-end gap-5 text-primary">
          {SIZES.map((s) => (
            <span key={s} className="flex flex-col items-center gap-1">
              <ItsSymbol size={s} />
              <span className="font-mono text-[0.65rem] text-muted-foreground">{s}</span>
            </span>
          ))}
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Aba do navegador (favicon)</p>
            <div className="mt-2 flex h-9 items-center gap-2 rounded-t-md border border-b-0 bg-background px-3 text-xs">
              <img src="/favicon.svg" alt="" width={16} height={16} />
              <span className="truncate">Fila de ideias · ITS</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Assinatura</p>
            <div className="mt-2 flex items-center gap-2.5">
              <span className="text-primary">
                <ItsSymbol size={34} />
              </span>
              <span className="leading-tight">
                <span className="block font-heading text-[1.05rem] font-bold tracking-tight">ITS</span>
                <span className="block text-[0.7rem] text-muted-foreground">Acompanhamento de Ideias</span>
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Ícone de app e tinta neutra</p>
            <div className="mt-2 flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
                <ItsSymbol size={34} />
              </span>
              <span className="grid size-12 place-items-center rounded-xl border bg-background text-foreground">
                <ItsSymbol size={34} />
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
