# Stack e arquitetura – novo sistema de melhoria contínua

> **Status: v1.0 (decisões do autor).** Base: [REGRAS-DE-NEGOCIO.md](REGRAS-DE-NEGOCIO.md) v1.0 e [CRITERIOS-DE-ACEITE.md](CRITERIOS-DE-ACEITE.md). Modelo de dados: [MODELO-DE-DADOS.md](MODELO-DE-DADOS.md).
> Os spikes do M0 foram executados (§8). Itens ainda marcados **[VALIDAR]** dependem de verificação futura.
> **Versões instaladas no M0** (mais novas do que a maior parte da documentação pública): NestJS 12 (ESM), TypeORM 1.1, pg-boss 12, PostgreSQL 17, TypeScript 7, Vitest 5, React 19, Vite 8, Tailwind 4. Os exemplos de outras fontes podem não valer; **confie nos testes**.

## 1. Arquitetura

```
Navegador ──► web (nginx: serve a SPA e repassa /api) ──► api (monólito modular) ──► PostgreSQL
Sistemas externos ──► web (nginx: repassa /integration, M16) ──┘     worker (mesma imagem da api, outro comando) ──┘
```

| Decisão | Escolha | Motivo |
|---|---|---|
| Estilo | **Monólito modular** no backend + **SPA** separada no frontend | Instalação simples (Docker), consistência transacional (status, histórico e convergência no mesmo commit), equipe pequena |
| Processos | `api` e `worker` na **mesma imagem**, comandos diferentes | Código único; o worker executa os jobs sem competir com as requisições |
| Origem | O nginx do frontend repassa `/api` para a API (e, desde o M16, `/integration`, a API de integração, §5A) | Sem CORS; cookie de sessão simples |
| Microsserviços | **Fora** | Só fariam sentido com SaaS multi-organização e carga alta. Primeiro candidato à extração seria o worker de notificações, e os módulos já deixam esse caminho aberto |

### 1.1 Módulos do backend (por fase)

| Fase | Módulos |
|---|---|
| F1 | `identity-access` (usuários, sessões, perfis, escopo), `organization` (entidades, categorias, configurações), `ideas`, `steps`, `comments`, `notifications`, `public-tracking`, `reports`, `audit` |
| F2 | `triage` (SLA, regras, priorização, semelhantes, lote), `convergence`, `campaigns`, `results` (medição, ganho, validação, sustentação) |
| F3 | `recognition` (pontos, níveis, conquistas), `hall` (destaques, curtidas, elogios) |
| v1.0 | `observability` (M12), `communication` e `identity-access/sso` (M13 a M15), `integration` (M16: API de integração de leitura, §5A) |

Regras de projeto:
- Cada módulo expõe só uma interface pública; outro módulo nunca acessa as tabelas dele diretamente.
- **Regras puras** (transições de status, atraso, progresso, divisão de pontos) ficam em funções sem banco e sem framework. Os critérios de aceite do tipo **U** testam essas funções.
- **Eventos de domínio** (por exemplo, `IdeaApproved`) são gravados na mesma transação e consumidos por histórico, notificações e pontos. O módulo `recognition` apenas escuta: desligá-lo (RN-66) não afeta o núcleo.
- **Módulos desligáveis** por configuração (campanhas, gamificação, Hall, ganho financeiro).

## 2. Stack

