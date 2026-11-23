# Product

<!-- impeccable:product-schema 1 -->

> Fonte: `docs/REGRAS-DE-NEGOCIO.md` (v1.0). Vale para o produto inteiro: o sistema (`frontend/`), a Ajuda e o site público (`ajuda/`). Decisões visuais **não** ficam aqui: vão para `docs/DESIGN.md`.

## Platform

web

(SPA responsiva e instalável como PWA; o envio de ideia precisa funcionar bem a partir de 360 px de largura.)

## Users

| Perfil | Situação | Trabalho |
|---|---|---|
| **Colaborador** (linha de frente) | Celular, muitas vezes no chão de fábrica ou em pé, com pouco tempo; pode ter pouca intimidade com sistemas | Enviar uma ideia em menos de 1 minuto; saber "em que pé está" a própria ideia; ver e curtir o Hall |
| **Analista** (equipe de melhoria) | Computador, várias horas por dia, dezenas de ideias na fila | Triar, aprovar/recusar, conduzir etapas, cumprir prazos de retorno; precisa de densidade, filtros e ações em lote |
| **Gestor** | Computador ou tablet, uso esporádico | Acompanhar indicadores, comparar áreas, criar campanhas, destacar ideias no Hall; não altera etapas |
| **Validador de resultados** (opcional) | Controladoria/finanças | Validar ganhos realizados |
| **Administrador** (TI) | Computador, uso raro | Configurar a instalação: usuários, perfis, entidades, categorias, identidade, módulos, e-mail |
| **Visitante** | Celular, sem login | Consultar o andamento de uma ideia por código de acompanhamento, numa única tela, sem dados pessoais |

Perfis são editáveis e têm escopo por entidade; um mesmo usuário pode ser colaborador numa entidade e analista em outra.

**Antes de usar (site público e repositório):** o ITS é aberto e cada organização o instala por conta própria, então há quem o conheça antes de existir uma instalação.

| Quem | Situação | Trabalho |
|---|---|---|
| **Quem decide adotar** (público principal do site) | Responsável por um programa de melhoria contínua ou gestor de uma organização, chegando pelo GitHub, por uma indicação ou pelo LinkedIn | Entender se o ITS resolve o problema de ideias que ficam sem retorno e se dá para instalar e manter sem custo de licença |
| **Quem instala** (TI) | Técnico com Docker, decidindo se o ITS é confiável e simples de manter | Instalar, atualizar, fazer backup e ligar os recursos opcionais |
| **Comunidade e colegas** | Desenvolvedores e recrutadores conhecendo o projeto | Ver o que ele faz, como foi feito e o código |

## Product Purpose

ITS (Idea Tracking System, Sistema de Acompanhamento de Ideias) é um sistema aberto de gestão de ideias e melhoria contínua: **qualquer colaborador envia uma ideia**, a equipe faz a triagem e conduz a execução em etapas, o autor **acompanha cada passo**, e as melhores ideias são **celebradas** no Hall de destaques.

Existe porque falta de retorno é a principal causa de baixo engajamento em programas de ideias. Sucesso = colaboradores enviam sem atrito, recebem retorno visível e no prazo, e a equipe dá conta da fila sem perder o controle.

## Positioning

- **Aberto e genérico por configuração**, na linha do GLPI: uma instalação por organização, entidades em árvore, perfis, categorias, rótulos e identidade configuráveis, sem nada cravado no código.
- **Metodologia-agnóstico:** sem termo de metodologia; o fluxo serve a qualquer programa de ideias, e a ideia se chama "ideia" do envio ao fim da execução.
- **Transparência como mecanismo:** status, prazos, etapas e próximos passos sempre visíveis para o autor; tudo que muda de estado deixa rastro (quem, quando, por quê).
- **Reconhecimento sem infantilizar:** Hall com curadoria, consentimento do autor e ganhos validados, em vez de gamificação de brinquedo.

## Operating Context

- **Ciclo da ideia:** Enviada → Em análise → Em andamento → Implementada, ou Não autorizada; além disso, o sinal "atrasada" (prazo vencido).
- **Execução em etapas** com responsável, datas, progresso e atraso; linha do tempo; comentários públicos (visíveis ao autor) e internos (só da equipe).
- **Triagem em volume** com prazo de retorno (SLA), prioridade por impacto × esforço, convergência de ideias semelhantes (a mais antiga vira a principal e os demais solicitantes viram coautores).
- **Campanhas** temáticas com período, foco e meta.
- **Hall de destaques:** ideia do mês, mais impactantes (ganho validado), mais curtidas, recém-implementadas, destaques de campanha, Hall da fama por ano; exportação de cartões (imagem/PDF) para murais físicos.
- **Telas-chave do M0V** (onde as escolhas visuais devem ser avaliadas): Enviar ideia (celular), Minhas ideias (celular), Fila do analista (desktop), Detalhe da ideia (desktop), Painel de indicadores (desktop), Hall de destaques, Consulta pública por código (celular, sem login).

## Capabilities and Constraints

