import type { Metadata } from 'next';
import Link from 'next/link';
import type { ComponentType } from 'react';
import { Toc } from '~/components/toc';
import { isLang, LANGS, type Lang, MESSAGES } from '~/i18n';
import { metaPublica } from '~/previa';
import { ALL_PAGES, pageHref } from '../../../../../content/nav';

export const dynamicParams = false;

/** Toda página do mapa (content/nav.ts) nos dois idiomas, gerada no build. */
export function generateStaticParams() {
  return LANGS.flatMap((lang) => ALL_PAGES.map((p) => ({ lang, slug: p.slug ? p.slug.split('/') : [] })));
}

type Params = Promise<{ lang: string; slug?: string[] }>;
interface DocModule {
  default: ComponentType;
  meta: { title: string; description: string };
}

async function load(lang: Lang, slug: string): Promise<DocModule> {
  return (await import(`../../../../../content/${lang}/${slug || 'index'}.mdx`)) as DocModule;
}

async function resolve(params: Params) {
  const { lang: raw, slug: parts } = await params;
  const lang: Lang = isLang(raw) ? raw : 'pt-BR';
  const slug = (parts ?? []).join('/');
  return { lang, slug, doc: await load(lang, slug) };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { lang, slug, doc } = await resolve(params);
  const site = MESSAGES[lang].site.title;
  const path = (l: Lang) => `/${l}/${slug ? `${slug}/` : ''}`;
  return {
    // A página inicial usa só o nome da ajuda (sem "Boas-vindas · Ajuda do ITS").
    title: slug ? doc.meta.title : { absolute: site },
    description: doc.meta.description,
    ...metaPublica({
      path: path(lang),
      lang,
      title: slug ? `${doc.meta.title} · ${site}` : site,
      description: doc.meta.description,
      languages: { 'pt-BR': path('pt-BR'), en: path('en'), 'x-default': path('pt-BR') },
    }),
  };
}

export default async function DocPage({ params }: { params: Params }) {
  const { lang, slug, doc } = await resolve(params);
  const t = MESSAGES[lang];
  const Doc = doc.default;
  const i = ALL_PAGES.findIndex((p) => p.slug === slug);
  const prev = i > 0 ? ALL_PAGES[i - 1] : undefined;
  const next = i >= 0 && i < ALL_PAGES.length - 1 ? ALL_PAGES[i + 1] : undefined;

  return (
    <div className="flex gap-10">
      <main id="conteudo" className="min-w-0 flex-1 py-8 sm:py-10">
        <article className="doc" data-pagefind-body>
          <Doc />
        </article>
        {(prev || next) && (
          <nav aria-label={t.pager.label} className="mt-14 grid gap-3 border-t pt-6 sm:grid-cols-2">
            {prev ? (
              <Link href={pageHref(lang, prev.slug)} className="group rounded-lg border p-4 hover:bg-foreground/[0.03]">
                <span className="block text-xs text-muted-foreground">← {t.pager.prev}</span>
                <span className="mt-1 block font-medium group-hover:underline">{prev.title[lang]}</span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link
                href={pageHref(lang, next.slug)}
                className="group rounded-lg border p-4 text-right hover:bg-foreground/[0.03] sm:col-start-2"
              >
                <span className="block text-xs text-muted-foreground">{t.pager.next} →</span>
                <span className="mt-1 block font-medium group-hover:underline">{next.title[lang]}</span>
              </Link>
            )}
          </nav>
        )}
      </main>
      <Toc title={t.toc.title} />
    </div>
  );
}