| Camada | Escolha | Observação |
|---|---|---|
| Runtime | Node LTS + TypeScript (modo estrito) | |
| API | **NestJS** com adaptador **Express** | Módulos, injeção de dependência e *guards* para a RN-01 |
| Banco | **PostgreSQL** (somente) | `pg_trgm` (ideias semelhantes), sequências e travas (RN-22), `citext` |
| ORM e migrações | **TypeORM**, `synchronize` **desligado**, migrações sempre explícitas | CA-T.9: subir do zero e reverter |
| Validação | **Zod** no backend (validação de entrada) e Zod no frontend (formulários), com os tipos de API **gerados do OpenAPI** | Sem pacote compartilhado; o contrato é o OpenAPI (`@nestjs/swagger` no backend → `openapi.json` versionado). No frontend: **openapi-typescript** gera os tipos e **openapi-fetch** é o cliente. O gerador precisa da API JS do TypeScript, que o TypeScript 7 não expõe: roda isolado em `tools/openapi` com TypeScript 6 |
| Autenticação | Sessão no servidor (cookie `httpOnly`, `SameSite`) + **Argon2id**; opcionalmente **OpenID Connect** (Microsoft e Google, M13), cliente próprio e enxuto sobre `fetch` e `node:crypto` | Permite invalidar a sessão ao desativar o usuário (RN-41); o login corporativo termina na mesma sessão do login por senha |
| Filas e jobs | **pg-boss** (fila e agendamento dentro do Postgres) | Mantido por decisão do autor. Sem Redis. Ver §4 |
| E-mail | Interface de envio com **adaptadores** configurada por tela do admin (RN-90) | SMTP na v1; outros provedores depois |
| Datas e fusos | **date-fns** 4 + **@date-fns/tz** | Um módulo de datas por lado (`backend/src/common/dates.ts`, `frontend/src/lib/dates.ts`) é o único que importa a biblioteca. Regra: **datas só por esses módulos** (nada de `Intl.DateTimeFormat`, `setDate` ou `86_400_000` espalhados). Instante usa o fuso da **instalação** (`organization.timezone`), nunca o do processo nem o do navegador; dia de calendário (`AAAA-MM-DD`) não tem fuso e é calculado em UTC puro. A tela mostra data e hora no fuso da instalação (hook `useDates`) |
| PDF | **pdfkit** | Relatório por ideia (RN-47). O relatório é simples (texto em seções), então usamos o pdfkit direto, com uma dependência a menos. Fonte padrão do PDF (Helvetica), que cobre os acentos do português |
| Imagens (foto do perfil, cartão do Hall) | **sharp** | Redimensiona, converte para WebP e remove metadados (RN-91) |
| Arquivos | Volume local atrás de uma interface | Troca por armazenamento compatível com S3 no futuro |
| Frontend | **React + Vite + TypeScript + shadcn/ui + Tailwind CSS** | Componentes copiados para o repositório (fáceis de personalizar por organização) |
| Dados no frontend | TanStack Query, **TanStack Router** (rotas em código, guardas em `beforeLoad` usando o cache do Query, parâmetros de busca validados com Zod, telas sob demanda), react-hook-form + Zod, TanStack Table | Trocado de React Router para TanStack Router em 05/11/2026, antes do M2 (decisão do autor) |
| i18n e PWA | i18next (pt-BR e en); `vite-plugin-pwa` (manifesto e *service worker* gerados no build; cache só da casca do app, nunca da API; atualização quando a pessoa escolhe) | RN-83 |
| Testes | Vitest; integração com Postgres real em contêiner; Playwright; axe | Níveis U, I e E dos critérios |
| Lint e formatação | **Biome** (um só binário para lint, formatação e organização de imports) | Escolhido no M0 em vez de ESLint + Prettier: o typescript-eslint depende da API JS do TypeScript, ausente no TypeScript 7. Perde-se a checagem com tipos no lint; o `tsc` em modo estrito cobre a maior parte |
| Repositório | **Um repositório** (`its`) com as pastas `backend`, `frontend`, `docker` e `docs` | Mudanças de API e cliente no mesmo commit, um só lugar para issues e versões, instalação com um clone (decisão do autor, 05/11/2026). Ver §7 |
| Entrega | Docker Compose; imagens multi-arquitetura no GHCR | Serviços: `web`, `api`, `worker`, `db` |
| CI | GitHub Actions: lint, tipos, testes, build das imagens, varredura de segredos (CA-T.6), auditoria de dependências, Dependabot/Renovate | |

### 2.1 Idioma dos identificadores
O código, as tabelas e as colunas usam **inglês** (facilita contribuições da comunidade). A interface é internacionalizada (pt-BR e en), e as regras seguem em português. O mapeamento termo ↔ nome técnico está em [MODELO-DE-DADOS.md](MODELO-DE-DADOS.md), §1.

## 3. Consultas "difíceis" com recursos do TypeORM

Duas necessidades pareciam pedir SQL cru: **a árvore de entidades** e **as ideias semelhantes**. O desenho abaixo usa os recursos do TypeORM e reduz o que precisa de SQL manual.

### 3.1 Árvore de entidades (RN-25 e escopo da RN-01)

- A entidade é declarada com **`@Tree('materialized-path')`**, `@TreeParent` e `@TreeChildren`. O TypeORM guarda o caminho de cada nó e oferece, via `TreeRepository`, `findDescendants`, `findAncestors`, `createDescendantsQueryBuilder` e `countDescendants`, sem escrever CTE recursiva.
- O caminho é uma consulta por prefixo (`LIKE 'a.b.%'`), que usa um índice comum (`text_pattern_ops`).
- A árvore é **pequena** (dezenas ou centenas de nós). O **escopo de um usuário** é resolvido uma vez (entidades permitidas + descendentes) e fica em cache por sessão. As consultas de ideias usam `entityId IN (:...ids)`, sem recursão a cada requisição.
- **Mover uma entidade:** no TypeORM 1.1 o `save()` com o novo pai **já reescreve o caminho do nó e de todos os descendentes** (confirmado no Spike 1). O que não vem pronto é a **proteção contra ciclo** (CA-RN-25.1): o serviço compara o caminho do novo pai com o do nó (`startsWith`), sem recursão. A coluna `mpath` não é mapeada na entidade; para lê-la usa-se `QueryBuilder` (`select('e.mpath')`).

### 3.2 Ideias semelhantes (RN-57)

O TypeORM não tem tipo nem operador de trigrama, então a divisão é esta:

