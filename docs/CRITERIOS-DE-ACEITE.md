# Critérios de aceite – novo sistema de melhoria contínua

> Base: [REGRAS-DE-NEGOCIO.md](REGRAS-DE-NEGOCIO.md) v1.0. Cada regra (RN) tem um ou mais critérios **testáveis**. O identificador do critério é `CA-<RN>.<n>` e deve aparecer no nome do teste automatizado correspondente (ex.: `it('CA-RN-05.1 ...')`), para rastrear regra → teste.

## Como ler

- Formato: **Dado** (estado inicial) · **Quando** (ação) · **Então** (resultado verificável).
- **Nível** do teste: **U** = unitário (regra pura, sem banco) · **I** = integração/API (banco real de teste) · **E** = ponta a ponta (navegador).
- Regras só de apresentação ou configuração têm critério mínimo; as de segurança e de estado exigem sempre pelo menos um teste **negativo** (o que deve ser recusado).
- **Fase** segue o faseamento da D14: F1 núcleo, F2 resultado e foco, F3 reconhecimento.
- Convenção: "usuário X" é fictício; "ideia" vale para todo o caminho, inclusive depois de aprovada.

### Dados de teste padrão (fixture)

| Item | Valor |
|---|---|
| Entidades | `Org` > `Unidade A` > `Setor A1`; `Org` > `Unidade B` |
| Usuários | `colab1` (Colaborador em A1), `colab2` (Colaborador em A1), `colab3` (Colaborador em B), `analista` (Analista em Unidade A, com sub-entidades), `gestor` (Gestor em Unidade A), `validador` (`ganho.validar`), `admin` |
| Categorias | Segurança, Qualidade |
| Configuração | Consulta pública ligada; e-mail desligado; SLA de triagem 10 dias; gamificação ligada |

---

## 1. Acesso e permissões (§3) · F1

**RN-01 – Permissão e escopo em toda rota**
- **CA-RN-01.1 (I)** Dado `colab1` · Quando chama qualquer rota de gestão (`PATCH /ideias/{id}/status`, `POST /usuarios`) · Então recebe **403**.
- **CA-RN-01.2 (I)** Dado `analista` da Unidade A · Quando consulta uma ideia da Unidade B · Então recebe **404** (não revela existência).
- **CA-RN-01.3 (I)** Dado `analista` com escopo "Unidade A, incluir sub-entidades" · Quando lista ideias · Então vê as de A e A1 e **não** as de B.
- **CA-RN-01.4 (I)** Dado `colab3` autor de uma ideia em B · Quando seu escopo é reduzido · Então ainda vê a **própria** ideia, e só ela.
- **CA-RN-01.5 (I)** Dado um usuário com perfil Analista em A e Colaborador em B · Quando tenta triar uma ideia de B · Então recebe 403; em A, consegue.
- **CA-RN-01.6 (E)** Dado `colab1` · Quando abre a URL de uma tela administrativa digitando o endereço · Então é redirecionado ou vê "sem permissão", e a API também nega (CA-RN-01.1).
- **CA-RN-01.7 (I)** Dado um perfil editado pelo admin sem `ideia.triar` · Quando um usuário com esse perfil tenta triar · Então 403.

## 2. Ciclo de vida (§4) · F1

**RN-02 – Qualquer colaborador envia; autor automático**
- **CA-RN-02.1 (I)** Dado `colab1` · Quando envia ideia válida · Então status **Enviada**, autor = `colab1`, identificador gerado.
- **CA-RN-02.2 (I)** Dado `colab1` · Quando envia informando `autor = colab2` no corpo · Então o campo é ignorado e o autor continua `colab1`.
- **CA-RN-02.3 (I)** Dado usuário desativado · Quando tenta enviar · Então 401/403.

**RN-03 – Campos obrigatórios**
- **CA-RN-03.1 (I)** Quando envia sem título, ou sem descrição, ou sem entidade · Então 422 com o campo faltante indicado.
- **CA-RN-03.2 (I)** Dado categoria configurada como obrigatória · Quando envia sem categoria · Então 422; com a configuração desligada, aceita.
- **CA-RN-03.3 (I)** Quando envia em entidade fora do seu escopo · Então 422/403.

**RN-04 – Cadastro em nome de outra pessoa**
- **CA-RN-04.1 (I)** Dado `analista` · Quando cadastra em nome de `colab2` · Então autor = `colab2`, `cadastrado_por` = `analista`, ambos no histórico.
- **CA-RN-04.2 (I)** Dado `colab1` · Quando tenta cadastrar em nome de `colab2` · Então 403.
- **CA-RN-04.3 (I)** Dado `analista` · Quando cadastra e escolhe "já aprovar" · Então a ideia nasce **Em andamento** com a primeira etapa e responsável (atalho da D3), com os dois eventos no histórico.

**RN-05 – Justificativa obrigatória ao recusar**
- **CA-RN-05.1 (I)** Dado ideia Enviada · Quando analista recusa sem justificativa (vazia ou só espaços) · Então 422 e o status não muda.
- **CA-RN-05.2 (I)** Quando recusa com justificativa · Então status **Não autorizada**, justificativa salva e notificação ao autor contendo o texto.

**RN-06 – Aprovar cria primeira etapa com responsável**
- **CA-RN-06.1 (I)** Dado ideia Em análise · Quando aprova sem responsável · Então 422.
- **CA-RN-06.2 (I)** Quando aprova com responsável · Então status Em andamento e existe exatamente **1 etapa** (posição 1) com o responsável.
- **CA-RN-06.3 (I)** Dado ideia Enviada (sem triagem assumida) · Quando analista aprova · Então é permitido apenas se a regra de atalho estiver ativa; o histórico registra as duas transições.

**RN-07 – Implementar exige etapas concluídas e resultado**
- **CA-RN-07.1 (U)** Dado ideia sem etapas · Quando tenta implementar · Então recusa.
- **CA-RN-07.2 (U)** Dado 3 etapas, 2 concluídas · Quando tenta implementar · Então recusa.
- **CA-RN-07.3 (I)** Dado todas concluídas e resultado informado · Quando implementa · Então status Implementada, data de implementação preenchida.
- **CA-RN-07.4 (I)** Dado todas concluídas e **sem** resultado · Quando implementa · Então 422 (resultado em texto é obrigatório).

**RN-08 – Somente leitura após encerrar**
- **CA-RN-08.1 (I)** Dado ideia Implementada ou Não autorizada · Quando alguém (inclusive admin) tenta editar campos, criar ou editar etapa, ou anexar · Então 409.
- **CA-RN-08.2 (I)** Nessas ideias, **comentar** continua permitido (decisão: só comentários públicos/internos; não altera o conteúdo da ideia).

**RN-09 – Reabrir**
- **CA-RN-09.1 (I)** Dado ideia Implementada · Quando `analista` tenta reabrir · Então 403.
- **CA-RN-09.2 (I)** Quando `admin` reabre **sem motivo** · Então 422.
- **CA-RN-09.3 (I)** Quando `admin` reabre com motivo · Então status volta (Implementada → Em andamento; Não autorizada → Em análise), motivo no histórico, autor notificado.
- **CA-RN-09.4 (I)** Dado ideia Em andamento · Quando admin tenta "reabrir" · Então 409 (só encerradas).

**RN-10 – Status só por ações do fluxo**
- **CA-RN-10.1 (I)** Quando qualquer usuário envia `PATCH` com o campo `status` diretamente · Então o campo é rejeitado (422 ou ignorado) e o status não muda.
- **CA-RN-10.2 (U)** Matriz de transições: para cada par (origem, destino) do diagrama da §4 há teste de **permitido**; para cada par não listado (ex.: Enviada → Implementada, Implementada → Enviada) há teste de **recusado**.

**RN-11 – Arquivamento lógico**
- **CA-RN-11.1 (I)** Quando analista exclui uma ideia · Então ela some das listas, mas o registro e o histórico permanecem (`arquivada_em` preenchido).
- **CA-RN-11.2 (I)** Quando se pede exclusão física sem ser admin · Então 403; com admin, a exclusão é feita e registrada no log de auditoria.
- **CA-RN-11.3 (I)** Uma ideia arquivada não aparece na consulta pública nem em indicadores.

## 3. Etapas (§5) · F1

**RN-12 – Sequencial**
- **CA-RN-12.1 (I)** Dado última etapa aberta · Quando cria nova etapa · Então 409.
- **CA-RN-12.2 (I)** Dado última etapa concluída · Quando cria nova · Então cria com posição +1.

**RN-13 – Concluída é imutável; só a última aberta edita**
- **CA-RN-13.1 (I)** Etapa concluída: editar ou excluir → 409.
- **CA-RN-13.2 (I)** Etapa aberta que **não** é a última (caso exista por reversão): editar → 409.
- **CA-RN-13.3 (I)** Última etapa aberta: editar e excluir → permitido (excluir só se for a única aberta e houver outra concluída, ou conforme RN-14, sem lacuna).

**RN-14 – Posição explícita, sem lacunas**
- **CA-RN-14.1 (U)** Criar 3 etapas e excluir a última → posições 1 e 2, sem lacuna.
- **CA-RN-14.2 (I)** Duas requisições simultâneas de criar etapa → só uma é aceita (a outra 409), sem posição repetida.

**RN-15 – Campos da etapa**
- **CA-RN-15.1 (I)** Criar etapa sem nome, responsável ou data prevista → 422.
- **CA-RN-15.2 (I)** Responsável precisa ser usuário ativo com acesso à entidade da ideia.

**RN-16 – Datas coerentes**
- **CA-RN-16.1 (U)** `prevista < início` → recusa; `prevista == início` → aceita.

**RN-17 – Prazo = previsão da última etapa**
- **CA-RN-17.1 (U)** Com etapas previstas em 10/03 e 20/03, o prazo da ideia é 20/03.
- **CA-RN-17.2 (I)** Ao criar uma etapa com previsão posterior, o prazo muda e o histórico registra "prazo alterado de X para Y".

**RN-18 – Atraso só para Em andamento com etapa aberta**
- **CA-RN-18.1 (U)** Em andamento, última etapa aberta, previsão ontem → atrasada.
- **CA-RN-18.2 (U)** Implementada ou Não autorizada com previsão vencida → **não** atrasada.
- **CA-RN-18.3 (U)** Em andamento com todas as etapas concluídas → não atrasada.
- **CA-RN-18.4 (U)** Previsão **hoje** → ainda não atrasada (atrasa no dia seguinte), considerando o fuso da instalação.

**RN-19 – Cálculo de progresso configurável**
- **CA-RN-19.1 (U)** Modo "etapas": 2 concluídas de 4 → 50%.
- **CA-RN-19.2 (U)** Modo "tempo": início 01/03, prazo 11/03, hoje 06/03 → 50%; nunca passa de 100% nem fica abaixo de 0%.
- **CA-RN-19.3 (U)** Ideia sem etapas → 0% (sem divisão por zero).

**RN-20 – Aviso ao concluir a última etapa**
- **CA-RN-20.1 (I)** Ao concluir a última etapa, o analista responsável recebe notificação com as duas ações (nova etapa ou implementar) e a ideia **continua Em andamento**.

**RN-21 – Anexos configuráveis**
- **CA-RN-21.1 (I)** Tipo fora da lista configurada → 415; acima do tamanho máximo → 413.
- **CA-RN-21.2 (I)** Alterar o limite na configuração passa a valer na requisição seguinte.
- **CA-RN-21.3 (I)** Remover anexo: permitido em etapa aberta por quem tem `etapa.gerenciar`; em etapa concluída → 409; sem permissão → 403.
- **CA-RN-21.4 (I)** Download de anexo respeita escopo (RN-01) e **nunca** é público.
- **CA-RN-21.5 (I)** O nome do arquivo é normalizado no armazenamento (sem `../`, sem execução de conteúdo).

## 4. Identificação, categorias e entidades (§6) · F1

**RN-22 – Identificador sequencial**
- **CA-RN-22.1 (I)** Duas ideias seguidas em 2026 → `ITS-2026-0001` e `ITS-2026-0002`.
- **CA-RN-22.2 (I)** 50 criações simultâneas → 50 identificadores distintos, sem lacunas nem repetição.
- **CA-RN-22.3 (I)** Virada de ano reinicia a sequência; o identificador é imutável (tentativa de alterar → ignorada/422).
- **CA-RN-22.4 (I)** Alterar o prefixo na configuração só afeta as novas ideias.

**RN-23 – Referência externa**
- **CA-RN-23.1 (I)** Campo opcional, texto livre até 100 caracteres; permite busca por ele; não precisa ser único.

**RN-24 – Categorias**
- **CA-RN-24.1 (I)** Admin cria, edita e inativa categoria; não-admin → 403.
- **CA-RN-24.2 (I)** Importar o conjunto *Segurança + QDCEP* cria 6 categorias; importar duas vezes não duplica.
- **CA-RN-24.3 (I)** Uma categoria principal obrigatória quando configurado; categorias secundárias opcionais (tags).

**RN-25 – Entidades em árvore**
- **CA-RN-25.1 (U)** Mover uma entidade para dentro de um descendente dela → recusa (ciclo).
- **CA-RN-25.2 (I)** Toda ideia tem entidade; filtrar por entidade pai inclui as descendentes.

**RN-26 – Inativas**
- **CA-RN-26.1 (I)** Enviar para categoria ou entidade inativa → 422.
- **CA-RN-26.2 (I)** Ideias antigas dessa categoria continuam listáveis e filtráveis.

## 5. Comunicação (§7) · F1

**RN-27 – Notificações do autor**
- **CA-RN-27.1 (I)** Para cada evento (recebimento, início da triagem, aprovação, recusa, etapa concluída, conclusão, reabertura) existe exatamente **1** notificação ao autor.
- **CA-RN-27.2 (I)** O autor não é notificado de eventos da ideia de outra pessoa.

**RN-28 – Comentários públicos e internos**
- **CA-RN-28.1 (I)** Comentário interno de `analista` → `colab1` (autor) **não** o vê, nem via API.
- **CA-RN-28.2 (I)** Comentário público → autor e equipe veem; o autor também pode comentar.
- **CA-RN-28.3 (I)** `colab1` não consegue marcar o próprio comentário como interno nem ler os de outras ideias.

**RN-29 – Alertas de prazo**
- **CA-RN-29.1 (U)** Alerta padrão = 3 dias: etapa com previsão em 3 dias gera alerta; em 4 dias, não.
- **CA-RN-29.2 (I)** Alerta ao responsável **e** ao analista; um único alerta por etapa por dia (idempotente em reexecução do job).
- **CA-RN-29.3 (I)** Etapa concluída ou ideia encerrada não gera alerta.
- **CA-RN-29.4 (I)** Preferência do usuário para menos dias é respeitada.

**RN-30 – Canais e preferências**
- **CA-RN-30.1 (I)** Sempre existe notificação interna.
- **CA-RN-30.2 (I)** Com e-mail desligado na instalação, nenhum envio é tentado (verificável por servidor SMTP falso sem conexões).
- **CA-RN-30.3 (I)** Usuário que desliga um evento deixa de receber esse evento, **exceto** decisões sobre a própria ideia.

**RN-31 – Resumo diário**
- **CA-RN-31.1 (I)** Três eventos no mesmo dia viram **1** e-mail no horário configurado, no fuso configurado.
- **CA-RN-31.2 (I)** Sem eventos no dia, nenhum e-mail.

**RN-32 – Modelos**
- **CA-RN-32.1 (I)** Admin edita o modelo; o próximo envio usa o novo texto; variável inexistente é recusada na gravação; fallback para pt-BR se o idioma do usuário não tiver modelo.

**RN-90 – Provedor de e-mail configurável (§16)**
- **CA-RN-90.1 (I)** Em instalação nova o envio de e-mail está desligado; ativar sem teste bem-sucedido → recusa.
- **CA-RN-90.2 (I)** "Enviar e-mail de teste" com SMTP falso: sucesso habilita a ativação; falha mostra o motivo sem expor a senha.
- **CA-RN-90.3 (I)** A senha é gravada cifrada (o valor no banco difere do enviado) e nenhuma rota a devolve; a tela mostra apenas "definida".
- **CA-RN-90.4 (I)** Falha de envio → nova tentativa com espera crescente até o limite; depois fica `failed` com o último erro visível ao admin; não bloqueia a requisição do usuário.
- **CA-RN-90.5 (I)** Só quem tem `config.email` cadastra ou altera o provedor; as credenciais não aparecem em logs nem no log de auditoria (CA-RN-39.2).

**RN-92 – Métricas operacionais locais (§16.1) · M12**
- **CA-RN-92.1 (I)** Uma requisição a `/api/ideas/<uuid>?x=1` conta na rota `GET /api/ideas/:id`; nenhuma métrica gravada nem resposta de `/api/ops/*` contém o uuid nem `x=1`.
- **CA-RN-92.2 (I)** Rota inexistente conta como `(sem rota)`; `/api/health` e `/api/ops/*` não são contados.
- **CA-RN-92.3 (I)** Duas gravações na mesma hora e processo somam contadores e faixas de tempo; os percentis lidos do histórico coincidem com o cálculo direto sobre as faixas somadas; a memória guarda o maior valor.
- **CA-RN-92.4 (I)** Sem `ops.view` → 403 em todas as rotas `/api/ops/*`; o perfil de fábrica Administrador tem a permissão.
- **CA-RN-92.5 (I)** O worker apaga as horas mais antigas que `ops.retention_days`; repetir a limpeza não altera mais nada. Período do histórico acima de 31 dias, invertido ou inválido → 422.
- **CA-RN-92.6 (I)** Com `METRICS_ENABLED=false`, nada é contado nem gravado, mas `/api/ops/health` responde e informa que a medição está desligada.
- **CA-RN-92.7 (I)** Falhas de login (401), bloqueios por tentativas e respostas 429 são contados à parte.
- **CA-RN-92.8 (I)** O worker grava por hora os disparos, a duração (em faixas de tempo), as falhas e os e-mails enviados, repetidos e falhos; duas gravações na mesma hora somam sem perder nada, e o que não puder ser gravado volta para a memória.
- **CA-RN-92.9 (I)** O bloco de uso conta contas e sessões ativas e as entradas, falhas e bloqueios das últimas 24 horas, mais o tamanho do banco e das tabelas que só crescem, sem identificar ninguém; cada número que falhar vira vazio sem derrubar os outros.

**RN-93 – Saúde por itens (§16.1) · M12**
- **CA-RN-93.1 (U)** O estado geral é o pior dos itens (`failed` > `warning` > `ok`); sem itens, `ok`.
- **CA-RN-93.2 (U)** Cada item muda de estado exatamente nos limites da RN-93 (banco 200 ms; disco 10% e 3%; fila 10 e 30 min; worker e API 3 e 10 min; atraso do ciclo de eventos 200 ms; e-mail com 5 tentativas e metade de falhas; segredos a 30 e 7 dias, M14).
- **CA-RN-93.3 (I)** `/api/health` responde 200 `{ status: 'ok', db: 'ok' }`, sem nenhum outro dado, inclusive antes da instalação.
- **CA-RN-93.4 (I)** Com o banco inacessível, `/api/health` responde 503 com `db: 'down'`.
- **CA-RN-93.5 (I)** Um item que dá erro na coleta vira `failed` e não derruba a resposta de `/api/ops/health`.
- **CA-RN-93.6 (I)** Batimento do worker com mais de 10 minutos → `worker` em falha; e-mail pendente há 40 minutos → `email_queue` em falha.
- **CA-RN-93.7 (I)** Provedor de e-mail desligado → item de e-mail `ok`, com o resumo "desligado".

**RN-94 – Alerta de saúde (§16.1) · M12**
- **CA-RN-94.1 (U)** Item que entra em `failed` avisa; `warning` não avisa.
- **CA-RN-94.2 (U)** "Voltou" só depois de 2 conferências seguidas sem falha; uma falha no meio zera a contagem.
- **CA-RN-94.3 (U)** O mesmo item não avisa falha duas vezes em menos de 30 minutos; a volta dessa falha silenciada também não avisa.
- **CA-RN-94.4 (U)** Sem estado anterior (primeira conferência), item em falha avisa e item em ordem não diz nada.
- **CA-RN-94.5 (I)** A falha gera aviso interno para cada usuário ativo com `ops.view` e para mais ninguém; o tipo `ops_alert` não pode ser desligado nas preferências.
- **CA-RN-94.6 (I)** Com o provedor de e-mail ativo, o e-mail sai na hora (SMTP falso), fora do resumo diário; com o provedor desligado, só o aviso interno.
- **CA-RN-94.7 (I)** Repetir a conferência com o mesmo estado, inclusive em duas execuções simultâneas, não duplica avisos (CA-T.1).
- **CA-RN-94.8 (I)** O estado persiste: com um serviço novo (reinício do worker), a falha em curso não é avisada de novo.

