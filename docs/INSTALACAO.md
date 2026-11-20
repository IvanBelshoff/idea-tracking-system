# Instale o ITS em 10 minutos

Este guia leva uma pessoa que nunca viu o projeto de um computador com Docker até o sistema funcionando, com backup e atualização. Os comandos são para Linux, macOS ou Windows com o Docker Desktop (use o Git Bash ou o WSL no Windows).

O ITS vem em **imagens prontas**, publicadas a cada versão no GitHub (`ghcr.io/ivanbelshoff`) e no Docker Hub (`ivanbelshoff`): não é preciso baixar o código nem montar nada.

## O que você precisa

- **Docker** com o Compose v2 (`docker compose version` deve responder).
- Um terminal e acesso à internet para baixar as imagens.
- Uns 2 GB de memória livre e 2 GB de disco para começar.

## 1. Baixar e configurar (2 minutos)

São só dois arquivos, numa pasta própria:

```bash
mkdir its && cd its
curl -fsSLO https://raw.githubusercontent.com/IvanBelshoff/idea-tracking-system/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/IvanBelshoff/idea-tracking-system/main/.env.example -o .env
```

(Ou clone o repositório, `git clone https://github.com/IvanBelshoff/idea-tracking-system.git its`, e rode `cp .env.example .env` dentro dele.)

Abra o arquivo `.env` e preencha **as duas obrigatórias**, que vêm vazias de propósito:

| Variável | O que colocar |
|---|---|
| `POSTGRES_PASSWORD` | Uma senha forte para o banco (só o sistema a usa). Gere com `openssl rand -base64 24`. |
| `APP_SECRET_KEY` | Uma chave aleatória longa. Gere com `openssl rand -base64 32` (ou use um gerador de senhas com 32+ caracteres). |

Confira também o `TZ` (o seu fuso, por exemplo `America/Sao_Paulo`). O resto já vem com um padrão seguro.

> **Sem as duas, o sistema não sobe.** O Compose para com uma mensagem como `required variable POSTGRES_PASSWORD is missing a value: Defina POSTGRES_PASSWORD no .env`. Não existe senha padrão para trocar depois.
>
> **Guarde o `.env` junto com o backup.** A `POSTGRES_PASSWORD` é a do banco criado na primeira vez, e a `APP_SECRET_KEY` cifra a senha do servidor de e-mail, os segredos do login corporativo e o corpo dos e-mails guardados. Se você perder ou trocar a chave, o sistema continua funcionando, mas esses segredos precisam ser cadastrados de novo.
>
> **Nunca versione o `.env`.**

## 2. Subir (3 minutos)

```bash
docker compose up -d
```

Na primeira vez, o Docker baixa as imagens (`its-api`, `its-web`, `its-ajuda` e o `postgres`), o que leva alguns minutos conforme a internet. Quando terminar, confira:

```bash
docker compose ps
```

`db`, `api`, `web` e `docs` devem aparecer como `healthy` e o `worker` como `Up`.

> **Versão e origem das imagens:** `ITS_VERSION=1` (padrão) segue a versão 1 inteira, recebendo correções e melhorias sem mudanças que quebram; para fixar uma versão exata, use por exemplo `ITS_VERSION=1.0.0`. As imagens vêm do GitHub; para usar o Docker Hub, defina `ITS_REGISTRY=docker.io/ivanbelshoff`. As duas origens têm as mesmas imagens, para `amd64` e `arm64`.

## 3. Instalar pelo assistente (2 minutos)

Abra **http://127.0.0.1:8080**. Como o sistema ainda não foi instalado, aparece o **assistente de instalação**: informe o nome da organização, o fuso, o idioma e crie a **conta de administrador** (seu e-mail e uma senha). Não existe usuário nem senha padrão. O assistente aparece **uma única vez**.

Depois de instalar, o administrador entra e configura, nesta ordem:

1. **Entidades** (a estrutura da organização: unidades e setores) e **Categorias** (dá para importar um conjunto pronto).
2. **Perfis e usuários**: crie as pessoas e dê a cada uma o perfil e a entidade onde atua. Ao criar um usuário, o sistema mostra **um link para a pessoa definir a senha**; entregue o link a ela.
3. **Configurações**: prefixo do código das ideias, regras de prazo, anexos e senhas.