| Parte | Como fica |
|---|---|
| Extensões, função e índice GIN | Na **migração**: `pg_trgm`, `unaccent`, a função `immutable_unaccent` (o `unaccent` puro não é *immutable*, e uma coluna gerada exige isso) e o índice `gin_trgm_ops`. O `@Index` do TypeORM não declara classe de operador |
| Expressão de busca | Sem coluna extra: o índice GIN é sobre a **expressão** `immutable_unaccent(lower(title || ' ' || description))`, declarado na entidade com `@Index('ix_idea_search_trgm', { synchronize: false })` para o TypeORM não tentar recriá-lo. (O Spike 2 confirmou que a coluna gerada também funcionaria; o índice na expressão evita duplicar o texto.) |
| Consulta | `IdeasService.similar`: SQL **parametrizado** (nada concatenado com a entrada), com `word_similarity(...)` como pontuação e ordem. Usa o operador `<%` (as palavras da consulta aparecem no texto): a similaridade comum (`%`) **falha** quando a consulta é curta e o texto é longo (título × título + descrição) |
| Escopo e filtros | O **mesmo helper de escopo** das demais consultas é aplicado antes (RN-01), mais exclusão de arquivadas e convergidas, e `LIMIT` pequeno |
| Limite de semelhança | `set_config('pg_trgm.word_similarity_threshold', '0.45', true)` na mesma transação. O planner usa o índice GIN com o operador `<%` (confirmado por `EXPLAIN`). O limite 0,45 é ponto de partida a calibrar com dados reais |

### 3.3 Escopo centralizado (RN-01, CA-T.5)
Um único helper `applyScope(queryBuilder, user)` aplica o escopo por entidade e a exceção "o autor sempre vê a própria ideia". Toda listagem, indicador, exportação e busca o usam; um teste automatizado impede consultas de ideia que não passem por ele.

## 4. Jobs com pg-boss

- **Agendamento (cron):** a fila `notifications-tick` roda a cada minuto (um único worker executa cada disparo) e chama alertas de prazo (RN-29), resumo diário (RN-31) e a limpeza de envios travados (`src/communication/jobs.ts`). Os horários configuráveis (ex.: resumo às 07:00) são conferidos dentro do job, no fuso da instalação, então mudar a configuração não exige reagendar nada. SLA de triagem (RN-54), expiração de destaque (RN-78) e sustentação (RN-65) entram nesse mesmo disparo quando chegarem.
- **Envio de e-mail (fila `email-send`):** cada e-mail é um job com 5 tentativas e espera crescente (30 s, 60 s, 120 s...). A API não fala com o servidor de e-mail: ela grava em `email_log` (fila de saída) e o worker transforma as linhas pendentes em jobs **na mesma transação** (`enqueuePendingEmails`, com `SKIP LOCKED`), a cada 10 s e a cada disparo do cron.
- **Rastro para o admin:** o job é o executor; o registro do envio (destinatário, assunto, estado, tentativas, último erro) fica na tabela `email_log`, que alimenta a tela "Envios". O corpo fica cifrado (pode ter link de recuperação de senha).
- **Idempotência (CA-T.1):** todo alerta tem uma chave única (ex.: etapa + dia + destinatário). Reexecutar não duplica.
- **Conexão:** o pg-boss 12 aceita um adaptador `db: { executeSql }`; usamos o pool do TypeORM pegando o cliente `pg` de um `QueryRunner` e devolvendo o **resultado bruto** do driver (`src/jobs/pg-boss-typeorm.adapter.ts`). Atenção: devolver só as linhas da última instrução quebra a manutenção do pg-boss em consultas com várias instruções (erro achado ao subir o worker no Docker; coberto por teste de regressão). O pg-boss instala e migra o próprio esquema `pgboss` ao iniciar (fora das migrações do TypeORM).
- Processamento no processo `worker`; a API só enfileira.
- **Observabilidade (M12, RN-92 a RN-94):** o mesmo disparo por minuto grava o batimento do worker (`ops_heartbeat`) e as métricas dele, apaga o histórico vencido (uma vez por dia) e, a cada 5 minutos, confere a saúde e dispara o alerta, com o estado em `ops_alert_state`. A API grava o próprio batimento e fecha as horas de tráfego com um temporizador interno (`setInterval` de 60 s, sem `@nestjs/schedule`). O alerta roda nos dois processos (o worker a cada 5 minutos, a API a cada 5 minutos depois dos 3 primeiros), um avisando pelo outro, com o mesmo estado no banco e a mesma trava; banco fora, ou API e worker parados juntos, não geram alerta (o aviso depende do banco) e fica a cargo do `/api/health` (503) e do healthcheck do Compose. Nada sai da instalação: sem Prometheus e sem telemetria externa (D16 das regras).
- **Integrações (M16, RN-113):** a limpeza diária do histórico (a mesma do M12) também apaga as linhas de `integration_hour` mais velhas que `ops.retention_days`, de forma idempotente (CA-T.1). A API grava o consumo por hora com o mesmo padrão aditivo do `ops_metric_hour`.

