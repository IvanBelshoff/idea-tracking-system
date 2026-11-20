import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import { Children, isValidElement, type ReactNode } from 'react';
import { Captura } from './components/captura';
import { Atencao, Dica, Regra, Simulador, Situacao } from './components/doc-parts';
import { TabelaDePerfis } from './components/tabela-de-perfis';
import { TabelaDeRegras } from './components/tabela-de-regras';
import { Apoiar } from './simuladores/apoiar';
import { CicloDeVida } from './simuladores/ciclo-de-vida';
import { Convergencia } from './simuladores/convergencia';
import { DestacarHall } from './simuladores/destacar-hall';
import { EnviarIdeia } from './simuladores/enviar-ideia';
import { Etapas } from './simuladores/etapas';
import { QuemEnxerga } from './simuladores/quem-enxerga';
import { Triagem } from './simuladores/triagem';

/** Texto puro de um título (para a âncora). */
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((c) =>
      typeof c === 'string' || typeof c === 'number'
        ? String(c)
        : isValidElement(c)
          ? textOf((c.props as { children?: ReactNode }).children)
          : '',
    )
    .join('');
}

/** Âncora estável e legível: "Quem pode reabrir?" → "quem-pode-reabrir". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function heading(Tag: 'h2' | 'h3') {
  return function Heading({ children }: { children?: ReactNode }) {
    const id = slugify(textOf(children));
    return <Tag id={id}>{children}</Tag>;
  };
}

/** Componentes disponíveis em todo arquivo .mdx, sem import. */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h2: heading('h2'),
    h3: heading('h3'),
    a: ({ href = '', children }) =>
      href.startsWith('/') ? (
        <Link href={href}>{children}</Link>
      ) : href.startsWith('#') ? (
        <a href={href}>{children}</a>
      ) : (
        // Nada externo é carregado; um link para fora abre em outra aba, de propósito.
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
    // Comando longo rola na horizontal: o bloco precisa ser focável pelo teclado (axe, CA-T.8).
    pre: ({ children }) => (
      // biome-ignore lint/a11y/noNoninteractiveTabindex: região rolável precisa de foco para o teclado
      <pre tabIndex={0}>{children}</pre>
    ),
    table: ({ children }) => (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    ),
    Apoiar,
    Atencao,
    Captura,
    CicloDeVida,
    Convergencia,
    DestacarHall,
    Dica,
    EnviarIdeia,
    Etapas,
    QuemEnxerga,
    Regra,
    Simulador,
    Situacao,
    TabelaDePerfis,
    TabelaDeRegras,
    Triagem,
    ...components,
  };
}