Pronto: as pessoas já enviam e acompanham ideias.

## Para quem vai expor na rede

Por padrão, só a própria máquina acessa o sistema (`127.0.0.1`). Para que outras pessoas acessem:

- Ponha o ITS atrás de um **proxy com HTTPS** (Caddy, Traefik ou Nginx) apontando para a porta `8080` e, no `.env`, mantenha `WEB_BIND=127.0.0.1` quando o proxy roda na mesma máquina. Use `WEB_BIND=0.0.0.0` só se o proxy estiver em outra máquina e a rede for confiável.
- O banco de dados **nunca** é publicado: ele mora numa rede interna do Docker, da qual só a API e o worker participam (o `web` não a enxerga, e o banco não tem saída). Só o `web` abre uma porta. Não use o arquivo `docker-compose.dev.yml` em instalações reais: ele publica o banco em `127.0.0.1:5433` apenas para os testes de desenvolvimento.
- Com HTTPS, o cookie de sessão sai com o atributo `Secure` automaticamente.
- **App no celular:** com HTTPS, o navegador oferece "Instalar app" (ou "Adicionar à tela inicial"), e o ITS abre como aplicativo, com atalho para "Enviar ideia". Sem HTTPS, o sistema funciona normalmente no navegador, mas não pode ser instalado. Quando sai uma versão nova, quem está com o app aberto vê "Há uma versão nova do ITS" e escolhe a hora de atualizar.

## Opcionais

### E-mail (resumo diário e "esqueci minha senha")

Vem **desligado**. Para ligar, entre como administrador em **Administração > E-mail**:

1. Em **Configurações > Notificações e e-mail**, informe o **endereço do sistema** (por exemplo `https://ideias.suaempresa.com`), usado nos links.
2. Em **E-mail > Envio**, cadastre o servidor SMTP da sua organização e clique em **Enviar teste**.
3. Com o teste bem-sucedido, clique em **Ligar envio**.

A senha do servidor fica cifrada e nunca é mostrada de volta. Falhas de envio aparecem em **E-mail > Envios**, com o motivo e o botão "Tentar de novo".

**Microsoft 365 em vez de SMTP:** em **E-mail > Envio**, escolha o tipo **Microsoft 365** e informe o tenant, o ID do cliente, o segredo e a caixa remetente (e a data de validade do segredo, para a saúde avisar antes de vencer). O passo a passo do aplicativo no Entra e do RBAC no Exchange está na ajuda: *Envio de e-mail pela Microsoft*. O servidor da API e o worker precisam de saída HTTPS para `login.microsoftonline.com` e `graph.microsoft.com`; atrás de proxy, valem as mesmas variáveis do login corporativo.

**Google Workspace em vez de SMTP:** em **E-mail > Envio**, escolha o tipo **Google Workspace** e cole a chave JSON da conta de serviço (criada no Google Cloud e autorizada no Admin Console com o escopo `gmail.send`); informe a caixa remetente (um usuário do Workspace). Como a delegação do Google vale para o domínio todo, use um projeto e uma conta de serviço só do ITS. O passo a passo está na ajuda: *Envio de e-mail pelo Google*. O servidor da API e o worker precisam de saída HTTPS para `oauth2.googleapis.com` e `gmail.googleapis.com`; atrás de proxy, valem as mesmas variáveis do login corporativo.

### Login corporativo (Microsoft e Google)

Vem **desligado**: o ITS entra só com e-mail e senha. Para entrar com a conta da empresa, o administrador usa **Administração > Acesso corporativo** (permissão `sso.manage`, de fábrica só o Administrador).

Antes de começar, confira:

- **Endereço do sistema** em **Configurações > Notificações e e-mail**, com **HTTPS** (a Microsoft e o Google só aceitam `http` em `localhost`). O endereço de retorno que você registra no provedor é esse endereço mais `/api/auth/sso/microsoft/callback` (ou `/google/callback`); a tela mostra o endereço exato para copiar.
- **`APP_SECRET_KEY`** no `.env`: o segredo do cliente fica cifrado com ela. Se você trocar a chave, cadastre o segredo de novo.
- **Rede:** o servidor da API precisa de saída HTTPS para `login.microsoftonline.com` (Microsoft) e `accounts.google.com` e `www.googleapis.com` (Google). Atrás de um proxy corporativo, defina no `.env` `NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY` e `NO_PROXY` (o Node da imagem precisa ser o 24 ou mais novo). Nada além disso sai da instalação.