- **Stack fixada:** React + Vite + TypeScript + shadcn/ui + Tailwind CSS 4; os componentes ficam no repositório e podem ser ajustados. Tipos e cliente HTTP são gerados a partir do OpenAPI da API, nunca escritos à mão.
- **Tema por organização:** cada instalação troca logo, nome e **cor de marca**. A identidade do ITS é o padrão, e a interface precisa continuar bonita e acessível com a cor de outra empresa.
- **Modo claro e escuro.**
- **Status são centrais** e precisam de cor distinta **e** de um segundo sinal (ícone ou texto).
- **Categorias têm cor configurável** pela organização; a paleta precisa conviver com essas cores.
- **Idiomas pt-BR e en** desde o início; os textos variam de tamanho e o layout não pode quebrar com palavras longas em português.
- **Fontes livres e hospedadas no próprio projeto** (sem serviços externos), por privacidade e para funcionar sem internet.
- **Textos de tamanho variável** (nomes de entidade, categoria e organização, traduções); a interface não pode depender do comprimento deles.
- **Módulos desligáveis:** pontos, níveis, conquistas, rankings, curtidas, Hall e consulta pública podem ser desligados; a interface precisa funcionar sem eles.
- **Permissão e escopo são sempre decididos pelo backend;** o frontend só esconde o que o usuário não pode fazer.
- **Consulta pública** (opcional, desligada por padrão) mostra só título, categoria, status, etapas e prazo; nunca autor, comentários, anexos, ganhos ou dados pessoais.
- **Privacidade no reconhecimento:** o autor pode ocultar o nome em murais e rankings; ideias anônimas aparecem sem autor; o valor do ganho só aparece no Hall se a organização permitir.
- **Terminologia** (glossário em `docs/REGRAS-DE-NEGOCIO.md` §2): Ideia, Etapa, Categoria, Entidade, Perfil, Código de acompanhamento, Campanha, Hall de destaques, Ganho validado, Coautor, Convergência, Identificador (ex.: `ITS-2026-0042`).
- **Licença:** MIT. **Distribuição:** código em `github.com/IvanBelshoff/idea-tracking-system`, imagens prontas no GitHub (`ghcr.io/ivanbelshoff`) e no Docker Hub (`ivanbelshoff`), instalação com Docker Compose; a Ajuda vem em toda instalação e também fica aberta no GitHub Pages (`idea-tracking-system.silexcode.com.br`), que é o site público do projeto.

## Brand Commitments

- **Personalidade:** profissional e acolhedor (sério o bastante para uma indústria ou um hospital, caloroso o bastante para o colaborador se sentir ouvido); celebra sem infantilizar; transparente; calmo.
- **Voz:** direta, em segunda pessoa, sem jargão. "Sua ideia foi aprovada", não "Status alterado para APPROVED".
- **Evitar:** visual genérico de "template de IA" (gradientes chamativos, cartões dentro de cartões, uma só fonte sem hierarquia); aparência de sistema corporativo cinza e datado (o GLPI é referência funcional, **não** visual); excesso de animação e de gamificação visual (confetes, medalhas brilhantes); depender só da cor para comunicar estado.
- Nome: **ITS – Idea Tracking System** (Sistema de Acompanhamento de Ideias); o símbolo das pás é a marca.
- **Autoria:** criado por **Ivan Belshoff** (`github.com/IvanBelshoff`), que pode aparecer como autor no site público; a licença diz "Contribuidores do ITS".
- **Identidade escolhida no M0V (04/11/2026): o padrão consagrado da categoria, executado com acabamento de primeira.** A barra de qualidade é o nível do **GitHub** (tabelas, status e linhas do tempo claros) e do **Notion** (calmo e acolhedor, bom de ler). As direções Sinalização, Metrô e Bilhete foram avaliadas e descartadas. Detalhes em `docs/DESIGN.md`.

## Evidence on Hand

- Protótipos descartáveis com dados fictícios em `src/prototype/` (enviar ideia, minhas ideias, fila do analista, detalhe da ideia), sobre o tema neutro padrão do shadcn/ui. Servem só para avaliar escolhas visuais.
- Documentação de produto em `docs/`: regras de negócio, critérios de aceite, modelo de dados, stack, design, instalação e roadmap.
- Capturas de tela reais do sistema, com dados de demonstração fictícios, em `ajuda/public/capturas/` (pt-BR e en, temas claro e escuro), geradas por `ajuda/scripts/capturas.mjs`.
- Versão publicada: **1.0.0** (20/11/2026).
- **Não há** clientes, depoimentos, métricas de uso ou de ganho, casos reais nem logos de organizações. Nada disso pode ser inventado; telas de demonstração usam dados claramente fictícios.

## Product Principles

1. **Enviar é sem atrito.** O caminho do colaborador (enviar e acompanhar) cabe em menos de 1 minuto, no celular, em pé.
2. **Nada é caixa-preta.** Status, prazo e próximo passo estão sempre à vista de quem tem direito a vê-los.
3. **Densidade com calma.** O analista vê muita informação de uma vez, sem ruído visual.
4. **Genérico por configuração.** Marca, rótulos, cores de categoria e módulos mudam por instalação, e a interface continua correta e acessível em qualquer combinação.
5. **Reconhecer com respeito.** Celebrar ideias com consentimento e sobriedade, sem transformar melhoria contínua em jogo.

## Accessibility & Inclusion

- **WCAG 2.x AA** (CA-T.8): contraste nos modos claro e escuro (inclusive com a cor de marca de cada organização), foco visível, navegação completa por teclado.
- Estado nunca comunicado só por cor (daltonismo): sempre ícone ou texto junto.
- Público da linha de frente com pouca intimidade com sistemas: linguagem simples, alvos de toque grandes, uso com uma mão em 360 px.
- Funcionar sem internet para fontes e recursos estáticos (PWA, fontes locais).