**RN-95 – Política de domínio e e-mail de fora (§16.2) · M13**
- **CA-RN-95.1 (U)** Normalização: domínios em minúsculas, sem `@`, sem repetição e com formato válido; `Empresa.COM` e `empresa.com` são o mesmo domínio.
- **CA-RN-95.2 (I)** Com domínios cadastrados e e-mail de fora desligado, cadastrar usuário com e-mail de outro domínio → 422 `email_domain_not_allowed`; dentro do domínio funciona.
- **CA-RN-95.3 (I)** Trocar o e-mail de um usuário para fora dos domínios segue a mesma regra; a troca dentro do domínio funciona.
- **CA-RN-95.4 (I)** Com a lista vazia não há restrição, qualquer e-mail é aceito (instalação sem configuração não muda).
- **CA-RN-95.5 (I)** Com e-mail de fora ligado, qualquer domínio é aceito no cadastro e na troca.
- **CA-RN-95.6 (I)** Usuário que já está fora da política continua entrando por senha e aparece na lista de "fora da política" da tela de acesso.
- **CA-RN-95.7 (I)** Sem a permissão `sso.manage` → 403 ao ler ou alterar a política; com a permissão, a alteração é auditada (`access.policy_updated`, sem dado pessoal).
- **CA-RN-95.8 (I)** O Administrador de fábrica recebe `sso.manage`; nenhum outro perfil de fábrica recebe.

**RN-96 – Login corporativo (§16.2) · M13**
- **CA-RN-96.1 (I)** Primeiro login com Microsoft de quem já existe pelo e-mail: entra, o vínculo é criado e auditado (`auth.sso_identity_linked`) e a sessão é a mesma do login por senha (cookie, permissões, `me`).
- **CA-RN-96.2 (I)** Segundo login: o usuário é achado pelo identificador do provedor, mesmo que o e-mail do usuário tenha mudado no ITS; o e-mail do provedor igual ao de outra pessoa não troca de conta.
- **CA-RN-96.3 (I)** E-mail de usuário que já tem vínculo com outro identificador no mesmo provedor → recusa `sso_identity_conflict`, auditada.
- **CA-RN-96.4 (I)** Microsoft de outro tenant (`tid` diferente) → recusa; emissor, público (`aud`), expiração e `nonce` errados → recusa.
- **CA-RN-96.5 (I)** `state` ausente, repetido ou diferente do cookie, ou PKCE inválido → recusa sem criar sessão.
- **CA-RN-96.6 (I)** Google com e-mail não verificado, sem `hd` ou de domínio fora da lista → recusa.
- **CA-RN-96.7 (I)** E-mail fora dos domínios (RN-95) não entra por SSO, mesmo cadastrado; o SSO sem nenhum domínio cadastrado não pode ser ligado.
- **CA-RN-96.8 (I)** Usuário desativado ou anonimizado → recusa, sem sessão e auditada (`auth.sso_login_failed`, com o motivo).
- **CA-RN-96.9 (I)** Usuário sem cadastro e criação automática desligada → recusa com `sso_user_not_found`, e a tela orienta procurar o administrador.
- **CA-RN-96.10 (I)** O bloqueio por senha errada não impede o SSO e o SSO não zera nem soma tentativas de senha.
- **CA-RN-96.11 (I)** Anonimizar o usuário apaga os vínculos; o administrador consegue desvincular, e a ação é auditada (`auth.sso_unlinked`).
- **CA-RN-96.13 (I)** A sessão aberta pelo login corporativo dura `auth.sso_session_hours` (padrão 8 horas) e a da senha continua com `auth.session_hours` (12 horas); o cookie de sessão leva o mesmo prazo.
- **CA-RN-96.12 (I)** Início e retorno têm limite por IP (429); o destino `voltar` só aceita caminho interno; erros voltam a `/entrar?sso_erro=<código>` sem detalhe técnico.

**RN-97 – Modos de login e acesso de emergência (§16.2) · M13**
- **CA-RN-97.1 (U)** `canUsePassword`: modo diferente de Só SSO → sim; Só SSO → não, exceto quem tem `setting.manage` ou e-mail de fora dos domínios.
- **CA-RN-97.2 (I)** Modo Só senha ou Senha + SSO: o login por senha funciona como antes (CA-RN-42.*).
- **CA-RN-97.3 (I)** Modo Só SSO: senha certa de quem não pode usar senha → 403 `sso_required`; senha errada continua `invalid_credentials` (não revela se o e-mail existe).
- **CA-RN-97.4 (I)** Modo Só SSO: o administrador de emergência e o usuário de e-mail de fora continuam entrando por senha.
- **CA-RN-97.5 (I)** Modo Só SSO: pedido e resgate de link de senha não valem para quem não pode usar senha; o cadastro não devolve link de senha para essas pessoas.
- **CA-RN-97.6 (I)** Não se liga o SSO sem: endereço do sistema, chave do servidor, provedor completo, domínio e teste de conexão aprovado (cada falta tem seu erro).
- **CA-RN-97.7 (I)** O teste de conexão exige administrador logado, confere tenant e domínio, vincula a identidade dele e registra resultado e data; qualquer mudança de cliente, segredo ou tenant desliga o provedor e zera o teste.
- **CA-RN-97.8 (I)** Modo Só SSO só liga com o administrador que o liga vinculado, e não se desliga o último provedor ligado enquanto o modo for Só SSO.
- **CA-RN-97.9 (I)** O segredo do cliente fica cifrado no banco e nunca aparece em resposta, log ou auditoria; a resposta traz só `clientSecretSet`.
- **CA-RN-97.10 (I)** `/api/settings/public` expõe só o modo e os provedores ligados, nunca cliente, tenant ou segredo; o padrão de fábrica é Só senha, sem provedor.

**RN-98 – Criação automática de conta (§16.2) · M13**
- **CA-RN-98.1 (I)** Interruptor desligado: usuário sem cadastro não entra e nada é criado.
- **CA-RN-98.2 (I)** Interruptor ligado: quem passa nas regras da RN-96 e não existe ganha conta ativa, sem senha, com o nome do provedor, o idioma padrão da instalação e um único escopo (perfil e entidade iniciais); a criação é auditada (`auth.sso_user_provisioned`).
- **CA-RN-98.3 (I)** Não cria conta para e-mail de fora dos domínios, e-mail não verificado ou tenant errado.
- **CA-RN-98.4 (I)** Não existe conta duplicada: com o e-mail já cadastrado vincula (RN-96), e dois logins simultâneos do mesmo e-mail criam uma conta só.
- **CA-RN-98.5 (U)** `canProvision`: perfil com qualquer permissão administrativa, ou o Administrador de fábrica, nunca pode ser perfil inicial.
- **CA-RN-98.6 (I)** Salvar perfil administrativo como inicial → 422; perfil que se torna administrativo depois é recusado na criação (`sso_provisioning_unavailable`).
- **CA-RN-98.7 (I)** Perfil ou entidade iniciais removidos ou inativos → login recusado e o erro aparece na tela de acesso; nenhuma conta parcial fica criada.
- **CA-RN-98.8 (I)** Nome do provedor vazio ou longo demais vira o e-mail antes do `@`, limitado a 200 caracteres, e é tratado como texto (CA-T.4).
- **CA-RN-98.9 (I)** A conta criada tem as permissões do perfil inicial no escopo da entidade inicial e nada além.

**RN-99 – Envio de e-mail pela Microsoft (§16.3) · M14**
- **CA-RN-99.1 (I)** O provedor pode ser salvo como Microsoft 365 com tenant (GUID ou domínio), ID do cliente, segredo e caixa remetente; dado inválido → 400; um corpo sem `type` continua valendo como SMTP.
- **CA-RN-99.2 (I)** O segredo é gravado cifrado (o valor no banco difere do enviado) e nenhuma rota, log ou auditoria o devolve; a resposta traz só "segredo definido".
- **CA-RN-99.3 (I)** "Enviar e-mail de teste" com o Graph falso: o token é pedido com as credenciais, o `sendMail` vai para a caixa certa, sem guardar na caixa de enviados; o sucesso habilita a ativação; a falha mostra o motivo sem o segredo.
- **CA-RN-99.4 (I)** Ativar sem teste bem-sucedido → recusa; qualquer mudança no provedor, inclusive trocar o tipo, desliga o envio e zera o teste.
- **CA-RN-99.5 (I)** Com o tipo Microsoft, a entrega pela fila usa o Graph e o e-mail fica `sent`.
- **CA-RN-99.6 (I)** `401` do Graph → o token é renovado e há uma nova tentativa; o token fica em cache e é reaproveitado entre envios.
- **CA-RN-99.7 (I)** Erro permanente (credencial recusada, `403`, `404`) → o e-mail fica `failed` na hora, sem repetir, com o código do erro visível ao administrador.
- **CA-RN-99.8 (I)** `429` e `5xx` → repete com espera crescente até o limite, como no SMTP (CA-RN-90.4).
- **CA-RN-99.9 (U)** A mensagem de erro do adaptador leva só o código do erro: nunca o segredo, o corpo da resposta nem o destinatário.
- **CA-RN-99.10 (I)** Só `https` (e `http` em 127.0.0.1 apenas com `NODE_ENV=test`); os endereços da Microsoft não são configuráveis em produção.
- **CA-RN-99.11 (I)** Só quem tem `email.manage` cadastra ou altera o provedor; sem a permissão → 403 (CA-RN-90.5).
- **CA-RN-99.12 (I)** O SMTP continua igual: os critérios CA-RN-90.* seguem passando.

**RN-100 – Validade dos segredos (§16.3) · M14**
- **CA-RN-100.1 (U)** Os dias restantes são contados no fuso da instalação (virada de dia testada); uma data ilegível vale como "sem data".
- **CA-RN-100.2 (U)** Estados nos limites: sem data → atenção; 31 dias → ok; 30 e 8 dias → atenção; 7 dias e 0 dias → falha; vencido → falha.
- **CA-RN-100.3 (I)** `email_secret` só vale com o envio ligado e do tipo Microsoft (ou Google com data informada, CA-RN-101.9); SMTP ou envio desligado → `ok`, "não se aplica".
- **CA-RN-100.4 (I)** `sso_secret` considera só os provedores de login ligados e mostra o pior deles.
- **CA-RN-100.5 (I)** Trocar o segredo sem informar a data apaga a data antiga (e-mail e login); informando, grava a nova.
- **CA-RN-100.6 (I)** Segredo a 7 dias ou vencido dispara o alerta da RN-94: aviso no sino para quem tem `ops.view`; a volta só é avisada depois de duas conferências com o segredo trocado.
- **CA-RN-100.7 (I)** A data de validade aparece na tela do administrador e vai à auditoria como dado comum (não é segredo).

**RN-101 – Envio de e-mail pelo Google Workspace (§16.3) · M15**
- **CA-RN-101.1 (I)** O provedor pode ser salvo como Google Workspace com a chave JSON da conta de serviço e a caixa remetente; dado inválido → 400; sem a chave na primeira vez → 422 `service_account_required`.
- **CA-RN-101.2 (I/U)** O JSON só vale se for `type: service_account` com e-mail e chave RSA legíveis; senão → 422 `invalid_service_account`, sem repetir o conteúdo. A chave é gravada cifrada e nenhuma rota, log ou auditoria a devolve; a resposta traz só o e-mail da conta de serviço e se há chave gravada.
- **CA-RN-101.3 (I/U)** "Enviar e-mail de teste" com o Google falso: o JWT é assinado (RS256) com a chave, em nome da caixa, com o escopo único `gmail.send`; a mensagem leva nome do remetente, "responder para" e assunto com acento; credencial recusada mostra só o código, sem a chave.
- **CA-RN-101.4 (I)** Ativar sem teste bem-sucedido → recusa; qualquer mudança no provedor, inclusive trocar o tipo, desliga o envio e zera o teste.
- **CA-RN-101.5 (I)** Com o tipo Google, a entrega pela fila usa a Gmail API e o e-mail fica `sent`.
- **CA-RN-101.6 (I/U)** `401` → o token é renovado e há uma nova tentativa; o token fica em cache e é reaproveitado entre envios.
- **CA-RN-101.7 (I/U)** Erro permanente (`invalid_grant`, `unauthorized_client`, `invalid_client`, `403` de permissão, `404`, `400`) → o e-mail fica `failed` na hora, sem repetir, com o código do erro e sem dado do Google.
- **CA-RN-101.8 (I/U)** `429`, `5xx`, rede e `403` de limite de cota → repete com espera crescente até o limite, como no SMTP (CA-RN-90.4).
- **CA-RN-101.9 (I)** `email_secret` com o Google só vale com a validade informada: sem data → "não se aplica"; com data seguem os limites da RN-100.
- **CA-RN-101.10 (U)** Só `https` nos endereços do Google (`http` em 127.0.0.1 apenas com `NODE_ENV=test`); não são configuráveis em produção.
- **CA-RN-101.11 (I)** Só quem tem `email.manage` cadastra ou altera o provedor; sem a permissão → 403 (CA-RN-90.5).
- **CA-RN-101.12 (I)** Trocar o tipo desliga o envio e exige colar a chave de novo; o SMTP e a Microsoft continuam iguais (CA-RN-90.* e CA-RN-99.* seguem passando).

**RN-102 – Chave geral e módulos (§16.4) · M16**
- **CA-RN-102.1 (I)** Instalação nova: com a chave desligada, `/integration/v1/ideas` e `/integration/v1/openapi.json` respondem 404, mesmo com um token que seria válido (a API não revela que existe).
- **CA-RN-102.2 (I)** Ligar a chave sem `email.app_url`, ou com `http` fora de `localhost`, → 422 `integration_requires_https`; com `https` (ou `localhost`) liga.
- **CA-RN-102.3 (I)** Os seis módulos nascem desligados; módulo desligado → 404 nas suas rotas para uma integração que o teria, e os módulos ligados seguem funcionando.
- **CA-RN-102.4 (I)** Desligar um módulo corta todas as integrações na hora (a chamada seguinte já é 404, sem esperar cache); religar volta ao normal sem recriar nada.
- **CA-RN-102.5 (I)** O OpenAPI da integração só traz as rotas dos módulos ligados.
- **CA-RN-102.6 (I)** Só quem tem `integration.manage` altera a chave, os módulos, as integrações e os tokens; sem a permissão → 403 em toda rota de `admin/integrations`. De fábrica só o Administrador a tem.
- **CA-RN-102.7 (U)** Nome de módulo desconhecido na lista de módulos → 422; a lista é gravada sem repetição.

**RN-103 – Integração, identidade de serviço (§16.4) · M16**
- **CA-RN-103.1 (I)** Criar integração com nome, responsável, módulos, escopo, limite e IPs; nome repetido (sem diferenciar maiúsculas) → 409; módulo que não está ligado → 422.
- **CA-RN-103.2 (I)** Integração **sem escopo** com token válido recebe lista vazia em todos os módulos de dados, nunca "tudo" (negativo).
- **CA-RN-103.3 (I)** Escopo na entidade A **sem** subentidades: não vê dado de uma subentidade de A nem de B; **com** subentidades vê a subárvore de A e continua sem ver B.
- **CA-RN-103.4 (I)** Rota de módulo que a integração não tem, mas que está ligado, → 403 `module_not_allowed`; rota de módulo desligado → 404 (CA-RN-102.3).
- **CA-RN-103.5 (I)** Suspensa → 401 igual aos demais (CA-RN-104.7) e volta a funcionar ao reativar; revogada → 401 e reativar é recusado (409).
- **CA-RN-103.6 (I)** A integração não é usuário: não aparece na lista de usuários, não tem perfil e o login com ela não existe.
- **CA-RN-103.7 (U)** O acesso da integração é calculado sem a exceção do autor: dado fora do escopo nunca aparece, qualquer que seja o autor.
- **CA-RN-103.8 (I)** Lista de IPs: origem fora da lista → 401 igual aos demais; IP exato ou dentro da faixa passa; lista vazia aceita qualquer origem; mais de 20 entradas ou formato inválido → 422. Vale o IP real repassado pelo nginx.
- **CA-RN-103.9 (I)** Entidade inativa (RN-26) no escopo continua valendo e as ideias antigas dela seguem visíveis.

**RN-104 – Token (§16.4) · M16**
- **CA-RN-104.1 (U)** O token tem o formato `its_` mais 43 caracteres base64url (32 bytes aleatórios); mil tokens gerados não se repetem.
- **CA-RN-104.2 (I)** O banco guarda só o hash e o prefixo (`its_` e 4 caracteres); o valor do banco difere do token e não o contém. A resposta de criação traz o valor **uma única vez**; listagem e detalhe depois nunca o trazem.
- **CA-RN-104.3 (I)** A validade é obrigatória: criar sem `expires_at` → 422; no passado ou a mais de 365 dias → 422. A tela sugere 90 dias.
- **CA-RN-104.4 (I)** No instante do vencimento o token passa a dar 401.
- **CA-RN-104.5 (I)** Rotação: o token novo vale na hora e o antigo segue valendo pela janela (padrão 24 h, máximo 72 h, nunca além da validade dele), depois dá 401; pedir um terceiro token ativo → 409 `too_many_tokens`; janela acima de 72 h → 422.
- **CA-RN-104.6 (I)** Revogar um token dá 401 nele na hora e não afeta o outro token da integração.
- **CA-RN-104.7 (I)** Cabeçalho ausente, malformado, token inexistente, vencido ou revogado, integração suspensa ou revogada e IP fora da lista dão **o mesmo 401** (status, corpo e cabeçalhos idênticos, com `WWW-Authenticate: Bearer`) (negativo).
- **CA-RN-104.8 (I)** O token correto enviado em `?token=` ou no corpo é tratado como ausente → 401 (negativo).
- **CA-RN-104.9 (U)** A verificação é pelo hash do token; o prefixo nunca decide o acesso.
- **CA-RN-104.10 (I)** A cada chamada válida a "última chamada" do token é atualizada (no máximo uma gravação por minuto).

**RN-105 – Limites de uso (§16.4) · M16**
- **CA-RN-105.1 (I)** Com o limite padrão (60 por minuto), a 61ª chamada do minuto → 429 com `Retry-After`; no minuto seguinte volta a passar.
- **CA-RN-105.2 (I)** Toda resposta traz `X-RateLimit-Limit` e `X-RateLimit-Remaining` coerentes; limite configurado acima de 600, zero ou negativo → 422.
- **CA-RN-105.3 (I)** O limite é por integração: estourar o de uma não afeta a outra.
- **CA-RN-105.4 (I)** A 21ª tentativa com token inválido do mesmo IP no minuto → 429, sem consultar o banco; chamadas válidas não consomem esse limite (negativo).

**RN-106 – Contrato v1 (§16.4) · M16**
- **CA-RN-106.1 (I)** `POST`, `PUT`, `PATCH` e `DELETE` em qualquer rota → 405 com `Allow: GET`; nada é gravado (negativo).
- **CA-RN-106.2 (I)** Paginação: `limit` padrão 50; acima de 200 ou `cursor` inválido → 422; percorrer todo o cursor devolve cada item uma vez, sem repetir nem pular, mesmo com ideias novas chegando no meio.
- **CA-RN-106.3 (I)** `updated_since` devolve só o que mudou desde a data (inclusive mudança de situação); data inválida → 422.
- **CA-RN-106.4 (I)** As listas vêm no envelope `{ data, next_cursor }`, com `next_cursor` nulo na última página; as datas vêm em ISO 8601 UTC (com `Z`).
- **CA-RN-106.5 (I)** Os erros têm o mesmo formato da API interna.
- **CA-RN-106.6 (I)** Toda resposta, inclusive 401, 404 e 429, leva `Cache-Control: no-store`.
- **CA-RN-106.7 (I)** Não há CORS: `OPTIONS` e requisições com `Origin` não recebem nenhum cabeçalho `Access-Control-*` (negativo).
- **CA-RN-106.8 (I)** `/integration/v1/openapi.json` sem token → 401; com token mostra só os módulos daquela integração.
- **CA-RN-106.9 (I)** O OpenAPI da integração é um documento à parte (`backend/openapi-integration.json`), conferido em dia no teste; o `openapi.json` da API interna não contém nenhum caminho `/integration`.
- **CA-RN-106.10 (U)** Contrato congelado: comparar o OpenAPI atual com o de referência de `v1`; remover ou mudar campo, rota ou tipo existente falha; só acréscimo passa.

**RN-107 – Módulo Ideias (§16.4) · M16**
- **CA-RN-107.1 (I)** A lista traz só as ideias do escopo; o detalhe de ideia fora do escopo → 404, não 403 (negativo, mesmo molde do CA-T.5).
- **CA-RN-107.2 (I)** A resposta traz exatamente os campos da RN-107; uma varredura de chaves não acha comentário (público ou interno), histórico, anexo, responsável da etapa, ganho nem e-mail (negativo).
- **CA-RN-107.3 (I)** As etapas vêm com nome, posição e as datas de início, prevista e de conclusão.
- **CA-RN-107.4 (I)** Ideia convergida (RN-84) vem com o identificador da principal e **sem o texto** de quem a enviou.
- **CA-RN-107.5 (I)** Ideia arquivada (RN-11) segue na lista com `archived: true` e reaparece em `updated_since` no momento do arquivamento; ideia excluída fisicamente não aparece.
- **CA-RN-107.6 (I)** Autor: nome de exibição na ideia comum; **sem autor** na ideia anônima (D5, RN-74) e quando a pessoa ativou o opt-out (RN-70); "Ex-colaborador" quando anonimizado (RN-40) (negativo).
- **CA-RN-107.7 (I)** Filtros por situação, entidade, categoria e campanha funcionam; filtrar por entidade fora do escopo devolve lista vazia, não 403.
- **CA-RN-107.8 (I)** Ideias na situação "Enviada" (ainda sem triagem) aparecem; não existe rascunho de ideia.

