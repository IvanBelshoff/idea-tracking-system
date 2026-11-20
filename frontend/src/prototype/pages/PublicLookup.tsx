import { Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deadlineOf, formatDate, IDEAS } from '../data';
import { Journey } from '../journey';
import { BrandMark } from '../Layout';
import { CategoryTag, LateBadge, StatusBadge } from '../status';
import { BRANDS, useTheme } from '../theme';

// Consulta pública por código (RN-33 a RN-37): sem login, só leitura, sem dados pessoais.
// No protótipo o código público é simulado; na versão real ele é aleatório e longo.
const DEMO_CODE = 'R7KQ-M2XD-94TA';

export function PublicLookup() {
  const { brand } = useTheme();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<'none' | 'found' | 'missing'>('none');
  const idea = IDEAS[0];
  const deadline = idea ? deadlineOf(idea) : undefined;

  return (
    <div className="min-h-svh bg-background">
      <header className="bg-shell text-shell-foreground">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-3 px-4">
          <BrandMark />
          <span className="font-heading font-bold">{BRANDS[brand].name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pt-8 pb-48">
        <h1 className="text-[1.75rem] leading-tight font-bold">Consultar andamento</h1>
        <p className="mt-1.5 text-muted-foreground">Digite o código que você recebeu ao enviar a ideia.</p>

        <form
          className="mt-6 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setResult(code.trim().toUpperCase() === DEMO_CODE ? 'found' : 'missing');
          }}
        >
          <Label htmlFor="code">Código de acompanhamento</Label>
          <div className="flex gap-2">
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Ex.: R7KQ-M2XD-94TA"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="h-12 font-mono text-base tracking-[0.06em] uppercase"
            />
            <Button type="submit" size="lg" className="h-12 px-4">
              <Search aria-hidden="true" />
              Consultar
            </Button>
          </div>
          <button
            type="button"
            className="text-sm text-muted-foreground underline hover:text-foreground"
            onClick={() => {
              setCode(DEMO_CODE);
              setResult('found');
            }}
          >
            Usar o código de exemplo
          </button>
        </form>

        {result === 'missing' && (
          <div role="alert" className="mt-6 rounded-md bg-muted px-4 py-3">
            <p className="font-semibold">Não encontramos esse código.</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Confira as letras e os números. Se o autor desativou a consulta pública, a ideia não aparece aqui.
            </p>
          </div>
        )}

        {result === 'found' && idea && (
          <section aria-labelledby="result-title" className="mt-8 rounded-lg border bg-card p-5" aria-live="polite">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <StatusBadge status={idea.status} size="lg" />
              <LateBadge />
            </div>
            <h2 id="result-title" className="mt-3 text-xl leading-snug font-bold">
              {idea.title}
            </h2>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <CategoryTag name={idea.category} />
              {deadline && (
                <span>
                  Prazo <span className="font-num font-semibold text-foreground">{formatDate(deadline)}</span>
                </span>
              )}
            </p>
            <div className="mt-6 border-t pt-5">
              <Journey idea={idea} publicView />
            </div>
          </section>
        )}

        <p className="mt-8 flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Esta consulta mostra só o título, o tipo, o status e as etapas. Nomes, comentários e anexos não aparecem.
        </p>
      </main>
    </div>
  );
}
