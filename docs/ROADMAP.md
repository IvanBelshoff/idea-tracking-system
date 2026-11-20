# Roadmap

O ITS evolui em versões pequenas, com versionamento semântico e uma só versão para o backend, o frontend e a Ajuda. O que muda em cada versão fica no [CHANGELOG](../CHANGELOG.md); as regras de negócio e os critérios de aceite estão em [REGRAS-DE-NEGOCIO.md](REGRAS-DE-NEGOCIO.md) e [CRITERIOS-DE-ACEITE.md](CRITERIOS-DE-ACEITE.md).

## O que a 1.0 tem

### Núcleo

- Instalação por assistente, sem usuário ou senha padrão; perfis e permissões por entidade, numa árvore de entidades.
- Envio de ideias, triagem, aprovação e execução em etapas com prazo, anexos e histórico completo.
- Notificações no sino e por e-mail (SMTP, Microsoft 365 ou Google Workspace), com resumo diário.
- Consulta pública opcional, por código de acompanhamento.
- Indicadores, relatórios, exportação em CSV e PDF.

### Resultado e foco

- Triagem em volume, regras de atribuição e prazo de retorno.
- Ideias parecidas: busca de semelhantes e convergência.
- Ganho declarado e validado, padronização e campanhas.

### Reconhecimento

- Pontos, níveis, conquistas e o Hall de destaques, sempre com o consentimento de quem aparece.
- Mural de ideias com reações e conversa moderada.
- Loja de pontos e bonificações, com aprovação da equipe e a lista para o RH.

### Organização e operação

- Identidade visual da organização, tela de login própria e campos personalizados do usuário.
- Login corporativo com Microsoft e Google.
- Aprovação de outras áreas, com ou sem usuário no ITS.
- Observabilidade com saúde, métricas e alertas.
- API de integração (leitura e escrita) e webhooks de saída.
- Ajuda interativa em português e inglês, com simuladores.

## Para depois da 1.0

Ideias registradas, sem data. Elas entram numa versão quando houver uma regra escrita e critérios de aceite para ela.

- **Transparência na entidade:** o colaborador ver as ideias aprovadas da própria entidade, não só as suas.
- **Exportação em imagem** dos relatórios e do Hall (hoje é PDF).
- **Mais provedores de e-mail**, como SES e Resend.
- **Mais formas de login corporativo:** LDAP, OIDC genérico (Okta, Keycloak) e SCIM, com a desativação automática de contas.
- **Fluxo de aprovação configurável** (hoje o fluxo é fixo).
- **Várias organizações no mesmo banco** (hoje é uma instalação por organização).
- **Semelhantes por IA**, além da busca textual.

## Como propor

Abra uma *issue* descrevendo o problema que a mudança resolve, de preferência ligado a uma regra (RN) existente ou com a proposta de uma nova. Veja também o [CONTRIBUTING](../CONTRIBUTING.md).