**RN-108 – Módulo Indicadores e ganhos (§16.4) · M16**
- **CA-RN-108.1 (I)** Para os mesmos filtros e o mesmo escopo, os indicadores da integração são **iguais** aos do relatório interno de um usuário com `report.view` nesse escopo.
- **CA-RN-108.2 (I)** Ideia convergida não conta em dobro (RN-84).
- **CA-RN-108.3 (I)** A lista de ganhos só traz **validados**; ganho declarado ou estimado nunca sai (negativo).
- **CA-RN-108.4 (I)** Cada ganho traz identificador da ideia, valor realizado, moeda, periodicidade, custo de implementação e data da validação; não traz quem validou nem o autor.
- **CA-RN-108.5 (I)** Ganho de ideia fora do escopo não aparece na lista nem entra nos totais (negativo).
- **CA-RN-108.6 (I)** Uma varredura de chaves nas respostas do módulo não acha nenhum campo que identifique pessoa.

**RN-109 – Módulo Campanhas (§16.4) · M16**
- **CA-RN-109.1 (I)** Campanha ativa e encerrada aparecem; rascunho nunca (negativo).
- **CA-RN-109.2 (I)** Campanha cujas entidades-alvo não tocam o escopo não aparece; campanha sem entidade-alvo aparece a qualquer integração com o módulo.
- **CA-RN-109.3 (I)** As ideias vinculadas e os totais do painel (RN-52) levam só o que está no escopo.
- **CA-RN-109.4 (I)** A recompensa informativa (RN-71) não sai.

**RN-110 – Módulo Hall e reconhecimento (§16.4) · M16**
- **CA-RN-110.1 (I)** Destaques vigentes e do Hall da fama aparecem; destaque revogado e destaque de ideia fora do escopo não (negativo).
- **CA-RN-110.2 (I)** O valor do ganho só vem com "mostrar ganho no Hall" ligado; desligado, o campo nem existe na resposta (RN-75).
- **CA-RN-110.3 (I)** Autores seguem as regras do CA-RN-107.6 (opt-out, anônima, anonimizado).
- **CA-RN-110.4 (I)** Elogio ocultado pela moderação (RN-77) não sai; o autor do elogio nunca sai (negativo).
- **CA-RN-110.5 (I)** Pontos, níveis, conquistas, rankings de pessoas e recompensas não aparecem em nenhuma resposta (negativo).
- **CA-RN-110.6 (I)** As curtidas saem só como número, nunca quem curtiu.

**RN-111 – Módulo Entidades e categorias (§16.4) · M16**
- **CA-RN-111.1 (I)** A árvore traz só as entidades do escopo; o pai que fica fora do escopo vem nulo (negativo).
- **CA-RN-111.2 (I)** As categorias vêm com identificador, nome, cor e se estão ativas, inclusive as inativas.
- **CA-RN-111.3 (I)** Entidade inativa aparece com `active: false`.
- **CA-RN-111.4 (I)** Nenhuma resposta do módulo traz dado pessoal.

**RN-112 – Módulo Usuários (§16.4) · M16**
- **CA-RN-112.1 (I)** Usuário ativo e inativo aparecem; o anonimizado (RN-40) não aparece.
- **CA-RN-112.2 (I)** Só aparece quem tem perfil em entidade do escopo, e os vínculos vêm **cortados ao escopo**: o vínculo em B não aparece para uma integração com escopo só em A, mesmo que a pessoa também esteja em A (negativo).
- **CA-RN-112.3 (I)** Sem "incluir e-mail", a resposta não traz a chave de e-mail (nem nula); e não há como descobrir e-mail por consulta (`?email=` não filtra) (negativo).
- **CA-RN-112.4 (I)** Com "incluir e-mail" marcado, o e-mail vem; marcar e desmarcar vai para a auditoria (CA-RN-114.4).
- **CA-RN-112.5 (I)** Uma varredura de chaves e valores não acha senha, hash, sessão, identificador de login corporativo, foto, último acesso, idioma nem preferência (negativo).

**RN-113 – Saúde, métricas e alerta (§16.4) · M16**
- **CA-RN-113.1 (U)** Limites do item: 31 dias → ok; 30 e 8 → atenção; 7, 0 e vencido → falha, no fuso da instalação (mesma conta do CA-RN-100.2).
- **CA-RN-113.2 (I)** O item só vale com a chave geral ligada e ao menos uma integração ativa; fora disso é `ok`, "não se aplica".
- **CA-RN-113.3 (I)** Por integração conta o token de maior validade (o antigo de uma rotação não pesa); entre integrações, o pior manda.
- **CA-RN-113.4 (I)** Integração suspensa ou revogada não conta.
- **CA-RN-113.5 (I)** Token a 7 dias ou vencido dispara o alerta da RN-94 (aviso no sino para quem tem `ops.view`); a volta só é avisada depois de duas conferências com o token trocado.
- **CA-RN-113.6 (I)** O consumo por hora soma certo por integração e por módulo (chamadas, 4xx, 5xx, 429) depois de chamadas conhecidas; a limpeza do worker apaga o que passou de `ops.retention_days` e repetir a limpeza não muda nada (CA-T.1).
- **CA-RN-113.7 (I)** A "última chamada" da integração aparece na tela e atualiza.
- **CA-RN-113.8 (I)** Falha de autenticação não gera linha de consumo de nenhuma integração; só conta nas métricas gerais (RN-92) (negativo).
- **CA-RN-113.9 (I)** Nenhuma tabela de consumo, log ou resposta de `/api/ops/*` guarda URL crua, parâmetro, IP, identificador de pessoa ou de ideia (estende o CA-T.11).

**RN-114 – Auditoria (§16.4) · M16**
- **CA-RN-114.1 (I)** Chave geral, módulos, integração criada, alterada, suspensa, reativada e revogada, e token criado, girado e revogado geram, cada um, um registro em `audit_log` com o administrador como autor e o identificador e o nome da integração nos dados.
- **CA-RN-114.2 (I)** Nenhum registro contém o token nem o hash; pode conter o prefixo.
- **CA-RN-114.3 (I)** Cem leituras pela API de integração não criam nenhuma linha nova em `audit_log` (negativo).
- **CA-RN-114.4 (I)** Marcar e desmarcar "incluir e-mail" gera registro com o valor novo e o antigo.

**RN-115 – Tela do administrador (§16.4) · M16**
- **CA-RN-115.1 (E)** O item Integrações só aparece no menu para quem tem `integration.manage`; abrir a rota sem a permissão → bloqueio.
- **CA-RN-115.2 (E)** Criar integração mostra o token **uma única vez**, com o aviso de que não volta e botão de copiar; recarregar a tela não o mostra mais.
- **CA-RN-115.3 (E)** Rotação, suspensão, reativação e revogação pedem confirmação, e a revogação diz que é definitiva.
- **CA-RN-115.4 (E)** A chave geral mostra a pré-condição não cumprida (`https`) em texto claro, em vez de só falhar.
- **CA-RN-115.5 (E)** O módulo Usuários e a opção "incluir e-mail" aparecem marcados como sensíveis.
- **CA-RN-115.6 (E)** A tela passa nos CA-T.7 (pt-BR e en completos) e CA-T.8 (axe, claro e escuro).
- **CA-RN-115.7 (I)** `GET /api/admin/integrations/openapi` exige `integration.manage` (sem a permissão → 403) e devolve o contrato só com os módulos **ligados**; com `?integration=` devolve só os módulos daquela integração. Os caminhos e esquemas são os mesmos do `openapi-integration.json`, apenas filtrados.
- **CA-RN-115.8 (E)** A aba Documentação mostra, para cada módulo ligado, as rotas, os parâmetros, os campos de resposta com tipo e descrição, um exemplo de resposta e um `curl`; módulo desligado não aparece, e escolher uma integração mostra só os módulos dela.
- **CA-RN-115.9 (E)** Os exemplos são fictícios e o `curl` usa `SEU_TOKEN`; nenhum token real e nenhum dado real da instalação aparece na aba (negativo; vale também o CA-T.13).
- **CA-RN-115.10 (E)** Usar a aba não gera nenhuma requisição a `/integration` (não há "Experimentar") (negativo).
- **CA-RN-115.11 (U)** Toda rota, parâmetro e campo do contrato tem descrição em inglês e em pt-BR; faltar uma é erro no CI (como o CA-T.7); a aba mostra a do idioma da pessoa.
- **CA-RN-115.12 (E)** "Baixar OpenAPI" entrega o JSON filtrado do mesmo jeito que a aba mostra, sem token e sem dado real.

**RN-116 – Ajuda e documentação (§16.4) · M16**
- **CA-RN-116.1 (CI)** As duas páginas existem em pt-BR e en e passam no `check-content` (paridade, links, capturas, tópicos do ITS).
- **CA-RN-116.2 (CI)** `RN-102` a `RN-116` existem em `regras.ts`, e o teste das regras da Ajuda segue passando com o `regras.json` regenerado.
- **CA-RN-116.3 (E)** O botão "?" da tela de Integrações abre a página do administrador.
- **CA-RN-116.4 (I)** O exemplo de `curl` da página de TI, apontado para a API de teste, devolve 200 e o envelope `{ data, next_cursor }`.

**RN-117 – Chave dos webhooks e destinos permitidos (§16.5) · M17**
- **CA-RN-117.1 (I)** A chave dos webhooks nasce desligada; ligar com a chave geral da integração desligada → 422 `webhooks_require_integration`; com ela ligada, liga.
- **CA-RN-117.2 (I)** Com a chave desligada, uma ideia enviada não gera nenhuma entrega (nenhum evento é guardado) (negativo).
- **CA-RN-117.3 (U)** A lista de destinos aceita nome (`erp.empresa.local`), domínio com curinga (`*.empresa.com.br`), IP e faixa; normaliza em minúsculas, sem repetição; entrada inválida ou mais de 50 → 422. O curinga casa subdomínios, não o domínio puro.
- **CA-RN-117.4 (I)** Assinatura para destino fora da lista → 422 `destination_not_allowed`, inclusive para rede interna (negativo).
- **CA-RN-117.5 (I)** Ao religar, o pendente volta a ser enviado; o que passou de 48 horas vira falha.
- **CA-RN-117.6 (I)** Só quem tem `integration.manage` mexe na chave e na lista; sem a permissão → 403.

**RN-118 – Assinatura de webhook (§16.5) · M17**
- **CA-RN-118.1 (U)** Destino sempre bloqueado, mesmo estando na lista: loopback, link local (`169.254.169.254`), `0.0.0.0`, multicast e os equivalentes em IPv6 (negativo).
- **CA-RN-118.2 (U)** O destino vale se o nome casa com a lista **ou** o IP resolvido está na lista, e o IP resolvido nunca pode ser de classe bloqueada.
- **CA-RN-118.3 (I)** `http://` para destino público → 422 `https_required`; `http://` para IP interno da lista passa; usuário e senha na URL ou esquema que não seja http(s) → 422.
- **CA-RN-118.4 (I)** O nome é resolvido na hora do envio: um nome da lista que passa a resolver para endereço bloqueado faz a entrega falhar com `blocked_destination`, **sem abrir conexão** (negativo, com um resolvedor de teste).
- **CA-RN-118.5 (I)** Resposta `3xx` é falha definitiva (`redirect`) e o redirecionamento não é seguido (o segundo endereço não recebe conexão).
- **CA-RN-118.6 (I)** Sem resposta em 10 segundos → falha `timeout`; resposta maior que 64 KB é cortada e descartada; o aviso enviado nunca passa de 8 KB.
- **CA-RN-118.7 (I)** A 6ª assinatura de uma integração → 422 `too_many_subscriptions`.
- **CA-RN-118.8 (I)** Evento de módulo que a integração não tem → 422 `event_not_allowed`.
- **CA-RN-118.9 (I)** Integração suspensa ou revogada: nenhuma entrega sai (negativo).

**RN-119 – Eventos e conteúdo mínimo (§16.5) · M17**
- **CA-RN-119.1 (U)** O aviso é `{ id, type, created_at, data }`; uma varredura de chaves e valores não acha título, descrição, nome, e-mail nem valor de ganho (negativo).
- **CA-RN-119.2 (I)** `idea.submitted` sai ao enviar uma ideia do escopo; ideia de fora do escopo não gera entrega (negativo).
- **CA-RN-119.3 (I)** Cada transição (assumir a triagem, aprovar, recusar, implementar, reabrir) gera um `idea.status_changed` com o código, `from` e `to`.
- **CA-RN-119.4 (I)** `idea.archived`, `idea.converged` e `idea.deleted` (esse só com código e entidade) saem.
- **CA-RN-119.5 (I)** `gain.validated` só para quem tem o módulo de indicadores; `highlight.*` só com o Hall; `campaign.status_changed` só com campanhas e se a campanha toca o escopo.
- **CA-RN-119.6 (I)** O evento nasce na mesma transação: se a ação falha e desfaz, nenhum evento fica (negativo); se dá certo, sai exatamente um por assinatura interessada.
- **CA-RN-119.7 (I)** O escopo conta no momento do evento: mudar o escopo depois não reenvia nem apaga o que já foi gerado.

**RN-120 – Assinatura criptográfica e segredo (§16.5) · M17**
- **CA-RN-120.1 (U)** A assinatura é o HMAC-SHA256 em hexadecimal de `<timestamp>.<corpo>`; um receptor de referência a confere, e mudar um byte do corpo ou do carimbo a invalida.
- **CA-RN-120.2 (I)** Toda entrega leva `X-ITS-Event`, `X-ITS-Event-Id`, `X-ITS-Timestamp` e `X-ITS-Signature` com `v1=`.
- **CA-RN-120.3 (I)** O segredo (`whsec_` mais 43 caracteres) aparece uma única vez; no banco só existe cifrado (difere do valor e não o contém); listagem e detalhe nunca o devolvem (negativo).
- **CA-RN-120.4 (I)** A validade é obrigatória, no futuro e de até 365 dias (as mesmas recusas do CA-RN-104.3).
- **CA-RN-120.5 (I)** Rotação: na janela a entrega leva duas assinaturas (`v1=novo,v1=antigo`) e as duas conferem; depois, só a nova; um terceiro segredo ativo → 409 `too_many_secrets`; janela acima de 72 horas → 422.
- **CA-RN-120.6 (U)** O receptor de referência recusa carimbo com mais de 5 minutos e carimbo do futuro além da tolerância.

**RN-121 – Entrega, repetição e suspensão (§16.5) · M17**
- **CA-RN-121.1 (I)** Resposta `2xx` entrega com uma tentativa; o registro vira `delivered`.
- **CA-RN-121.2 (U)** O calendário de repetição é 30 s, 2 min, 10 min, 1 h, 3 h, 6 h, 12 h e 24 h; a primeira tentativa e até 8 repetições (cerca de 46 horas); esgotadas, a entrega fica em falha.
- **CA-RN-121.3 (I)** Rede, `5xx`, `408` e `429` repetem; `3xx` e os demais `4xx` são falha definitiva sem repetir (negativo).
- **CA-RN-121.4 (I)** A repetição leva o mesmo `X-ITS-Event-Id` e o mesmo corpo.
- **CA-RN-121.5 (I)** 20 falhas definitivas seguidas suspendem a assinatura (estado suspensa, motivo `failures`); um sucesso zera a contagem; reativar volta a enviar.
- **CA-RN-121.6 (I)** Dois processos não enviam a mesma entrega ao mesmo tempo (CA-T.2).
- **CA-RN-121.7 (I)** A ordem não é garantida (eventos em sequência podem chegar trocados), mas todo aviso traz `created_at`.

**RN-122 – Registro de entregas, reenvio e teste (§16.5) · M17**
- **CA-RN-122.1 (I)** O registro tem tipo, identificador do evento, estado, tentativas, último HTTP e código de erro; uma varredura mostra que o corpo da resposta nunca é guardado (negativo).
- **CA-RN-122.2 (I)** Reenviar uma entrega com falha a volta para pendente e sai igual; reenviar uma já entregue → 409.
- **CA-RN-122.3 (I)** O evento de teste `webhook.ping` passa pela checagem do destino e pela assinatura, devolve o resultado na hora e não precisa de ideia nem de escopo.
- **CA-RN-122.4 (I)** A limpeza apaga o que passou de `ops.retention_days` e repetir não muda nada (CA-T.1).
- **CA-RN-122.5 (I)** Só `integration.manage` vê o registro e reenvia; sem a permissão → 403.

**RN-123 – Saúde e alerta dos webhooks (§16.5) · M17**
- **CA-RN-123.1 (U)** `webhook_secret`: 31 dias ok; 30 e 8 atenção; 7, 0 e vencido falha (mesma conta do CA-RN-100.2).
- **CA-RN-123.2 (U)** `webhook_delivery`: sem problema ok; falha definitiva nas últimas 24 horas atenção; entrega pendente há mais de 15 minutos atenção; assinatura suspensa por falhas falha.
- **CA-RN-123.3 (I)** Os dois itens só valem com a chave dos webhooks ligada e ao menos uma assinatura ativa (a suspensa por falhas conta para a entrega); fora disso são `ok`, "não se aplica".
- **CA-RN-123.4 (I)** A falha dispara o alerta da RN-94 (sino para quem tem `ops.view`); a volta só é avisada depois de duas conferências.

**RN-124 – Auditoria dos webhooks (§16.5) · M17**
- **CA-RN-124.1 (I)** Cada ação listada gera um registro com o administrador como autor e a integração e o nome da assinatura nos dados; a suspensão automática tem o sistema como autor.
- **CA-RN-124.2 (I)** Os registros guardam só o servidor (host) do endereço, nunca o caminho nem a consulta, e nunca o segredo (negativo).
- **CA-RN-124.3 (I)** Cem entregas não criam nenhuma linha em `audit_log` (negativo).

**RN-125 – Tela e Ajuda dos webhooks (§16.5) · M17**
- **CA-RN-125.1 (E)** A aba Webhooks só aparece para quem tem `integration.manage`.
- **CA-RN-125.2 (E)** O segredo aparece uma única vez, na criação e na rotação, com o aviso; recarregar a tela não o mostra mais.
- **CA-RN-125.3 (E)** A aba mostra a chave, os destinos permitidos, as assinaturas e as entregas, com reenvio e teste.
- **CA-RN-125.4 (E)** A aba Documentação lista os eventos e o passo a passo para conferir a assinatura, com exemplo fictício.
- **CA-RN-125.5 (E)** A tela passa nos CA-T.7 e CA-T.8 (claro e escuro).
- **CA-RN-125.6 (CI)** As páginas da Ajuda existem em pt-BR e en e passam no `check-content`; as RN-117 a RN-125 estão em `regras.ts`.
- **CA-RN-125.7 (I)** O exemplo de conferência da assinatura da Ajuda, executado contra um receptor de teste, valida uma entrega real.

**RN-126 – Módulos de escrita (§16.6) · M18**
- **CA-RN-126.1 (I)** `ideas_write` e `gains_write` nascem desligados; o administrador liga; a tela os marca como "grava".
- **CA-RN-126.2 (I)** Rota de escrita com módulo desligado → 404; módulo ligado mas fora da integração → 403 `module_not_allowed`.
- **CA-RN-126.3 (I)** `ideas_write` sem `ideas`: grava, e `GET /ideas` → 403; a resposta da gravação é mínima.
- **CA-RN-126.4 (I)** As rotas de leitura continuam só `GET` (`POST` em `/indicators/summary` → 405); rota de escrita com método errado → 405.
- **CA-RN-126.5 (I)** O `CHECK` de módulos do banco aceita os oito e recusa um desconhecido (CA-T.9).

