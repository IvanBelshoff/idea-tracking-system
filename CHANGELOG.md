# Histórico de versões

O ITS segue o [versionamento semântico](https://semver.org/lang/pt-BR/), com uma só versão para o backend, o frontend e a Ajuda. O formato é o do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [1.0.1] - 2026-11-20

### Adicionado

- **Página inicial do site público** (<https://ivanbelshoff.github.io/idea-tracking-system/>): apresenta o ITS, mostra como ele funciona, os recursos e um vídeo curto do caminho de uma ideia, e leva à instalação e à documentação, em português e em inglês. A documentação continua nos mesmos endereços, e dentro de uma instalação a Ajuda abre direto nela, como antes.
- O site público também pode ser publicado à mão, sem versão nova (fluxo `pages.yml`).

## [1.0.0] - 2026-11-20

Primeira versão pública do ITS – Idea Tracking System (Sistema de Acompanhamento de Ideias).

### Adicionado

- **Instalação:** Docker Compose com imagens prontas no GitHub (`ghcr.io/ivanbelshoff`) e no Docker Hub (`ivanbelshoff`), para amd64 e arm64; `.env` obrigatório, sem senha padrão; assistente de instalação que cria a organização e o primeiro administrador, no idioma escolhido.
- **Organização:** entidades em árvore, perfis com permissões por entidade (cinco de fábrica, editáveis), usuários com campos personalizados e cadastro no primeiro acesso.
- **Ideias:** envio, triagem (inclusive em volume), aprovação, execução em etapas com prazo e anexos, histórico completo, ideias parecidas e convergência, prazo de retorno e regras de atribuição.
- **Resultado:** ganho declarado e validado, padronização, campanhas, indicadores e relatórios em CSV e PDF.
- **Comunicação:** notificações no sino e por e-mail (SMTP, Microsoft 365 ou Google Workspace), resumo diário, avisos na tela e consulta pública opcional por código.
- **Reconhecimento:** pontos, níveis, conquistas, Hall de destaques, mural de ideias e loja de pontos e bonificações, sempre com o consentimento de quem aparece.
- **Aprovação de outras áreas:** o aval de quem responde pela mudança, com ou sem usuário no ITS.
- **Identidade:** cor, logo e fonte da organização, tela de login com 6 layouts e fundo próprio, cor e fonte por pessoa.
- **Acesso:** login por e-mail e senha, e login corporativo com Microsoft e Google (desligado de fábrica).
- **Operação:** observabilidade com saúde, métricas e alertas; segredos com validade acompanhada.
- **Integrações:** API de leitura e escrita com tokens e escopo por entidade, e webhooks de saída assinados (desligados de fábrica).
- **Interface e Ajuda** em português e em inglês; a Ajuda interativa, com simuladores, vem em toda instalação e também está aberta em <https://ivanbelshoff.github.io/idea-tracking-system/>.
