# Política de segurança

O sistema lida com dados de pessoas dentro de organizações, então levamos segurança a sério.

## Como reportar uma vulnerabilidade

**Não abra uma *issue* pública.** Envie um relato privado ao mantenedor (o canal de contato será definido antes do primeiro lançamento público; até lá, use o recurso de aviso de segurança privado do repositório quando ele estiver hospedado).

Inclua, se possível: versão, passos para reproduzir, impacto esperado e, se tiver, uma sugestão de correção.

## O que esperar

- Confirmação de recebimento e avaliação do relato.
- Correção e divulgação coordenadas, com crédito a quem reportou (se desejar).

## Versões com suporte

Ainda não há versão lançada. Esta seção será preenchida a partir da v0.1.

## Princípios de segurança do projeto

Resumo; detalhes em [docs/REGRAS-DE-NEGOCIO.md](docs/REGRAS-DE-NEGOCIO.md):

- Nenhuma escrita pública; consulta pública opcional, limitada e sem dados pessoais.
- Permissão e escopo verificados em toda rota (RN-01).
- Sem usuário ou senha padrão; instalação por assistente (RN-43).
- Senhas com Argon2id, bloqueio por tentativas, recuperação por link de uso único.
- Segredos cifrados no banco; nunca em logs.
