'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Item {
  id: string;
  text: string;
}

/**
 * "Nesta página": as seções (h2) do artigo, com a seção em leitura destacada. Só em telas largas;
 * os títulos já têm âncora (id) gerada no build, então o sumário só os lê da página.
 */
export function Toc({ title }: { title: string }) {
  const path = usePathname();
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    void path;
    const heads = [...document.querySelectorAll<HTMLHeadingElement>('article.doc h2[id]')];
    setItems(heads.map((h) => ({ id: h.id, text: h.textContent?.replace(/#$/, '').trim() ?? '' })));
    // Seção em leitura = a última cujo título já passou da linha de leitura. No fim da página, a
    // última sempre vale (ela pode ser curta demais para chegar à linha). Ao clicar num item, ele
    // fica marcado até a pessoa voltar a rolar por conta própria.
    let locked = false;
    const line = () => Math.min(window.innerHeight * 0.25, 200);
    const compute = () => {
      if (locked) return;
      if (heads.length === 0) return;
      const y = window.scrollY;
      const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      // Rolagem necessária para cada título chegar à linha de leitura.
      const reach = heads.map((h) => h.getBoundingClientRect().top + y - line());
      let idx = 0;
      reach.forEach((r, i) => {
        if (r <= y) idx = i;
      });
      // Os últimos títulos podem nunca chegar à linha (a página acaba antes). Esses dividem entre
      // si o último trecho da rolagem, para que cada um seja marcado em algum momento.
      const k = reach.findIndex((r) => r > maxY);
      if (k !== -1 && y >= Math.min(k > 0 ? (reach[k - 1] ?? 0) : 0, maxY)) {
        const slots = heads.length - k + (k > 0 ? 1 : 0); // o último alcançável + os que não chegam
        const start = Math.min(k > 0 ? (reach[k - 1] ?? 0) : 0, maxY);
        const span = maxY - start;
        const p = span > 0 ? Math.min(1, Math.max(0, (y - start) / span)) : 1;
        const sub = y >= maxY - 2 ? slots - 1 : Math.min(slots - 1, Math.floor(p * slots));
        idx = Math.min(heads.length - 1, Math.max(0, k - 1) + sub);
      }
      setActive(heads[idx]?.id ?? null);
    };
    const unlock = () => {
      locked = false;
    };
    const onClick = (e: MouseEvent) => {
      const id = (e.target as Element | null)?.closest?.('a[data-toc]')?.getAttribute('data-toc');
      if (!id) return;
      locked = true;
      setActive(id);
    };
    compute();
    window.addEventListener('scroll', compute, { passive: true });
    window.addEventListener('resize', compute);
    window.addEventListener('wheel', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
      window.removeEventListener('wheel', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('click', onClick);
    };
  }, [path]);

  if (items.length < 2) return <div className="hidden w-52 shrink-0 xl:block" />;
  return (
    <nav aria-label={title} className="sticky top-14 hidden h-fit w-52 shrink-0 py-10 xl:block">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 space-y-2 border-l text-sm">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              data-toc={item.id}
              aria-current={active === item.id ? 'location' : undefined}
              className={`-ml-px block border-l pl-3 ${
                active === item.id
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
