import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import createMDX from '@next/mdx';
import type { NextConfig } from 'next';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Dois builds do mesmo app (M28): na instalação, em /ajuda (padrão); pública, no GitHub Pages, com
 * AJUDA_BASE_PATH=/idea-tracking-system e AJUDA_PUBLICA=1 (veja src/site.ts e scripts/publica.mjs).
 */
const basePath = process.env.AJUDA_BASE_PATH || '/ajuda';
if (!/^\/[a-z0-9-]+$/.test(basePath)) throw new Error(`AJUDA_BASE_PATH inválido: ${basePath}`);
const publica = process.env.AJUDA_PUBLICA === '1';

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
  env: { NEXT_PUBLIC_AJUDA_BASE_PATH: basePath, NEXT_PUBLIC_AJUDA_PUBLICA: publica ? '1' : '' },
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