## 5. E-mail configurável pela interface (RN-90)

- Interface única `MailTransport.send(message)` (`src/communication/mail-transport.ts`); adaptadores: **SMTP** (nodemailer) e **Microsoft Graph** (M14, `src/communication/mail-graph.ts`) e **Google Workspace** (M15, `src/communication/mail-google.ts`); outros (Resend, SES) depois. Um provedor ativo por vez.
- O admin cadastra o provedor numa tela (permissão `email.manage`). **Segredos cifrados** no banco com AES-256-GCM e chave derivada (HKDF) da `APP_SECRET_KEY` do ambiente (`src/communication/secret-box.ts`); a tela nunca devolve a senha (só "definida"). Trocar a `APP_SECRET_KEY` exige cadastrar o provedor de novo.
- **Desligado por padrão**; só liga depois de um "enviar e-mail de teste" bem-sucedido e com o endereço do sistema (`email.app_url`) definido. Qualquer alteração no provedor desliga o envio até um novo teste.
- Os e-mails de aviso chegam juntos no **resumo diário**; só a recuperação de senha e o teste saem na hora.
- Nos testes, um SMTP falso local (`test/support/fake-smtp.ts`, só em 127.0.0.1) recebe as mensagens. Nunca há envio real em desenvolvimento.
- Credenciais nunca vão para logs (CA-RN-39.2, CA-T.6).

### 5.1 Login corporativo (M13, RN-95 a RN-98)

- **Protocolo:** OpenID Connect, fluxo de código com **PKCE**, no servidor (cliente confidencial), com um cliente próprio e enxuto sobre `fetch` e `node:crypto` (sem dependência nova: só assinatura RS256, `iss`, `aud`, `exp`, `nbf` e `nonce` conferidos, chaves pela descoberta do provedor). Microsoft como app de **um tenant só** (emissor `https://login.microsoftonline.com/{tenant}/v2.0`, `tid` conferido); Google com `email_verified` e `hd`. O módulo é `identity-access/sso/`, com um preset por provedor (a arquitetura deixa o caminho aberto para outros).
- **Fluxo:** `GET /api/auth/sso/:provider/start` guarda `state`, `nonce` e o verificador PKCE num **cookie curto e cifrado** (`its_sso`, `httpOnly`, `SameSite=Lax`, só em `/api/auth/sso`, 10 minutos, cifrado com o `secret-box`; sem tabela). `GET .../callback` valida tudo, acha ou vincula o usuário e termina com o **mesmo `finishLogin`** do login por senha (mesmo cookie `its_session`, mesma auditoria). O endereço de retorno usa o endereço do sistema (`email.app_url`).
- **Segredo:** o segredo do cliente fica **cifrado** em `sso_provider` (AES-256-GCM, chave derivada da `APP_SECRET_KEY`), como o do SMTP (§5); a tela só recebe "definido". Trocar a chave exige cadastrar o segredo de novo.
- **Rede (exceção consciente à regra "nada contata o exterior", D17):** só com o recurso ligado, a API fala **servidor a servidor** com o provedor (descoberta, troca do código e chaves públicas). Nenhum dado da instalação além do protocolo sai. Proxy corporativo: `NODE_USE_ENV_PROXY=1` com `HTTPS_PROXY`/`NO_PROXY` (Node 24).
- **Limites:** `RateLimiter` por IP em início e retorno; a auditoria não guarda token nem claims.
- **Testes:** um provedor OIDC falso e local (`test/support/fake-oidc.ts`, só em 127.0.0.1, com chaves RSA geradas no teste), como o SMTP falso. O emissor do preset só pode ser trocado com `NODE_ENV=test`. Nenhum teste fala com Microsoft ou Google; a validação com contas reais é do dono, com o roteiro da Ajuda.

### 5.2 Envio pela Microsoft Graph (M14, RN-99 e RN-100)

- **Fluxo:** credenciais do aplicativo (`client_credentials`, `scope=https://graph.microsoft.com/.default`) e `POST /v1.0/users/{caixa}/sendMail` (resposta `202`), com `fetch` (sem biblioteca nova), limite de 10 s, `saveToSentItems: false` e corpo em texto. O token fica em cache **na memória do processo** (chave por tenant, cliente e impressão do segredo), com margem de 1 minuto, e um `401` renova o token e tenta mais uma vez. Nada de token em disco.
- **Segredo e permissão:** o segredo do cliente fica cifrado como o do SMTP (§5). O aplicativo do envio é **separado** do login corporativo e **não tem permissão de API no Entra**: a permissão vem do **RBAC for Applications do Exchange**, restrita a uma caixa (idealmente uma caixa compartilhada num subdomínio com SPF, DKIM e DMARC). Esse passo é obrigatório na Ajuda de TI.
- **Erros:** o adaptador só informa o código (`invalid_client`, `ErrorAccessDenied`…), nunca o corpo da resposta. Erros permanentes (credencial recusada, `403`, `404`) viram `failed` na hora; `429` e `5xx` seguem a repetição do §4.
- **Rede (exceção consciente, D18):** só com o envio ligado a API e o worker falam com `login.microsoftonline.com` e `graph.microsoft.com`. Proxy: as mesmas variáveis do §5.1.
- **Validade do segredo:** `secret_expires_on` (e-mail e login corporativo) alimenta dois itens da saúde (`email_secret`, `sso_secret`), com atenção a 30 dias e falha a 7 dias ou vencido; a falha usa o alerta existente (M12).
- **Testes:** um Graph falso local (`test/support/fake-graph.ts`, só em 127.0.0.1); os endereços da Microsoft só são trocáveis com `NODE_ENV=test`. Nenhum teste fala com a Microsoft.

