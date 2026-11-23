import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { FaviconSync } from '~/components/favicon-sync';
import { FontSync } from '~/components/font-sync';
import { Shell } from '~/components/shell';
import { isLang, LANGS, MESSAGES } from '~/i18n';
import { PREPAINT } from '~/prepaint';
import { asset, PUBLICA } from '~/site';
import '../../globals.css';
import { Contador } from '~/components/contador';

export const dynamicParams = false;

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const t = MESSAGES[isLang(lang) ? lang : 'pt-BR'];
  return {
    title: { default: t.site.title, template: `%s · ${t.site.title}` },
    description: t.site.description,
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#5458c8' };

/** Raiz de cada idioma: o `lang` do documento sai certo no HTML gerado (leitor de tela e busca). */
export default async function LangLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        {/*
          Na instalação, o favicon é o do ITS (mesmo endereço); com cor da organização, o script troca
          pelo dela. Na ajuda pública, é a cópia do símbolo que o build põe junto (scripts/publica.mjs).
        */}
        <link rel="icon" type="image/svg+xml" href={PUBLICA ? asset('/favicon.svg') : '/favicon.svg'} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: script fixo do projeto, sem dados de fora */}
        <script dangerouslySetInnerHTML={{ __html: PREPAINT }} />
      </head>
      <body>
        <FontSync />
        <FaviconSync />
        <Shell lang={lang}>{children}</Shell>
        <Contador />
      </body>
    </html>
  );
}