Passo a passo na tela: cadastre os **domínios** da empresa, preencha o **cliente, o segredo e (na Microsoft) o tenant** do aplicativo que o TI registrou, clique em **Testar entrando** (você entra com a sua conta e o teste vincula o seu usuário), ligue o provedor e escolha o modo: **Senha + SSO** (a senha continua valendo) ou **Só SSO**. No modo **Só SSO**, os administradores mantêm a senha como acesso de emergência. A criação automática de conta no primeiro login é opcional e vem desligada. O registro do aplicativo no Microsoft Entra e no Google Cloud está na ajuda: *Login corporativo*.

**Foto do perfil do provedor (opcional, desligada):** com **Oferecer a foto do perfil** ligada, o ITS busca a foto da pessoa no login (Microsoft pelo Graph, que exige a permissão delegada **User.Read** no aplicativo; Google pelo endereço da foto do próprio login). A API passa a precisar de saída HTTPS para `graph.microsoft.com` e `*.googleusercontent.com`. A foto só aparece se a pessoa escolher em Minha conta.

### Integrações (API de leitura)

Vem **desligada**. Para outros sistemas (Power Automate, n8n, BI, ERP) lerem dados do ITS, o administrador usa **Administração > Integrações** (permissão `integration.manage`, de fábrica só o Administrador): liga a **chave geral**, liga os **módulos**, cria uma **integração** com escopo de entidades e recebe um **token** (mostrado uma única vez, com validade de até 365 dias).

Antes de começar, confira:

- **Endereço do sistema** em **Configurações > Notificações e e-mail**, com **HTTPS** (ou `localhost`): o ITS só liga a API assim, para o token não trafegar aberto.
- **Caminho `/integration/`:** a API fica em `/integration/v1`, fora de `/api`. O contêiner `web` do ITS já a repassa para a API. Se houver **outro proxy na frente** (Caddy, Traefik, balanceador), repasse também `/integration/`, mantendo os cabeçalhos `Authorization`, `Host` e `X-Forwarded-For`. Para impedir o uso na rede, basta não liberar esse caminho.
- **Rede de saída:** nada muda para esta API: ela só **recebe** chamadas e não liga para ninguém. A única saída nova são os **webhooks** (seção abaixo), desligados de fábrica.
- **Leitura só com `GET`:** qualquer outro método responde `405`, exceto as quatro rotas de escrita (seção *Escrita pela API*, abaixo). Não há CORS: o sistema que consulta chama de um servidor, nunca do navegador de alguém.

O vencimento do token entra na saúde (item **Token de integração**) e gera alerta a 7 dias; o consumo por integração aparece na tela. O passo a passo para o administrador e para quem constrói a integração está na ajuda: *Integrações: configurar* e *API de integração: como consumir*.

### Escrita pela API

Vem **desligada**: são dois módulos próprios (`ideas_write`, `gains_write`) que o administrador liga em **Administração > Integrações > Módulos** (marcados "grava") e dá à integração. Quatro ações pequenas, pelos mesmos serviços das telas: enviar ideia (`POST /integration/v1/ideas`), comentar (`.../comments`), atualizar a referência externa (`PUT .../external-ref`) e registrar ganho **declarado** (`PUT .../gain`). **A integração nunca decide:** não existe rota para triar, aprovar, validar ganho, arquivar ou excluir.

- **Autoria:** a ideia é enviada em nome da pessoa do `author_email` (ativa e com permissão de enviar naquela entidade); o comentário sai em nome da integração. A origem "via Integração X" aparece na ideia, no comentário e no histórico.
- **Idempotência:** todo `POST` exige `Idempotency-Key`; a mesma chave com o mesmo corpo por 24 horas devolve a mesma resposta sem gravar de novo (tabela `integration_idempotency`, limpa pelo worker junto com a observabilidade).
- **Limite:** 30 chamadas de escrita por minuto por integração, além do limite geral.
- **Auditoria:** cada gravação vai ao log (`integration.idea_submitted` etc.), sem o texto do comentário nem o corpo; a leitura continua fora.
- **Rede:** nada muda (a API só recebe chamadas). Se houver outro proxy na frente, ele precisa repassar `POST` e `PUT` em `/integration/` e o cabeçalho `Idempotency-Key`.
- **Cuidado ao testar:** a ideia enviada é uma ideia de verdade na fila; teste numa entidade de teste.