### 5.3 Envio pelo Google Workspace (M15, RN-101)

- **Fluxo:** conta de serviço com delegação em todo o domínio. O ITS assina um JWT (RS256, `node:crypto`, `iss` = e-mail da conta, `sub` = caixa remetente, `scope` = `gmail.send`, validade de 1 hora), troca por um token em `oauth2.googleapis.com/token` (`urn:ietf:params:oauth:grant-type:jwt-bearer`) e envia com `POST /gmail/v1/users/me/messages/send` (`{ raw }`, mensagem em base64url), com `fetch` e limite de 10 s. A mensagem (RFC 5322, cabeçalhos com acento) é montada pelo `nodemailer` (`streamTransport`), que já é dependência. O token fica em cache **na memória do processo** (chave por conta, caixa e impressão da chave), com margem de 1 minuto, e um `401` renova e tenta mais uma vez.
- **Chave e permissão:** o JSON da conta de serviço é validado ao salvar (`type`, e-mail, chave RSA legível) e só e-mail e chave privada ficam, cifrados como o resto (§5). A delegação do Google **não se restringe a uma caixa** (ao contrário do RBAC do Exchange): o risco é tratado na Ajuda de TI (projeto e conta só do ITS, escopo único, troca da chave). A API `messages.send` guarda a cópia em Enviados da caixa (documentado).
- **Erros:** só o código (`invalid_grant`, `unauthorized_client`, `PERMISSION_DENIED`…), nunca o corpo. Permanentes (`invalid_grant`, `unauthorized_client`, `invalid_client`, `400`, `404`, `403` de permissão) viram `failed` na hora; `429`, `5xx`, rede e `403` de cota repetem (§4).
- **Rede (exceção consciente, D19):** só com o envio ligado a API e o worker falam com `oauth2.googleapis.com` e `gmail.googleapis.com`. Proxy: as mesmas variáveis do §5.1.
- **Validade da chave:** `secret_expires_on` opcional; só alimenta `email_secret` quando informada (RN-100).
- **Testes:** um Google falso local (`test/support/fake-google.ts`, só em 127.0.0.1) que confere a assinatura do JWT; os endereços do Google só são trocáveis com `NODE_ENV=test`. Nenhum teste fala com o Google.

## 5A. API de integração (M16, RN-102 a RN-116)

Uma API de **leitura**, separada da API interna, para outros sistemas consumirem com contrato estável. Vem desligada de fábrica (D20). (A seção leva "5A" para não renumerar as referências às seguintes.)

