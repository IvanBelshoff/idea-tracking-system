# ITS – frontend

SPA em React + Vite + TypeScript + shadcn/ui + Tailwind CSS.

> **Telas reais em `src/app`** (M1): assistente de instalação, login, definir senha, minha conta e, a seguir, a administração. Os protótipos do M0V continuam em `/prototipo` (dados fictícios) até as telas do M2 os substituírem. Tokens em `src/tokens.css`; decisões em [`../docs/DESIGN.md`](../docs/DESIGN.md). Ao mudar um token, rode `pnpm design:contrast`.
>
> **Rotas:** TanStack Router, definidas em código em `src/app/router.tsx` (guardas em `beforeLoad` com o cache do TanStack Query). Links e parâmetros são tipados pelo registro do roteador.
>
> **Preferências da conta:** idioma, tema e menu recolhido ficam no servidor (`useUpdatePreferences`); o navegador guarda só uma cópia para as telas sem login.
>
> **Textos:** `src/i18n/pt-BR.ts` é a fonte; `en.ts` é tipado a partir dele, então chave faltando ou sobrando quebra o `pnpm typecheck`. Nunca escreva texto de interface direto no componente.

## Impeccable (design)

Ferramenta de design usada no M0V. A instalação **não é versionada** (traz binários de terceiros); o resultado fica em [`../docs/DESIGN.md`](../docs/DESIGN.md), `src/tokens.css` e `PRODUCT.md`. Para usar: nesta pasta, `npx impeccable install`, depois abra o Claude Code aqui (`frontend`), suba `pnpm dev` e rode `/impeccable`. As pastas `.claude/`, `.github/` e `.impeccable/` desta pasta ficam fora do Git, e o Biome as ignora.

## Responsabilidades

- Interface (pt-BR e en), acessibilidade, responsivo e instalável (PWA).
- **Contrato com o backend:** os tipos e o cliente HTTP são **gerados a partir do OpenAPI** publicado pela API; não se escrevem tipos de API à mão.
- Permissões e escopo são sempre decididos pelo backend; o frontend só esconde o que o usuário não pode fazer (a API também nega).

## Desenvolvimento

Pré-requisitos: Node 22+, [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm --dir tools/openapi install   # gerador de tipos da API (ferramenta isolada)
pnpm dev                           # http://127.0.0.1:5173
```

**Tipos da API:** `pnpm api:generate` lê o contrato em `../backend/openapi.json` e grava `src/api/schema.d.ts`. Rode depois de qualquer mudança no contrato e versione os dois juntos.

## Licença

[MIT](../LICENSE).