**RN-127 – Enviar ideia (§16.6) · M18**
- **CA-RN-127.1 (I)** Uma ideia válida → 201 `{ code, status: "submitted", entity_id }`; a ideia entra na fila com o autor indicado, a entidade, a origem e o histórico.
- **CA-RN-127.2 (I)** Sem `Idempotency-Key` → 422 `idempotency_key_required`.
- **CA-RN-127.3 (I)** Entidade fora do escopo → 422 `entity_not_in_scope`; entidade inativa → 422 (negativo).
- **CA-RN-127.4 (I)** Faltando título, descrição ou entidade → 422; a categoria obrigatória segue a configuração (RN-03).
- **CA-RN-127.5 (I)** `author_email` ausente, de pessoa inexistente, desativada ou anonimizada → 422 `author_not_found`; de pessoa sem permissão de enviar na entidade → 422 `author_cannot_submit` (negativo).
- **CA-RN-127.6 (I)** Campanha só se elegível (RN-51): inativa ou de outro alvo → 422.
- **CA-RN-127.7 (I)** A ideia nasce Enviada; campo desconhecido no corpo (como `status`, `author_id`) → 422 (negativo).
- **CA-RN-127.8 (I)** O autor recebe o aviso de recebimento (RN-27) e o histórico mostra "via Integração X".
- **CA-RN-127.9 (I)** Os limites de tamanho são os da tela (título de 200 caracteres etc.).
- **CA-RN-127.10 (I)** A resposta não traz nada além de `code`, `status` e `entity_id`.

**RN-128 – Comentar (§16.6) · M18**
- **CA-RN-128.1 (I)** Um comentário → 201; aparece na ideia como público, com o nome da integração ("via Integração X").
- **CA-RN-128.2 (I)** Ideia fora do escopo → 404; texto vazio ou com mais de 5000 caracteres → 422; campo `visibility` → 422 (negativo).
- **CA-RN-128.3 (I)** Em ideia encerrada, o comentário é aceito.
- **CA-RN-128.4 (I)** O comentário nunca é interno: quem só vê comentários públicos o enxerga, e ele não aparece na lista interna de quem é da equipe (negativo).
- **CA-RN-128.5 (I)** Os avisos são os de qualquer comentário público.

**RN-129 – Atualizar a referência externa (§16.6) · M18**
- **CA-RN-129.1 (I)** A referência é atualizada e o histórico traz o valor antigo, o novo e a origem.
- **CA-RN-129.2 (I)** `null` limpa; mais de 100 caracteres → 422.
- **CA-RN-129.3 (I)** Ideia encerrada → 409 `idea_closed`; ideia fora do escopo → 404 (negativo).
- **CA-RN-129.4 (I)** Mandar a mesma referência de novo devolve 200 sem novo registro no histórico.

**RN-130 – Registrar ganho declarado (§16.6) · M18**
- **CA-RN-130.1 (I)** O estimado só é aceito em Enviada ou Em análise e o realizado só depois de implementada (409 nos outros casos), como na tela.
- **CA-RN-130.2 (I)** Moeda padrão da instalação; periodicidade inválida ou valor negativo → 422.
- **CA-RN-130.3 (I)** Ganho já validado → 409 `gain_validated`; não existe rota para validar (`POST .../gain/validate` → 404 ou 405) (negativo).
- **CA-RN-130.4 (I)** Ideia fora do escopo → 404; a resposta é `{ idea_code, status: "declared" }`.
- **CA-RN-130.5 (I)** O ganho declarado não entra nos indicadores oficiais nem na lista de ganhos da leitura (o CA-RN-108.3 segue passando).

**RN-131 – Idempotência (§16.6) · M18**
- **CA-RN-131.1 (U)** Chave válida: 1 a 64 caracteres entre letras, números, `-` e `_`; senão 422.
- **CA-RN-131.2 (I)** Mesma chave e mesmo corpo → a mesma resposta, com `Idempotent-Replay: true`, e uma única ideia no banco (negativo).
- **CA-RN-131.3 (I)** Mesma chave com corpo diferente → 422 `idempotency_key_reused`.
- **CA-RN-131.4 (I)** Duas chamadas simultâneas com a mesma chave: uma grava e a outra recebe 409 `request_in_progress` ou a mesma resposta; nunca duas ideias (CA-T.2, CA-T.19).
- **CA-RN-131.5 (I)** A chave vale por integração e por rota: outra integração com a mesma chave não colide.
- **CA-RN-131.6 (I)** `5xx` libera a chave; `4xx` de negócio é repetido igual; passadas 24 horas a chave é esquecida, e a limpeza é idempotente (CA-T.1).
- **CA-RN-131.7 (I)** O `PUT` aceita a chave também.

**RN-132 – O que a escrita nunca faz (§16.6) · M18**
- **CA-RN-132.1 (I)** Varredura de todas as rotas do contrato: só existem as quatro ações; tentar triar, aprovar, recusar, interromper, implementar, reabrir, arquivar, excluir, converger, validar ganho ou destacar → 404 ou 405 (negativo).
- **CA-RN-132.2 (I)** Não há rota para mudar situação, autor, entidade ou categoria de uma ideia existente (negativo).
- **CA-RN-132.3 (I)** Uma ideia enviada pela API e outra pela tela, com o mesmo conteúdo, geram o mesmo histórico, os mesmos avisos e o identificador sequencial seguinte (mesmo serviço).
- **CA-RN-132.4 (I)** Toda gravação confere o escopo: o que está fora dele → 404, e o banco não muda (negativo).

**RN-133 – Origem, auditoria e eco (§16.6) · M18**
- **CA-RN-133.1 (I)** Cada ação gera um registro `integration.*` com a integração e o código da ideia; o autor do registro é nulo (quem agiu foi a integração).
- **CA-RN-133.2 (I)** A auditoria não guarda o texto do comentário nem o corpo da chamada (varredura) (negativo).
- **CA-RN-133.3 (I)** A origem aparece no histórico da ideia, no comentário e na tela da ideia, nos dois idiomas.
- **CA-RN-133.4 (I)** O evento causado por uma integração não volta para as assinaturas dela mesma, mas chega às das outras (com os webhooks ligados).
- **CA-RN-133.5 (I)** A leitura continua fora da auditoria (o CA-RN-114.3 segue passando).

**RN-134 – Limites, tela e Ajuda da escrita (§16.6) · M18**
- **CA-RN-134.1 (I)** A 31ª chamada de escrita no minuto → 429 com `Retry-After`, mesmo com o limite geral livre; a leitura não gasta o limite da escrita.
- **CA-RN-134.2 (E)** A tela marca "grava" nos módulos de escrita, e a Documentação mostra as rotas de escrita, exemplos fictícios e o `curl` com `SEU_TOKEN` e `Idempotency-Key`.
- **CA-RN-134.3 (I)** O consumo por hora conta os módulos de escrita (o `CHECK` de `integration_hour` os aceita).
- **CA-RN-134.4 (CI)** A página da Ajuda existe nos dois idiomas e as RN-126 a RN-134 estão em `regras.ts`.
- **CA-RN-134.5 (U)** O `openapi-integration.json` só ganha (o CA-RN-106.10 passa) e tudo o que é novo tem descrição em inglês e pt-BR (o CA-RN-115.11 passa).

**RN-135 – Campos sensíveis ocultos por padrão (§16.7) · M19**
- **CA-RN-135.1 (E)** Em login corporativo, e-mail (os três provedores) e detalhe da assinatura de webhook, os campos listados na RN-135 abrem **mascarados**.
- **CA-RN-135.2 (E)** Clicar no olho revela o valor; clicar de novo oculta; o nome acessível alterna entre "mostrar" e "ocultar" e o botão tem `aria-pressed`.
- **CA-RN-135.3 (E)** Enquanto oculto, o valor **não aparece como texto** em nenhum lugar da página (varredura do texto e dos atributos visíveis) e a máscara não revela o tamanho (negativo).
- **CA-RN-135.4 (E)** O campo volta a ocultar ao trocar de tela, ao salvar e após 60 segundos revelado.
- **CA-RN-135.5 (E)** O campo oculto não é preenchido nem guardado pelo navegador e o botão funciona só com o teclado.
- **CA-RN-135.6 (U)** O componente mascara qualquer valor com a mesma máscara (valor vazio continua vazio) e não guarda o valor revelado depois de oculto.
- **CA-RN-135.7 (E)** As telas passam nos CA-T.7 e CA-T.8 (claro e escuro), com o campo oculto e revelado.
- **CA-RN-135.8 (E)** Na auditoria, o IP de origem e os e-mails dos detalhes abrem mascarados e cada linha se revela sozinha; o texto da página não traz o valor enquanto oculto (negativo).

**RN-136 – Editor de texto formatado (§16.7) · M19**
- **CA-RN-136.1 (E)** Cada campo listado na RN-136 usa o editor; os campos em texto simples (título, referência, justificativas curtas, modelos de e-mail) não.
- **CA-RN-136.2 (I)** A formatação fora da lista (imagem, tabela, script, `style`, evento `on...`, link `javascript:`) é **removida no servidor**, mesmo se enviada direto pela API (negativo).
- **CA-RN-136.3 (I)** O texto puro derivado existe para cada campo e é o que a busca, as ideias semelhantes, o PDF, a exportação e a API de integração usam; achar uma ideia por palavra em negrito funciona.
- **CA-RN-136.4 (I)** Ideia, comentário e etapa criados **antes** do M19 continuam legíveis, sem perder quebra de linha.
- **CA-RN-136.5 (I)** O limite de tamanho vale sobre o texto puro (10 mil, 5 mil...), com a mesma recusa de hoje.
- **CA-RN-136.6 (I)** A API de leitura v1 devolve `description` e `proposed_solution` em texto puro (o `openapi-integration.json` só ganha; CA-RN-106.10) e a de escrita aceita texto puro, que vira parágrafos.
- **CA-RN-136.7 (I)** O comentário interno continua visível só para quem pode (CA-RN-28.1), com a formatação.
- **CA-RN-136.8 (E)** O editor funciona só com o teclado e com leitor de tela (barra de ferramentas com papel e nomes, atalhos, foco previsível) e tem os textos em pt-BR e en.
- **CA-RN-136.9 (E)** O código do editor só é baixado quando um campo formatado é aberto.
- **CA-RN-136.10 (I)** O PDF da ideia mostra o texto formatado como texto (listas com marcadores), sem quebrar.

**RN-137 – Ordenar arrastando (§16.7) · M19**
- **CA-RN-137.1 (E)** Arrastar uma categoria muda a ordem e a lista volta na ordem nova depois de recarregar.
- **CA-RN-137.2 (E)** A mesma mudança se faz sem arrastar (botões e teclado), com aviso por leitor de tela da posição nova.
- **CA-RN-137.3 (I)** A ordem salva é completa e sem lacuna; lista com categoria desconhecida ou faltando → 422 e nada muda (negativo).
- **CA-RN-137.4 (I)** A reordenação vai para a auditoria e exige a permissão de administrar categorias; sem ela → 403 (negativo).
- **CA-RN-137.5 (I)** Duas reordenações simultâneas não deixam a ordem com repetição (CA-T.2).

**RN-138 – Variáveis do modelo de e-mail (§16.7) · M19**
- **CA-RN-138.1 (E)** As variáveis permitidas do modelo aparecem como peças que se arrastam, se inserem por clique e por teclado, na posição do cursor.
- **CA-RN-138.2 (I)** O modelo salvo continua texto puro e a variável fora da lista é recusada como hoje (CA-RN-32.x) (negativo).
- **CA-RN-138.3 (E)** A visualização do modelo troca as variáveis por exemplos fictícios.

**RN-139 – Notificações ao lado da conta (§16.7) · M19**
- **CA-RN-139.1 (E)** O sino fica ao lado do bloco da conta, na barra expandida e na recolhida, e o item "Notificações" some do grupo "Início".
- **CA-RN-139.2 (E)** O contador mostra as não lidas (9+ acima de 9), atualiza como hoje e some em zero.
- **CA-RN-139.3 (E)** O nome acessível traz a contagem e o sino fica marcado na tela de notificações; no celular continua o sino atual.
- **CA-RN-139.4 (E)** A tela passa nos CA-T.7 e CA-T.8.

**RN-140 – Nome do projeto e banco só na rede interna (§16.7) · M19**
- **CA-RN-140.1 (I)** O Compose base declara o projeto `its`; os contêineres e os volumes sobem com esse nome.
- **CA-RN-140.2 (I)** O Compose base **não publica porta** do banco (teste que lê o arquivo) (negativo).
- **CA-RN-140.3 (I)** O `web` não está na rede do banco, e a rede do banco é interna (sem saída); API e worker conseguem usar o banco.
- **CA-RN-140.4 (I)** O arquivo de desenvolvimento publica o banco só em `127.0.0.1` (nunca `0.0.0.0`).
- **CA-RN-140.5 (E)** Numa pilha isolada, o banco **não responde** em nenhuma porta do computador sem o arquivo de desenvolvimento.
- **CA-RN-140.6 (I)** O Compose de instalação usa só imagens publicadas, na versão `ITS_VERSION`, sem montar nada; a API e o worker usam a mesma imagem (teste que lê o arquivo).
- **CA-RN-140.7 (I)** Sem `POSTGRES_PASSWORD` ou `APP_SECRET_KEY`, o Compose para com uma mensagem; nenhuma das duas tem valor padrão e o `.env.example` traz as duas vazias (teste que lê os arquivos e job da CI).
- **CA-RN-140.8 (I)** A sobreposição de build monta API, site e ajuda do código, e não muda portas, redes nem variáveis.

**RN-141 – Mover entidade arrastando (§16.7) · M19**
- **CA-RN-141.1 (E)** Arrastar uma entidade sobre outra abre a confirmação ("Mover X para dentro de Y?"); confirmar move, e a árvore volta com a entidade (e a subárvore) no lugar novo depois de recarregar; cancelar não muda nada.
- **CA-RN-141.2 (E)** A mesma mudança se faz sem arrastar (o seletor Mover e o teclado do arrastar), com aviso por leitor de tela do que está sendo movido e do destino.
- **CA-RN-141.3 (I)** Mover para dentro de si mesma ou de uma descendente → `422 entity_cycle` e a árvore não muda; durante o arraste esses destinos aparecem desabilitados (negativo).
- **CA-RN-141.4 (I)** A raiz não é arrastável; destino sem `entity.manage` → 403 e nada muda (negativo).
- **CA-RN-141.5 (I)** A subárvore vai junto e o escopo calculado (`mpath`) continua coerente: quem enxergava a entidade pelo escopo do pai passa a enxergá-la pelo do novo pai (CA-RN-25.1).
- **CA-RN-141.6 (I)** O mover arrastado e o do seletor geram o mesmo registro de auditoria.
- **CA-RN-141.7 (E)** A tela passa nos CA-T.7 e CA-T.8 (claro e escuro), também no modo de arraste.

**RN-142 – Foto padrão e um avatar só (§16.8) · M20**
- **CA-RN-142.1 (U)** As iniciais saem da primeira e da última palavra do nome, só letras ("Ana Souza (demo)" → "AS"; "Ana" → "A"; nome sem letras → "?").
- **CA-RN-142.2 (E)** Sem foto, o bloco da conta, Minha conta, Usuários (lista e detalhe), os comentários, o Hall e o ranking mostram o avatar padrão com as iniciais sobre a cor da marca; com foto, a foto.
- **CA-RN-142.3 (U)** A tinta das iniciais sobre a cor da marca passa no contraste AA nos dois temas, também com a cor de exemplo da organização (`design:contrast`).
- **CA-RN-142.4 (I)** Quem ligou o opt-out de nome (RN-70) e o anonimizado aparecem no Hall e no ranking com o ícone genérico: a resposta da API não traz a versão da foto nem o nome deles nesses lugares (negativo).
- **CA-RN-142.5 (E)** Ao lado do nome o avatar é decorativo (texto alternativo vazio); sozinho, tem o nome da pessoa como nome acessível. As telas passam nos CA-T.7 e CA-T.8.

**RN-143 – Recortar a foto antes de enviar (§16.8) · M20**
- **CA-RN-143.1 (E)** Escolher uma foto abre o diálogo de recorte com a prévia; confirmar envia a foto recortada e o avatar muda; cancelar não envia nada.
- **CA-RN-143.2 (U)** O recorte gera uma imagem quadrada de 512 × 512 em WebP a partir da área escolhida, com o giro aplicado, em qualquer ângulo (ex.: 17°, 90°, -135°), sem cortar a área escolhida.
- **CA-RN-143.3 (E)** Zoom, mover e girar funcionam pelos botões e pelo teclado, sem arrastar (o giro livre por controle deslizante com setas, de 1° em 1°, e botões de 90°); o foco fica preso no diálogo e volta ao botão de trocar a foto ao fechar.
- **CA-RN-143.4 (E)** Arquivo de origem acima de 20 MB ou que o navegador não consegue ler é recusado no diálogo, com mensagem, sem enviar (negativo).
- **CA-RN-143.5 (I)** O servidor continua sendo a barreira: um envio direto pela API que não seja imagem → 415, acima do limite → 413 (CA-RN-91.1 e .2 continuam passando).
- **CA-RN-143.6 (E)** O administrador, ao trocar a foto de outra pessoa, usa o mesmo diálogo.

**RN-144 – Foto do login corporativo, por escolha da pessoa (§16.8) · M20**
- **CA-RN-144.1 (I)** Com a opção do provedor **desligada** (padrão), o login não faz nenhuma chamada além das de hoje: o provedor falso não recebe pedido de foto (negativo).
- **CA-RN-144.2 (I)** Ligada, o login pela Microsoft falsa pede `User.Read`, busca a foto pelo Graph falso e a guarda à parte; o login pelo Google falso busca o endereço `picture`. A foto é normalizada (WebP, sem metadados).
- **CA-RN-144.3 (I)** Foto do provedor que falha (tempo esgotado, 404, 6 MB, tipo errado, HTML com nome de imagem) não impede o login e não grava nada (negativo).
- **CA-RN-144.4 (I)** Endereço de foto fora dos hosts fixos (`http://`, loopback, IP interno, outro domínio) é ignorado sem nenhuma conexão (negativo; molde CA-T.17).
- **CA-RN-144.5 (I)** A foto do provedor **não** vira a foto da pessoa sozinha, nem na primeira vez; em Minha conta ela escolhe entre a enviada, a do provedor e a padrão, e a escolha vale em todas as telas.
- **CA-RN-144.6 (I)** Com a do provedor escolhida, um novo login com foto diferente atualiza a foto mostrada; com a enviada escolhida, nada muda.
- **CA-RN-144.7 (I)** Desligar a opção apaga as fotos daquele provedor e quem as usava volta à enviada ou à padrão; desvincular a conta apaga a foto daquele provedor; anonimizar apaga todas (arquivo e registro).
- **CA-RN-144.8 (I)** Ligar e desligar a opção gera registro de auditoria; o token de acesso do provedor não aparece em log, auditoria, banco nem resposta (CA-T.12).
- **CA-RN-144.9 (E)** A tela de Acesso corporativo avisa da permissão `User.Read` ao ligar a opção da Microsoft; Minha conta mostra as três opções com prévia, operáveis pelo teclado.

**RN-145 – Cor e fonte de cada pessoa (§16.8) · M20**
- **CA-RN-145.1 (I)** Com a chave **desligada** (padrão), gravar uma preferência de cor ou fonte → 403 (ou é ignorada), e a tela de Minha conta não mostra a Aparência (negativo).
- **CA-RN-145.2 (I)** Ligada, a pessoa grava uma cor **da paleta** e uma das 4 fontes; cor fora da paleta (inclusive um `#RRGGBB` válido qualquer) ou fonte desconhecida → 422 (negativo).
- **CA-RN-145.3 (U)** Cada cor da paleta, com o escuro derivado, passa no contraste AA (texto 4,5:1, foco e ícones 3:1) nos dois temas, sem precisar de correção (`design:contrast` e teste da regra da marca).
- **CA-RN-145.4 (E)** A escolha muda a cor da marca e a fonte só na tela de quem escolheu; outra pessoa logada continua com a da organização.
- **CA-RN-145.5 (I)** PDF da ideia, cartão do Hall, e-mails, consulta pública e tela de entrada continuam com a identidade da organização mesmo para quem escolheu outra cor (negativo).
- **CA-RN-145.6 (I)** Desligar a chave devolve todos à identidade da organização na próxima carga; religar devolve a escolha guardada.
- **CA-RN-145.7 (E)** O seletor de cor é um grupo de opções nativo (radio), com o escolhido anunciado e o nome de cada cor, operável pelo teclado (as setas andam entre as cores); passa nos CA-T.7 e CA-T.8.

**RN-146 – Anexos da ideia (§16.8) · M20**
- **CA-RN-146.1 (E)** Ao enviar a ideia com 3 arquivos, a ideia é criada e os 3 aparecem na página dela, cada um com o progresso do envio.
- **CA-RN-146.2 (E)** Se um dos arquivos falhar (extensão não permitida, acima do limite), a ideia é criada mesmo assim, o arquivo aparece com o motivo e pode ser reenviado na página da ideia.
- **CA-RN-146.3 (I)** O 11º anexo da ideia → 422; extensão fora da lista → 415; acima do limite → 413; o tipo e o nome gerado seguem a RN-21 (negativo).
- **CA-RN-146.4 (I)** O autor anexa enquanto a ideia está Enviada ou Em análise; em Em andamento ou encerrada → 403. Quem tem `idea.triage` anexa até a ideia ser encerrada (negativo nos dois).
- **CA-RN-146.5 (I)** Remover: quem enviou o anexo, enquanto Enviada ou Em análise; quem tem `idea.triage`, enquanto não encerrada; outra pessoa → 403 (negativo).
- **CA-RN-146.6 (I)** Quem não vê a ideia não lista nem baixa os anexos dela, nem trocando o identificador na URL (CA-T.5).
- **CA-RN-146.7 (I)** Incluir e remover anexo da ideia entram no histórico, com quem fez.
- **CA-RN-146.8 (I)** Os anexos de etapa continuam como estão (CA-RN-21.* passando) e a API de integração não passa a expor anexos.
- **CA-RN-146.9 (E)** Antes de enviar, clicar numa foto ou vídeo escolhido abre o visualizador e num PDF abre um iframe num diálogo, ambos a partir da memória do navegador (URL `blob:`, nada é enviado); Esc fecha e a lista continua igual.