- **Superfície e prefixo:** os controllers do módulo `integration` respondem em `/integration/v1/...`, **fora** do prefixo global `api` (`setGlobalPrefix('api', { exclude: [...] })` para `integration/*`). O `web` ganha um `location /integration/` que repassa para a API (e o proxy de desenvolvimento do Vite também); o TI pode liberar ou bloquear esse caminho sozinho. **Sem CORS**: a API é para servidores, e nenhuma rota dela habilita CORS. Só `GET`; qualquer outro método responde `405`. Toda resposta leva `Cache-Control: no-store`.
- **Autenticação:** as rotas são `@Public()` para o `SessionGuard` e o `PermissionGuard` globais (feitos para pessoas, com cookie) e passam por um **`IntegrationGuard`** próprio, nesta ordem: limite de tentativas inválidas por IP (só memória, antes de qualquer consulta ao banco), chave geral ligada (senão `404`), cabeçalho `Authorization: Bearer`, busca pelo **hash** do token (`tokenHash` de `identity-access/password.ts`, o mesmo das sessões; só o hash existe no banco), estado da integração, validade, lista de IPs (o IP real que o nginx repassa, via `trust proxy`), **limite por integração** (os cabeçalhos `X-RateLimit-*` vão em toda resposta autenticada), módulo ligado (`404`) e módulo da integração (`403`) e, por fim, o escopo. Toda falha de autenticação devolve o **mesmo `401`**. O guard põe em `req.integration` o identificador, os módulos, o escopo e `includeEmail`; o token e o cabeçalho nunca chegam ao log, à auditoria nem às métricas. Antes de tudo, um middleware de `/integration` põe `Cache-Control: no-store` em toda resposta e responde `405` (ou `404` com a chave desligada) a qualquer método que não seja `GET`, inclusive `OPTIONS`, sem cabeçalho CORS.
- **Escopo e leitura:** cada integração vira um `Access` pela mesma função pura `computeAccess` (`identity-access/access.ts`), com uma concessão por entidade do escopo (com ou sem subentidades) e as permissões internas de leitura do módulo (por exemplo `idea.view_scope`, `report.view`). **Sem `userId`**: a exceção "o autor vê a própria ideia" e os participantes não valem. Os serviços atuais misturam regra de pessoa e filtro de tela, então a integração usa **leitores novos e enxutos** (`integration/readers`), que só selecionam os campos das RN-107 a RN-112 e sempre aplicam o escopo; nenhuma resposta é montada a partir de uma entidade inteira (lista de campos explícita). Os testes CA-T.14 e CA-T.5 cobrem o isolamento.
- **Limites:** o `RateLimiter` de `common/rate-limit.ts` com duas chaves: o IP para tentativa inválida (20 por minuto, antes de consultar o banco) e a integração para o uso (padrão 60 por minuto). Os dois vivem na memória de cada instância da API (mesma limitação da consulta pública).
- **Chave geral e módulos:** lidos de `setting` (`integration.enabled`, `integration.modules`) a cada chamada, ou de um cache invalidado ao gravar; desligar tem efeito na chamada seguinte (CA-RN-102.4).
- **Contrato:** um **segundo documento OpenAPI** (`SwaggerModule.createDocument` com `include` do módulo `integration`), gravado em `backend/openapi-integration.json` e conferido em dia pelo teste. O documento interno (`openapi.json`, contrato do frontend) passa a listar os módulos explicitamente, **sem** o de integração (CA-T.15). `GET /integration/v1/openapi.json` exige token e devolve o documento **filtrado pelos módulos da integração** (uma tag por módulo). O contrato `v1` é **congelado**: um teste compara o documento atual com o de referência e falha se algo existente for removido ou mudado (CA-RN-106.10); acréscimos passam.
- **Métricas e consumo:** as rotas entram nas métricas gerais pelo molde (`GET /integration/v1/ideas`); o consumo por integração e módulo é acumulado em memória e descarregado de forma aditiva em `integration_hour`, no padrão do `metrics-flush` do M12. Autenticação que falha não se liga a nenhuma integração.
- **Saúde e alerta:** `probeIntegrationToken` reaproveita `secretVerdict` e `worstVerdict` de `observability/secret-expiry.ts`; `integration_token` entra em `HEALTH_KEYS`, nos textos do alerta (`alert-text.ts`, pt-BR e en) e na tela de saúde.
- **Administração:** `admin/integrations` (permissão `integration.manage`), no molde de `admin/access` e `admin/email`: DTOs Zod, `apiError`, `AuditService.record` com o administrador como autor e a integração em `data`. A tela vive em Administração > Integrações.
- **Documentação na tela (RN-115):** `GET /api/admin/integrations/openapi` (sessão e `integration.manage`, não o token) devolve o mesmo documento do contrato, **filtrado** pelos módulos ligados (ou pelos de uma integração, com `?integration=`); a aba só renderiza esse JSON (lista de rotas, campos, exemplo e `curl`), sem dependência de Swagger UI e **sem chamar** `/integration`. Os exemplos vêm dos `example` do contrato, escritos à mão e fictícios; o `curl` usa `SEU_TOKEN`. Cada rota, parâmetro e campo leva `description` (inglês) e `x-description-pt-BR`, e um teste falha se faltar um deles (CA-RN-115.11).
- **Rede:** nenhuma saída. Ao contrário do e-mail e do login corporativo (§5.1 a §5.3), a API de integração só **recebe** chamadas; os webhooks de saída, que contatam o exterior, são o M17 e exigirão uma exceção consciente própria.
- **Testes:** o cliente de teste (`test/support/test-app.ts`) sempre prefixa `/api`; ganha um modo para URL absoluta e cabeçalho `Authorization`. O "consumidor" é o próprio cliente HTTP dos testes, com duas integrações de escopos disjuntos para o CA-T.14. Nada fala com a internet.

## 5B. Webhooks de saída (M17, RN-117 a RN-125)

O ITS avisa os sistemas integrados quando algo acontece, com um aviso mínimo e assinado (D22). É o primeiro recurso em que a API e o worker chamam um endereço de fora.

