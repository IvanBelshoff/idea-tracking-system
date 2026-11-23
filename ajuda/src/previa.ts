import type { Metadata } from 'next';
import { HOME } from './components/home/texto';
import type { Lang } from './i18n';
import { PUBLICA, SITE_URL } from './site';

const LOCALE: Record<Lang, string> = { 'pt-BR': 'pt_BR', en: 'en_US' };
const SITE_NAME = 'ITS – Idea Tracking System';

/**
 * Metadados do site público: a prévia ao compartilhar o link (Open Graph, com a imagem de
 * public/previa/, gerada por `pnpm previa`), o endereço canônico e as versões da página nos outros
 * idiomas (hreflang). Na instalação, nada: a Ajuda de lá não é para mecanismos de busca.
 *
 * `path` e `languages` são caminhos a partir da raiz do site (ex.: `/pt-BR/ti/instalacao/`).
 */
export function metaPublica(opts: {
  path: string;
  lang: Lang;
  title: string;
  description: string;
  languages?: Record<string, string>;
}): Metadata {
  if (!PUBLICA || !SITE_URL) return {};
  const url = `${SITE_URL}${opts.path}`;
  const image = {
    url: `${SITE_URL}/previa/og-${opts.lang}.png`,
    width: 1200,
    height: 630,
    alt: `${SITE_NAME}: ${HOME[opts.lang].hero.title.join(' ')}`,
  };
  return {
    alternates: {
      canonical: url,
      languages:
        opts.languages && Object.fromEntries(Object.entries(opts.languages).map(([l, p]) => [l, `${SITE_URL}${p}`])),
    },
    openGraph: {
      type: 'website',
      url,
      siteName: SITE_NAME,
      title: opts.title,
      description: opts.description,
      locale: LOCALE[opts.lang],
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: opts.title, description: opts.description, images: [image.url] },
  };
}