**RN-147 – Ver foto e vídeo na tela (§16.8) · M20**
- **CA-RN-147.1 (E)** Clicar num anexo de imagem abre o visualizador na página, com contador, anterior/próximo e zoom; Esc fecha e o foco volta ao anexo; tudo funciona pelo teclado.
- **CA-RN-147.2 (E)** Um anexo MP4 toca na página com os controles do navegador, sem começar sozinho; avançar o vídeo pede só a faixa necessária (resposta `206`).
- **CA-RN-147.3 (I)** A rota de exibição responde `206` a um pedido `Range` válido, `416` a um inválido, e entrega com `inline`, `nosniff`, `sandbox` e sem cache compartilhado.
- **CA-RN-147.4 (I)** Um HTML ou SVG renomeado como `.png` ou `.mp4` **não** é exibido: a rota de exibição recusa (só o download continua) (negativo; CA-T.23).
- **CA-RN-147.5 (I)** A rota de exibição segue a mesma permissão do download: quem não vê a ideia → 404 (negativo).
- **CA-RN-147.6 (E)** Anexos que não são imagem nem vídeo continuam só com Baixar; o código do visualizador não está no pacote inicial (só baixa ao abrir um anexo).
- **CA-RN-147.7 (U)** As extensões de fábrica incluem `mp4` e `webm`; uma instalação com a lista alterada não muda.
- **CA-RN-147.8 (E)** O visualizador passa nos CA-T.7 e CA-T.8 (claro e escuro), com imagem e com vídeo abertos.

**RN-148 – Módulo do mural e Início (§16.9) · M21**
- **CA-RN-148.1 (I)** Com o módulo **desligado** (padrão), todas as rotas do mural → 404, o Início é o de hoje e nenhum aviso do mural é criado (negativo).
- **CA-RN-148.2 (E)** Ligado, o Início mostra o mural e, ao lado (computador) ou acima (celular), "Minhas ideias e tarefas" com os mesmos cartões de antes.
- **CA-RN-148.3 (I)** Desligar e religar devolve publicações, reações, comentários e denúncias como estavam; ligar e desligar gera registro de auditoria.
- **CA-RN-148.4 (I)** Os perfis de fábrica Analista e Administrador têm `mural.manage`; Colaborador e Gestor não. Só `setting.manage` liga o módulo (negativo para os outros).

**RN-149 – Publicar e retirar (§16.9) · M21**
- **CA-RN-149.1 (I)** `analista` publica uma ideia Em andamento de `Setor A1`; ela aparece no mural para `colab3` (de `Unidade B`), e a publicação entra no histórico da ideia e na auditoria.
- **CA-RN-149.2 (I)** Publicar ideia Enviada, Em análise ou Não autorizada → 422; publicar sem `mural.manage` na entidade da ideia (`colab1`, `gestor`) → 403, e quem nem vê a ideia (`analista` numa ideia de `Unidade B` fora do mural) → 404 (negativo; CA-T.5).
- **CA-RN-149.3 (I)** Retirar exige motivo (sem motivo → 422); retirada, a ideia some do mural e da página dela no mural, e publicar de novo devolve reações e comentários.
- **CA-RN-149.4 (I)** Interromper ou arquivar uma ideia publicada a retira sozinha (autor: o sistema, no histórico e na auditoria); excluir apaga a publicação junto; reabrir não a publica de novo.
- **CA-RN-149.5 (I)** Implementar uma ideia publicada (e reabrir uma Implementada) mantém a publicação, e o cartão mostra a nova situação.
- **CA-RN-149.6 (E)** O diálogo de publicar mostra o lembrete de sigilo e o que vai aparecer no cartão antes de confirmar.
- **CA-RN-149.7 (I)** Publicar duas vezes em paralelo grava uma publicação só (CA-T.2).

**RN-150 – O que aparece e quem vê (§16.9) · M21**
- **CA-RN-150.1 (I)** A resposta do mural traz só título, situação, categoria, entidade, data da publicação, nomes consentidos e contagens; não traz descrição, solução, etapas, ganho, anexos, histórico, comentários da ideia nem quem triou (negativo; CA-T.24).
- **CA-RN-150.2 (I)** `colab3` vê o cartão de uma ideia de `Setor A1`, mas `GET` da ideia, dos anexos e dos comentários dela → 404 (CA-T.5); a resposta do mural traz `canOpen: false` para ele e `true` para `analista` e para o autor.
- **CA-RN-150.3 (I)** Usuário desativado ou sem login não vê o mural; a consulta pública por código não mostra nada do mural (negativo).
- **CA-RN-150.4 (I)** A ordem padrão é pela data da publicação (mais nova primeiro); "Mais reações" ordena pelo total, com empate pela data.
- **CA-RN-150.5 (I)** Os filtros por situação, categoria e entidade (com as sub-entidades) combinam entre si; filtrar por `Unidade A` traz as ideias de `Setor A1`.
- **CA-RN-150.6 (I)** A lista vem em páginas de 20, com cursor estável (publicar uma ideia nova não repete nem pula cartões na página seguinte; CA-T.10).
- **CA-RN-150.7 (E)** O link interno de uma ideia do mural abre a página dela depois do login; sem sessão, vai para a entrada e volta ao link.

**RN-151 – Nome do autor por consentimento (§16.9) · M21**
- **CA-RN-151.1 (I)** Publicada a ideia, autor e coautores recebem o aviso de consentimento; sem resposta, o cartão e a conversa não trazem o nome nem a foto de nenhum deles (negativo).
- **CA-RN-151.2 (I)** O autor consente e o nome dele aparece no cartão; o coautor, que não consentiu, continua sem aparecer; retirar o consentimento tira o nome na hora.
- **CA-RN-151.3 (I)** Com o opt-out de nome (RN-70), desativado ou anonimizado, o nome não aparece mesmo com o consentimento dado (negativo).
- **CA-RN-151.4 (I)** O autor sem consentimento comenta: a conversa mostra "Autor da ideia" sem foto para `colab3`, e o nome real só para quem tem `mural.manage` na entidade da ideia; a auditoria guarda quem foi.
- **CA-RN-151.5 (I)** Nenhuma resposta do mural para quem não tem `mural.manage` permite ligar um participante sem consentimento à ideia: nem o identificador da pessoa, nem a versão da foto, nem a lista de reações, nem o "enviado por" (negativo; CA-T.24).

**RN-152 – Reações (§16.9) · M21**
- **CA-RN-152.1 (I)** `colab3` reage com Genial, troca para Parabéns e tira; a contagem por tipo acompanha e nunca passa de uma reação dele na ideia.
- **CA-RN-152.2 (I)** Duas reações dele em paralelo deixam uma só (CA-T.2); tipo fora das 5 → 422 (negativo).
- **CA-RN-152.3 (I)** Autor ou coautor reagindo à própria ideia → 403 (negativo).
- **CA-RN-152.4 (I)** A lista de quem reagiu traz os nomes, filtrável por tipo; anonimizado aparece como "Ex-colaborador".
- **CA-RN-152.5 (I)** Reagir não muda pontos (com a gamificação ligada, o extrato não muda) nem as curtidas do Hall.
- **CA-RN-152.6 (E)** Cada reação é um botão com nome e `aria-pressed`; a nova contagem é anunciada; a primeira reação avisa que o nome aparece na lista.

**RN-153 – Comentários e respostas (§16.9) · M21**
- **CA-RN-153.1 (I)** Um comentário do mural não aparece nos comentários da ideia, e nenhum comentário da ideia (público ou interno) aparece no mural (negativo).
- **CA-RN-153.2 (I)** O comentário é publicado na hora, com o nome de quem escreve; texto acima de 2000 caracteres → 422; `<script>` aparece como texto (CA-T.4).
- **CA-RN-153.3 (I)** Responder a uma resposta grava a resposta no comentário de origem (nunca um segundo nível).
- **CA-RN-153.4 (I)** Quem escreveu edita: o comentário mostra "editado" e o texto anterior fica disponível só para `mural.manage`; outra pessoa editando → 403 (negativo).
- **CA-RN-153.5 (I)** Apagar comentário com respostas deixa "Comentário removido" e mantém as respostas; sem respostas, some.
- **CA-RN-153.6 (I)** Comentário oculto não pode ser editado (negativo); o 31º comentário da pessoa na mesma hora → 429.
- **CA-RN-153.7 (I)** Com a ideia retirada, comentar → 404 e a conversa não aparece; publicada de novo, volta.

**RN-154 – Denúncia e moderação (§16.9) · M21**
- **CA-RN-154.1 (I)** `colab3` denuncia um comentário de `colab1` com motivo; denunciar de novo o mesmo comentário, ou o próprio, → 422 (negativo).
- **CA-RN-154.2 (I)** `analista` vê a denúncia na fila e oculta com motivo (sem motivo → 422); `colab1` recebe o aviso com o motivo e vê o comentário marcado como oculto; os outros veem "Comentário oculto pela equipe".
- **CA-RN-154.3 (I)** Ocultar, restaurar ou dispensar sem `mural.manage` na entidade da ideia → 403 (negativo).
- **CA-RN-154.4 (I)** Ocultar, restaurar e dispensar geram auditoria sem o texto do comentário; nenhuma resposta a `colab1` revela quem denunciou.

**RN-155 – Compartilhar (§16.9) · M21**
- **CA-RN-155.1 (I)** `colab3` envia a ideia a `colab2` com mensagem; `colab2` recebe o aviso com o nome de quem enviou e o link interno. O autor sem consentimento que envia a própria ideia aparece no aviso como "um colega" (CA-RN-151.5).
- **CA-RN-155.2 (I)** Enviar a pessoa desativada ou inexistente → 422; mensagem acima de 300 caracteres → 422; o 21º envio na mesma hora → 429 (negativo).
- **CA-RN-155.3 (E)** "Copiar link" copia o endereço interno; não existe botão de rede social nem link público; o link de uma ideia retirada mostra "Esta ideia não está mais no mural".

**RN-156 – Avisos do mural (§16.9) · M21**
- **CA-RN-156.1 (I)** Cinco reações e dois comentários no mesmo dia geram **um** aviso de resumo por participante, atualizado (não sete avisos); no dia seguinte começa outro (CA-T.1, CA-T.3).
- **CA-RN-156.2 (I)** Duas respostas ao mesmo comentário no dia geram um aviso só a quem escreveu.
- **CA-RN-156.3 (I)** Cada aviso do mural pode ser desligado nas preferências, por canal, e nenhum é obrigatório; desligado, não é criado (negativo).
- **CA-RN-156.4 (I)** A equipe com `mural.manage` na entidade recebe o aviso agrupado de denúncias pendentes; quem não tem, não (negativo).

**RN-157 – Integração (§16.9) · M21**
- **CA-RN-157.1 (I)** Publicar e retirar geram `mural.published` e `mural.withdrawn` para quem assina (módulo ideias, no escopo), com `data` só com `idea_code` e `entity_id` (CA-T.16).
- **CA-RN-157.2 (I)** A ideia na API de leitura ganha `on_mural` e `mural_published_at`; o contrato `openapi-integration.json` só ganhou campos.
- **CA-RN-157.3 (I)** Nenhuma rota de `/integration/v1` expõe reações, comentários, denúncias ou consentimentos, e a escrita não publica no mural (negativo; CA-T.18).

**RN-158 – Telas, acessibilidade e Ajuda (§16.9) · M21**
- **CA-RN-158.1 (E)** O mural, a página da ideia no mural, a lista de quem reagiu, o diálogo de publicar, o de enviar a um colega e a fila de denúncias passam nos CA-T.7 e CA-T.8 (claro e escuro), operáveis pelo teclado.
- **CA-RN-158.2 (D)** A Ajuda tem "Mural de ideias" e "Publicar e moderar o mural" nas duas línguas, e as RN-148 a RN-158 aparecem na lista de regras.

**RN-159 – Módulo da loja e permissão (§16.10) · M22**
- **CA-RN-159.1 (I)** Com a loja **desligada** (padrão), todas as rotas da loja → 404 e nenhum aviso da loja é criado (negativo).
- **CA-RN-159.2 (I)** Ligar a loja com o reconhecimento desligado → 422; desligar o reconhecimento com a loja ligada → 422 (negativo).
- **CA-RN-159.3 (I)** Desligar e religar a loja devolve saldos, extrato, itens e pedidos como estavam; ligar e desligar gera auditoria.
- **CA-RN-159.4 (I)** De fábrica, só o Administrador tem `store.manage`; com ela num perfil de qualquer entidade, a pessoa gerencia a loja inteira; sem ela, as rotas de gestão → 403 (negativo).

**RN-160 – Dois números e o extrato (§16.10) · M22**
- **CA-RN-160.1 (I)** Depois de um resgate, os pontos ganhos, o nível e a posição no ranking de `colab1` não mudam; só o saldo diminui.
- **CA-RN-160.2 (I)** O saldo é sempre a soma do extrato, depois de qualquer sequência de pontos, pedidos, estornos, ajustes e expirações.
- **CA-RN-160.3 (I)** `UPDATE` e `DELETE` numa linha do extrato são recusados pelo banco (CA-T.26).
- **CA-RN-160.4 (I)** Cada linha traz o tipo, o valor, a data, quem causou e a referência (ideia, pedido ou motivo).

**RN-161 – Saldo inicial e créditos (§16.10) · M22**
- **CA-RN-161.1 (I)** `colab1` com 80 pontos ganhos antes da loja: ao ligar a loja pela primeira vez, ganha uma linha "saldo inicial" de 80; quem não tinha pontos não ganha linha.
- **CA-RN-161.2 (I)** Desligar e religar a loja não cria um segundo saldo inicial (negativo; CA-T.1).
- **CA-RN-161.3 (I)** Uma ideia aprovada depois credita o saldo com os mesmos pontos do reconhecimento, na mesma transação, divididos entre autor e coautores pela regra da RN-69.
- **CA-RN-161.4 (I)** Com a loja desligada depois da primeira ativação, os pontos ganhos continuam creditando o saldo; uma temporada nova não zera o saldo.

**RN-162 – Validade do saldo (§16.10) · M22**
- **CA-RN-162.1 (I)** Sem validade (padrão), nada expira, nem crédito de anos atrás (negativo).
- **CA-RN-162.2 (I)** Validade de 12 meses: um crédito de 100 de 13 meses atrás, com 30 já gastos, gera uma expiração de 70; o crédito de 2 meses atrás não expira (os gastos consomem primeiro o mais antigo).
- **CA-RN-162.3 (I)** Rodar a expiração duas vezes no mesmo dia não expira de novo (CA-T.1); o que está reservado em pedido pendente não expira.
- **CA-RN-162.4 (I)** 30 dias antes do vencimento, a pessoa recebe um aviso com a quantidade e a data, uma vez só.

**RN-163 – Item da loja (§16.10) · M22**
- **CA-RN-163.1 (I)** Criar item sem nome, com custo 0 ou negativo, ou bonificação sem valor informativo → 422 (negativo).
- **CA-RN-163.2 (I)** Mudar o custo de 100 para 150 não muda o custo dos pedidos já feitos; a auditoria guarda o custo antes e depois.
- **CA-RN-163.3 (I)** Desativar um item com 2 pedidos pendentes tira o item da vitrine e os 2 pedidos continuam podendo ser aprovados e entregues.
- **CA-RN-163.4 (I)** Excluir item com pedidos → 409; sem pedidos, exclui (negativo e positivo).
- **CA-RN-163.5 (I)** Item só para a `Unidade A` não aparece para `colab3` (de `Unidade B`) e pedir pela API → 404; aparece para `colab1` (de `Setor A1`, sub-entidade).
- **CA-RN-163.6 (E)** A foto do item usa o recorte quadrado; o diálogo passa nos CA-T.7 e CA-T.8.

**RN-164 – Vitrine (§16.10) · M22**
- **CA-RN-164.1 (I)** A vitrine traz só os itens ativos disponíveis à pessoa, com o custo atual, o estoque restante quando limitado, o limite e o número de resgates, sem nomes de quem resgatou (negativo).
- **CA-RN-164.2 (I)** A resposta traz o saldo, o reservado e, por item, se dá para pedir e o motivo quando não dá (sem saldo, sem estoque, limite atingido).
- **CA-RN-164.3 (E)** A vitrine e o saldo passam nos CA-T.7 e CA-T.8; o motivo de não poder pedir é texto, não só cor.

**RN-165 – Pedir (§16.10) · M22**
- **CA-RN-165.1 (I)** `colab1` com saldo 100 pede item de 60: o pedido nasce pendente, o extrato ganha uma reserva de −60, o saldo fica 40 e o estoque baixa 1.
- **CA-RN-165.2 (I)** Pedir item de 60 com saldo 40 → 422 `insufficient_balance`; item sem estoque → 422 `out_of_stock`; limite de 1 por trimestre já usado → 422 `limit_reached`; item inativo → 404 (negativo).
- **CA-RN-165.3 (I)** Dois pedidos simultâneos de 60 com saldo 100 → um aceito e um recusado; dois pedidos simultâneos da última unidade por pessoas diferentes → um aceito (CA-T.25).
- **CA-RN-165.4 (I)** Pedido recusado ou cancelado não conta para o limite do período; um pedido do trimestre anterior também não.
- **CA-RN-165.5 (I)** A pessoa cancela o próprio pedido pendente: estorno imediato e o estoque volta; cancelar pedido aprovado pela própria pessoa → 409 (negativo).

**RN-166 – Aprovar, recusar, entregar e cancelar (§16.10) · M22**
- **CA-RN-166.1 (I)** Quem tem `store.manage` aprova e depois entrega; entregar um pendente → 409 e aprovar um entregue → 409 (negativo).
- **CA-RN-166.2 (I)** Recusar sem motivo → 422; recusar com motivo devolve o saldo (linha de estorno) e o estoque.
- **CA-RN-166.3 (I)** Cancelar um aprovado, com motivo, faz o estorno; entregue não se cancela (409) (negativo).
- **CA-RN-166.4 (I)** O gestor da loja que fez um pedido não o aprova, recusa, entrega nem cancela como gestor → 403 (negativo).
- **CA-RN-166.5 (I)** Aprovar, recusar, entregar e cancelar ao mesmo tempo no mesmo pedido: só uma vale, a outra recebe 409 (CA-T.2).

**RN-167 – Bonificação (§16.10) · M22**
- **CA-RN-167.1 (I)** Pedido de bonificação aprovado aparece em "Bonificações a pagar"; marcar paga exige data e referência (sem elas → 422) e o tira da lista.
- **CA-RN-167.2 (I)** Bonificação não tem "entregue" (409) e produto não tem "paga" (409) (negativo).
- **CA-RN-167.3 (I)** A exportação CSV traz pessoa, item, valor informativo, data da aprovação e situação, e trata `=`, `+`, `-` e `@` no começo do texto (CA-T.4).
- **CA-RN-167.4 (U)** Nenhuma regra calcula imposto, desconto ou valor líquido: o valor informativo sai como foi cadastrado.

**RN-168 – Ajuste manual de saldo (§16.10) · M22**
- **CA-RN-168.1 (I)** Crédito de 50 com motivo: linha de ajuste, saldo +50, pontos ganhos iguais, auditoria e aviso à pessoa com o motivo.
- **CA-RN-168.2 (I)** Ajuste sem motivo ou de valor 0 → 422; sem `store.manage` → 403; no próprio saldo → 403 (negativo).
- **CA-RN-168.3 (I)** Débito maior que o saldo deixa o saldo negativo (RN-169).

**RN-169 – Saldo negativo (§16.10) · M22**
- **CA-RN-169.1 (I)** Com saldo −20, pedir qualquer item → 422 `insufficient_balance`; o pedido já reservado antes do débito segue e pode ser entregue.
- **CA-RN-169.2 (E)** Minha loja mostra o saldo negativo com a explicação.

**RN-170 – Privacidade e auditoria (§16.10) · M22**
- **CA-RN-170.1 (I)** `colab2` não lê o saldo, o extrato nem os pedidos de `colab1`, nem trocando o identificador na URL (404; CA-T.5).
- **CA-RN-170.2 (I)** O ranking não muda com resgates, e nenhuma resposta pública da loja traz nome de quem resgatou (negativo).
- **CA-RN-170.3 (I)** Cada ação da lista da RN-170 gera um registro de auditoria com quem fez.
- **CA-RN-170.4 (I)** Anonimizar `colab1` mantém o extrato e os pedidos, que passam a mostrar "Ex-colaborador".