O passo a passo está na ajuda: *Integrações: configurar* (administrador) e *Escrita pela API* (TI).

### Webhooks (avisos de saída)

Vêm **desligados**. É o **único** recurso em que o ITS chama algo fora dele, então tem chave própria e só chama endereços que o administrador permitiu. Em **Administração > Integrações > Webhooks** (permissão `integration.manage`): liga a **chave dos webhooks** (exige a chave geral da API de integração), cadastra os **destinos permitidos** (nomes, `*.dominio`, IPs e faixas, até 50), cria uma **assinatura** por integração (endereço e eventos) e recebe o **segredo** (`whsec_...`, mostrado uma única vez, com validade de até 365 dias).

Antes de começar, confira:

- **Quem envia:** o **worker** faz as entregas (a cada 5 segundos) e a **API** faz o envio de teste. Os dois precisam alcançar o endereço do receptor. Libere no firewall de saída só o endereço e a porta dele.
- **Sem proxy:** o envio é **direto**. Ele não usa `HTTPS_PROXY` nem `NO_PROXY` (um proxy desviaria a conexão do endereço que o ITS conferiu). Onde a saída só passa por proxy, os avisos só chegam a destinos que o servidor alcança direto, como os da rede interna.
- **Destino interno:** funciona só se estiver na lista de destinos permitidos, e `http://` só vale para rede interna. `localhost`, endereços de link local (inclui `169.254.169.254`), `0.0.0.0` e multicast ficam **sempre bloqueados**.
- **Receptor:** precisa responder `2xx` em até 10 segundos e conferir a assinatura (`X-ITS-Signature`). O que falhar é repetido por cerca de 46 horas; 20 falhas definitivas seguidas suspendem a assinatura.
- **Banco:** os avisos e as entregas ficam em `webhook_event` e `webhook_delivery`, com a mesma retenção da observabilidade (`ops.retention_days`).

O segredo e as entregas entram na saúde (itens **Segredo dos webhooks** e **Entrega dos webhooks**) e geram alerta. O passo a passo está na ajuda: *Webhooks: configurar* (administrador) e *Webhooks: como receber* (TI).

### Identidade visual (cor, logo e fonte)

O administrador ajusta em **Administração > Identidade visual**:

- **Cor da marca:** escolha uma cor; o tema escuro é calculado a partir dela. Se a cor deixar botões ou links difíceis de ler, o sistema ajusta o tom e avisa. As amostras mostram o resultado antes de salvar. "Voltar ao padrão do ITS" desfaz.
- **Logo da organização:** PNG ou WebP de até 2 MB, de preferência com fundo transparente. Um segundo logo para o tema escuro é opcional; sem ele, o logo aparece sobre uma placa clara. O logo fica **ao lado** do símbolo do ITS, no menu e na tela de entrada. O ícone da aba do navegador e o do app instalado continuam sendo o símbolo do ITS, na cor da marca. No Android e no computador, quem já instalou o app recebe o ícone novo sozinho; no iPhone, é preciso remover o app e adicioná-lo de novo à tela de início. Ao enviar, a tela sugere a cor predominante do logo como cor da marca.
- **Fonte:** Geist (padrão), Inter, Atkinson Hyperlegible Next ou IBM Plex Sans, para a interface inteira.

As fontes vêm junto com o sistema; nada é baixado de serviços externos.

### Ajuda (documentação)

A ajuda do ITS sobe junto, no serviço `docs`, e abre em **http://127.0.0.1:8080/ajuda/**, no mesmo endereço do sistema. Ela não tem porta própria e não precisa de configuração.

- **Conteúdo:** explica cada parte do sistema, com simuladores para praticar sem mexer em nada de verdade, em português e em inglês.
- **Acesso pelo ITS:** pela página "Informações" do menu do usuário, pelo link "Precisa de ajuda?" da tela de entrada e pelo "?" ao lado do título das telas.
- **Fora do ar:** se o serviço `docs` parar, `/ajuda/` mostra um aviso, e o ITS continua funcionando normalmente.
- **Outro endereço:** para hospedar a ajuda em outro lugar, mude **Configurações > Organização > Endereço da ajuda**, informando um caminho como `/ajuda/` ou um endereço `https://`.

