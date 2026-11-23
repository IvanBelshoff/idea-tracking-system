/**
 * Onde esta ajuda mora (M28). O mesmo app sai em dois builds:
 * - **na instalação** (padrão): em `/ajuda`, no mesmo endereço do ITS, servida pelo contêiner `docs`;
 * - **pública**: no GitHub Pages, na raiz do domínio próprio (idea-tracking-system.silexcode.com.br), com a
 *   página inicial e sem o que só faz sentido dentro de uma instalação (o link "Voltar ao ITS" vira o
 *   link do código no GitHub).
 *
 * Os valores vêm do build (next.config.ts, a partir de AJUDA_BASE_PATH, AJUDA_PUBLICA e GOATCOUNTER_CODE).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_AJUDA_BASE_PATH ?? '/ajuda';
export const PUBLICA = process.env.NEXT_PUBLIC_AJUDA_PUBLICA === '1';
export const REPO_URL = 'https://github.com/IvanBelshoff/idea-tracking-system';
/** Endereço completo do site público (ex.: https://idea-tracking-system.silexcode.com.br); vazio na instalação. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || '';
/** Código do site no GoatCounter: só no build público, e vazio quando a variável não existe (sem contagem). */
export const GOATCOUNTER_CODE = process.env.NEXT_PUBLIC_GOATCOUNTER_CODE || '';

/** Caminho de um arquivo de `public/` (capturas, índice de busca) já com o caminho base. */
export const asset = (path: string): string => `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
