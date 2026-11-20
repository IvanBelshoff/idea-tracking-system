# Como contribuir

O projeto está na fase de desenho (marco M0). Contribuições de ideias e revisão das regras já ajudam muito.

## Antes de escrever código

1. Leia [docs/REGRAS-DE-NEGOCIO.md](docs/REGRAS-DE-NEGOCIO.md) e [docs/CRITERIOS-DE-ACEITE.md](docs/CRITERIOS-DE-ACEITE.md). **As regras são a fonte da verdade.**
2. Toda mudança de comportamento começa por uma alteração (ou um novo item) nas regras e nos critérios, discutida em uma *issue*.
3. Veja o [roadmap](docs/ROADMAP.md): o que a 1.0 tem e as ideias para depois. Uma ideia nova entra numa versão quando tiver regra escrita e critérios de aceite.

## Regras de código

- TypeScript em modo estrito; sem `any` desnecessário.
- Cada teste automatizado leva o identificador do critério no nome (ex.: `CA-RN-05.1 recusar exige justificativa`).
- Regras de negócio em funções puras, com teste unitário; acesso a dados por repositórios, sempre passando pelo escopo central (`applyScope`).
- Nada de segredos, dados reais ou credenciais no repositório. Dados de demonstração são sempre fictícios.
- Mudanças no banco só por **migração** (`synchronize` fica desligado), testada do zero e com reversão.

## Pull requests

- Um assunto por PR, com a pipeline verde.
- Descreva qual regra (RN) e quais critérios (CA) o PR atende.
- Textos de interface nos dois idiomas (pt-BR e en).

## Publicar uma versão

Quem mantém o projeto publica assim (versionamento semântico, uma versão só para backend, frontend e Ajuda):

1. Atualize a `version` dos três `package.json` (`backend`, `frontend` e `ajuda`) e escreva a seção `## [X.Y.Z] - AAAA-MM-DD` no `CHANGELOG.md`, no mesmo commit, já na `main`.
2. Crie e envie a tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

O fluxo `release.yml` confere que a tag bate com os `package.json` e com o CHANGELOG, roda as mesmas verificações da CI, monta `its-api`, `its-web` e `its-ajuda` para amd64 e arm64, publica no GitHub (`ghcr.io/ivanbelshoff`) e no Docker Hub (`ivanbelshoff`) com as etiquetas `X.Y.Z`, `X.Y`, `X` e `latest`, e cria o release com o trecho do CHANGELOG. Uma versão de teste (`vX.Y.Z-rc.N`) sai só com o número exato.

Para vulnerabilidades, **não** abra uma *issue* pública: veja [SECURITY.md](SECURITY.md).