### Consulta pública

Vem **desligada**. O administrador liga em **Configurações > Consulta pública e foto do perfil**. Mesmo ligada, cada **autor decide**, ideia por ideia, se compartilha o link de acompanhamento. A página pública mostra só título, categoria, situação, etapas e prazo: nunca nomes, comentários, anexos ou dados pessoais.

### Conhecer o sistema com dados de exemplo

Numa instalação **nova e de teste** (antes de rodar o assistente), você pode criar uma demonstração com pessoas e ideias fictícias. O script fica no repositório e precisa do Node 24 (clone o repositório para usá-lo):

```bash
DEMO_PASSWORD='escolha-uma-senha-forte' node scripts/seed-demo.mjs http://127.0.0.1:8080
```

O script cria seis contas `@example.test` com a senha que você escolheu e ideias em todas as situações. **Não use numa instalação de verdade.** O envio de e-mail continua desligado.

## Backup (o que guardar)

São **três coisas**; sem qualquer uma delas a restauração fica incompleta:

| O quê | Onde está | Como copiar |
|---|---|---|
| Banco de dados | volume `pgdata` | `pg_dump` (abaixo) |
| Anexos, fotos e logo da organização | volume `storage` | arquivo `.tar` (abaixo) |
| Configuração | arquivo `.env` (com a `APP_SECRET_KEY`) | copie para um lugar seguro, **fora do repositório** |

```bash
mkdir -p backup
STAMP=$(date +%Y%m%d-%H%M)

# Banco (formato próprio do PostgreSQL, compactado)
docker compose exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backup/its-$STAMP.dump

# Anexos e fotos
docker run --rm -v its_storage:/dados -v "$PWD/backup":/saida alpine \
  tar czf /saida/its-arquivos-$STAMP.tar.gz -C /dados .
```

> O projeto do Compose se chama `its`, então os volumes são `its_pgdata` e `its_storage` e os contêineres, `its-db-1`, `its-api-1` etc. Confira com `docker volume ls`. Rode os comandos na pasta do `docker-compose.yml`.

Programe estes comandos para rodar todo dia (cron no Linux, Agendador de Tarefas no Windows) e **copie os arquivos para fora da máquina**. Um backup que mora só no mesmo disco não protege de nada.

## Restaurar

Numa máquina com o `docker-compose.yml` e o mesmo `.env` (a mesma `APP_SECRET_KEY`):

```bash
# 1. Suba só o banco
docker compose up -d db

# 2. Restaure o banco (apaga e recria os objetos do dump)
docker compose exec -T db \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backup/its-AAAAMMDD-HHMM.dump

# 3. Restaure anexos e fotos
docker run --rm -v its_storage:/dados -v "$PWD/backup":/saida alpine \
  sh -c 'cd /dados && tar xzf /saida/its-arquivos-AAAAMMDD-HHMM.tar.gz'

# 4. Suba o resto
docker compose up -d
```

**Teste a restauração** numa máquina de teste pelo menos uma vez. Backup que nunca foi restaurado é uma aposta.

## Atualizar para uma versão nova

O ITS usa **versionamento semântico** (`MAIOR.MENOR.CORREÇÃO`), com **uma só versão** para o backend, o frontend e a Ajuda (a atual é a **1.0.0**; veja o [CHANGELOG](../CHANGELOG.md)). **Correção** conserta sem mudar nada que você configurou; **menor** traz função nova sem quebrar; **maior** pode exigir um passo seu, sempre descrito no CHANGELOG. A versão instalada aparece em **Informações** e na saúde da instalação.

```bash
# 1. Faça o backup (acima) ANTES de qualquer atualização
# 2. Baixe as imagens novas (da versão que ITS_VERSION indica) e suba
docker compose pull
docker compose up -d
```

Com `ITS_VERSION=1`, isso traz a última versão 1.x. Para ir a uma **versão maior** (por exemplo, a 2), leia o CHANGELOG, faça o que ele pedir, mude `ITS_VERSION` no `.env` e rode os mesmos dois comandos. Se uma versão nova trouxer mudança no `docker-compose.yml`, o CHANGELOG avisa: baixe o arquivo de novo (seção 1) antes do `pull`.

