# Ajuda do ITS

Documentação interativa para quem usa e quem administra o ITS: textos curtos, em português e em inglês, e simuladores para praticar com dados fictícios. É um site estático (Next.js com `output: 'export'`), servido pelo serviço `docs` e repassado pelo nginx do ITS em `/ajuda/`, no mesmo endereço do sistema.

## Desenvolver

```bash
pnpm install
pnpm dev            # http://127.0.0.1:3100/ajuda/  (busca só no build)
pnpm build          # out/ + índice de busca (Pagefind)
node scripts/serve.mjs 3200   # serve o build em http://127.0.0.1:3200/ajuda/
```

Para ver a ajuda dentro do ITS em desenvolvimento, suba o frontend com `AJUDA_DEV_URL=http://127.0.0.1:3200 pnpm dev`: o Vite repassa `/ajuda` para cá.

Checagens (as mesmas da CI, em `.github/workflows/ajuda.yml`):

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm check:content  # paridade pt-BR/en, regras citadas, links, capturas e tópicos do ITS
pnpm a11y           # axe em todas as páginas, nos dois idiomas e temas (com o build servido)
```

## Escrever uma página

1. Acrescente a página em `content/nav.ts` (o endereço é o mesmo nos dois idiomas).
2. Crie `content/pt-BR/<slug>.mdx` e `content/en/<slug>.mdx`, cada um com `export const meta = { title, description }`.
3. Use os componentes disponíveis sem import: `<Regra id="RN-05" />`, `<Situacao s="in_review" />`, `<Dica>`, `<Atencao>`, `<Captura nome="fila" alt="…" />` e `<Simulador titulo="…">…</Simulador>`.
4. Toda regra citada precisa estar em `content/regras.ts` (texto simples nos dois idiomas e a página que a ensina).
5. Se uma tela do ITS deve abrir a página pelo "?", acrescente o tópico em `frontend/src/app/help-topics.ts`; o `check:content` confere que ele existe aqui.

A voz e o visual estão em `docs/DESIGN.md`, na seção "Ajuda".

## Simuladores e regras

Os simuladores (`src/simuladores/`) nunca chamam a API. As regras vêm de `src/simuladores/regras.json`, gerado pelo backend a partir das regras reais. Se uma regra mudar no ITS, o teste `backend/test/docs` falha. Para regenerar:

```bash
cd ../backend && UPDATE_DOCS_RULES=1 pnpm exec vitest run test/docs
```

Depois disso, `pnpm test` aqui confere que as funções em JavaScript (`src/simuladores/regras.ts`) continuam batendo com o JSON.

## Capturas de tela

Na página, a `<Captura>` amplia em tela cheia com um clique (`src/components/captura-visor.tsx`, a mesma biblioteca do visualizador de anexos do ITS). O `alt` vira o texto embaixo da captura ampliada (ou a `legenda`, se houver), então escreva-o como uma frase que descreve a tela.

As imagens em `public/capturas/` são geradas a cada versão, numa instalação de **demonstração** (nunca na de verdade):

```bash
# instalação nova (assistente ainda não rodado) + dados fictícios
DEMO_PASSWORD='uma-senha-forte' node ../scripts/seed-demo.mjs http://127.0.0.1:5173
# 15 telas × 2 idiomas × 2 temas, em WebP
ITS_BASE=http://127.0.0.1:5173 CAPTURA_EMAIL=ana@example.test CAPTURA_PASSWORD='uma-senha-forte' pnpm capturas
# só uma tela, sem regravar as outras: acrescente CAPTURA_SO=observabilidade (CAPTURA_ALTURA força a altura da janela)
```

Antes das telas, o script deixa a demonstração no estado que elas mostram, sempre com dados fictícios: endereço do sistema, provedor de e-mail de cada captura (SMTP, Microsoft e Google, com uma chave gerada na hora), login com a Microsoft e uma integração. A altura de cada tela fica na lista `SHOTS` do script. As capturas e o `pnpm a11y` usam o primeiro navegador Chromium que acharem (Edge, Chrome ou Chromium, no macOS, no Windows ou no Linux); para outro, defina `CHROME`.

Para não mexer na sua instalação, suba uma pilha só para as capturas, com projeto e porta próprios, e apague no fim:

```bash
docker compose -p its-capturas -f ../docker-compose.yml -f ../docker-compose.build.yml --env-file capturas.env up -d --no-build   # WEB_PORT=8090 no capturas.env
# ... seed-demo e capturas com http://127.0.0.1:8090 ...
docker compose -p its-capturas -f ../docker-compose.yml -f ../docker-compose.build.yml --env-file capturas.env down -v
```

## Ajuda pública (GitHub Pages)

O mesmo app sai num segundo build, publicado no GitHub Pages pelo `.github/workflows/pages.yml` (a cada versão, chamado pelo `release.yml`, ou à mão, pelo "Run workflow" na `main`), em https://idea-tracking-system.silexcode.com.br/. Com `AJUDA_PUBLICA=1`, a raiz vira a página inicial e o "Voltar ao ITS" vira o link do código no GitHub (`src/site.ts`). O `scripts/publica.mjs` acerta as páginas estáticas de `public/`, cria o `404.html` e copia o ícone.

O caminho base (`AJUDA_BASE_PATH`) é `/ajuda` na instalação. No site público, o `pages.yml` usa o que o próprio GitHub Pages informa: vazio com o domínio próprio (Settings > Pages > Custom domain), e o site fica na raiz; sem domínio, `/<repositório>`. Trocar o domínio é só mudar essa configuração e rodar o fluxo de novo. Os endereços antigos (`ivanbelshoff.github.io/idea-tracking-system/...`) o GitHub redireciona para o domínio próprio.

```bash
AJUDA_PUBLICA=1 pnpm build                                     # na raiz, como no domínio próprio
AJUDA_PUBLICA=1 node scripts/serve.mjs 3201                    # http://127.0.0.1:3201/
AJUDA_PUBLICA=1 A11Y_BASE=http://127.0.0.1:3201 pnpm a11y
```

Use sempre `asset()` de `src/site.ts` para arquivos de `public/` e `<Link>` para páginas: nada de `/ajuda/` escrito no código.

### Página inicial

Na ajuda pública, a raiz (`src/app/(site)/page.tsx`) é a página inicial do ITS; na instalação, a mesma rota só redireciona para o idioma, e a documentação fica em `src/app/(docs)/[lang]/`, com os mesmos endereços. As seções ficam em `src/components/home/` e os textos, nos dois idiomas, em `src/components/home/texto.ts` (os dois idiomas vão no HTML; um script antes da primeira pintura escolhe e o CSS mostra só o escolhido, `data-l`). A página não entra na busca, porque não usa `data-pagefind-body`.

O vídeo (`public/video/ciclo-<idioma>.webm` e o pôster `.webp`) é gravado pelo `scripts/video.mjs` numa instalação de **demonstração** nova, uma por idioma, para o código da ideia sair igual: ele dirige as telas reais (enviar, fila, triagem, etapas, implementada, avisos), monta o WebM com o `ffmpeg` e o pôster com o `cwebp`.

```bash
DEMO_PASSWORD='...' node ../scripts/seed-demo.mjs http://127.0.0.1:8090
ITS_BASE=http://127.0.0.1:8090 VIDEO_PASSWORD='...' VIDEO_LANG=pt-BR pnpm video
# recrie a demonstração e repita com VIDEO_LANG=en
```

### Contagem de visitas

O site público conta visitas com o [GoatCounter](https://www.goatcounter.com), sem cookie e sem dado de quem visita. No GoatCounter, o site é criado com o domínio `idea-tracking-system.silexcode.com.br`, e o código dele (o que vem antes de `.goatcounter.com`) vai para a variável `GOATCOUNTER_CODE` do repositório (Settings > Secrets and variables > Actions > Variables), que o `pages.yml` passa ao build. Vazia, o site sai sem contador; um valor que não é um código para o build.

Só o build público leva o script (`src/components/contador.tsx`, com a versão fixa e o hash de integridade); o build da instalação nunca tem contador. O endereço local (localhost, 127.0.0.1) não conta, e quem abre o site com `#toggle-goatcounter` no fim do endereço deixa de contar naquele navegador (bom para as suas próprias visitas). O script sozinho contaria só a primeira página: o `Contador` conta também as trocas de página da documentação, que não recarregam.

Além das páginas vistas, a página inicial manda estes eventos (`data-goatcounter-click` e `src/rastrear.ts`). O GoatCounter não guarda dados junto do evento, então o detalhe vai no nome, separado por `/`:

| Evento                            | Quando                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `instalar`                        | botão "Instalar o ITS" do topo                                                    |
| `copiar-comando/<comando>/<onde>` | copiar um comando: `baixar` ou `subir`, no topo (`inicio`) ou na seção `instalar` |
| `guia-instalacao`                 | link para a página de Instalação                                                  |
| `documentacao/<onde>`             | link para a documentação: `topo`, `inicio` ou `rodape`                            |
| `video/<idioma>`                  | primeiro play do vídeo                                                            |
| `saida/<destino>/<onde>`          | link para fora: `github`, `releases`, `docker-hub`, `licenca` ou `autor`          |

## Docker

`ajuda/Dockerfile` é construído com o contexto na raiz do repositório (usa tokens e componentes do frontend). O `ajuda/Dockerfile.dockerignore` deixa de fora dependências, builds e segredos. O compose sobe o serviço `docs` sem porta própria; com ele parado, `/ajuda/` mostra um aviso e o ITS segue normal.