- **Evento e caixa de saída:** `WebhookEventsService.emit(manager, ...)` é chamado **dentro da transação** de quem muda o dado (envio de ideia, transições, arquivar, excluir, converger, validar ganho, destaque e campanha), no mesmo padrão dos eventos de domínio do projeto. Ele grava o `webhook_event` e uma `webhook_delivery` para cada assinatura que o assina (módulo da integração, entidade no escopo **naquele momento**, assinatura e integração ativas, chave dos webhooks ligada). Se a transação desfaz, o evento some junto.
- **Envio no worker:** como a fila de e-mail (§4), o worker pega as entregas pendentes com `SKIP LOCKED` (`next_attempt_at <= now()`) e envia. O cliente HTTP é `node:http`/`node:https` com um `lookup` próprio: **resolve o nome, confere o endereço contra a lista e as classes bloqueadas e conecta nesse endereço** (sem resolver de novo), não segue redirecionamento, espera 10 segundos, lê até 64 KB da resposta (descartada) e envia até 8 KB. A repetição usa o calendário da RN-121 gravado em `next_attempt_at`.
- **Assinatura:** `X-ITS-Signature: v1=<hmac>` de `<timestamp>.<corpo>` (`node:crypto`), com o segredo decifrado do `secret-box` (§5) só na hora de assinar; na rotação, as duas assinaturas vão no mesmo cabeçalho. A Ajuda de TI traz o exemplo de conferência, que também é testado (CA-RN-125.7).
- **Destino:** regras puras em `integration/webhooks/destination-rules.ts` (casamento por nome, domínio com curinga e faixa de IP; classes sempre bloqueadas: loopback, link local, metadados de nuvem, não especificado, multicast, IPv6 equivalentes), usadas ao salvar e a cada envio.
- **Saúde e alerta:** `webhook_secret` (mesma régua da RN-100) e `webhook_delivery` entram em `HEALTH_KEYS`, nos textos do alerta e na tela; a falha usa o alerta existente (RN-94).
- **Rede (exceção consciente, D22):** só com a chave dos webhooks ligada, a API (envio de teste) e o worker (entregas) chamam os destinos permitidos. O envio é **direto, sem proxy** (agente HTTP próprio, que não lê `HTTPS_PROXY`/`NO_PROXY`): a conexão vai ao endereço já checado, e um proxy a desviaria. Onde a saída só passa por proxy, os avisos só chegam a destinos que o servidor alcança direto. Nada além disso sai da instalação.
- **Testes:** um receptor falso local (`test/support/fake-webhook-receiver.ts`) que registra toda conexão e confere a assinatura, e um resolvedor de teste. O loopback só é alcançável com `NODE_ENV=test`, como os outros falsos; nenhum teste fala com a internet.

## 5C. Escrita pela API de integração (M18, RN-126 a RN-134)

Quatro gravações pequenas (D23), pelos **mesmos serviços** das telas.

- **Módulos e rotas:** `ideas_write` e `gains_write` entram em `INTEGRATION_MODULES` (oito no total); as rotas novas ficam no `IntegrationModule`, com a tag do módulo (o contrato `v1` só ganha). O middleware de `/integration` deixa de recusar tudo que não é `GET` e passa a recusar só o que **não** é uma rota de escrita declarada (`405` com `Allow` do método certo).
- **Autoria e permissão:** o serviço resolve `author_email` para um usuário ativo e carrega o `Access` **dele** (`AccessService.load`); a permissão de enviar naquela entidade se confere pelo caminho normal. A origem (`source_integration_id`) entra como parâmetro dos serviços de ideias e de comentários e vai para o histórico (`integrationId` no dado do evento).
- **Idempotência:** um interceptador reserva a chave (`INSERT ... ON CONFLICT DO NOTHING` em `integration_idempotency`), guarda a resposta de sucesso ou de erro de negócio (`4xx`) e libera a chave em `5xx`; chave igual com corpo diferente é `422`, e a concorrência dá `409 request_in_progress`. A limpeza das chaves com mais de 24 horas roda no mesmo disparo da observabilidade.
- **Limite:** uma segunda instância do `WindowCounter` (§5A) conta só as chamadas de escrita (30 por minuto, fixo no código), além do limite geral da integração.
- **Auditoria e eco:** `integration.idea_submitted`, `integration.comment_added`, `integration.external_ref_changed` e `integration.gain_declared` (autor nulo; a integração e o código nos dados, sem o corpo). O evento de webhook de uma ação da integração leva `origin_integration_id` e não é entregue às assinaturas dela mesma.
- **Resposta mínima:** cada gravação devolve só `code`, `status` e `entity_id` (ou `idea_code` e `status`); por isso os módulos de escrita não exigem os de leitura.

## 6. Empacotamento (Docker)

| Serviço | Imagem | Notas |
|---|---|---|
| `web` | nginx com a SPA compilada | Repassa `/api` e, desde o M16, `/integration`; é o único serviço exposto |
| `api` | Node (build multiestágio, usuário sem privilégios) | Executa as migrações ao iniciar (com trava), healthcheck |
| `worker` | mesma imagem da `api` | Comando de inicialização diferente |
| `db` | `postgres` | Volume nomeado; backup documentado |

