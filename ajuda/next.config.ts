import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import createMDX from '@next/mdx';
import type { NextConfig } from 'next';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Dois builds do mesmo app (M28): na instalação, em /ajuda (padrão); pública, no GitHub Pages, com
 * AJUDA_PUBLICA=1 (veja src/site.ts e scripts/publica.mjs).
 */
const publica = process.env.AJUDA_PUBLICA === '1';

/**
 * Caminho base. Na instalação, /ajuda. Na ajuda pública, o que o GitHub Pages informa (pages.yml, pelo
 * actions/configure-pages): vazio com domínio próprio (o site na raiz) ou /<repositório> sem ele.
 */
const basePath = process.env.AJUDA_BASE_PATH ?? (publica ? '' : '/ajuda');
if (!(publica && basePath === '') && !/^\/[a-z0-9-]+$/.test(basePath)) {
  throw new Error(`AJUDA_BASE_PATH inválido: "${basePath}"`);
}

/**
 * Contagem de visitas do site público (GoatCounter, sem cookie): o código do site vem da variável
 * GOATCOUNTER_CODE do repositório (pages.yml). Vazio desliga. O build da instalação nunca leva o script.
 */
const goatcounter = (process.env.GOATCOUNTER_CODE ?? '').trim();
if (goatcounter && !/^[a-z0-9-]+$/.test(goatcounter)) {
  throw new Error('GOATCOUNTER_CODE: use só o código do site, o que vem antes de .goatcounter.com.');
}

/**
 * Pacotes usados pelos arquivos compartilhados do ITS (../frontend/src). Resolvidos SEMPRE a partir
 * deste projeto: sem isso, o React do frontend entraria junto e a página teria dois Reacts.
 */
const SHARED_DEPS = ['react', 'react-dom', 'radix-ui', 'cn', 'class-variance-authority', 'lucide-react'];

const nextConfig: NextConfig = {
  // HTML pronto no build, servido por nginx em /ajuda/ (mesmo endereço do ITS) ou pelo GitHub Pages;
  // sem servidor Node.
  output: 'export',
  basePath,
  env: {
    NEXT_PUBLIC_AJUDA_BASE_PATH: basePath,
    NEXT_PUBLIC_AJUDA_PUBLICA: publica ? '1' : '',
    NEXT_PUBLIC_GOATCOUNTER_CODE: publica ? goatcounter : '',
  },
  trailingSlash: true,
  images: { unoptimized: true },
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    // A raiz é o repositório: os simuladores importam componentes e tokens do frontend do ITS.
    root: join(here, '..'),
    resolveAlias: Object.fromEntries(SHARED_DEPS.map((dep) => [dep, `./node_modules/${dep}`])),
  },
};

// Tabelas e listas de tarefas do Markdown (GFM). Com Turbopack, o plugin vai pelo nome.
const withMDX = createMDX({ options: { remarkPlugins: [['remark-gfm', {}]] } });

export default withMDX(nextConfig);