**RN-171 – Avisos da loja (§16.10) · M22**
- **CA-RN-171.1 (I)** Aprovar, recusar, entregar, cancelar pela equipe, marcar bonificação paga e ajustar o saldo avisam a pessoa; aprovado, recusado e cancelado não se desligam nas preferências.
- **CA-RN-171.2 (I)** Três pedidos novos no mesmo dia geram **um** aviso agrupado para cada gestor da loja (CA-T.1).
- **CA-RN-171.3 (I)** O grupo Loja só aparece nas preferências com a loja ligada; nenhum aviso da loja gera pontos.

**RN-172 – Integração (§16.10) · M22**
- **CA-RN-172.1 (I)** O módulo `store` desligado → as rotas `/integration/v1/store/*` respondem como módulo fora (403); ligado, a lista traz os pedidos com o nome da pessoa e sem e-mail, salvo a opção de e-mail.
- **CA-RN-172.2 (I)** Aprovar, entregar e pagar geram `store.order_approved`, `store.order_delivered` e `store.bonus_paid` só com `order_id`, `item_id` e `status` (CA-T.16).
- **CA-RN-172.3 (I)** Nenhuma rota de integração expõe saldo ou extrato, e nenhuma pede, aprova ou ajusta (negativo; CA-T.18).

**RN-173 – Telas, acessibilidade e Ajuda (§16.10) · M22**
- **CA-RN-173.1 (E)** Loja, Meus pedidos, Meu extrato, Gerenciar loja (itens, pedidos, bonificações, ajuste) e os diálogos passam nos CA-T.7 e CA-T.8, operáveis pelo teclado.
- **CA-RN-173.2 (D)** A Ajuda tem "Loja: trocar pontos" e "Gerenciar a loja e as bonificações" nas duas línguas, e as RN-159 a RN-173 aparecem na lista de regras.

**RN-174 – Aviso na tela das ações (§16.11) · M23**
- **CA-RN-174.1 (U)** Toda ação que falha mostra um aviso de erro com o mesmo texto que a tela já usa para o erro (`errorText`), sem nenhuma linha no código da ação.
- **CA-RN-174.2 (U)** Uma ação com texto de sucesso declarado mostra o aviso de sucesso com esse texto; sem o texto declarado, não mostra sucesso (negativo).
- **CA-RN-174.3 (E)** Um erro de formulário (senha errada no login, nome de categoria repetido) aparece junto do formulário **e** no aviso.
- **CA-RN-174.4 (U)** A sessão expirada (401) não gera aviso e leva ao login, e a validação do navegador antes de enviar também não gera aviso (negativo).
- **CA-RN-174.5 (U)** Uma varredura do código lista toda ação que grava sem texto de sucesso declarado; a lista fica vazia, fora as exceções da RN-174.
- **CA-RN-174.6 (E)** Reagir no mural, marcar notificação como lida, trocar o tema e ordenar arrastando não mostram sucesso; com um erro forçado, mostram o erro.
- **CA-RN-174.7 (E)** O link de senha, o segredo do webhook e o token da integração continuam na tela depois de criados: o aviso não os substitui.

**RN-175 – Como o aviso se comporta (§16.11) · M23**
- **CA-RN-175.1 (U)** Ficam no máximo 3 avisos visíveis; o quarto tira o mais antigo.
- **CA-RN-175.2 (U)** O aviso some em 4 s (sucesso), 6 s (atenção e informação) e 8 s (erro); o mouse em cima ou o foco dentro dele pausa o tempo, e sair retoma.
- **CA-RN-175.3 (E)** O aviso de sucesso tem `role="status"` e o de erro `role="alert"`; o foco não muda quando um aviso aparece.
- **CA-RN-175.4 (E)** O botão Fechar tem nome em pt-BR e en e fecha o aviso; o tipo é dito em texto ao leitor de tela, e não só pela cor.
- **CA-RN-175.5 (E)** Com o pedido de menos movimento, o aviso entra e sai sem animação.
- **CA-RN-175.6 (E)** Com um aviso aberto de cada tipo, a tela passa no axe nos dois temas; no celular não há rolagem lateral.

**RN-176 – Layouts da tela de login (§16.11) · M23**
- **CA-RN-176.1 (I)** De fábrica, e numa instalação que só foi atualizada, o layout é o cartão central, e a tela de acesso fica igual à de antes.
- **CA-RN-176.2 (I)** Só os 6 layouts (e os 2 lados do dividido e do painel lateral) são aceitos; outro valor → 422 (negativo).
- **CA-RN-176.3 (E)** O layout escolhido aparece em entrar, esqueci a senha, definir a senha e no retorno com erro do login corporativo; o assistente de instalação e a consulta pública não mudam.
- **CA-RN-176.4 (E)** No celular (390 px), todo layout vira uma coluna, com o formulário visível sem rolar até ele e sem rolagem lateral.
- **CA-RN-176.5 (E)** No dividido e no painel lateral, o formulário fica do lado escolhido.

**RN-177 – Fundo da tela de login (§16.11) · M23**
- **CA-RN-177.1 (I)** Uma imagem PNG, JPEG ou WebP vira WebP com no máximo 2560 px de largura e sem metadados (sem EXIF nem GPS); um arquivo de outro tipo pelo conteúdo (um `.png` que é SVG ou HTML) → 415; acima de 10 MB → 413 (negativo).
- **CA-RN-177.2 (I)** Ponto de foco, camada (0 a 90%), desfoque (0 a 20 px) e cores do gradiente fora dos limites ou inválidos → 422 (negativo).
- **CA-RN-177.3 (U, I)** O texto sobre o fundo dá pelo menos 4,5:1 no pior caso, sozinho ou com a placa: um gradiente sem contraste para nenhuma cor (azul → amarelo) e uma camada preta de 50% sobre foto (3,95:1) recebem a placa, e a placa calculada garante 4,5:1 nas duas pontas. A cor escolhida (clara ou escura) é respeitada; a automática não usa placa quando uma cor passa sozinha. O editor avisa quando a placa entra.
- **CA-RN-177.4 (I)** A imagem é servida sem login, com cache e a versão na URL; trocar apaga o arquivo antigo; enviar e remover geram auditoria sem o conteúdo.
- **CA-RN-177.5 (E)** Com uma foto muito clara e outra muito escura no fundo, o formulário fica sobre superfície sólida em todo layout, e o axe não acusa contraste.
- **CA-RN-177.6 (E)** O ponto de foco continua visível no celular e no computador.

**RN-178 – Vídeo de fundo (§16.11) · M23**
- **CA-RN-178.1 (I)** Um MP4 ou WebM é aceito pelo conteúdo; outro tipo → 415; acima de 20 MB → 413; ativar o vídeo sem capa → 422 `login_video_needs_poster` (negativo).
- **CA-RN-178.2 (I)** O vídeo é servido sem login, em partes (206 com `Range`, 416 fora do arquivo) e com `nosniff`.
- **CA-RN-178.3 (E)** O vídeo toca sem som e em repetição; **Pausar o vídeo** e **Retomar o vídeo** têm nome e estado, funcionam pelo teclado, e a escolha continua ao recarregar neste navegador.
- **CA-RN-178.4 (E)** Com o pedido de menos movimento, com economia de dados ou numa tela estreita, só a capa aparece, e o vídeo não é baixado.
- **CA-RN-178.5 (E)** Com o vídeo ligado, nenhuma requisição da tela de acesso vai a outro domínio (CA-T.27).

**RN-179 – Textos da tela de login (§16.11) · M23**
- **CA-RN-179.1 (I)** Título com mais de 80 caracteres ou subtítulo com mais de 200 → 422; um texto com HTML é guardado como texto e mostrado escapado, nunca interpretado (negativo).
- **CA-RN-179.2 (E)** Escolher um texto pronto preenche o pt-BR e o en, e os campos continuam editáveis antes de salvar.
- **CA-RN-179.3 (E)** Sem o texto em en, a tela de acesso em inglês mostra o texto em pt-BR.
- **CA-RN-179.4 (E)** Com o tradutor do navegador disponível, **Sugerir tradução** preenche o en sem salvar; sem ele, o botão não aparece; o servidor do ITS não faz nenhuma chamada externa (negativo).
- **CA-RN-179.5 (D)** Há pelo menos 6 pares de textos prontos, revisados nas duas línguas.

**RN-180 – Prévia, gravação e permissão (§16.11) · M23**
- **CA-RN-180.1 (I)** Sem `setting.manage`, toda rota de configuração da tela de login → 403 (negativo).
- **CA-RN-180.2 (E)** A prévia mostra o que ainda não foi salvo no computador e no celular, no claro e no escuro, e a tela de acesso pública só muda depois de salvar.
- **CA-RN-180.3 (I)** Salvar gera `branding.login_changed` com os campos que mudaram; **Restaurar o padrão** apaga os arquivos e volta ao cartão central sem fundo nem textos.
- **CA-RN-180.4 (I)** A configuração pública traz só o layout, o fundo (endereços com versão e ajustes) e os textos, e nada mais da configuração.

**RN-181 – Tema nas telas de acesso (§16.11) · M23**
- **CA-RN-181.1 (E)** Sem sessão, trocar o tema muda a tela na hora, e a escolha continua ao recarregar neste navegador.
- **CA-RN-181.2 (E)** Escolher Escuro na tela de login e entrar com uma conta de tema Claro mantém a tela escura, sem piscar, e grava Escuro na conta (uma chamada a `/auth/me/preferences`); ao entrar em outro navegador, a conta abre escura. Sem mexer no botão do login, a conta entra com o tema que já tinha e nada é gravado.
- **CA-RN-181.3 (E)** Ao sair, a tela de acesso abre com o último tema usado neste navegador.
- **CA-RN-181.4 (E)** O botão de tema é um menu com nome ("Tema: Automático"), opções com `aria-checked` e uso pelo teclado, e passa no axe.

**RN-182 – Telas, acessibilidade e Ajuda (§16.11) · M23**
- **CA-RN-182.1 (E)** Os 6 layouts, com fundo nenhum, gradiente, imagem e vídeo (capa), passam no CA-T.8 no claro e no escuro e no celular; o formulário de acesso é operável pelo teclado em todos.
- **CA-RN-182.2 (D)** A Ajuda tem "Personalizar a tela de login" nas duas línguas, e as RN-174 a RN-182 aparecem na lista de regras.

**RN-183 – Pedir aprovação (§16.12) · M24**
- **CA-RN-183.1 (I)** Quem tem `idea.triage` na entidade pede a aprovação de uma ideia Em análise ou Em andamento, com aprovadores do ITS e de fora; o pedido vai para a linha do tempo e para a auditoria.
- **CA-RN-183.2 (I)** Sem `idea.triage` na entidade → 403; ideia Enviada, implementada, não autorizada, interrompida ou arquivada → 409 (negativo).
- **CA-RN-183.3 (I)** Nenhum ou mais de 10 aprovadores, e-mail inválido, nome ou área acima do limite, resumo acima de 2000, mais de 5 anexos, anexo de outra ideia ou prazo fora de 1 a 60 → 422 (negativo).
- **CA-RN-183.4 (I)** Com um pedido aberto, outro pedido na mesma ideia → 409; depois de encerrado, um novo pedido é aceito e o anterior fica no histórico.
- **CA-RN-183.5 (I)** "Segurar a aprovação" só vale com a ideia Em análise; "segurar a implementação" vale Em análise e Em andamento (negativo para o resto).
- **CA-RN-183.6 (I)** Cancelar exige motivo, invalida todos os links do pedido na hora e vai para a auditoria.

**RN-184 – Aprovar por um link de uso único (§16.12) · M24**
- **CA-RN-184.1 (I)** O banco guarda só o resumo do link (nunca o link); com o link certo, a página abre sem login; com um link inventado ou alterado → 404 (CA-T.28).
- **CA-RN-184.2 (I)** A página mostra só o que o pedido congelou (título, código, resumo, área, quem pediu, prazo e, se marcados, ganho e anexos); a descrição, os comentários, o autor e os dados de outras ideias nunca aparecem, nem nos anexos baixados pelo link (negativo).
- **CA-RN-184.3 (I)** Aprovar grava a decisão, o nome, o e-mail, a data e o IP; não aprovar sem comentário → 422; o link usado não aceita uma segunda decisão (409) e passa a mostrar só "Resposta registrada".
- **CA-RN-184.4 (I)** Link vencido, de pedido cancelado ou substituído por um pedido novo → a página diz que não vale mais e não aceita decisão (negativo).
- **CA-RN-184.5 (I)** Mudar a ideia depois do pedido não muda o que a página mostra (o pedido congela o resumo, o título e os anexos escolhidos).
- **CA-RN-184.6 (E)** A página do link passa no CA-T.8 nos dois temas e no celular, não carrega nada de fora (CA-T.27) e tem `noindex`.

**RN-185 – Código de confirmação (§16.12) · M24**
- **CA-RN-185.1 (I)** Com `approval.email_code` desligado (padrão), a página não pede código; ligado, decidir sem o código certo → 422 e nada muda.
- **CA-RN-185.2 (I)** O código vai para o e-mail do aprovador, vale 10 minutos e aceita 5 tentativas; vencido ou esgotado → é preciso pedir outro (negativo).
- **CA-RN-185.3 (I)** O código nunca aparece na resposta da API, no log nem na auditoria (CA-RN-39.2).

**RN-186 – Aprovar dentro do ITS (§16.12) · M24**
- **CA-RN-186.1 (I)** Um aprovador com usuário não recebe link: recebe o aviso no sino (que não pode ser desligado) e decide em Aprovações pendentes.
- **CA-RN-186.2 (I)** Só o próprio aprovador decide a parte dele; outra pessoa → 403 (negativo).
- **CA-RN-186.3 (E)** Em Aprovações pendentes, o botão para abrir a ideia só aparece para quem já pode vê-la; os outros veem só o resumo do pedido.

**RN-187 – Registro manual com evidência (§16.12) · M24**
- **CA-RN-187.1 (I)** O analista registra a decisão de um aprovador pendente com nome, data e pelo menos um arquivo de evidência; sem arquivo → 422; o registro fica marcado com o nome de quem registrou.
- **CA-RN-187.2 (I)** O registro vale com o envio de e-mail ligado e desligado; com o e-mail desligado, pedir a aprovação de alguém de fora não envia nada e deixa só o registro manual.
- **CA-RN-187.3 (I)** O arquivo de evidência segue as regras de anexo (RN-21): tipo e tamanho fora da regra → recusado (negativo).

**RN-188 – Efeito no ciclo da ideia (§16.12) · M24**
- **CA-RN-188.1 (I)** Com o pedido pendente, aprovar (ou implementar, conforme o pedido) → 409 `approval_pending`; as outras ações seguem normais.
- **CA-RN-188.2 (I)** Com todos aprovando, o pedido fica aprovado e a transição é liberada; com um aprovando e outro pendente, continua seguro.
- **CA-RN-188.3 (I)** Uma recusa fecha o pedido como não aprovado e invalida os links que faltavam.
- **CA-RN-188.4 (I)** No modo **devolver** (padrão), "seguir sem a aprovação" exige justificativa, libera a transição e vai para a linha do tempo e para a auditoria; sem justificativa → 422.
- **CA-RN-188.5 (I)** No modo **bloquear**, "seguir sem a aprovação" → 403; só um novo pedido aprovado libera a transição (negativo).
- **CA-RN-188.6 (I)** Nenhuma decisão de aprovador muda a situação da ideia sozinha.

**RN-189 – Prazo e lembretes (§16.12) · M24**
- **CA-RN-189.1 (I)** Cada aprovador pendente recebe no máximo dois lembretes (3 dias antes e no dia), e rodar a rotina de novo não repete nenhum (CA-T.1).
- **CA-RN-189.2 (I)** No fim do prazo, o pedido fica vencido, os links morrem e quem pediu é avisado; um novo pedido pode ser feito.
- **CA-RN-189.3 (I)** Quem já decidiu não recebe lembrete (negativo).

**RN-190 – Quem vê o quê (§16.12) · M24**
- **CA-RN-190.1 (I)** O autor e os coautores veem só "Aguardando aprovação de outra área" e o resultado, sem nomes, e-mails nem comentários (negativo).
- **CA-RN-190.2 (E)** Para a equipe, o e-mail de quem é de fora abre oculto e só aparece com o olho (RN-135).
- **CA-RN-190.3 (I)** Com domínios cadastrados, um e-mail de fora deles gera o aviso; com `approval.allow_outside_domains` desligado → 422 (negativo).
- **CA-RN-190.4 (I)** Excluir a ideia apaga os pedidos, os aprovadores e as evidências dela.

**RN-191 – Avisos e integração (§16.12) · M24**
- **CA-RN-191.1 (I)** Os avisos de pedido, resposta, aprovado, não aprovado e vencido chegam a quem devem; o de "aprovação pedida" não pode ser desligado.
- **CA-RN-191.2 (I)** Os webhooks `approval.requested` e `approval.decided` levam só `idea_code`, `entity_id`, `request_id` e a situação (CA-T.16).
- **CA-RN-191.3 (I)** A ideia na API de leitura ganha `pending_approval`; o contrato `openapi-integration.json` só ganhou campos; a escrita pela API não pede nem decide aprovações (negativo; CA-T.18).

**RN-192 – Telas, acessibilidade e Ajuda (§16.12) · M24**
- **CA-RN-192.1 (E)** O bloco Aprovação, o diálogo de pedir, o de registrar, a página pública, Aprovações pendentes e a seção de Configurações passam nos CA-T.7 e CA-T.8, operáveis pelo teclado.
- **CA-RN-192.2 (D)** A Ajuda tem "Pedir aprovação de outra área" e "Aprovar uma ideia" nas duas línguas, e as RN-183 a RN-192 aparecem na lista de regras.

**RN-193 – Criar os campos (§16.13) · M25**
- **CA-RN-193.1 (I)** Quem tem `user.manage` cria um campo aberto e um fechado; sem a permissão → 403; criar, alterar, ordenar e desativar vão para a auditoria.
- **CA-RN-193.2 (I)** O 9º campo ativo → 422; desativar um campo libera a vaga.
- **CA-RN-193.3 (I)** Nome vazio ou acima de 60 caracteres, ou dica acima de 200 → 422; sem o nome em inglês, a tela em inglês mostra o nome em pt-BR.
- **CA-RN-193.4 (E)** Ordenar arrastando, e também pelos botões sem arrastar, muda a ordem no diálogo, em Minha conta e no detalhe do usuário.

**RN-194 – Campos abertos (§16.13) · M25**
- **CA-RN-194.1 (U)** A máscara CPF aceita só CPF com os dígitos verificadores certos; a máscara livre `AA-9999` aceita "AB-1234" e recusa "A1-1234" e "AB-123".
- **CA-RN-194.2 (I)** Texto fora dos limites, número fora do mínimo e do máximo (ou não numérico) e data inválida → 422, apontando o campo.
- **CA-RN-194.3 (I)** Com "valor único", um segundo usuário com o mesmo valor, mesmo com outra pontuação ou com maiúsculas → 409 `custom_field_duplicate`.
- **CA-RN-194.4 (I)** Mudar a máscara ou os limites não apaga nem recusa os valores que já existem; a regra nova vale no próximo preenchimento.

**RN-195 – Campos fechados (§16.13) · M25**
- **CA-RN-195.1 (I)** Nenhuma ou mais de 100 opções, opção repetida no campo ou acima de 80 caracteres → 422.
- **CA-RN-195.2 (I)** A opção desativada some da escolha, mas quem já a tem continua com ela, e o detalhe a mostra marcada como desativada.
- **CA-RN-195.3 (I)** Gravar um valor que não é uma opção ativa do campo → 422 (negativo).

**RN-196 – Quem preenche e quem altera (§16.13) · M25**
- **CA-RN-196.1 (I)** A pessoa altera os próprios valores; tentar alterar os de outra pessoa → 403 (negativo).
- **CA-RN-196.2 (I)** Quem tem `user.manage` altera os valores de qualquer usuário, e a alteração vai para a auditoria.
- **CA-RN-196.3 (I)** Com "só a administração altera depois de preenchido", a pessoa preenche o campo vazio; com o valor gravado, alterar → 403 `custom_field_locked`; o administrador continua alterando.

