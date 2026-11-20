# ITS – backend

API (NestJS com Express) e worker de jobs (pg-boss), no mesmo código. Monólito modular.

> Pré-desenvolvimento (marco M0). Regras, critérios de aceite, modelo de dados e roadmap ficam em [`../docs`](../docs). Arquitetura: [`../docs/STACK-E-ARQUITETURA.md`](../docs/STACK-E-ARQUITETURA.md).

## Responsabilidades

- Regras de negócio, persistência (TypeORM + PostgreSQL), autenticação por sessão, jobs e e-mail.
- **Contrato com o frontend:** a API publica um documento **OpenAPI**. Os tipos e o cliente do frontend são gerados a partir dele; não há pacote compartilhado.
- Os códigos de permissão (ex.: `idea.triage`) são definidos aqui e expostos pela API.

## Desenvolvimento

Pré-requisitos: Node 22+, [pnpm](https://pnpm.io), um PostgreSQL local (há um Compose pronto em `../docker`).

```bash
# banco local (Compose na raiz do repositório): publica o Postgres só em 127.0.0.1:5433
docker compose -f ../docker-compose.yml -f ../docker-compose.dev.yml up -d db
cp .env.example .env      # DATABASE_URL aponta para o banco de manutenção "postgres" na porta 5433
corepack pnpm install
corepack pnpm test        # inclui os spikes do M0 (test/spikes)
```

**Migrações:** a API aplica as pendentes ao iniciar (com trava entre instâncias) e semeia os perfis de fábrica. Depois de mudar uma entidade, rode `pnpm migration:generate NomeEmPascalCase`: o comando cria um banco temporário, compara com as entidades, escreve a migração em `src/database/migrations` e a registra no `index.ts`. Revise o arquivo; triggers, índices com classe de operador e dados vão à mão, numa migração separada. Nunca edite uma migração já publicada.

Os testes **nunca** usam o banco principal: cada execução cria um banco temporário (prefixo `TEST_DATABASE_PREFIX`), roda as migrações do zero e o descarta ao final. Cada teste leva o identificador do critério no nome (ex.: `CA-RN-05.1 ...`).

## Observabilidade (M12)

Saúde por itens, tráfego, histórico por hora, métricas do worker e alertas ficam em `src/observability` e valem só dentro da instalação (RN-92 a RN-94). Rotas protegidas por `ops.view`: `GET /api/ops/health`, `/traffic`, `/history` e `/usage`; `GET /api/health` é público e devolve `503` com o banco fora. Variável de ambiente: `METRICS_ENABLED` (padrão `true`; `false` desliga a contagem, a saúde continua). Dias de histórico: configuração `ops.retention_days` (padrão 30, até 90). O alerta roda no worker, a cada 5 minutos; o e-mail dele tem texto fixo (`src/observability/alert-text.ts`).

## Acesso corporativo (M13)

Login com Microsoft e Google por OpenID Connect, desligado de fábrica (RN-95 a RN-98, decisão D17). O código fica em `src/identity-access/sso` e `domain-policy.ts`:

- `oidc.ts` é um cliente OIDC próprio e enxuto sobre `fetch` e `node:crypto` (PKCE, descoberta, troca do código e validação do id_token com RS256, `iss`, `aud`, `exp`, `nbf` e `nonce`); não há dependência nova. `providers.ts` tem os dois provedores (Microsoft de um tenant só; Google com `email_verified` e `hd`).
- Rotas públicas `GET /api/auth/sso/:provedor/start` e `/callback` (limite por IP, estado num cookie curto e cifrado). Rotas do administrador, com `sso.manage`: `GET /api/admin/access`, `PUT /policy`, `PUT /providers/:provedor`, `POST /providers/:provedor/test-address|enable|disable`, `PUT /mode` e `PUT /provisioning`.
- O segredo do cliente fica cifrado em `sso_provider` (mesmo `secret-box` do SMTP) e nunca sai pela API; o vínculo com a conta do provedor fica em `user_identity`.
- Só `https` (ou `http` em 127.0.0.1 com `NODE_ENV=test`, para o provedor falso dos testes). Variáveis opcionais de proxy: `NODE_USE_ENV_PROXY`, `HTTPS_PROXY` e `NO_PROXY`.
- Nos testes, `test/support/fake-oidc.ts` é um provedor OIDC falso e local; nenhum teste fala com a Microsoft nem com o Google.

## E-mail pela Microsoft e validade dos segredos (M14)

O envio de e-mail tem três tipos de provedor (RN-90, RN-99, RN-101): **SMTP**, **Microsoft 365 pelo Graph** e **Google Workspace pela Gmail API**, um ativo por vez. O código fica em `src/communication`:

- `mail-graph.ts` é o adaptador do Graph: `client_credentials`, `POST /users/{caixa}/sendMail` (`202`), token com cache na memória do processo, `401` com uma nova tentativa, `saveToSentItems: false`, corpo em texto e erro só com o código (`MailSendError`, `permanent` para credencial recusada, `403` e `404`, que não são repetidos). Sem dependência nova.
- `mail-transport.ts` guarda a união de configurações e a fábrica por tipo; `mail.ts` (`readConfig`, `deliverEmail`) e `email-admin.service.ts` (a tela de e-mail) escolhem o adaptador pelo `type` do `mail_provider`. A API do administrador (`/api/admin/email/provider`) recebe o corpo por `type` (sem o campo vale SMTP).
- `common/microsoft.ts` tem o validador do tenant e os endereços da Microsoft: só `https`, e em `NODE_ENV=test` podem apontar para um Graph falso local (`MAIL_LOGIN_BASE_OVERRIDE`, `MAIL_GRAPH_BASE_OVERRIDE`).
- A validade do segredo (`secret_expires_on`, em `mail_provider` e `sso_provider`) alimenta os itens de saúde `email_secret` e `sso_secret` (`observability/secret-expiry.ts`): atenção a 30 dias, falha (e alerta) a 7 dias ou vencido (RN-100).
- Nos testes, `test/support/fake-graph.ts` é um Graph falso e local; nenhum teste fala com a Microsoft.
- `mail-google.ts` (M15) é o adaptador do Google Workspace: JWT RS256 da conta de serviço em nome da caixa (escopo `gmail.send`), `POST /gmail/v1/users/me/messages/send` com a mensagem montada pelo nodemailer, token em cache, `401` com uma nova tentativa e erro só com o código (permanentes: `invalid_grant`, `unauthorized_client`, `403` de permissão; repetíveis: `429`, `5xx`, cota). `common/google.ts` tem os endereços (trocáveis só com `NODE_ENV=test`: `MAIL_GOOGLE_TOKEN_OVERRIDE`, `MAIL_GMAIL_BASE_OVERRIDE`) e a leitura da chave JSON. Nos testes, `test/support/fake-google.ts` confere a assinatura do JWT; nenhum teste fala com o Google.

## Licença

[MIT](../LICENSE).

## API de integração (M16)

Uma API só de **leitura** para outros sistemas, em `/integration/v1`, **separada** da API interna (`/api`). Vem desligada de fábrica (RN-102 a RN-116, D20 e D21).

- **Módulo `integration/`:** `IntegrationModule` tem só as rotas e os leitores do contrato (`api/*.api.ts`, um por módulo: ideias, indicadores e ganhos, campanhas, Hall, entidades e categorias, usuários); `IntegrationAdminModule` tem a administração (`/api/admin/integrations`, permissão `integration.manage`). Só o primeiro entra no OpenAPI da integração e só ele sai do OpenAPI interno (`app.factory.ts`).
- **Entrada:** `integration-http.ts` (middleware de `/integration`: `no-store`, `405` fora de `GET`, sem CORS) e `integration.guard.ts` (limite por IP para token inválido, chave geral, token pelo hash, estado, validade, IPs, limite por integração, módulo ligado e da integração, escopo). Toda falha de autenticação é o mesmo `401`. As rotas são `@Public()` para o `SessionGuard`: o cookie nunca vale aqui, e o token nunca vale em `/api`.
- **Escopo:** `computeAccess` (o mesmo cálculo dos perfis), sem `userId`: não há a exceção "o autor vê a própria ideia". Os leitores selecionam campos explícitos e sempre aplicam o escopo; indicadores reaproveitam o `ReportsService`.
- **Token:** `token-rules.ts` (`its_` + 256 bits, hash SHA-256, validade de até 365 dias, rotação com sobreposição). Só o hash e o prefixo ficam no banco.
- **Consumo:** `integration-usage.service.ts` acumula em memória e grava por hora, de forma aditiva, em `integration_hour`; a limpeza usa `ops.retention_days`.
- **Contrato congelado:** `openapi-integration.json` é versionado; `pnpm openapi:export` recusa uma mudança que quebra quem já integra (`contract-compat.ts`), salvo `ALLOW_BREAKING_CONTRACT=1`. As descrições vão em inglês (`description`) e pt-BR (`x-description-pt-BR`), conferidas por teste.
- **Testes:** `test/integration/` (regras puras, administração, API de leitura e contrato). O consumidor é o `IntegrationClient` (`test/support/integration-support.ts`), com um IP de `X-Forwarded-For` por teste; nada fala com a internet.

## Webhooks de saída (M17)

O ITS avisa o sistema da integração quando algo acontece (RN-117 a RN-125, D22). Desligados de fábrica; é o único ponto em que o ITS chama o exterior.

- **Módulo `integration/webhooks/`:** regras puras (`destination-rules.ts`: destinos permitidos e classes sempre bloqueadas; `rules.ts`: limites, calendário de repetição, HMAC-SHA256 e o receptor de referência; `events.ts`: catálogo e aviso mínimo), `entities.ts` (4 tabelas), emissão (`webhook-emit.ts`) e envio (`webhook-sender.ts`). A administração está em `admin/` (`/api/admin/webhooks`, permissão `integration.manage`) e entra no `AppModule` por `WebhooksAdminModule`.
- **Caixa de saída:** o evento é gravado na **mesma transação** da mudança (`emitWebhookEvent`, chamado pelo `recordEvent` das ideias e pelos serviços de Hall e campanhas), uma entrega por assinatura interessada, só com identificadores e estado. O escopo vale no momento do evento.
- **Envio:** o worker pega as entregas devidas com `FOR UPDATE SKIP LOCKED` (dois processos não enviam a mesma) a cada 5 s. O nome é resolvido na hora e a conexão vai ao **endereço já checado**; sem redirecionamento, 10 s, 8 KB enviados, 64 KB lidos e descartados. O envio usa agente HTTP próprio (não obedece `HTTPS_PROXY`). Repetição em 30 s, 2 min, 10 min, 1 h, 3 h, 6 h, 12 h e 24 h; 20 falhas definitivas seguidas suspendem a assinatura.
- **Segredo:** `whsec_` + 256 bits, **cifrado** (`secret-box`), mostrado uma vez, validade de até 365 dias, rotação com sobreposição (duas assinaturas no cabeçalho). Auditoria e logs guardam só o servidor do endereço.
- **Testes:** `test/integration/webhook-rules.spec.ts` (regras puras) e `webhooks.spec.ts` (administração, entrega, repetição, suspensão, DNS trocado, redirecionamento, vazamento, saúde e o exemplo da Ajuda executado contra uma entrega real). O receptor é `test/support/fake-webhook-receiver.ts` e o DNS é falso; o loopback só é alcançável com `NODE_ENV=test`.

## Escrita pela API de integração (M18)

Quatro gravações pequenas em `/integration/v1`, desligadas de fábrica (RN-126 a RN-134, D23). Regra de ouro: **a integração nunca decide**.

- **Módulos e rotas:** `ideas_write` e `gains_write` (oito módulos no total). `integration/write/`: `write.api.ts` (rotas e contrato bilíngue), `write.service.ts` (a lógica), `write-schemas.ts` (corpos `strict`), `write-routes.ts` (as ÚNICAS rotas que aceitam outro método além de `GET`; o middleware `integration-http.ts` responde `405` com o `Allow` certo a todo o resto) e `idempotency.ts`.
- **Mesmos serviços das telas:** enviar ideia chama `IdeasService.submit` com o `Access` da pessoa do `author_email` (a permissão de enviar naquela entidade se confere sozinha) e a origem (`sourceIntegration`); o ganho usa `ResultsService.saveGain`, extraído do `setGain` (a tela e a integração passam pela mesma regra); comentário e referência externa são gravações próprias, sem pessoa.
- **Origem:** `idea.source_integration_id`, `comment.source_integration_id` (e `comment.author_id` anulável) e `integrationId`/`integrationName` no dado do histórico. O `recordEvent` repassa `integrationId` como `originIntegrationId` dos webhooks: o evento causado por uma integração não volta para ela.
- **Idempotência:** `IdempotencyInterceptor` reserva a chave com `INSERT ... ON CONFLICT DO NOTHING` em `integration_idempotency`, guarda a resposta de sucesso e a de erro `4xx` e libera a chave em `5xx`; a limpeza (24 h) roda em `purgeOpsData`. O TypeORM devolve `[linhas, contagem]` em `UPDATE`/`DELETE ... RETURNING`; o código trata isso.
- **Limite:** o `IntegrationGuard` tem um segundo `WindowCounter` só para escrita (30/min, fixo), além do geral.
- **Auditoria:** `integration.idea_submitted`, `comment_added`, `external_ref_changed` e `gain_declared`, sem autor de pessoa, na mesma transação da gravação.
- **Testes:** `test/integration/integration-write.spec.ts` (35 casos: módulos, as quatro ações, idempotência inclusive concorrente, "nunca decide", origem, auditoria sem vazamento, eco dos webhooks, limite e consumo). Cada teste cria a própria integração, porque o limite de escrita é fixo.

## Acabamento da v1.0 (M19)

Texto formatado, arrastar para ordenar e o banco fechado (RN-135 a RN-141, D24 e D25).

- **Texto formatado (RN-136, D25):** o JSON do editor (TipTap) fica em colunas `jsonb` `*_rich` (descrição, solução, resultado, padrão adotado, comentário, etapa, objetivo da campanha) e a coluna de texto que já existia vira a **cópia em texto puro**, derivada no servidor. `common/rich-text.ts`: `sanitizeRichDoc` valida contra a lista fixa (parágrafo, quebra, listas, citação, negrito, itálico, link `http`/`https`/`mailto`) sem interpretar HTML; `resolveRich`/`normalizeRich` derivam o texto e aplicam o limite sobre ele. Busca, ideias semelhantes, PDF, exportação e a API de integração leem o texto puro, como antes; a escrita da integração segue aceitando texto puro, que zera o documento antigo.
- **Ordem das categorias (RN-137):** `PUT /categories/order` com a lista completa de ids (422 `invalid_order` se faltar ou sobrar), trava consultiva, `sort_order` em passos de 10, auditoria `category.reordered`.
- **Mover entidade arrastando (RN-141):** é o mesmo `PATCH /entities/{id}` de sempre (ciclo `entity_cycle`, permissão no destino); só a tela mudou.
- **Compose (RN-140):** projeto `its`, rede `internal: true` só com o banco, a API e o worker; o banco não publica porta (só o arquivo de desenvolvimento abre `127.0.0.1:5433`). `test/infra/compose.spec.ts` lê os YAML.
- **Testes:** `test/common/rich-text.spec.ts`, `test/ideas/rich-text.spec.ts` (HTML hostil direto pela API, busca por palavra em negrito, ideia antiga, limite, integração, comentário interno, PDF), `test/organization/entities-categories.spec.ts` (ordem) e `test/infra/compose.spec.ts`.

## Pessoas e anexos (M20 · 1.1.0)

Foto, aparência e anexos (RN-142 a RN-147, D26 e D27).

- **Foto por origem (RN-144):** `user_avatar` tem `source` (`upload`, `microsoft`, `google`; uma por origem) e `user.photo_choice` diz qual mostrar (`default` = iniciais). `photo-versions.ts` resolve a foto mostrada (`activePhoto`) em lote para listas (Usuários, comentários, Hall, ranking) e respeita o opt-out de nome. Rotas novas: `GET /users/{id}/photo/options`, `GET /users/{id}/photo/sources/{source}` e `PUT /users/{id}/photo/choice`.
- **Foto do provedor:** `sso/provider-photo.ts` busca pelo servidor, só em `graph.microsoft.com` e `*.googleusercontent.com` (`https`, sem redirecionamento, 5 s, 5 MB), com a mesma normalização do `sharp`; falha nunca derruba o login. A Microsoft pede `User.Read` só com `sso_provider.photo_enabled` ligado; o token de acesso não é guardado. Em teste, `SSO_GRAPH_BASE_OVERRIDE` e `SSO_PHOTO_TEST_HOST` (só com `NODE_ENV=test`).
- **Aparência (RN-145):** `organization/user-theme.ts` (paleta curada de 8 cores, todas sem correção de contraste) e a chave `branding.user_theme`; `user.ui_color`/`ui_font` pelo `PATCH /auth/me/preferences` (403 `user_theme_disabled` com a chave desligada) e o `me.appearance` com a marca derivada.
- **Anexos da ideia (RN-146):** `attachment.step_id` nulo; `GET/POST /ideas/{ref}/attachments` (até 10, `attachment_limit`), regras de anexar e remover por situação e por `idea.triage`.
- **Exibição (RN-147):** `GET /ideas/{ref}/attachments/{id}/view`, com o tipo pelo conteúdo (`media-view.ts`: PNG, JPEG, GIF, WebP, MP4, WebM; o resto 415 `not_viewable`), `inline`, `nosniff`, `sandbox` e `Range` (206/416).
- **Testes:** `test/identity-access/person-photo.spec.ts`, `sso-photo.spec.ts`, `provider-photo.spec.ts`, `user-theme-api.spec.ts`, `test/organization/user-theme.spec.ts`, `test/ideas/idea-attachments.spec.ts` e `media-view.spec.ts`.

## Mural de ideias (M21 · 1.2.0)

Publicar, reagir, conversar, moderar e compartilhar (RN-148 a RN-158, D28). Módulo `src/mural/`; chave `mural.enabled` (desligada de fábrica: toda rota responde 404) e permissão `mural.manage` no escopo da entidade da ideia.

- **Dados:** migração `Mural` com `mural_post` (uma por ideia; retirar e publicar de novo reusam a linha), `mural_consent`, `mural_reaction`, `mural_comment` (um nível de resposta) e `mural_comment_revision`, `mural_report` e `mural_share`. O último passo dá `mural.manage` ao perfil de fábrica Analista das instalações que já existem.
- **Publicar e retirar (`mural.service.ts`):** `/mural/ideas/{ref}/publication`, `publish`, `withdraw` e `consent`. A retirada automática (`mural-core.ts`) roda no fim do `recordEvent` do histórico: interromper ou arquivar retira; excluir apaga em cascata.
- **Leitura (`mural-feed.service.ts`, `mural-views.ts`):** `GET /mural` com cursor estável em microssegundos (ordem pela publicação ou pelo total de reações), filtros e páginas de 20; `GET /mural/ideas/{ref}` (cartão e conversa; retirada responde 404 `mural_withdrawn`); reações com `INSERT ... ON CONFLICT` e lista de quem reagiu; busca de colegas sem e-mail.
- **Anonimato (`mural-common.ts`):** os participantes são calculados na hora (autor e coautores atuais) e `personView` decide como cada pessoa aparece (`author`, `co_author`, `former` ou revelada para a equipe).
- **Conversa e moderação (`mural-talk.service.ts`):** comentar, responder, editar com revisão, apagar, denunciar (unicidade por pessoa), ocultar, restaurar, dispensar e a fila; limites de 30 comentários e 20 envios por hora com trava consultiva por pessoa.
- **Avisos (`mural-notify.ts`):** sete tipos em `MURAL_TYPES`; resumo do dia, respostas e denúncias agrupados por dia (`payload.day` e `payload.group`, com trava por chave).
- **Integração:** os eventos `mural.published` e `mural.withdrawn` saem do histórico; `on_mural` e `mural_published_at` no `IdeaItem`.
- **Testes:** `test/mural/mural-publish.spec.ts`, `mural-api.spec.ts` (inclui a varredura do CA-T.24) e `mural-notify.spec.ts`.

## Loja e bonificação (M22 · 1.3.0)

Saldo, itens, pedidos e bonificações (RN-159 a RN-173, D29). Módulo `src/store/`; chave `store.enabled` (desligada de fábrica: toda rota responde 404; só liga com `recognition.enabled`, senão 422 `store_requires_recognition`) e permissão `store.manage`, que vale para a loja inteira.

- **Dados:** migração `Store` com `store_item`, `store_item_entity`, `store_order` (custo, tipo e valor congelados na hora do pedido), `store_ledger` e `store_expiry_notice`. O extrato só aceita `INSERT`: gatilhos recusam `UPDATE` e `DELETE`; `idea_id` e `actor_id` não têm chave estrangeira para não travar a exclusão de ideias, e `uq_store_ledger_point` garante um crédito por ponto. A migração acrescenta `store` nos CHECKs de módulos da integração.
- **Saldo (`store-core.ts`, `store-rules.ts`):** o saldo é a soma do extrato menos o vencido (`expiredAmount`, FIFO). `initializeBalances` grava o saldo inicial na primeira ativação (`store.initialized_at`); `creditForPoint` roda em `recognition/award.ts` logo depois de cada ponto; `lockBalance` usa `pg_advisory_xact_lock(hashtext('store_balance:<pessoa>'))`.
- **Validade:** `runStoreExpiry` roda uma vez por dia no worker, grava as linhas de vencimento e o aviso de 30 dias (uma vez por lote, `store_expiry_notice`).
- **Itens (`store-items.service.ts`, `store-photo.ts`):** CRUD com auditoria `store.item_*`, alcance por entidade (com sub-entidades), estoque e limite por período do calendário; foto quadrada de 512 px em WebP (`storage/store`, até 5 MB).
- **Pedidos (`store-orders.service.ts`):** `POST /store/orders` (201) trava o saldo e o item (`FOR UPDATE`), confere estoque e limite e grava a reserva; `approve`, `reject`, `deliver`, `pay` e `cancel` com 403 `own_order` e 409 `invalid_order_status`; o estorno devolve saldo e estoque. `GET /store/bonuses` e `/store/bonuses/export` (CSV).
- **Saldos (`store.service.ts`):** `/store/me`, `/store/me/ledger`, `/store/accounts` e `POST /store/adjustments` (200; 403 `own_account`, 422 `person_anonymized`).
- **Avisos (`store-notify.ts`):** `STORE_TYPES`; aprovado, recusado e cancelado são obrigatórios; os pedidos novos chegam a quem tem `store.manage` num aviso por dia (sem quem pediu).
- **Integração:** módulo `store` (`integration/api/store.api.ts`, `/integration/v1/store/orders`, sensível, sem escopo de entidade; 404 com a loja desligada) e os eventos `store.order_approved`, `store.order_delivered` e `store.bonus_paid`, com `entityIds` nulo.
- **Testes:** `test/store/store-balance.spec.ts`, `store-orders.spec.ts` e `store-notify.spec.ts`.

## Campos personalizados do usuário (M25)

Até 8 campos que a organização cria sobre as pessoas (RN-193 a RN-202, D32). Módulo `src/user-fields/`.

- **Dados (migração `UserFields`):** `user_field`, `user_field_option`, `user_field_value` (um valor por pessoa e campo; a chave de valor único tem índice único parcial) e `idea_field_value` (o valor dos campos fechados do autor, gravado na ideia ao enviar).
- **Regras puras** em `user-field-rules.ts` (tipos, limites, CPF, telefone, máscara livre e a chave de valor único); a mesma regra existe em `frontend/src/lib/user-fields.ts`.
- **Rotas:**
  - Administração (`user.manage`): `/user-fields` (campos, opções e ordem) e `GET`/`PUT /users/{id}/fields`.
  - A própria pessoa: `GET`/`PUT /me/fields`, com a trava "só a administração altera" (403 `custom_field_locked`) e o valor único (409 `custom_field_duplicate`).
- **Cadastro obrigatório:** a guarda `ProfileGuard` (logo depois da sessão) responde 428 `profile_incomplete` a quem tem obrigatório vazio; respondem as rotas com `@AllowIncompleteProfile` (`/auth/*`, `/me/fields`, a foto), as públicas e a integração; `setting.manage` passa. O `/auth/me` traz `missingFields`.
- **Busca e lista:** `/users` ganhou `incomplete`, `incompleteTotal` e os filtros `incomplete` e `options`; `/ideas/people` procura nos campos pesquisáveis não sensíveis e devolve `fields`.
- **Relatórios:** `snapshotAuthorFields` roda em `IdeasService.submit`; o filtro `options` vale para os três relatórios, o resumo ganhou `byField`, e a exportação, uma coluna por campo fechado.
- **Integração:** `custom_fields` no módulo Usuários (marcados e não sensíveis).
- **Privacidade:** a auditoria registra quais campos mudaram, nunca os valores; anonimizar apaga os valores.
- **Testes:** `test/user-fields/` (36).

## Aprovação de outras áreas (M24 · 1.5.0)

A equipe pede o aval de outra área antes de aprovar ou implementar uma ideia (RN-183 a RN-192, D31). Módulo `src/approvals/`.

- **Dados (migração `Approvals`):** `approval_request` (cópia do código, do título, do resumo e do ganho; um pedido aberto por ideia, por índice único parcial), `approval_recipient` (só o SHA-256 do link e do código), `approval_request_attachment` e `approval_evidence`.
- **Regras puras** em `approval-rules.ts` (limites, esquemas Zod, `holdState`, `outcomeOf`, `linkState`); a decisão única fica em `approval-core.ts` (`applyDecision`), usada pelo link, pelo ITS e pelo registro manual.
- **No ciclo da ideia:** `assertNotHeld` em aprovar e implementar (409 `approval_pending` ou `approval_not_obtained`); não autorizar, interromper ou arquivar fecha o pedido aberto; um anexo num pedido aberto não sai (`attachment_in_approval`).
- **Rotas:**
  - Equipe: `GET`/`POST /ideas/{ref}/approvals`, `.../{id}/cancel`, `.../{id}/override`, `.../recipients/{id}/record` (multipart, campo `files`) e a evidência. O `GET` devolve `form` (prazo padrão, domínios, se o e-mail sai) só para a equipe.
  - Aprovador com usuário: `GET /approvals/pending`, `POST /approvals/recipients/{id}/decide` e os anexos.
  - Sem login: `POST /approvals/link/{view,code,decide,attachment}`, com o link no corpo (nunca na URL), 30 tentativas por minuto por IP, `noindex` e `no-store`.
- **Worker:** `runApprovalJobs` de hora em hora (idempotente): vence os pedidos e manda os lembretes; o lembrete de quem é de fora leva um link novo.
- **Avisos e e-mail:** 5 tipos no sino (`approval_requested` obrigatório) e os modelos `approval_request`, `approval_code` e `approval_reminder` (corpo cifrado na fila).
- **Integração:** webhooks `approval.requested` e `approval.decided` pelo histórico da ideia; `pending_approval` em `/integration/v1/ideas`.
- **Visibilidade:** a decisão de cada aprovador e o "seguir sem a aprovação" vão para o histórico como internos; o resultado, como público.
- **Testes:** `test/approvals/` (43).

## Avisos na tela e tela de login (M23 · 1.4.0)

Avisos de cada ação, a tela de login da organização e o tema antes de entrar (RN-174 a RN-182, D30).

- **Avisos na tela:** são do frontend (`frontend/src/lib/toast.ts`, `app/mutation-feedback.ts`). O backend só precisa devolver os erros no formato `{ code, message }` de sempre. A sessão expirada (401 `unauthenticated`) não vira aviso.
- **Configuração:** um objeto só na chave `branding.login` (`organization/login-screen-rules.ts`: layouts, lados, fundos, limites, `changedFields`, `requiredMedia` e `textPlacement`). Fica fora das configurações editáveis em bloco: o `PATCH /settings` não a grava.
- **Contraste do texto:** `textPlacement` confere 4,5:1 no pior caso (foto toda branca ou toda preta). A camada preta precisa de 55%; abaixo disso, o texto vai para a superfície do formulário.
- **Arquivos do fundo:** a tabela `login_media` (migração `LoginScreen`, com CHECK dos tipos) guarda imagem, capa e vídeo, um de cada. A imagem e a capa passam pelo `sharp`: PNG, JPEG ou WebP pelo conteúdo, até 10 MB, viram WebP sem metadados com até 2560 px. O vídeo é MP4 ou WebM pelo conteúdo (`sniffViewable`), até 20 MB.
- **Rotas (`login-screen.controller.ts`):**
  - Com `setting.manage`: `GET`/`PUT /branding/login`, `POST /branding/login/preview` (calcula sem gravar), `POST /branding/login/reset`, `PUT`/`DELETE /branding/login/media/{kind}`.
  - Público: `GET /branding/login/media/{kind}`, com cache, `nosniff` e `Range` (206/416). A configuração pública ganhou `login`, com as cores resolvidas e o lugar e o tom do texto.
- **Recusas:** `login_media_missing`, `login_video_needs_poster` e `login_media_in_use` (422); 413 e 415 nos arquivos.
- **Auditoria:** `branding.login_changed`, com os campos e sem os valores, mais `branding.login_media_changed`, `branding.login_media_removed` e `branding.login_reset`.
- **nginx:** `location /api/branding/login/media/` com `client_max_body_size 24m`; o resto continua com 12 MB.
- **Contrato:** os DTOs repetidos viraram `MuralCommentRequest` e `StoreReasonRequest`; `test/docs/dto-names.spec.ts` impede nome repetido no mesmo documento.
- **Testes:** `test/organization/login-screen-rules.spec.ts` e `login-screen.spec.ts`.
