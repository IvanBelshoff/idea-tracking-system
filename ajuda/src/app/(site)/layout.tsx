import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Contador } from '~/components/contador';
import { LANG_PREPAINT } from '~/components/home/idioma';
import { HOME } from '~/components/home/texto';
import { PREPAINT } from '~/prepaint';
import { asset, PUBLICA } from '~/site';
import '../globals.css';

export const metadata: Metadata = {
  title: HOME['pt-BR'].meta.title,
  description: HOME['pt-BR'].meta.description,
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#5458c8' };

/**
 * Raiz do site: a página inicial na ajuda pública e, na instalação, só a escolha do idioma. O tema e o
 * idioma são aplicados antes da primeira pintura (os mesmos dados que o ITS e a documentação guardam).
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/svg+xml" href={PUBLICA ? asset('/favicon.svg') : '/favicon.svg'} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: scripts fixos do projeto, sem dados de fora */}
        <script dangerouslySetInnerHTML={{ __html: PREPAINT + LANG_PREPAINT }} />
      </head>
      <body>
        {children}
        <Contador />
      </body>
    </html>
  );
}