**RN-197 – Campo obrigatório no cadastro (§16.13) · M25**
- **CA-RN-197.1 (E)** Com um campo obrigatório vazio, entrar com senha e pelo login corporativo (provedor falso) abre o diálogo só com os que faltam; o ITS por trás não é utilizável (o foco fica no diálogo, que não fecha sem preencher).
- **CA-RN-197.2 (I)** Com um obrigatório vazio, outra rota da API → 428 `profile_incomplete`; a própria conta, os próprios campos, as configurações públicas e sair continuam respondendo.
- **CA-RN-197.3 (I)** Tornar um campo obrigatório depois pega quem já tem conta na próxima chamada; preencher libera na hora.
- **CA-RN-197.4 (I)** Quem tem `setting.manage` não recebe o 428 e pode deixar o diálogo para depois.
- **CA-RN-197.5 (I)** A conta criada sozinha no primeiro login (RN-98) cai no diálogo; criar um usuário pela administração sem os obrigatórios é aceito.
- **CA-RN-197.6 (I)** Os tokens da integração não recebem o 428 (negativo).

**RN-198 – Cadastro incompleto (§16.13) · M25**
- **CA-RN-198.1 (E)** Com algum campo obrigatório, a lista de usuários mostra o selo (cor, ícone e texto) e a quantidade, e o filtro devolve só os incompletos; sem campo obrigatório, não aparecem nem o selo nem o filtro.
- **CA-RN-198.2 (I)** Usuário anonimizado não entra na contagem nem no filtro (negativo).
- **CA-RN-198.3 (E)** O detalhe do usuário marca os obrigatórios vazios.

**RN-199 – Privacidade (§16.13) · M25**
- **CA-RN-199.1 (I)** Sem `user.manage`, a API não devolve os valores de outra pessoa, fora o que a RN-200 mostra no seletor (negativo).
- **CA-RN-199.2 (E)** O campo sensível abre oculto no detalhe do usuário e em Minha conta e só aparece com o olho (CA-T.29).
- **CA-RN-199.3 (I)** Anonimizar apaga todos os valores da pessoa.
- **CA-RN-199.4 (I)** Desativar guarda os valores e reativar os devolve; excluir campo com valor → 409; mudar o tipo de campo com valor → 409.
- **CA-RN-199.5 (I)** A auditoria da alteração de campo sensível registra o campo, sem o valor (CA-T.29).

**RN-200 – Busca e filtro (§16.13) · M25**
- **CA-RN-200.1 (I)** A busca do seletor de pessoas encontra pela matrícula (campo pesquisável) e mostra o valor no resultado.
- **CA-RN-200.2 (I)** Campo sensível ou não pesquisável não é buscado nem mostrado no seletor (negativo; CA-T.29).
- **CA-RN-200.3 (I)** Na lista de usuários, o filtro por campo fechado e a busca por campo sensível (com `user.manage`) funcionam.

**RN-201 – Relatórios com o valor da hora do envio (§16.13) · M25**
- **CA-RN-201.1 (I)** Ao enviar, a ideia grava os campos fechados do autor; mudar o departamento do autor depois não muda a ideia nem o indicador.
- **CA-RN-201.2 (I)** Enviar em nome de outra pessoa e pela API grava os valores do autor, e não os de quem cadastrou.
- **CA-RN-201.3 (I)** Os indicadores filtram e agrupam por campo fechado, no escopo de `report.view`; a ideia sem valor aparece em "Não informado".
- **CA-RN-201.4 (I)** A exportação da fila tem uma coluna por campo fechado, com a neutralização de fórmula da RN-48.
- **CA-RN-201.5 (I)** Campo aberto nunca aparece nos indicadores nem na exportação da fila (negativo).

**RN-202 – Integração, telas, acessibilidade e Ajuda (§16.13) · M25**
- **CA-RN-202.1 (I)** Com "sai na integração", `custom_fields` aparece no módulo Usuários; sem a marcação, ou com o campo sensível, não aparece; o contrato `openapi-integration.json` só ganhou campos (CA-T.18).
- **CA-RN-202.2 (E)** Campos do usuário, o detalhe e a lista de usuários, Minha conta, o diálogo obrigatório e o filtro dos indicadores passam nos CA-T.7 e CA-T.8, operáveis pelo teclado.
- **CA-RN-202.3 (D)** A Ajuda tem "Campos personalizados do usuário" e a pergunta frequente nas duas línguas, e as RN-193 a RN-202 aparecem na lista de regras.

## 6. Consulta pública (§8) · F1

**RN-33 – Opcional, desligada por padrão**
- **CA-RN-33.1 (I)** Em instalação nova, a rota pública devolve 404 para qualquer código.
- **CA-RN-33.2 (I)** Admin liga → rota passa a funcionar; desliga → volta a 404 (mesmo para códigos já emitidos).

**RN-34 – Código não adivinhável**
- **CA-RN-34.1 (U)** Código com pelo menos 128 bits de entropia, gerado por fonte criptográfica.
- **CA-RN-34.2 (U)** 10 mil códigos gerados → nenhum repetido e nenhum padrão sequencial.

**RN-35 – O que a consulta mostra**
- **CA-RN-35.1 (I)** A resposta contém **somente** os campos permitidos; teste de contrato com lista fechada (qualquer campo extra reprova).
- **CA-RN-35.2 (I)** Nenhum e-mail, nome, comentário, anexo ou ganho aparece, mesmo em ideias com esses dados.

**RN-36 – Limite de tentativas**
- **CA-RN-36.1 (I)** Acima do limite (ex.: 30 por minuto por IP) → 429 com `Retry-After`.
- **CA-RN-36.2 (I)** Código inexistente e código desativado devolvem **resposta idêntica** (sem diferença de texto/tempo perceptível).

**RN-37 – Autor desativa**
- **CA-RN-37.1 (I)** Autor desativa → rota pública 404; reativa → volta. Outro usuário (colaborador) não consegue alterar esse ajuste.

## 7. Histórico, auditoria e privacidade (§9) · F1

**RN-38 – Histórico imutável**
- **CA-RN-38.1 (I)** Cada mudança de status, etapa, prazo, atribuição, comentário interno e reabertura gera registro com autor, data/hora e motivo.
- **CA-RN-38.2 (I)** Não existe rota nem permissão para editar ou apagar registros; um `UPDATE` ou `DELETE` direto na tabela de histórico (e na de auditoria) falha por causa do *trigger* da migração.
- **CA-RN-38.3 (I)** Histórico respeita o escopo: o autor não vê eventos de comentários internos.

**RN-39 – Auditoria do sistema**
- **CA-RN-39.1 (I)** Login com sucesso, falha, criação/edição de usuário, perfil e configuração geram registro; somente admin lê.
- **CA-RN-39.2 (I)** Nenhuma senha, token ou segredo aparece no log (varredura por padrão no teste).

**RN-40 – Anonimização (LGPD)**
- **CA-RN-40.1 (I)** Admin anonimiza usuário desativado → nome, e-mail e foto são substituídos; ideias, etapas e histórico permanecem; o autor aparece como "Ex-colaborador".
- **CA-RN-40.2 (I)** Anonimizar usuário **ativo** → recusa. A operação é irreversível e fica no log de auditoria.

**RN-41 – Desativar, não excluir**
- **CA-RN-41.1 (I)** Usuário desativado não faz login; sessões abertas são invalidadas.
- **CA-RN-41.2 (I)** Não existe exclusão física de usuário com vínculos; ideias antigas continuam apontando para ele.

**RN-42 – Senhas**
- **CA-RN-42.1 (U)** Política mínima configurável (tamanho, classes de caracteres) aplicada em cadastro e troca.
- **CA-RN-42.2 (I)** Após N falhas seguidas → bloqueio temporário; mensagem de erro **não** diferencia "usuário inexistente" de "senha incorreta".
- **CA-RN-42.3 (I)** Recuperação: link de uso único, com prazo (ex.: 1 h); segundo uso e uso após o prazo → recusa. Nunca se envia a senha.
- **CA-RN-42.4 (U)** Senha armazenada somente como hash adaptativo (bcrypt ou argon2); nunca em texto.

**RN-43 – Primeiro acesso**
- **CA-RN-43.1 (I)** Banco vazio → só o assistente de instalação responde; conclui criando o admin.
- **CA-RN-43.2 (I)** Depois de instalado, o assistente devolve 404/403 (não dá para criar outro admin por ele).
- **CA-RN-43.3 (I)** Não existe usuário ou senha padrão após a instalação nem no código-fonte (varredura).
- **CA-RN-43.4 (I)** Instalação em inglês → os perfis de fábrica ficam com o nome e a descrição em inglês e as mesmas permissões; um perfil cuja descrição ou nome já foi editado continua como está; instalação em pt-BR mantém os nomes em português.

**RN-91 – Foto do perfil (§9)**
- **CA-RN-91.1 (I)** Enviar JPG, PNG ou WebP dentro do limite → aceita; a imagem é salva já redimensionada em WebP, sem metadados EXIF (verificável por leitura do arquivo gravado).
- **CA-RN-91.2 (I)** Arquivo de outro tipo (ex.: SVG, PDF, executável renomeado como `.jpg`) → 415; acima do limite → 413. O tipo é verificado pelo conteúdo, não pela extensão.
- **CA-RN-91.3 (I)** Trocar a foto apaga o arquivo anterior; há no máximo 1 registro por usuário.
- **CA-RN-91.4 (I)** `colab1` não altera a foto de `colab2` (403); `admin` altera.
- **CA-RN-91.5 (I)** A rota da foto exige login e respeita o opt-out de nome (RN-70): para quem optou, devolve o avatar padrão em murais e no Hall. A consulta pública nunca inclui foto (CA-RN-35.2).
- **CA-RN-91.6 (I)** Anonimizar o usuário apaga o registro e o arquivo (CA-RN-40.1).

## 8. Indicadores e relatórios (§10) · F1 (RN-44 a RN-49), F2 (RN-81 a RN-83)

**RN-44 – Painel por período**
- **CA-RN-44.1 (I)** Com fixture conhecida (5 enviadas, 2 em análise, 1 em andamento, 1 implementada, 1 não autorizada), as contagens batem; filtro por período e entidade reduz corretamente.
- **CA-RN-44.2 (I)** Ideias convergidas **não** são contadas (RN-84); arquivadas também não.

**RN-45 – Indicadores de processo**
- **CA-RN-45.1 (U)** Tempo médio de triagem = média de (decisão − envio) apenas das já decididas; sem dados → "sem dados", não zero.
- **CA-RN-45.2 (U)** Taxa de aprovação = aprovadas ÷ decididas; % em atraso = atrasadas ÷ em andamento.

**RN-46 – Ganho acumulado**
- **CA-RN-46.1 (I)** Soma apenas ganhos informados; ideias sem ganho não entram como zero na média.

**RN-47 – PDF da ideia**
- **CA-RN-47.1 (I)** O PDF contém dados, etapas e status; histórico só se solicitado e se o usuário tiver permissão; comentários internos nunca saem para o autor.
- **CA-RN-47.2 (I)** Quem não enxerga a ideia (RN-01) recebe 404 ao pedir o PDF.

**RN-48 – Exportação CSV/Excel**
- **CA-RN-48.1 (I)** A exportação respeita filtros e escopo; contém só as linhas que o usuário veria na tela.
- **CA-RN-48.2 (U)** Valores iniciados por `=`, `+`, `-`, `@` são neutralizados (injeção de fórmula).

**RN-49 – Gestor só vê o seu escopo**
- **CA-RN-49.1 (I)** Gestor da Unidade A: indicadores só de A e descendentes; consultar B por parâmetro → 403/404.

**RN-81 – Engajamento (F2)**
- **CA-RN-81.1 (U)** Participação = colaboradores ativos com ≥1 ideia no período ÷ colaboradores ativos; taxa de implementação = implementadas ÷ enviadas; denominador zero → "sem dados".

**RN-82 – ROI (F2)**
- **CA-RN-82.1 (U)** ROI = ganho **validado** ÷ custo; ganho apenas declarado não entra; custo zero ou ausente → "não calculável".

**RN-83 – Responsivo e PWA (F2)**
- **CA-RN-83.1 (E)** Em viewport 360×640, o envio de ideia é concluído sem rolagem horizontal.
- **CA-RN-83.2 (E)** O app é instalável (manifesto e service worker válidos, auditoria Lighthouse PWA sem erro bloqueante).

## 9. Campanhas (§11) · F2

**RN-50 – Cadastro**
- **CA-RN-50.1 (I)** Campanha exige nome, período (fim ≥ início) e meta quando o tipo da meta é numérico; sem `campanha.gerenciar` → 403.
- **CA-RN-50.2 (I)** Estados válidos: rascunho → ativa → encerrada; encerrada não volta a ativa.

**RN-51 – Vincular**
- **CA-RN-51.1 (I)** Só campanhas **ativas**, dentro do período e cujas entidades/categorias-alvo incluam a ideia, aparecem para escolher.
- **CA-RN-51.2 (I)** Enviar sem campanha continua funcionando.

**RN-52 – Painel**
- **CA-RN-52.1 (I)** Contagens e ganho acumulado versus meta batem com a fixture; percentual da meta atingido calculado corretamente.

**RN-53 – Encerrar**
- **CA-RN-53.1 (I)** Ao encerrar, é gerado o resumo e a lista de candidatas ao Hall (apenas Implementadas, RN-73); nada entra no Hall automaticamente.

## 10. Triagem em volume (§12) · F2

**RN-54 – SLA de triagem**
- **CA-RN-54.1 (U)** Ideia Enviada há 11 dias com SLA de 10 → atrasada; há 10 dias → ainda no prazo.
- **CA-RN-54.2 (I)** O analista e o gestor recebem **um** alerta por ideia atrasada; o autor vê a previsão de retorno desde o envio.
- **CA-RN-54.3 (U)** Dias contados no fuso e no calendário de dias úteis, se a instalação configurar.

**RN-55 – Atribuição automática**
- **CA-RN-55.1 (I)** Regra "categoria Segurança → analista X": nova ideia dessa categoria já nasce atribuída a X.
- **CA-RN-55.2 (U)** Regras conflitantes: vale a mais específica; empate → a de maior prioridade configurada; sem regra → fila geral.
- **CA-RN-55.3 (I)** O analista pode reatribuir manualmente; o histórico registra.

**RN-56 – Priorização**
- **CA-RN-56.1 (I)** Impacto e esforço aceitam apenas 1 a 5; fora disso → 422.
- **CA-RN-56.2 (U)** Ordenação da fila por (impacto ÷ esforço) com desempate por data de envio; sem avaliação aparece depois das avaliadas.
- **CA-RN-56.3 (I)** A pontuação nunca muda o status por si só.

**RN-57 – Semelhantes**
- **CA-RN-57.1 (I)** Título "Trocar lâmpada do corredor" sugere "Substituição de lâmpada no corredor B" (mesma entidade) e não sugere ideia sem relação.
- **CA-RN-57.2 (I)** As sugestões respeitam o escopo: nunca revelam ideias que o usuário não pode ver (RN-01). No caso de ideias visíveis em outra entidade, apenas o título é exposto, se a organização permitir.
- **CA-RN-57.3 (E)** Colaborador pode escolher "Apoiar" ou "Enviar mesmo assim".

**RN-58 – Linha do tempo**
- **CA-RN-58.1 (I)** O autor vê cada mudança de status com responsável (nome) e data; não vê eventos internos.

**RN-59 – Lote e filtros salvos**
- **CA-RN-59.1 (I)** Ação em lote em 20 ideias: respeita permissão e escopo item a item; resultado mostra quais falharam e por quê; é **atômica por item**, não por lote.
- **CA-RN-59.2 (I)** Recusar em lote exige a justificativa e a aplica a todas; cada autor é notificado.
- **CA-RN-59.3 (I)** Filtro salvo é privado do usuário e não amplia seu escopo.

### 10.1 Convergência (§12.1) · F2

**RN-84 – Principal vigente**
- **CA-RN-84.1 (U)** Entre duas ideias semelhantes, a de menor `enviada_em` é a principal; com datas iguais, a de menor identificador.
- **CA-RN-84.2 (I)** A convergida sai das filas, do painel e dos indicadores (RN-44) e não tem fluxo próprio (status, etapas).
- **CA-RN-84.3 (I)** Convergência em cadeia (A converge em B, B em C) → A e B apontam para C; **nunca** ciclos (A↔B → 422).
- **CA-RN-84.4 (I)** Uma ideia que já é principal de outras e é convergida em outra mais antiga leva as convergidas junto.

**RN-85 – Como converge**
- **CA-RN-85.1 (I)** `colab2` escolhe "Apoiar" na ideia de `colab1` → vira co-autor, sem ideia nova criada.
- **CA-RN-85.2 (I)** `analista` converge com justificativa → ok; sem justificativa → 422; sem `ideia.convergir` → 403.
- **CA-RN-85.3 (I)** Nenhum processo automático converge sozinho (varredura do job de sugestão: só gera sugestões, não altera ideias).

**RN-86 – Co-autoria**
- **CA-RN-86.1 (I)** Após converter, a principal lista `colab2` como co-autor; o autor permanece o da mais antiga.
- **CA-RN-86.2 (I)** O texto original da ideia convergida é preservado e visível a analista/gestor; o autor da principal **não** vê o texto como edição, só o resumo ("mais 1 pessoa pediu").
- **CA-RN-86.3 (I)** Entrada como co-autor: permitida enquanto a principal estiver em Enviada, Em análise ou Em andamento; para Implementada/Não autorizada, só por analista.
- **CA-RN-86.4 (I)** Colaborador não pode apoiar a própria ideia, nem apoiar duas vezes a mesma ideia.

**RN-87 – Transparência**
- **CA-RN-87.1 (I)** Co-autor recebe notificação ao entrar e a cada mudança de status da principal; a lista dele mostra "Convergida com <identificador>".
- **CA-RN-87.2 (U)** O contador de solicitantes da principal = 1 + número de co-autores por convergência; alimenta a priorização (RN-56).

**RN-88 – Reversão e efeitos do resultado**
- **CA-RN-88.1 (I)** Desfazer convergência (analista/admin): a ideia volta com fluxo próprio e a data de envio original; histórico em ambas as ideias; co-autoria removida.
- **CA-RN-88.2 (I)** Principal é recusada → as convergidas ficam com o mesmo resultado, cada co-autor recebe a mesma justificativa, **sem duplicar** a notificação para quem é autor e co-autor.
- **CA-RN-88.3 (I)** Principal reaberta → as convergidas voltam a acompanhar.
- **CA-RN-88.4 (I)** Desfazer exige permissão; colaborador comum não desfaz.

**RN-89 – Reconhecimento (F3 para pontos/Hall)**
- **CA-RN-89.1 (U)** Com divisão padrão 50% autor e 50% dividido entre os co-autores: 1 autor + 2 co-autores, 100 pontos → 50, 25, 25; arredondamento sem perda (a soma fecha em 100).
- **CA-RN-89.2 (I)** Com a opção "convergência concede co-autoria" desligada, quem convergiu não ganha pontos nem aparece no Hall.
- **CA-RN-89.3 (I)** O Hall exibe todos os co-autores, respeitando o opt-out de cada um (RN-70).

## 11. Resultado e PDCA (§13) · F2

**RN-60 – Modelo PDCA**
- **CA-RN-60.1 (I)** Ao aprovar escolhendo PDCA → 4 etapas-modelo (P, D, C, A) em sequência; o fluxo das etapas continua obedecendo a RN-12 a RN-14.
- **CA-RN-60.2 (I)** Escolhendo etapas livres → nenhuma etapa PDCA é criada.

**RN-61 – Medição**
- **CA-RN-61.1 (U)** Com linha de base 100, meta 80 e obtido 82 (meta de redução) → atingimento 90% (parcial); obtido ≤ 80 → 100%.
- **CA-RN-61.2 (I)** Sem meta cadastrada, o sistema só exibe a variação, sem percentual de atingimento.

**RN-62 – Ganho**
- **CA-RN-62.1 (I)** Estimado só na triagem; realizado só na conclusão; moeda sempre presente; periodicidade ∈ {único, mensal, anual}.
- **CA-RN-62.2 (U)** Ganho anualizado correto: mensal × 12, anual × 1, único × 1.
- **CA-RN-62.3 (I)** Valores negativos recusados; custo de implementação opcional.

**RN-63 – Validação**
- **CA-RN-63.1 (I)** `validador` valida → estado "validado" com quem/quando; analista sem `ganho.validar` → 403.
- **CA-RN-63.2 (I)** Alterar o valor realizado depois de validado volta o ganho para "declarado" e registra no histórico.
- **CA-RN-63.3 (I)** Indicadores oficiais e o Hall com selo usam apenas o validado.

**RN-64 – Padronização e replicar**
- **CA-RN-64.1 (I)** Ao implementar, registrar o padrão adotado e marcar "replicável".
- **CA-RN-64.2 (I)** Replicar cria uma nova ideia **Enviada** em outra entidade vinculada à origem (sem copiar ganho nem anexos privados); a nova ideia segue o fluxo completo.

**RN-65 – Sustentação**
- **CA-RN-65.1 (I)** Com revisão configurada em 90 dias: no dia 90 após implementar, o responsável recebe lembrete; confirmar ou contestar grava no histórico; contestar não reabre a ideia automaticamente.

## 12. Reconhecimento (§14) · F3

