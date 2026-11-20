import { Download, Heart, Quote } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  CURRENT_USER,
  formatDate,
  HALL_ENTRIES,
  HALL_FEATURED,
  HALL_OF_FAME,
  type HallEntry,
  type HallMeasure,
} from '../data';
import { CategoryTag, IdCode, StatusBadge } from '../status';

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

function authorsText(e: HallEntry) {
  return e.authors ? e.authors.join(' e ') : 'Autor preferiu não aparecer';
}

/** Antes e depois na MESMA escala: a comparação é honesta e direta. */
function BeforeAfter({ before, after, large = false }: { before: HallMeasure; after: HallMeasure; large?: boolean }) {
  const max = Math.max(before.value, after.value) || 1;
  const rows: [string, HallMeasure, string][] = [
    ['Antes', before, 'bg-muted-foreground/45'],
    ['Depois', after, 'bg-(--st-done-fill)'],
  ];
  return (
    <dl className={large ? 'space-y-4' : 'space-y-3'}>
      {rows.map(([label, m, bar]) => (
        <div key={label}>
          <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
          <dd>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className={`font-num font-semibold ${large ? 'text-4xl' : 'text-2xl'}`}>
                {fmt(m.value)}
                <span className={large ? 'text-xl' : 'text-base'}>{m.unit === '%' ? '%' : ''}</span>
              </span>
              <span className="text-sm text-muted-foreground">
                {m.unit !== '%' && `${m.unit} `}
                {m.text}
              </span>
            </p>
            <div className={`mt-1.5 rounded-[4px] bg-muted ${large ? 'h-3' : 'h-2'}`}>
              <div className={`h-full min-w-1 rounded-[4px] ${bar}`} style={{ width: `${(m.value / max) * 100}%` }} />
            </div>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function LikeButton({ entry }: { entry: HallEntry }) {
  const own = entry.authors?.includes(CURRENT_USER);
  const [liked, setLiked] = useState(false);
  if (own) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Heart aria-hidden="true" className="size-4" />
        {entry.likes} curtidas · sua ideia
      </span>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={liked}
      onClick={() => setLiked((v) => !v)}
      className="aria-pressed:border-primary aria-pressed:text-primary"
    >
      <Heart aria-hidden="true" className={liked ? 'fill-current' : ''} />
      {entry.likes + (liked ? 1 : 0)} curtidas
    </Button>
  );
}

export function Hall() {
  const f = HALL_FEATURED;
  return (
    <div className="mx-auto max-w-[78rem]">
      <h1 className="text-[1.75rem] leading-tight font-bold">Hall de destaques</h1>
      <p className="mt-1 max-w-[60ch] text-muted-foreground">
        Ideias implementadas que melhoraram o dia a dia. Só aparece com nome quem concordou em aparecer.
      </p>

      <article
        aria-labelledby="featured"
        className="mt-8 grid overflow-hidden rounded-lg border bg-card lg:grid-cols-[1.2fr_1fr]"
      >
        <div className="p-6 sm:p-8">
          <h2 id="featured" className="max-w-[24ch] text-[2rem] leading-[1.15] font-bold">
            {f.title}
          </h2>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{authorsText(f)}</span>
            <span>{f.entity}</span>
            <CategoryTag name={f.category} />
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <StatusBadge status="implemented" label="Destaque de outubro" />
            <IdCode code={f.code} />
          </p>
          {f.testimonial && (
            <blockquote className="mt-6 flex max-w-[52ch] gap-3 text-lg leading-relaxed">
              <Quote aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" />
              <p>{f.testimonial}</p>
            </blockquote>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <LikeButton entry={f} />
            <Button variant="ghost" size="sm">
              <Download aria-hidden="true" />
              Baixar cartão para o mural
            </Button>
          </div>
        </div>
        <div className="border-t bg-muted/40 p-6 sm:p-8 lg:border-t-0 lg:border-l">
          <h3 className="text-sm font-semibold">O que mudou</h3>
          <div className="mt-4">
            <BeforeAfter before={f.before} after={f.after} large />
          </div>
          {f.gain && (
            <p className="mt-6 border-t pt-4 text-sm">
              <span className="block text-muted-foreground">Ganho</span>
              <span className="font-semibold">{f.gain}</span>
            </p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">Implementada em {formatDate(f.implementedAt)}</p>
        </div>
      </article>

      <section aria-labelledby="recent" className="mt-12">
        <h2 id="recent" className="text-xl font-bold">
          Recém-implementadas
        </h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-3">
          {HALL_ENTRIES.map((e) => (
            <li key={e.code} className="flex flex-col rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CategoryTag name={e.category} />
                <IdCode code={e.code} />
              </div>
              <h3 className="mt-3 text-lg leading-snug font-bold">{e.title}</h3>
              <p className={`mt-1 text-sm ${e.authors ? '' : 'text-muted-foreground italic'}`}>{authorsText(e)}</p>
              <p className="text-sm text-muted-foreground">{e.entity}</p>
              <div className="mt-4 flex-1">
                <BeforeAfter before={e.before} after={e.after} />
              </div>
              <div className="mt-5 flex items-center justify-between gap-2 border-t pt-3">
                <LikeButton entry={e} />
                <span className="font-num text-xs text-muted-foreground">{formatDate(e.implementedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="fame" className="mt-12 grid gap-6 border-t pt-8 lg:grid-cols-[16rem_1fr]">
        <div>
          <h2 id="fame" className="text-xl font-bold">
            Hall da fama
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Os destaques de cada ano ficam guardados aqui.</p>
        </div>
        <ol className="divide-y">
          {HALL_OF_FAME.map((h) => (
            <li key={h.title} className="grid grid-cols-[4rem_1fr] gap-4 py-3 sm:grid-cols-[4rem_1fr_auto]">
              <span className="font-num text-lg font-semibold">{h.year}</span>
              <span className="font-medium">{h.title}</span>
              <span className="col-start-2 text-sm text-muted-foreground sm:col-start-auto">{h.entity}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