As **migrações do banco rodam sozinhas** quando a API sobe (com trava, então várias instâncias não se atropelam), e o worker só começa depois que a API está saudável. Acompanhe com:

```bash
docker compose logs -f api
```

Procure a linha `Migrações aplicadas: ...` ou `Esquema em dia`. Se algo der errado, restaure o backup feito no passo 1 e volte à versão anterior fixando-a no `.env` (por exemplo `ITS_VERSION=1.2.0`), com `docker compose up -d`.

## Se algo não funcionar

| Sintoma | O que verificar |
|---|---|
| O Compose para com `required variable ... is missing a value` | Falta preencher `POSTGRES_PASSWORD` ou `APP_SECRET_KEY` no `.env` (seção 1). |
| `docker compose up` não baixa as imagens (`denied`, `not found`, tempo esgotado) | Confira a internet e o proxy do Docker. Se o GitHub estiver bloqueado na sua rede, use o Docker Hub: `ITS_REGISTRY=docker.io/ivanbelshoff` no `.env`. Uma versão fixada que não existe também dá `not found`. |
| A página não abre | `docker compose ps`: `web` e `api` estão `healthy`? `logs api` mostra algum erro? |
| A API não sobe | A `POSTGRES_PASSWORD` do `.env` é a mesma de quando o banco foi criado? (O banco guarda a senha da primeira vez.) |
| "Falha ao guardar segredo" no e-mail | Falta `APP_SECRET_KEY` no `.env` (16 caracteres ou mais). Defina e suba de novo. |
| Datas e horários errados | Confira o fuso em **Configurações** e o `TZ` do `.env`. |
| E-mail não sai | **E-mail > Envios**: o motivo do erro aparece ali. Confira o endereço do sistema e o teste de envio. Na tela **Observabilidade**, veja os itens **Fila de e-mail** e **Worker**. |
| Não sei se o sistema está saudável | **Administração > Observabilidade** (permissão `ops.view`, de fábrica só o Administrador): saúde por itens, tráfego, histórico e alertas. Fora do navegador, `GET /api/health` devolve `200` com o banco no ar e `503` com ele fora. |
| O item **Worker** está em atenção ou falha | `docker compose restart worker` e `logs worker`. O worker não aparece como `healthy`, só como `Up`: quem diz que está vivo é o sinal que ele grava a cada minuto. |
| "Entrar com Microsoft/Google" volta com erro | O erro vem na URL (`sso_erro`) e a tela explica: endereço de retorno diferente do registrado no provedor, tenant ou domínio errado, e-mail ainda não cadastrado ou conta desativada. Em **Administração > Auditoria**, procure `auth.sso_login_failed` (o motivo está nos dados). Confira também a saída de rede para o provedor. |
| O provedor saiu do ar ou foi mal configurado e ninguém entra (modo Só SSO) | Os administradores continuam entrando com e-mail e senha. Entre, mude o modo para **Só senha** em **Acesso corporativo** e corrija a configuração. |
| E-mail pela Microsoft recusado (`invalid_client`, `403`, `404`) | `invalid_client`: o segredo cadastrado é o **ID do segredo** em vez do **Valor**, ou venceu. `403`: o aplicativo não tem o RBAC do Exchange para essa caixa. `404`: caixa inexistente. Veja o motivo em **E-mail > Envios** e a ajuda *Envio de e-mail pela Microsoft*. |
| Esqueceu a senha de administrador | Se o e-mail estiver ligado, use "Esqueci minha senha". Se não, outro administrador gera um link em **Usuários**. |

**Observabilidade (RN-92 a RN-94):** a contagem de tráfego pode ser desligada com `METRICS_ENABLED=false` no `.env` (a saúde e os alertas continuam), e os dias de histórico guardados ficam em **Configurações > Operação** (padrão 30, até 90). Os alertas de falha chegam ao sino e, com o e-mail ligado, por e-mail; **se o banco cair, não há como avisar**, então monitore o `/api/health`. Detalhes na ajuda: *Operação e alertas*.

Os logs ficam em português: `docker compose logs api worker`.