**RN-66 – Pontos**
- **CA-RN-66.1 (I)** Cada evento pontua uma vez (idempotente se o evento for reprocessado); pesos editáveis valem daqui para frente, sem recalcular o passado.
- **CA-RN-66.2 (I)** Com o módulo desligado, nenhum ponto é registrado nem exibido.
- **CA-RN-66.3 (I)** Virada de temporada zera o ranking da temporada e preserva o histórico.

**RN-67 – Níveis**
- **CA-RN-67.1 (U)** Faixas 0–99, 100–299, 300+: 99 → nível 1; 100 → nível 2; 300 → nível 3.
- **CA-RN-67.2 (I)** Mudança de nível gera notificação ao usuário.

**RN-68 – Conquistas**
- **CA-RN-68.1 (I)** "Primeira ideia" é concedida uma única vez, após o primeiro envio; conquistas não são concedidas retroativamente sem uma ação explícita do admin.

**RN-69 – Co-autoria básica (entregue na F2)**
- **CA-RN-69.1 (I)** Uma ideia aceita vários participantes com papéis (autor, executor, co-autor); precisa de pelo menos 1 autor.
- **CA-RN-69.2 (U)** A divisão de pontos soma exatamente 100% (RN-89.1).
- **CA-RN-69.3 (I)** Só quem tem permissão na ideia pode adicionar ou remover participantes; mudanças ficam no histórico.

**RN-70 – Privacidade**
- **CA-RN-70.1 (I)** Usuário com opt-out não aparece nominalmente em mural, ranking ou Hall; aparece como "Colaborador anônimo".
- **CA-RN-70.2 (I)** Ranking individual desligado pela organização → rota e tela inexistentes; ranking por entidade continua.

**RN-71 – Recompensas fora do sistema**
- **CA-RN-71.1 (I)** Não existe fluxo de pagamento; "recompensa concedida" é só um registro informativo com data e texto, sem valor monetário obrigatório.

## 13. Hall de destaques (§15) · F3

**RN-72 – Como uma ideia entra**
- **CA-RN-72.1 (I)** Sem `hall.destacar` → 403; com permissão, exige justificativa e período.
- **CA-RN-72.2 (I)** Critério automático gera **sugestão** (candidata); nada aparece no Hall sem ação humana, a menos que o admin habilite a entrada automática.
- **CA-RN-72.3 (I)** Nova candidata não é repetida se já foi recusada pelo curador (guarda a decisão).

**RN-73 – Quem pode ser destaque**
- **CA-RN-73.1 (I)** Implementada → pode; Não autorizada → 422 sempre; Em andamento → só com a opção ligada; convergida → destaca a principal, nunca a convergida.

**RN-74 – Consentimento**
- **CA-RN-74.1 (I)** Antes de publicar, o autor (e cada co-autor) é notificado; recusando, a ideia aparece sem nome/foto; sem resposta no prazo, vale o padrão da instalação (aparecer sem nome).
- **CA-RN-74.2 (I)** Ideia anônima nunca mostra autor.

**RN-75 – Cartão**
- **CA-RN-75.1 (I)** O cartão tem os campos definidos; o ganho só aparece com "mostrar ganho no Hall" ligado **e** validado.
- **CA-RN-75.2 (I)** Nada de anexos privados, comentários internos ou dados pessoais além do permitido.

**RN-76 – Curtidas**
- **CA-RN-76.1 (I)** Uma curtida por usuário por ideia; curtir de novo remove (ou é idempotente); curtir a própria ou a de que é co-autor → 422.
- **CA-RN-76.2 (I)** Curtidas não alteram status nem a decisão de aprovação (nenhuma regra de fluxo lê o contador).
- **CA-RN-76.3 (I)** Com a opção desligada, a rota devolve 404 e o contador não é exibido.
- **CA-RN-76.4 (I)** Usuário só curte ideias que pode ver (RN-01).

**RN-77 – Elogios com moderação**
- **CA-RN-77.1 (I)** Analista oculta elogio; oculto some para todos menos moderadores; autor do elogio e motivo registrados.

**RN-78 – Validade**
- **CA-RN-78.1 (I)** No fim do período, o destaque vai ao Hall da fama (job idempotente); revogar exige motivo e vai ao histórico.

**RN-79 – Escopo**
- **CA-RN-79.1 (I)** Destaque da entidade só aparece para quem enxerga essa entidade; destaque da organização aparece para todos os logados; permissões distintas (`hall.destacar.entidade` e `hall.destacar.organizacao`).

**RN-80 – Notificação e exportação**
- **CA-RN-80.1 (I)** Autor notificado ao ser destacado; exportação em imagem/PDF respeita RN-74 e RN-75.
- **CA-RN-80.2 (I)** O link interno só abre para quem pode ver o destaque.

---

## 14. Testes transversais (valem para todo o sistema)

| ID | Critério | Nível |
|---|---|---|
| CA-T.1 | **Idempotência de jobs:** reexecutar alertas, resumo diário, expiração de destaque e sustentação não duplica efeitos | I |
| CA-T.2 | **Concorrência:** duas ações simultâneas na mesma ideia (aprovar e recusar) → só uma vale; a outra recebe 409 | I |
| CA-T.3 | **Fuso e datas:** todas as regras de prazo usam o fuso da instalação; virada de dia testada | U |
| CA-T.4 | **Injeção e XSS:** campos de texto com `<script>` e SQL são tratados como texto em tela, PDF, e-mail e CSV | I/E |
| CA-T.5 | **Autorização por objeto (IDOR):** trocar o id na URL nunca dá acesso a ideia de fora do escopo | I |
| CA-T.6 | **Sem segredos:** varredura de repositório e logs sem credenciais, tokens ou senha padrão | CI |
| CA-T.7 | **i18n:** pt-BR e en completos; texto sem tradução é erro no CI | U |
| CA-T.8 | **Acessibilidade:** telas principais sem violações críticas (axe) e navegáveis por teclado | E |
| CA-T.9 | **Migrações:** subir banco vazio com as migrações dá o mesmo esquema do modelo; reverter a última migração funciona | I |
| CA-T.10 | **Paginação e desempenho:** listagens paginadas; 10 mil ideias com resposta de listagem em < 500 ms (orçamento a validar) | I |
| CA-T.11 | **Observabilidade sem dado pessoal:** nenhuma tabela `ops_*`, log ou resposta de `/api/ops/*` contém URL crua, query string, e-mail ou identificador de pessoa ou de ideia | I |
| CA-T.12 | **Login corporativo e envio pela Microsoft e pelo Google sem vazamento:** token, código de autorização, segredo do cliente, chave da conta de serviço, JWT assinado, claims brutos do provedor e o corpo das respostas do Graph e do Google nunca aparecem em log, auditoria, resposta da API, URL de retorno, e-mail de teste ou tela | I |
| CA-T.13 | **Token de integração sem vazamento:** o token, o hash, o cabeçalho `Authorization` e o valor mostrado na criação nunca aparecem em log, auditoria, métrica, tabela de consumo, resposta de erro, URL ou tela depois da criação; as exceções de erro e os `401` não repetem o que foi enviado | I |
| CA-T.14 | **Nada fora do escopo:** com duas integrações de escopos disjuntos (A e B) e dados nos dois, uma varredura de **todas** as rotas de `/integration/v1` mostra que cada uma só recebe o que é do seu escopo, e o detalhe por identificador do outro escopo dá 404 | I |
| CA-T.15 | **Superfícies separadas:** o token de integração não vale em `/api` (401), o cookie de sessão não vale em `/integration` (401), e o `openapi.json` da API interna não contém nenhum caminho de integração | I |
| CA-T.16 | **Webhooks sem vazamento:** o segredo, a assinatura e o caminho e a consulta do endereço nunca aparecem em log, auditoria, métrica, resposta de erro nem no registro de entregas; o aviso enviado não contém dado pessoal (molde: CA-T.12 e CA-T.13) | I |
| CA-T.17 | **Destino bloqueado nunca é alcançado:** com um receptor local que registra toda conexão e um resolvedor de teste, nenhum destino bloqueado (loopback, link local, metadados de nuvem, fora da lista) recebe conexão, nem por redirecionamento nem por DNS trocado; o receptor de teste só alcança o loopback com `NODE_ENV=test` | I |
| CA-T.18 | **A escrita nunca decide:** uma bateria de chamadas de escrita com um token de integração não muda situação, não aprova, recusa, valida ganho, arquiva, exclui, converge nem destaca, e não mexe em usuários, perfis, entidades, categorias nem configurações; o estado dessas coisas no banco é o mesmo antes e depois (molde: CA-T.14) | I |
| CA-T.19 | **Escrita sem duplicar:** repetir, ou disparar em paralelo, qualquer gravação com a mesma `Idempotency-Key` nunca grava duas vezes (ideia, comentário, histórico, aviso) | I |
| CA-T.20 | **Sensível não vaza pela tela:** com os campos da RN-135 ocultos, uma varredura do texto, dos atributos e do armazenamento da página não acha o valor; revelado e ocultado de novo, o valor some (molde: CA-T.12) | E |
| CA-T.21 | **Banco fora do alcance de fora:** o Compose base não publica porta do banco, a rede do banco é interna e só banco, API e worker participam; a exceção de desenvolvimento só escuta em `127.0.0.1` | I |
| CA-T.22 | **Foto do provedor sem vazamento e sem destino livre:** o token de acesso do provedor nunca aparece em log, auditoria, banco ou resposta; a busca da foto só conecta a `graph.microsoft.com` e `*.googleusercontent.com` por `https`, e qualquer outro endereço (inclusive por redirecionamento) não recebe conexão (molde: CA-T.12 e CA-T.17) | I |
| CA-T.23 | **Anexo na tela não executa:** nenhum arquivo cujo conteúdo não seja imagem PNG, JPEG, WebP ou GIF ou vídeo MP4 ou WebM é entregue com `inline`; a resposta de exibição sempre leva `nosniff` e `sandbox` | I |
| CA-T.24 | **O mural não abre a ideia:** com ideias publicadas de várias entidades, participantes com e sem consentimento e comentários internos na ideia, uma varredura de **todas** as rotas do mural, como um colaborador de outra entidade, não acha descrição, solução, ganho, anexo, comentário da ideia nem o nome, o identificador ou a foto de participante sem consentimento (molde: CA-T.14) | I |
| CA-T.25 | **Saldo e estoque nunca gastos duas vezes:** uma bateria de pedidos, cancelamentos, recusas e ajustes simultâneos da mesma pessoa e do mesmo item termina com o saldo igual à soma do extrato, nenhum saldo usado duas vezes e o estoque nunca abaixo de zero (molde: CA-T.19) | I |
| CA-T.26 | **Extrato que não se reescreve:** o banco recusa `UPDATE`, `DELETE` e `TRUNCATE` nas linhas do extrato da loja, como no log de auditoria (molde: a imutabilidade da auditoria) | I |
| CA-T.27 | **Telas de acesso sem nada de fora:** com cada layout e cada tipo de fundo, as telas de acesso não fazem nenhuma requisição a outro domínio (fontes, imagens, vídeo e scripts vêm da própria instalação), e a política de segurança de conteúdo continua só com a própria origem | E |
| CA-T.28 | **Link de aprovação que não vaza:** o banco guarda só o resumo criptográfico dos links de aprovação; um link inventado, alterado, vencido, usado ou cancelado não abre nada; a página e os anexos do link mostram só o que o pedido congelou; e uma cópia do banco não permite montar nenhum link válido | I |
| CA-T.29 | **Campo sensível que não vaza:** o valor de um campo personalizado marcado como dado sensível não aparece na tela sem o olho, na busca nem nos resultados do seletor de pessoas, na exportação, na integração, no log de auditoria nem nos logs do servidor | I/E |

## 15. Matriz de cobertura por fase

| Fase | RNs cobertas | Quantidade de critérios |
|---|---|---|
| **F1 – Núcleo** | RN-01 a RN-49, RN-90, RN-91 | 134 |
| **F2 – Resultado e foco** | RN-50 a RN-65, RN-69 (básica), RN-81 a RN-89 | 59 |
| **F3 – Reconhecimento** | RN-66 a RN-80 | 29 |
| **Operação (M12)** | RN-92 a RN-94 | 24 |
| **Acesso corporativo (M13)** | RN-95 a RN-98 | 40 |
| **E-mail pela Microsoft (M14)** | RN-99, RN-100 | 19 |
| **E-mail pelo Google (M15)** | RN-101 | 12 |
| **Integrações (M16)** | RN-102 a RN-116 | 102 |
| **Webhooks de saída (M17)** | RN-117 a RN-125 | 54 |
| **Escrita pela API (M18)** | RN-126 a RN-134 | 50 |
| **Acabamento da v1.0 (M19)** | RN-135 a RN-141 | 43 |
| **Pessoas e anexos (M20 · v1.1)** | RN-142 a RN-147 | 44 |
| **Mural de ideias (M21 · v1.2)** | RN-148 a RN-158 | 52 |
| **Loja e bonificação (M22 · v1.3)** | RN-159 a RN-173 | 56 |
| **Avisos na tela e tela de login (M23 · v1.4)** | RN-174 a RN-182 | 44 |
| **Aprovação de outras áreas (M24 · v1.5)** | RN-183 a RN-192 | 39 |
| **Campos personalizados do usuário (M25 · v1.6)** | RN-193 a RN-202 | 39 |
| **Transversais** | CA-T.1 a CA-T.29 | 29 |

## 16. Lacunas detectadas ao escrever os critérios

Pontos que as regras não definem totalmente. Adotei o padrão entre parênteses; me diga se prefere outro.

1. **Comentar em ideia encerrada** (RN-08): adotei que **pode**, para o autor agradecer ou o analista complementar, sem alterar o conteúdo.
2. **Texto da ideia convergida** (RN-86): o autor da principal vê só "mais 1 pessoa pediu"; o texto completo fica com analista e gestor.
3. **Implementar exige resultado em texto** (RN-07): o resultado numérico/ganho continua opcional.
4. **Aprovar direto de "Enviada"** (RN-06 e D3): permitido como atalho, mas gera as duas transições no histórico.
5. **Prazo em dias úteis** (RN-54): opcional por instalação; sem calendário de feriados na v1, só fins de semana.
6. **Opt-out sem resposta** (RN-74): se o autor não responde no prazo, aparece **sem nome** (mais seguro para a privacidade).
7. **Limites numéricos** (tentativas de login, taxa da consulta pública, TTL de recuperação): valores sugeridos nos critérios são **configuráveis**; os números exatos são padrão inicial.
8. **Integrações (M16)**: adotei por padrão, sujeito a veto: (a) a chave geral só liga com o endereço do sistema em HTTPS fora de `localhost` (RN-102, por analogia com o SSO); (b) token de 90 dias sugerido na tela, máximo 365, janela de rotação de 24 h (máximo 72 h), no máximo 2 tokens ativos; (c) limite de 60 chamadas por minuto (até 600) e 20 tentativas inválidas por IP por minuto; (d) até 20 IPs ou faixas por integração; (e) detalhe de ideia fora do escopo dá **404** (não revela que existe) e módulo ligado mas fora da integração dá **403**; (f) campanha sem entidade-alvo vale para a organização toda; (g) quem sincroniza não recebe aviso de exclusão física de ideia no M16 (arquivada vem marcada; a exclusão física fica para os webhooks do M17); (h) o elogio do Hall sai sem autor; (i) a documentação da tela é só de leitura, sem "Experimentar" (decisão do dono, 11/11/2026), e as descrições do contrato existem em inglês (`description`) e em pt-BR (`x-description-pt-BR`).
9. **Webhooks (M17) e escrita (M18)**: adotei por padrão, sujeito a veto: (a) até 5 assinaturas por integração e até 50 destinos permitidos; (b) a primeira tentativa e até 8 repetições em cerca de 46 horas (30 s, 2 min, 10 min, 1 h, 3 h, 6 h, 12 h, 24 h) e suspensão automática depois de 20 falhas definitivas seguidas; (c) 10 segundos de espera, aviso de até 8 KB e leitura de até 64 KB da resposta; (d) quem recebe recusa carimbo com mais de 5 minutos; (e) segredo de assinatura com validade de até 365 dias e rotação de 24 a 72 horas; (f) o aviso do webhook é **mínimo** e a entrega é ao menos uma vez, sem ordem garantida; (g) destino interno só funciona se estiver na lista de destinos permitidos (decisão do dono, 11/11/2026), e loopback, link local e metadados de nuvem ficam sempre bloqueados; (h) na escrita, a autoria vem do e-mail e **recusa** quando a pessoa não existe ou não poderia enviar na entidade (a alternativa, aceitar sem autor, não foi escolhida); (i) o comentário sai em nome da integração e é sempre público; (j) referência externa não muda em ideia encerrada (RN-08); (k) idempotência de 24 horas e limite de escrita de 30 chamadas por minuto, fixo no código; (l) as respostas de escrita são mínimas, então os módulos de escrita não exigem os de leitura.
10. **Mural (M21)**: adotei por padrão, sujeito a veto: (a) o participante (autor e coautores) **não reage** à própria ideia, para a lista de quem reagiu não revelar quem é; (b) o opt-out de nome (RN-70) vale para ser mostrado como autor ou destaque, **não** esconde quem reage ou comenta (a tela avisa); (c) coautor sem consentimento aparece como "Coautor da ideia"; (d) comentário em texto simples de até 2000 caracteres (o editor da RN-136 fica só nos textos da ideia); (e) limites de 30 comentários e 20 envios a colegas por hora por pessoa; (f) retirar exige motivo; (g) a lista do mural vem em páginas de 20 com "Carregar mais"; (h) a fila de denúncias fica no menu da equipe de melhoria ("Denúncias do mural").
11. **Loja (M22)**: adotei por padrão, sujeito a veto: (a) `store.manage` vale para a loja inteira e, de fábrica, só o Administrador a tem; (b) ninguém decide o próprio pedido nem ajusta o próprio saldo; (c) uma unidade por pedido; (d) o limite por pessoa conta períodos do calendário (mês, trimestre, semestre, ano) no fuso da instalação; (e) com validade, os gastos consomem primeiro os créditos mais antigos, e mudar a validade vale para os créditos antigos; (f) desligar o reconhecimento exige desligar a loja antes; (g) item com pedidos só se desativa, sem pedidos pode ser excluído; (h) a pessoa só cancela o próprio pedido enquanto pendente; (i) o módulo de integração da loja traz o nome da pessoa e o e-mail só com a opção de e-mail.
12. **Avisos na tela e tela de login (M23)**: adotei por padrão, sujeito a veto: (a) até 3 avisos visíveis, com 4 s no sucesso, 6 s na atenção e na informação e 8 s no erro; (b) ações cujo resultado a tela já mostra na hora (reagir, marcar lida, tema, idioma, arrastar) não mostram sucesso, mas mostram erro; (c) a confirmação que traz algo para copiar (link de senha, segredo, token) continua na tela; (d) o cartão central é o padrão de fábrica; (e) imagem até 10 MB (gravada com até 2560 px) e vídeo até 20 MB; (f) o texto sem contraste sobre o fundo ganha uma placa translúcida (a partir de 35%), em vez de ir para o formulário (ajuste do dono, 16/11/2026); (g) no celular, a capa no lugar do vídeo; (h) a sugestão de tradução usa o tradutor do próprio navegador quando existe, e o servidor nunca chama serviço de tradução; (i) o assistente de instalação e a consulta pública ficam fora dos layouts.
13. **Aprovação de outras áreas (M24)**: adotei por padrão, sujeito a veto: (a) até 10 aprovadores por pedido e um pedido aberto por ideia; (b) prazo de 1 a 60 dias, 14 de fábrica; (c) aprovação em paralelo, com o "sim" de todos; (d) lembretes 3 dias antes e no dia, no máximo dois; (e) o link guarda só o resumo criptográfico, vale até o prazo e uma vez; (f) o código de confirmação vale 10 minutos e 5 tentativas; (g) o autor vê só que há aprovação pendente e o resultado; (h) e-mail fora dos domínios da empresa gera aviso e, opcionalmente, é recusado; (i) "seguir sem a aprovação" com justificativa só existe no modo devolver; (j) quem pede é quem tem `idea.triage` na entidade da ideia, sem permissão nova.
14. **Campos personalizados do usuário (M25)**: adotei por padrão, sujeito a veto: (a) até 8 campos **ativos** (desativar libera a vaga e guarda os valores); (b) nome até 60 caracteres e dica até 200, em pt-BR e, opcionalmente, em inglês; (c) texto até 200 caracteres; até 100 opções de até 80 caracteres, com escolha única; (d) quem configura os campos e altera os valores dos outros é quem tem `user.manage`, sem permissão nova; (e) quem tem `setting.manage` pode adiar o diálogo obrigatório; (f) "pesquisável" ligado de fábrica nos campos de texto e de máscara que não são sensíveis; (g) "sai na integração" desligado de fábrica, e dado sensível nunca sai; (h) anonimizar apaga os valores da pessoa, mas as ideias guardam o valor dos campos fechados da hora do envio; (i) os indicadores usam só campos fechados.