- Configuração por variáveis de ambiente (arquivo `.env`); **sem segredos nem usuário padrão** na imagem (RN-43).
- HTTPS: documentar uso com um proxy reverso (Caddy ou Traefik) na frente. Também é exigência do navegador para instalar o app (PWA) fora de `localhost`.
- O nginx serve o `index.html`, o `sw.js` e o manifesto sem cache (a versão nova chega na próxima visita) e os arquivos de `/assets` (nome com *hash*) com cache longo.
- Um comando para subir: `docker compose up -d`. O assistente de instalação cria o administrador (RN-43).

## 7. Estrutura do repositório

Um único repositório (decisão de 05/11/2026; antes eram três repositórios separados, sem nenhum commit, unidos sem perda de histórico).

```
its/
├─ backend/             NestJS + worker, Dockerfile, openapi.json
├─ frontend/            React + Vite, Dockerfile + nginx.conf
├─ docker/              Compose (implantação) e sobreposição de desenvolvimento
├─ docs/                regras, critérios, modelo de dados, stack, roadmap, DESIGN.md
└─ .github/workflows/   backend.yml, frontend.yml (filtrados por pasta) e ci.yml (segredos e Compose)
```

| Ponto | Como fica |
|---|---|
| Dependências | Cada pasta tem o seu `package.json` e `pnpm-lock.yaml`; sem workspace e sem pacote compartilhado (pode ser adotado depois, se fizer falta) |
| Contrato | O **OpenAPI** publicado pela API (`backend/openapi.json`) é a fonte única. O frontend gera os tipos lendo esse arquivo direto; a CI falha se o contrato ou os tipos gerados estiverem desatualizados. Os códigos de permissão são definidos no backend e entregues pela API |
| Mudança que atravessa os dois | Um commit (ou PR) com backend, contrato e frontend juntos, citando a regra e os critérios que motivam |
| CI | `backend.yml` roda quando muda `backend/**`; `frontend.yml` quando muda `frontend/**` ou o contrato; `ci.yml` sempre (gitleaks no histórico inteiro e validação do Compose) |
| Versões | Uma versão para o projeto (v0.1, v0.2…); backend e frontend são lançados juntos |
| Teste ponta a ponta (Playwright) | Sobe a pilha completa pelo Compose |
| Imagens Docker | Uma imagem para o backend e outra para o frontend, construídas a partir das respectivas pastas; o Compose de produção usa as imagens publicadas e o de desenvolvimento faz *build* das pastas |

## 8. Spikes do M0 (executados)

Todos aprovados.

1. **Árvore de entidades** (CA-RN-25.1/25.2): aprovado.
2. **Semelhantes** (CA-RN-57.1/57.2): aprovado, com `<%` em vez de `%`.
3. **pg-boss + TypeORM** (CA-T.1): aprovado.
4. **Identificador sequencial sob concorrência** (CA-RN-22.2): aprovado, só com QueryBuilder.

## 9. Decisões do autor registradas

- **Um repositório só** (`its`), com backend, frontend, Docker e documentação (05/11/2026; substitui a decisão anterior de três repositórios). Sem pacote compartilhado.
- **Login somente por e-mail** (a pessoa se identifica pelo e-mail; entra por senha ou, desde o M13 e se o administrador ligar, por Microsoft/Google).
- **UUID v7** em todas as chaves primárias (exceto `idea_event` e `audit_log`, `bigserial`).
- **Um único usuário de banco** na aplicação. O histórico imutável usa *trigger* (ver [MODELO-DE-DADOS.md](MODELO-DE-DADOS.md), §9 e §12).

## 10. Estratégia de testes e banco

- Os testes **nunca** usam o banco principal. Cada execução da suíte (local ou CI) **cria um banco temporário**, roda as migrações do zero (o que já valida CA-T.9), executa os testes e **descarta** o banco ao final.
- Em CI, o Postgres sobe como serviço da pipeline (ou contêiner de teste); localmente, um contêiner descartável.
- Isolamento entre testes de integração: transação com *rollback* por teste, ou limpeza por tabela; o que for mais simples e estável.
- **Como a trava funciona (implementado):** a variável `DATABASE_URL` dos testes aponta para o banco de **manutenção** (`postgres`) e serve só para criar e apagar bancos. Cada arquivo de teste cria `TEST_DATABASE_PREFIX` + sufixo aleatório e **só apaga bancos que ele mesmo criou com esse prefixo**; sem o prefixo definido ou inválido, a suíte se recusa a rodar. Os testes nunca executam nada no banco principal da aplicação.

## 11. Alternativas descartadas (para registro)

| Opção | Por que não |
|---|---|
| Next.js (app único) | Perde a separação desejada; dificulta o worker |
| Microsserviços | Custo operacional alto para o público-alvo; consistência mais difícil |
| MySQL | Dobra a matriz de testes; perde trigramas e travas consultivas |
| Redis + BullMQ | Um serviço a mais, sem necessidade (o pg-boss usa o Postgres) |
| JWT sem estado | Não invalida sessão ao desativar usuário |
